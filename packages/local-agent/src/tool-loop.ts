import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { Effect, Predicate, Schema } from "effect";

import { parseTraceOutput } from "@neuve/shared/parse-trace-output";
import {
  Action,
  AgentTurn,
  AgentTurnLoose,
  AssertionFailed,
  PlanUpdate,
  RunCompleted,
  StepDone,
  Thought,
  parseAgentTurnFromString,
} from "@neuve/shared/react-envelope";
import { rollTrajectory } from "@neuve/shared/trajectory";

import type {
  OllamaClient,
  OllamaMessage,
  OllamaToolDefinition,
} from "./ollama-client.js";
import type { McpBridge, McpToolCallResult } from "./mcp-bridge.js";

import { log } from "./log.js";

const MAX_TOOL_ROUNDS = 15;
const DOOM_LOOP_THRESHOLD = 3;
const TRACE_STOPPED_SENTINEL = "The performance trace has been stopped.";

// R6 multi-modal: after a successful ACTION on one of these tools we capture
// a viewport screenshot and attach to the next observation message. `interact`
// covers navigate/click/fill/hover/etc.; the flat tools (`click`, `fill`,
// `hover`, `select`) cover the legacy interactions tool surface. `observe`
// and `trace` are excluded — they don't mutate state.
const STATE_CHANGING_TOOL_NAMES = new Set([
  "interact",
  "click",
  "fill",
  "hover",
  "select",
]);

// AgentTurn JSON Schema generated once at module load. Variant B (locked
// 2026-04-25) constrains every Gemma turn to one of THOUGHT / ACTION /
// PLAN_UPDATE / STEP_DONE / ASSERTION_FAILED / RUN_COMPLETED — Ollama's
// `format` parameter applies this as a llama.cpp grammar so the model
// physically cannot emit non-conforming output. The loop dispatches on
// `_tag`; native `message.tool_calls` are intentionally ignored.
//
// R7 phase 7 — the format grammar uses `AgentTurnLoose` (Ollama-only path).
// The strict per-tool union the gemini-react path uses for responseSchema
// is too complex for llama.cpp's grammar engine: the depth-6 anyOf 27 KB
// schema overwhelms the compiler for complex prompts, the model emits zero
// bytes, and `result.content.length === 0` bails the loop. Full-sweep R7
// evidence: 7/20 gemma traces hit this mode. The loose schema (`args:
// Schema.Unknown`, no per-tool union) keeps the envelope contract intact
// while shrinking the grammar back to R5b-equivalent complexity. Runtime
// validation still goes through the strict `parseAgentTurnFromString`
// below — gemma's typical canonical/shorthand emissions are strict-valid.
const AGENT_TURN_FORMAT = (() => {
  const document = Schema.toJsonSchemaDocument(AgentTurnLoose);
  return { ...document.schema, $defs: document.definitions };
})();

interface AutoDrillTarget {
  readonly insightSetId: string;
  readonly insightName: string;
}

const collectAutoDrillTargets = (traceResultText: string): AutoDrillTarget[] => {
  const snapshots = parseTraceOutput(traceResultText);
  const seen = new Set<string>();
  const targets: AutoDrillTarget[] = [];
  for (const snapshot of snapshots) {
    for (const insight of snapshot.insights) {
      const key = `${insight.insightSetId}::${insight.insightName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        insightSetId: insight.insightSetId,
        insightName: insight.insightName,
      });
    }
  }
  return targets;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  Predicate.isObject(value) ? { ...value } : {};

export interface ToolLoopOptions {
  sessionId: string;
  messages: OllamaMessage[];
  tools: OllamaToolDefinition[];
  ollamaClient: OllamaClient;
  mcpBridge: McpBridge;
  connection: AgentSideConnection;
  signal: AbortSignal;
}

interface ToolCallFingerprint {
  toolName: string;
  argsHash: string;
}

interface ParseFailure {
  readonly _tag: "__parse_failure__";
  readonly cause: string;
}

const parseEnvelope = (
  content: string,
): Promise<typeof AgentTurn.Type | ParseFailure> =>
  Effect.runPromise(
    parseAgentTurnFromString(content).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.succeed<ParseFailure>({
          _tag: "__parse_failure__",
          cause: String(cause),
        }),
      ),
    ),
  );

export const runToolLoop = async (options: ToolLoopOptions): Promise<void> => {
  const { sessionId, messages, tools, ollamaClient, mcpBridge, connection, signal } = options;

  const recentCalls: ToolCallFingerprint[] = [];
  let lastToolError: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) return;

    // R4 trajectory rolling: keep the full chat history in `messages` so the
    // post-loop session caller can replay/inspect it, but send only the
    // rolled view to Ollama. Older assistant/observation pairs collapse into
    // a single `<trajectory_summary>` block; the most recent N=10 pairs stay
    // verbatim. See `packages/shared/src/trajectory.ts` and PRD §R4.
    const rolled = rollTrajectory(messages);
    log("calling ollama", {
      round,
      messageCount: messages.length,
      sentMessageCount: rolled.messages.length,
      summarizedTurns: rolled.summarizedTurnCount,
      verbatimTurns: rolled.verbatimTurnCount,
      toolCount: tools.length,
    });

    const result = await Effect.runPromise(
      ollamaClient.chat({
        messages: rolled.messages,
        tools,
        format: AGENT_TURN_FORMAT,
        signal,
      }),
    );

    if (result.usage) {
      const totalTokens = result.usage.promptEvalCount + result.usage.evalCount;
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "usage_update",
          size: totalTokens,
          used: totalTokens,
          _meta: {
            promptTokens: result.usage.promptEvalCount,
            completionTokens: result.usage.evalCount,
            totalTokens,
          },
        },
      });
      log("usage reported", {
        round,
        promptTokens: result.usage.promptEvalCount,
        completionTokens: result.usage.evalCount,
      });
    }

    log("ollama responded", {
      round,
      doneReason: result.doneReason,
      contentLength: result.content.length,
      contentPreview: result.content.slice(0, 200),
    });

    // The format-grammar guarantees the assistant message IS an AgentTurn JSON
    // envelope. Append it verbatim to message history so subsequent turns
    // see the prior envelopes.
    messages.push({ role: "assistant", content: result.content });

    if (result.content.length === 0) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `[Local agent: model returned empty content at round ${round} with done_reason="${result.doneReason ?? "unknown"}". The format grammar should have prevented this — likely a server-side cancellation.]`,
          },
        },
      });
      return;
    }

    const envelope = await parseEnvelope(result.content);

    if (envelope._tag === "__parse_failure__") {
      log("schema-invalid envelope", { cause: envelope.cause });
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `[Local agent: non-schema-valid agent output. Aborting run. Cause: ${envelope.cause}]`,
          },
        },
      });
      return;
    }

    // Emit the structured AgentTurn FIRST per R3 wire contract — supervisor's
    // ReAct reducer needs the typed envelope before any display-oriented update
    // arrives so REFLECT / cap-exceeded signals stay ordered with the next-turn
    // prompt assembly. Display updates below follow for UI compatibility.
    // The SDK's `session/update` channel is closed-union zod-validated at
    // runtime, so we use the SDK-blessed `extNotification` extension method
    // with the `_neuve/agent_turn` method name. The supervisor-side acp-client
    // implements `extNotification` to synthesize an `AcpAgentTurnUpdate` and
    // offer it to the session updates queue.
    await connection.extNotification(
      "_neuve/agent_turn",
      // HACK: SDK extNotification typed as Record<string, unknown>; the AgentTurn
      // Schema.Class instance is not directly assignable but JSON-serializes
      // cleanly through JSON-RPC via JSON.stringify (its `_tag` and field
      // properties are enumerable own properties).
      {
        sessionId,
        agentTurn: envelope,
      } as unknown as Record<string, unknown>,
    );

    if (envelope instanceof Thought) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: envelope.thought },
        },
      });
      messages.push({
        role: "user",
        content: `<observation>(THOUGHT recorded for ${envelope.stepId} — proceed with the next ACTION or status envelope.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof PlanUpdate) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: {
            type: "text",
            text: `[PLAN_UPDATE action=${envelope.action} step=${envelope.stepId}]`,
          },
        },
      });
      messages.push({
        role: "user",
        content: `<observation>(plan updated: action=${envelope.action} step=${envelope.stepId} — proceed.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof StepDone) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `[STEP_DONE ${envelope.stepId}] ${envelope.summary}`,
          },
        },
      });
      messages.push({
        role: "user",
        content: `<observation>(STEP_DONE recorded for ${envelope.stepId} — advance to next step or emit RUN_COMPLETED.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof AssertionFailed) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `[ASSERTION_FAILED ${envelope.stepId} | category=${envelope.category} domain=${envelope.domain}] ${envelope.reason}`,
          },
        },
      });
      messages.push({
        role: "user",
        content: `<observation>(ASSERTION_FAILED recorded for ${envelope.stepId} — choose between retry, replan via PLAN_UPDATE, or RUN_COMPLETED.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof RunCompleted) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `[RUN_COMPLETED|${envelope.status}] ${envelope.summary}`,
          },
        },
      });
      log("run completed", { status: envelope.status, round });
      return;
    }

    if (envelope instanceof Action) {
      const functionName = envelope.toolName;
      const args = toRecord(envelope.args);
      const argsHash = JSON.stringify(args);

      const lastCall = recentCalls[recentCalls.length - 1];
      const matchesLast =
        Boolean(lastCall) && lastCall?.toolName === functionName && lastCall?.argsHash === argsHash;
      if (!matchesLast) {
        recentCalls.length = 0;
      }
      const wouldTripThreshold = matchesLast && recentCalls.length >= DOOM_LOOP_THRESHOLD - 1;
      const callId = crypto.randomUUID();
      if (wouldTripThreshold) {
        log("doom loop detected", { tool: functionName, repeats: DOOM_LOOP_THRESHOLD });
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: callId,
            title: functionName,
            kind: "read",
            status: "failed",
            rawInput: args,
          },
        });
        const lastErrorOrUnknown = lastToolError ?? "unknown";
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `[Local agent: detected ${DOOM_LOOP_THRESHOLD} identical consecutive ACTION envelopes (${functionName}). Aborting to avoid wasted cycles. Last error: ${lastErrorOrUnknown}. Check the tool description for the expected call shape.]`,
            },
          },
        });
        return;
      }
      recentCalls.push({ toolName: functionName, argsHash });
      if (recentCalls.length > DOOM_LOOP_THRESHOLD) {
        recentCalls.shift();
      }

      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: callId,
          title: functionName,
          kind: "read",
          status: "pending",
          rawInput: args,
        },
      });

      const { text, isError } = await mcpBridge.callTool(functionName, args);
      if (isError) {
        lastToolError = text;
      }
      const baseMessageText = isError
        ? `${text}\n\nHint: Check the tool's call shape in its description. Wrap your arguments under the wrapper key shown in the example.`
        : text;

      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: callId,
          title: functionName,
          status: isError ? "failed" : "completed",
          content: [{ type: "content", content: { type: "text", text: baseMessageText } }],
          rawOutput: baseMessageText,
        },
      });

      let combinedLlmText = baseMessageText;
      if (
        !isError &&
        functionName === "trace" &&
        baseMessageText.includes(TRACE_STOPPED_SENTINEL)
      ) {
        const targets = collectAutoDrillTargets(baseMessageText);
        log("auto-drill-in planned", {
          tool: "trace",
          targetCount: targets.length,
          insightNames: targets.map((target) => target.insightName),
        });

        const analyses: string[] = [];
        for (const target of targets) {
          if (signal.aborted) return;

          const analyzeArgs = {
            action: {
              command: "analyze" as const,
              insightSetId: target.insightSetId,
              insightName: target.insightName,
            },
          };
          const analyzeCallId = `auto-drill-${target.insightSetId}-${target.insightName}-${crypto.randomUUID()}`;

          log("auto-drill-in start", {
            tool: "trace",
            auto: true,
            insightSetId: target.insightSetId,
            insightName: target.insightName,
          });

          await connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: analyzeCallId,
              title: "trace",
              kind: "read",
              status: "pending",
              rawInput: analyzeArgs,
            },
          });

          let analyzeResult: McpToolCallResult;
          try {
            analyzeResult = await mcpBridge.callTool("trace", analyzeArgs);
          } catch (cause) {
            const errorText = cause instanceof Error ? cause.message : String(cause);
            analyzeResult = { text: errorText, isError: true };
          }

          await connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: analyzeCallId,
              title: "trace",
              status: analyzeResult.isError ? "failed" : "completed",
              content: [
                {
                  type: "content",
                  content: { type: "text", text: analyzeResult.text },
                },
              ],
              rawOutput: analyzeResult.text,
            },
          });

          log("auto-drill-in complete", {
            tool: "trace",
            auto: true,
            insightName: target.insightName,
            isError: analyzeResult.isError,
            textLength: analyzeResult.text.length,
          });

          if (analyzeResult.isError) {
            analyses.push(`### ${target.insightName}: error — ${analyzeResult.text}`);
          } else {
            analyses.push(analyzeResult.text);
          }
        }

        if (analyses.length > 0) {
          combinedLlmText = `${baseMessageText}\n\n${analyses.join("\n\n---\n\n")}`;
        }
      }

      // R6 multi-modal: after a successful state-changing ACTION (interact/
      // click/fill/hover/select), capture a viewport PNG via `observe.screenshot`
      // and attach to the next observation. Skipped on observe/trace (state
      // unchanged) and on failed actions. The image bytes ride on
      // `OllamaMessage.images` and serialize to Ollama's native `images: [...]`
      // wire field via `toWireMessage`. See Probe 1 (2026-04-27).
      let observationImages: ReadonlyArray<{ data: string; mimeType: string }> | undefined;
      if (!isError && STATE_CHANGING_TOOL_NAMES.has(functionName)) {
        let screenshotResult: McpToolCallResult;
        try {
          screenshotResult = await mcpBridge.callTool("observe", {
            action: { command: "screenshot", format: "png" },
          });
        } catch (cause) {
          screenshotResult = {
            text: cause instanceof Error ? cause.message : String(cause),
            isError: true,
          };
        }
        if (
          !screenshotResult.isError &&
          screenshotResult.images &&
          screenshotResult.images.length > 0
        ) {
          observationImages = screenshotResult.images.map((image) => ({
            data: image.data,
            mimeType: image.mimeType,
          }));
          log("attached screenshot to observation", {
            tool: functionName,
            screenshotBytes: screenshotResult.images.reduce(
              (sum, image) => sum + image.data.length,
              0,
            ),
          });
        } else {
          log("screenshot capture skipped", {
            tool: functionName,
            isError: screenshotResult.isError,
            hasImages: Boolean(screenshotResult.images?.length),
          });
        }
      }

      const observationMessage = observationImages
        ? {
            role: "user" as const,
            content: `<observation>${combinedLlmText}</observation>`,
            images: observationImages,
          }
        : {
            role: "user" as const,
            content: `<observation>${combinedLlmText}</observation>`,
          };
      messages.push(observationMessage);
      continue;
    }

    // Defensive — should be unreachable since AgentTurn is a closed union.
    log("unexpected envelope kind", { tag: (envelope as { _tag: string })._tag });
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `[Local agent: unexpected envelope tag at round ${round}. Aborting.]`,
        },
      },
    });
    return;
  }

  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: `\n\n[Reached maximum tool call rounds (${MAX_TOOL_ROUNDS}). Stopping.]`,
      },
    },
  });
};
