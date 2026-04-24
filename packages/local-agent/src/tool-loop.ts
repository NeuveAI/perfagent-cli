import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { OllamaClient } from "./ollama-client.js";
import type { McpBridge, McpToolCallResult } from "./mcp-bridge.js";

import { parseTraceOutput } from "@neuve/shared/parse-trace-output";

import { log } from "./log.js";

const MAX_TOOL_ROUNDS = 15;
const DOOM_LOOP_THRESHOLD = 3;
const TRACE_STOPPED_SENTINEL = "The performance trace has been stopped.";

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

export interface ToolLoopOptions {
  sessionId: string;
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  ollamaClient: OllamaClient;
  mcpBridge: McpBridge;
  connection: AgentSideConnection;
  signal: AbortSignal;
}

interface ToolCallFingerprint {
  toolName: string;
  argsHash: string;
}

export const runToolLoop = async (options: ToolLoopOptions): Promise<void> => {
  const { sessionId, messages, tools, ollamaClient, mcpBridge, connection, signal } = options;

  const recentCalls: ToolCallFingerprint[] = [];
  let lastToolError: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) return;

    log("calling ollama", { round, messageCount: messages.length, toolCount: tools.length });
    const completion = await ollamaClient.complete({ messages, tools, signal });
    const choice = completion.choices[0];
    // Emit a usage_update session update per completion so the harness can
    // attribute tokens to the executor turn. ACP's UsageUpdate type only
    // carries cumulative `size`/`used` tokens; per-call prompt/completion
    // split is vendor-specific, so we route it through `_meta` (the
    // ACP-sanctioned extensibility channel) where @neuve/shared's
    // `AcpUsageUpdate` schema picks it up.
    if (completion.usage) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "usage_update",
          size: completion.usage.total_tokens,
          used: completion.usage.total_tokens,
          _meta: {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          },
        },
      });
      log("usage reported", {
        round,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
      });
    }
    if (!choice) {
      log("ollama returned no choices");
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "[Local agent: Ollama returned no choices]" },
        },
      });
      return;
    }
    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls;
    log("ollama responded", {
      round,
      finishReason: choice.finish_reason,
      hasToolCalls: Boolean(toolCalls?.length),
      toolCallCount: toolCalls?.length ?? 0,
      contentPreview: (assistantMessage.content ?? "").slice(0, 200),
    });

    messages.push(assistantMessage);

    if (!toolCalls || toolCalls.length === 0) {
      const text =
        assistantMessage.content && assistantMessage.content.length > 0
          ? assistantMessage.content
          : `[Local agent: model returned empty response at round ${round} with finish_reason="${choice.finish_reason}". The model may not support tool calling or the system prompt may need adjustment.]`;
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
      return;
    }

    for (const toolCall of toolCalls) {
      if (signal.aborted) return;

      const functionName = toolCall.function.name;
      const rawArgs = toolCall.function.arguments;
      // Post-Q9-fix: Ollama emits structured `tool_calls` where `arguments`
      // is a valid JSON string per OpenAI spec. If parsing fails here, the
      // upstream emitted malformed JSON — we want that surfaced (the fiber
      // dies, the eval run records the failure) rather than papered over
      // with regex repairs that silently swallow the real signal.
      const args = JSON.parse(rawArgs) as Record<string, unknown>;

      const argsHash = JSON.stringify(args);
      const lastCall = recentCalls[recentCalls.length - 1];
      const matchesLast =
        Boolean(lastCall) && lastCall?.toolName === functionName && lastCall?.argsHash === argsHash;
      if (!matchesLast) {
        recentCalls.length = 0;
      }
      const wouldTripThreshold = matchesLast && recentCalls.length >= DOOM_LOOP_THRESHOLD - 1;
      if (wouldTripThreshold) {
        log("doom loop detected", { tool: functionName, repeats: DOOM_LOOP_THRESHOLD });
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: toolCall.id,
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
              text: `[Local agent: detected ${DOOM_LOOP_THRESHOLD} identical consecutive tool calls (${functionName}). Aborting to avoid wasted cycles. Last error: ${lastErrorOrUnknown}. Check the tool description for the expected call shape.]`,
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
          toolCallId: toolCall.id,
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
          toolCallId: toolCall.id,
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

      messages.push({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: combinedLlmText,
      });
    }

    if (assistantMessage.content) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: assistantMessage.content },
        },
      });
    }
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
