import { Effect, Schema } from "effect";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import {
  Action,
  AgentTurn,
  AssertionFailed,
  parseAgentTurn,
  PlanUpdate as PlanUpdateTurn,
  RunCompleted,
  StepDone,
  Thought,
} from "@neuve/shared/react-envelope";
import {
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpAgentTurnUpdate,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpUsageUpdate,
  type AcpSessionUpdate,
} from "@neuve/shared/models";
import { rollTrajectory } from "@neuve/shared/trajectory";
import type { McpBridge, McpToolCallResult } from "@neuve/local-agent/mcp-bridge";
import {
  GEMINI_REACT_DOOM_LOOP_THRESHOLD,
  GEMINI_REACT_MAX_TOOL_ROUNDS,
} from "./gemini-react-constants";

export class GeminiReactCallError extends Schema.ErrorClass<GeminiReactCallError>(
  "GeminiReactCallError",
)({
  _tag: Schema.tag("GeminiReactCallError"),
  cause: Schema.String,
  round: Schema.Number,
}) {
  message = `Gemini generateObject call failed at round ${this.round}: ${this.cause}`;
}

export type EmitUpdate = (update: AcpSessionUpdate) => void;

interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

interface ToolCallFingerprint {
  readonly toolName: string;
  readonly argsHash: string;
}

interface RunLoopOptions {
  readonly sessionId: string;
  readonly model: LanguageModel;
  readonly mcpBridge: McpBridge;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly modelId: string;
  readonly emit: EmitUpdate;
}

const AGENT_TURN_JSON_SCHEMA = (() => {
  const document = Schema.toJsonSchemaDocument(AgentTurn);
  // HACK: Effect's `Schema.toJsonSchemaDocument` produces a
  // `JsonSchema.Document<"draft-2020-12">` but the AI SDK's `jsonSchema`
  // helper accepts `JSONSchema7` (draft-07). The two specs share the
  // bulk of the same field set (type / properties / oneOf / required /
  // enum / etc.) but the meta-keys differ (`$defs` in 2020-12,
  // `definitions` in draft-07) and TypeScript's structural typing can't
  // bridge them without an `as unknown` step. Direct `as JSONSchema7`
  // fails with "insufficient overlap"; the double cast is the
  // documented workaround at the boundary between the two third-party
  // schema specs. AI SDK 7's Gemini provider tolerates `$defs` at
  // runtime (the only meta-key difference that matters for our union),
  // so the cast is safe in practice.
  return { ...document.schema, $defs: document.definitions } as unknown as JSONSchema7;
})();

const AGENT_TURN_RESPONSE_SCHEMA = jsonSchema<typeof AgentTurn.Type>(AGENT_TURN_JSON_SCHEMA, {
  validate: (value) => {
    const decoded = Schema.decodeUnknownExit(AgentTurn)(value);
    if (decoded._tag === "Success") {
      return { success: true, value: decoded.value };
    }
    return { success: false, error: new Error(String(decoded.cause)) };
  },
});

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

const buildAiMessagesFromHistory = (
  systemPrompt: string,
  history: ReadonlyArray<ChatMessage>,
) => {
  const trajectoryView = rollTrajectory(history);
  const messages: Array<{ readonly role: "system" | "user" | "assistant"; readonly content: string }> = [
    { role: "system", content: systemPrompt },
  ];
  for (const message of trajectoryView.messages) {
    messages.push({
      role: message.role as "system" | "user" | "assistant",
      content: message.content,
    });
  }
  return messages;
};

const emitAgentTurn = (emit: EmitUpdate, envelope: typeof AgentTurn.Type): void => {
  emit(
    new AcpAgentTurnUpdate({
      sessionUpdate: "agent_turn",
      agentTurn: envelope,
    }),
  );
};

const emitThoughtChunk = (emit: EmitUpdate, text: string): void => {
  emit(
    new AcpAgentThoughtChunk({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text },
    }),
  );
};

const emitMessageChunk = (emit: EmitUpdate, text: string): void => {
  emit(
    new AcpAgentMessageChunk({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    }),
  );
};

const emitToolCallStarted = (
  emit: EmitUpdate,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): void => {
  emit(
    new AcpToolCall({
      sessionUpdate: "tool_call",
      toolCallId,
      title: toolName,
      kind: "read",
      status: "pending",
      rawInput: args,
    }),
  );
};

const emitToolCallCompleted = (
  emit: EmitUpdate,
  toolCallId: string,
  toolName: string,
  result: McpToolCallResult,
): void => {
  emit(
    new AcpToolCallUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId,
      title: toolName,
      status: result.isError ? "failed" : "completed",
      content: [{ type: "content", content: { type: "text", text: result.text } }],
      rawOutput: result.text,
    }),
  );
};

const emitUsageUpdate = (
  emit: EmitUpdate,
  promptTokens: number,
  completionTokens: number,
): void => {
  const totalTokens = promptTokens + completionTokens;
  emit(
    new AcpUsageUpdate({
      sessionUpdate: "usage_update",
      size: totalTokens,
      used: totalTokens,
      _meta: { promptTokens, completionTokens, totalTokens },
    }),
  );
};

/**
 * runGeminiReactLoop — drives the same ReAct envelope contract the local-agent
 * tool-loop runs (THOUGHT / ACTION / PLAN_UPDATE / STEP_DONE / ASSERTION_FAILED
 * / RUN_COMPLETED) but with Gemini Flash 3 as the LLM. Each round:
 *
 *   1. Roll trajectory (last N=10 turns verbatim, older summarized — the same
 *      `rollTrajectory` helper @neuve/local-agent uses).
 *   2. Call `generateObject({ schema: AgentTurn })`. The AI SDK enforces the
 *      schema server-side via Gemini's responseSchema; we re-validate via
 *      `parseAgentTurn` (Effect Schema) for defense in depth.
 *   3. Emit `agent_turn` first, then dispatch on `_tag`:
 *        - ACTION → tool_call → MCP bridge → tool_call_update → observation.
 *        - THOUGHT / PLAN_UPDATE / STEP_DONE / ASSERTION_FAILED → display
 *          chunk + observation (same observation strings the local-agent uses
 *          so the model sees a uniform conversation shape).
 *        - RUN_COMPLETED → display chunk → terminate.
 *   4. Emit `usage_update` so the supervisor's budget monitor and the
 *      TokenUsageBus see executor tokens.
 *
 * Loop ends on RUN_COMPLETED, max-rounds, or doom-loop detection (3 identical
 * consecutive ACTION envelopes — same threshold the local-agent uses). The
 * caller (gemini-agent.ts) closes the queue when this Effect resolves.
 */
export const runGeminiReactLoop = Effect.fn("GeminiReactLoop.run")(function* (
  options: RunLoopOptions,
) {
  const { sessionId, model, mcpBridge, systemPrompt, userPrompt, modelId, emit } = options;
  yield* Effect.annotateCurrentSpan({ sessionId, modelId });

  const history: ChatMessage[] = [{ role: "user", content: userPrompt }];
  const recentCalls: ToolCallFingerprint[] = [];
  let lastToolError: string | undefined;

  for (let round = 0; round < GEMINI_REACT_MAX_TOOL_ROUNDS; round++) {
    const aiMessages = buildAiMessagesFromHistory(systemPrompt, history);

    yield* Effect.logDebug("Gemini-react round starting", {
      round,
      sessionId,
      messageCount: aiMessages.length,
    });

    const generation = yield* Effect.tryPromise({
      try: () =>
        generateObject({
          model,
          schema: AGENT_TURN_RESPONSE_SCHEMA,
          schemaName: "AgentTurn",
          schemaDescription:
            "One ReAct envelope: THOUGHT, ACTION, PLAN_UPDATE, STEP_DONE, ASSERTION_FAILED, or RUN_COMPLETED.",
          messages: aiMessages,
        }),
      catch: (cause) =>
        new GeminiReactCallError({
          cause: cause instanceof Error ? cause.message : String(cause),
          round,
        }),
    });

    const promptTokens = generation.usage.inputTokens ?? 0;
    const completionTokens = generation.usage.outputTokens ?? 0;
    emitUsageUpdate(emit, promptTokens, completionTokens);

    const envelope = yield* parseAgentTurn(generation.object).pipe(
      Effect.catchTag("SchemaError", (schemaError) =>
        new GeminiReactCallError({
          cause: `AgentTurn re-validation failed: ${schemaError.message}`,
          round,
        }).asEffect(),
      ),
    );

    history.push({ role: "assistant", content: JSON.stringify(envelope) });
    emitAgentTurn(emit, envelope);

    if (envelope instanceof Thought) {
      emitThoughtChunk(emit, envelope.thought);
      history.push({
        role: "user",
        content: `<observation>(THOUGHT recorded for ${envelope.stepId} — proceed with the next ACTION or status envelope.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof PlanUpdateTurn) {
      emitThoughtChunk(emit, `[PLAN_UPDATE action=${envelope.action} step=${envelope.stepId}]`);
      history.push({
        role: "user",
        content: `<observation>(plan updated: action=${envelope.action} step=${envelope.stepId} — proceed.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof StepDone) {
      emitMessageChunk(emit, `[STEP_DONE ${envelope.stepId}] ${envelope.summary}`);
      history.push({
        role: "user",
        content: `<observation>(STEP_DONE recorded for ${envelope.stepId} — advance to next step or emit RUN_COMPLETED.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof AssertionFailed) {
      emitMessageChunk(
        emit,
        `[ASSERTION_FAILED ${envelope.stepId} | category=${envelope.category} domain=${envelope.domain}] ${envelope.reason}`,
      );
      history.push({
        role: "user",
        content: `<observation>(ASSERTION_FAILED recorded for ${envelope.stepId} — choose between retry, replan via PLAN_UPDATE, or RUN_COMPLETED.)</observation>`,
      });
      continue;
    }

    if (envelope instanceof RunCompleted) {
      emitMessageChunk(emit, `[RUN_COMPLETED|${envelope.status}] ${envelope.summary}`);
      yield* Effect.logInfo("Gemini-react run completed", {
        sessionId,
        round,
        status: envelope.status,
      });
      return;
    }

    if (envelope instanceof Action) {
      const toolName = envelope.toolName;
      const args = toRecord(envelope.args);
      const argsHash = JSON.stringify(args);
      const previousCall = recentCalls[recentCalls.length - 1];
      const matchesPrevious =
        previousCall !== undefined &&
        previousCall.toolName === toolName &&
        previousCall.argsHash === argsHash;
      if (!matchesPrevious) {
        recentCalls.length = 0;
      }
      const wouldTripDoomLoop =
        matchesPrevious && recentCalls.length >= GEMINI_REACT_DOOM_LOOP_THRESHOLD - 1;
      const toolCallId = crypto.randomUUID();

      if (wouldTripDoomLoop) {
        emitToolCallStarted(emit, toolCallId, toolName, args);
        emitMessageChunk(
          emit,
          `[Gemini-react: detected ${GEMINI_REACT_DOOM_LOOP_THRESHOLD} identical consecutive ACTION envelopes (${toolName}). Aborting to avoid wasted cycles. Last error: ${lastToolError ?? "unknown"}.]`,
        );
        yield* Effect.logWarning("Gemini-react doom loop detected", {
          sessionId,
          toolName,
          round,
          repeats: GEMINI_REACT_DOOM_LOOP_THRESHOLD,
        });
        return;
      }
      recentCalls.push({ toolName, argsHash });
      if (recentCalls.length > GEMINI_REACT_DOOM_LOOP_THRESHOLD) {
        recentCalls.shift();
      }

      emitToolCallStarted(emit, toolCallId, toolName, args);
      const toolResult: McpToolCallResult = yield* Effect.promise(() =>
        mcpBridge.callTool(toolName, args).catch(
          (cause) =>
            ({
              text: cause instanceof Error ? cause.message : String(cause),
              isError: true,
            }) satisfies McpToolCallResult,
        ),
      );

      if (toolResult.isError) {
        lastToolError = toolResult.text;
      }

      emitToolCallCompleted(emit, toolCallId, toolName, toolResult);

      const observationText = toolResult.isError
        ? `${toolResult.text}\n\nHint: Check the tool's call shape in its description. Wrap your arguments under the wrapper key shown in the example.`
        : toolResult.text;
      history.push({
        role: "user",
        content: `<observation>${observationText}</observation>`,
      });
      continue;
    }

    yield* Effect.logWarning("Gemini-react: unexpected envelope kind", {
      sessionId,
      round,
      tag: (envelope as { _tag: string })._tag,
    });
    emitMessageChunk(
      emit,
      `[Gemini-react: unexpected envelope tag at round ${round}. Aborting.]`,
    );
    return;
  }

  emitMessageChunk(
    emit,
    `\n\n[Reached maximum tool call rounds (${GEMINI_REACT_MAX_TOOL_ROUNDS}). Stopping.]`,
  );
  yield* Effect.logWarning("Gemini-react max rounds reached", {
    sessionId,
    maxRounds: GEMINI_REACT_MAX_TOOL_ROUNDS,
  });
});
