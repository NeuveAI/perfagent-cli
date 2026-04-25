import { describe, it, assert } from "vite-plus/test";
import { Effect } from "effect";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import {
  Action,
  AgentTurn,
  PlanUpdate as PlanUpdateTurn,
  RunCompleted,
  StepDone,
  Thought,
} from "@neuve/shared/react-envelope";
import {
  AcpAgentTurnUpdate,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpUsageUpdate,
  type AcpSessionUpdate,
} from "@neuve/shared/models";
import type { McpBridge, McpToolCallResult } from "@neuve/local-agent/mcp-bridge";
import {
  GeminiReactCallError,
  runGeminiReactLoop,
} from "../src/runners/gemini-react-loop";
import { GEMINI_REACT_DOOM_LOOP_THRESHOLD } from "../src/runners/gemini-react-constants";

const dummyResponseBase = {
  finishReason: { unified: "stop", raw: "stop" } as const,
  usage: {
    inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 50, text: 50, reasoning: undefined },
  },
  warnings: [],
};

const buildModelReturningSequence = (envelopes: ReadonlyArray<unknown>) => {
  let index = 0;
  return new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-gemini",
    doGenerate: async (_options: LanguageModelV4CallOptions) => {
      const envelope = envelopes[index++];
      if (envelope === undefined) {
        throw new Error(`Mock exhausted at call ${index}`);
      }
      return {
        ...dummyResponseBase,
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      };
    },
  });
};

const buildModelThrowing = (cause: Error, throwOnCall: number) => {
  let calls = 0;
  return new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-gemini",
    doGenerate: async () => {
      calls++;
      if (calls === throwOnCall) throw cause;
      return {
        ...dummyResponseBase,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              _tag: "RUN_COMPLETED",
              status: "passed",
              summary: "ok",
            }),
          },
        ],
      };
    },
  });
};

interface FakeMcpBridgeOptions {
  readonly results?: ReadonlyArray<McpToolCallResult>;
  readonly defaultResult?: McpToolCallResult;
}

const buildFakeMcpBridge = (options: FakeMcpBridgeOptions = {}): McpBridge & {
  readonly calls: ReadonlyArray<{ readonly name: string; readonly args: Record<string, unknown> }>;
} => {
  const calls: Array<{ readonly name: string; readonly args: Record<string, unknown> }> = [];
  const results = options.results ?? [];
  const defaultResult: McpToolCallResult = options.defaultResult ?? {
    text: "ok",
    isError: false,
  };
  return {
    listTools: () => [],
    callTool: async (name, args) => {
      calls.push({ name, args });
      return results[calls.length - 1] ?? defaultResult;
    },
    close: async () => {
      /* no-op for fake */
    },
    get calls() {
      return calls;
    },
  };
};

const collectEmits = () => {
  const updates: AcpSessionUpdate[] = [];
  const emit = (update: AcpSessionUpdate) => {
    updates.push(update);
  };
  return { updates, emit };
};

describe("runGeminiReactLoop happy path", () => {
  it("emits agent_turn for THOUGHT, dispatches ACTION through mcpBridge, terminates on RUN_COMPLETED", async () => {
    const envelopes = [
      {
        _tag: "THOUGHT",
        stepId: "step-01",
        thought: "Start by navigating to example.com",
      },
      {
        _tag: "ACTION",
        stepId: "step-01",
        toolName: "interact",
        args: { command: "navigate", url: "https://example.com/" },
      },
      {
        _tag: "STEP_DONE",
        stepId: "step-01",
        summary: "Landed on example.com",
      },
      {
        _tag: "RUN_COMPLETED",
        status: "passed",
        summary: "All steps complete",
      },
    ];
    const model = buildModelReturningSequence(envelopes);
    const mcpBridge = buildFakeMcpBridge({
      defaultResult: { text: "Navigated to https://example.com/", isError: false },
    });
    const { updates, emit } = collectEmits();

    await Effect.runPromise(
      runGeminiReactLoop({
        sessionId: "test-session-happy",
        model,
        mcpBridge,
        systemPrompt: "system",
        userPrompt: "navigate to example.com",
        modelId: "test-gemini",
        emit,
      }),
    );

    const agentTurns = updates.filter(
      (update): update is AcpAgentTurnUpdate => update.sessionUpdate === "agent_turn",
    );
    assert.strictEqual(agentTurns.length, 4, "one agent_turn per envelope");
    assert.instanceOf(agentTurns[0].agentTurn, Thought);
    assert.instanceOf(agentTurns[1].agentTurn, Action);
    assert.instanceOf(agentTurns[2].agentTurn, StepDone);
    assert.instanceOf(agentTurns[3].agentTurn, RunCompleted);

    const toolCalls = updates.filter(
      (update): update is AcpToolCall => update.sessionUpdate === "tool_call",
    );
    assert.strictEqual(toolCalls.length, 1);
    assert.strictEqual(toolCalls[0].title, "interact");
    assert.deepStrictEqual(toolCalls[0].rawInput, {
      command: "navigate",
      url: "https://example.com/",
    });

    const toolCallUpdates = updates.filter(
      (update): update is AcpToolCallUpdate => update.sessionUpdate === "tool_call_update",
    );
    assert.strictEqual(toolCallUpdates.length, 1);
    assert.strictEqual(toolCallUpdates[0].status, "completed");

    const usageUpdates = updates.filter(
      (update): update is AcpUsageUpdate => update.sessionUpdate === "usage_update",
    );
    assert.strictEqual(usageUpdates.length, 4, "one usage_update per generateObject call");
    assert.strictEqual(usageUpdates[0].promptTokens, 100);
    assert.strictEqual(usageUpdates[0].completionTokens, 50);

    assert.strictEqual(mcpBridge.calls.length, 1);
    assert.strictEqual(mcpBridge.calls[0].name, "interact");
  });
});

describe("runGeminiReactLoop PLAN_UPDATE flow", () => {
  it("dispatches PLAN_UPDATE envelopes through agent_turn so the supervisor's reducer sees them", async () => {
    const envelopes = [
      {
        _tag: "PLAN_UPDATE",
        stepId: "step-01",
        action: "insert",
        payload: {
          id: "step-01",
          title: "Open landing page",
          instruction: "Navigate to example.com",
          expectedOutcome: "Page loads",
          status: "pending",
        },
      },
      {
        _tag: "RUN_COMPLETED",
        status: "passed",
        summary: "Plan seeded",
      },
    ];
    const model = buildModelReturningSequence(envelopes);
    const mcpBridge = buildFakeMcpBridge();
    const { updates, emit } = collectEmits();

    await Effect.runPromise(
      runGeminiReactLoop({
        sessionId: "test-session-planupdate",
        model,
        mcpBridge,
        systemPrompt: "system",
        userPrompt: "plan a journey",
        modelId: "test-gemini",
        emit,
      }),
    );

    const agentTurns = updates.filter(
      (update): update is AcpAgentTurnUpdate => update.sessionUpdate === "agent_turn",
    );
    assert.strictEqual(agentTurns.length, 2);
    assert.instanceOf(agentTurns[0].agentTurn, PlanUpdateTurn);
    const planUpdate = agentTurns[0].agentTurn as PlanUpdateTurn;
    assert.strictEqual(planUpdate.action, "insert");
    assert.strictEqual(planUpdate.stepId, "step-01");
  });
});

describe("runGeminiReactLoop doom loop detection", () => {
  it("aborts after N identical consecutive ACTION envelopes", async () => {
    const repeatedAction = {
      _tag: "ACTION",
      stepId: "step-01",
      toolName: "interact",
      args: { command: "click", ref: "[5]" },
    };
    const envelopes = [
      repeatedAction,
      repeatedAction,
      repeatedAction,
      repeatedAction,
    ];
    const model = buildModelReturningSequence(envelopes);
    const mcpBridge = buildFakeMcpBridge({
      defaultResult: { text: "click failed", isError: true },
    });
    const { updates, emit } = collectEmits();

    await Effect.runPromise(
      runGeminiReactLoop({
        sessionId: "test-session-doom",
        model,
        mcpBridge,
        systemPrompt: "system",
        userPrompt: "loop forever",
        modelId: "test-gemini",
        emit,
      }),
    );

    const successfulToolCalls = mcpBridge.calls.length;
    assert.strictEqual(
      successfulToolCalls,
      GEMINI_REACT_DOOM_LOOP_THRESHOLD - 1,
      "doom-loop guard fires before the Nth identical call dispatches to MCP",
    );
    const messageChunks = updates.filter(
      (update) => update.sessionUpdate === "agent_message_chunk",
    );
    const aborted = messageChunks.some((chunk) =>
      "content" in chunk && typeof chunk.content === "object" && "text" in chunk.content
        ? chunk.content.text.includes("doom") || chunk.content.text.includes("identical")
        : false,
    );
    assert.isTrue(aborted, "abort message emitted on doom-loop trip");
  });
});

describe("runGeminiReactLoop error propagation", () => {
  it("surfaces a GeminiReactCallError when generateObject throws", async () => {
    const cause = new Error("503 Gemini upstream unavailable");
    const model = buildModelThrowing(cause, 1);
    const mcpBridge = buildFakeMcpBridge();
    const { emit } = collectEmits();

    const exit = await Effect.runPromiseExit(
      runGeminiReactLoop({
        sessionId: "test-session-error",
        model,
        mcpBridge,
        systemPrompt: "system",
        userPrompt: "trigger the error path",
        modelId: "test-gemini",
        emit,
      }),
    );

    assert.strictEqual(exit._tag, "Failure");
    if (exit._tag === "Failure") {
      const causeText = JSON.stringify(exit.cause);
      assert.match(
        causeText,
        /GeminiReactCallError|503/,
        "GeminiReactCallError or upstream cause surfaced via the failure cause",
      );
    }
  });
});

void GeminiReactCallError;

describe("runGeminiReactLoop schema-violation guard", () => {
  it("re-validates AgentTurn output via Effect Schema and fails loud on a non-conforming envelope", async () => {
    const malformed = {
      _tag: "MYSTERY_ENVELOPE",
      stepId: "step-01",
      thought: "should be rejected",
    };
    const model = buildModelReturningSequence([malformed]);
    const mcpBridge = buildFakeMcpBridge();
    const { emit } = collectEmits();

    const exit = await Effect.runPromiseExit(
      runGeminiReactLoop({
        sessionId: "test-session-schema",
        model,
        mcpBridge,
        systemPrompt: "system",
        userPrompt: "non-conforming",
        modelId: "test-gemini",
        emit,
      }),
    );

    // Either generateObject's internal schema-validation rejects it (preferred —
    // surfaces as a TypeValidationError before our re-validation), or our
    // parseAgentTurn step fails. Both terminate the loop with a typed error
    // rather than silently dispatching an unknown envelope.
    assert.strictEqual(exit._tag, "Failure");
  });
});

void AgentTurn;
