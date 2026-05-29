import type * as acp from "@agentclientprotocol/sdk";
import { Effect } from "effect";
import { assert, describe, it } from "vite-plus/test";

import { runToolLoop } from "../src/tool-loop.ts";
import type {
  OllamaChatResult,
  OllamaClient,
  OllamaCompletionOptions,
} from "../src/ollama-client.ts";
import type { McpBridge } from "../src/mcp-bridge.ts";

// Variant B (locked 2026-04-25) emits one AgentTurn per turn. This test
// drives `runToolLoop` through the canonical THOUGHT → ACTION → RUN_COMPLETED
// trajectory with the OllamaClient mocked to return scripted envelopes.
// Asserts: format grammar is sent on every turn, dispatch is by `_tag`,
// the tool gets called for ACTION, observation is fed back, and the loop
// exits cleanly on RUN_COMPLETED.

interface RecordedSessionUpdate {
  readonly sessionId: string;
  readonly update: acp.SessionNotification["update"];
}

interface RecordedChatRequest {
  readonly options: OllamaCompletionOptions;
}

interface RecordedToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

interface RecordedExtNotification {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

const makeRecordingConnection = (): {
  connection: acp.AgentSideConnection;
  updates: RecordedSessionUpdate[];
  extNotifications: RecordedExtNotification[];
} => {
  const updates: RecordedSessionUpdate[] = [];
  const extNotifications: RecordedExtNotification[] = [];
  const connection = {
    sessionUpdate: async (params: acp.SessionNotification): Promise<void> => {
      updates.push({ sessionId: params.sessionId, update: params.update });
    },
    extNotification: async (method: string, params: Record<string, unknown>): Promise<void> => {
      extNotifications.push({ method, params });
    },
  } as unknown as acp.AgentSideConnection;
  return { connection, updates, extNotifications };
};

const makeScriptedClient = (
  scriptedResults: ReadonlyArray<OllamaChatResult>,
): {
  client: OllamaClient;
  requests: RecordedChatRequest[];
} => {
  const requests: RecordedChatRequest[] = [];
  let cursor = 0;
  const chat = (options: OllamaCompletionOptions): ReturnType<OllamaClient["chat"]> => {
    requests.push({ options });
    const next = scriptedResults[cursor];
    cursor += 1;
    if (!next) {
      return Effect.die(
        new Error(
          `scripted client exhausted at cursor=${cursor}; expected exactly ${scriptedResults.length} chat calls`,
        ),
      ) as ReturnType<OllamaClient["chat"]>;
    }
    return Effect.succeed(next) as ReturnType<OllamaClient["chat"]>;
  };
  const checkHealth = (): ReturnType<OllamaClient["checkHealth"]> =>
    Effect.void as ReturnType<OllamaClient["checkHealth"]>;
  const client: OllamaClient = {
    model: "gemma4:e4b-test",
    baseUrl: "http://localhost:11434",
    chat,
    checkHealth,
  };
  return { client, requests };
};

const makeRecordingBridge = (
  toolResponses: Map<string, { text: string; isError: boolean }>,
): {
  bridge: McpBridge;
  calls: RecordedToolCall[];
} => {
  const calls: RecordedToolCall[] = [];
  const bridge: McpBridge = {
    listTools: () => [],
    callTool: async (name, args) => {
      calls.push({ name, args });
      const reply = toolResponses.get(name);
      return reply ?? { text: "no scripted response", isError: true };
    },
    close: async () => {},
  };
  return { bridge, calls };
};

const okResult = (content: string): OllamaChatResult => ({
  content,
  toolCalls: [],
  doneReason: "stop",
  usage: {
    promptEvalCount: 100,
    evalCount: 50,
    totalDuration: 1_000,
  },
});

const envelope = (value: unknown): string => JSON.stringify(value);

describe("runToolLoop — AgentTurn envelope dispatch", () => {
  it("dispatches THOUGHT → ACTION → RUN_COMPLETED, calls the tool, exits cleanly", async () => {
    const scripted = [
      okResult(
        envelope({
          _tag: "THOUGHT",
          stepId: "step-01",
          thought: "Navigate to the homepage to begin the trace.",
        }),
      ),
      okResult(
        envelope({
          _tag: "ACTION",
          stepId: "step-01",
          toolName: "interact",
          args: { command: "navigate", url: "https://example.com" },
        }),
      ),
      okResult(
        envelope({
          _tag: "RUN_COMPLETED",
          status: "passed",
          summary: "Homepage navigation completed; performance budget green.",
        }),
      ),
    ];
    const { client, requests } = makeScriptedClient(scripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge, calls } = makeRecordingBridge(
      new Map<string, { text: string; isError: boolean }>([
        ["interact", { text: "Navigated to https://example.com", isError: false }],
        // R6 multi-modal: a successful state-changing action triggers a
        // follow-up `observe { command: "screenshot" }` call. Stub it to a
        // text-only result so the test stays text-shape (no image bytes
        // need to flow through the recording connection).
        ["observe", { text: "Took a screenshot of the current page's viewport.", isError: false }],
      ]),
    );
    const messages = [{ role: "system" as const, content: "(system)" }];
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "interact",
          description: "Interact with a page",
          parameters: { type: "object" as const, properties: {} },
        },
      },
    ];

    await runToolLoop({
      sessionId: "test-session",
      messages,
      tools,
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    // Three chat calls — one per envelope.
    assert.strictEqual(requests.length, 3, "expected 3 chat requests, one per envelope");

    // Every chat call carries the AgentTurn JSON Schema in `format`.
    for (const request of requests) {
      assert.isDefined(request.options.format, "every chat call must pass `format`");
      const formatSchema = request.options.format as { anyOf?: unknown };
      assert.isArray(formatSchema.anyOf, "format schema must be an anyOf union");
    }

    // R6: a successful state-changing ACTION (interact/click/fill/hover/select)
    // is followed by an automatic `observe { command: "screenshot" }` capture
    // so the next observation can attach the post-action viewport. Two calls
    // expected: the ACTION itself and the screenshot.
    assert.strictEqual(calls.length, 2, "expected ACTION + screenshot capture");
    assert.strictEqual(calls[0]?.name, "interact");
    assert.deepStrictEqual(calls[0]?.args, {
      command: "navigate",
      url: "https://example.com",
    });
    assert.strictEqual(calls[1]?.name, "observe");
    assert.deepStrictEqual(calls[1]?.args, {
      action: { command: "screenshot", format: "png" },
    });

    // Session updates: THOUGHT (agent_thought_chunk) + tool_call+tool_call_update +
    // RUN_COMPLETED (agent_message_chunk). Three usage_update events too (one per turn).
    const updateKinds = updates.map((entry) => entry.update.sessionUpdate);
    assert.include(updateKinds, "agent_thought_chunk");
    assert.include(updateKinds, "tool_call");
    assert.include(updateKinds, "tool_call_update");
    assert.include(updateKinds, "agent_message_chunk");
    assert.strictEqual(
      updateKinds.filter((kind) => kind === "usage_update").length,
      3,
      "expected one usage_update per chat call",
    );

    // The RUN_COMPLETED summary must be present in the final agent_message_chunk.
    const finalMessage = updates
      .filter((entry) => entry.update.sessionUpdate === "agent_message_chunk")
      .at(-1);
    assert.isDefined(finalMessage, "expected at least one agent_message_chunk");
    const finalContent =
      finalMessage?.update.sessionUpdate === "agent_message_chunk"
        ? finalMessage.update.content
        : undefined;
    assert.isDefined(finalContent);
    assert.match(
      finalContent && finalContent.type === "text" ? finalContent.text : "",
      /RUN_COMPLETED\|passed/,
    );

    // After the run the message history should contain the assistant turns and
    // an observation feedback per non-RUN_COMPLETED envelope.
    const roles = messages.map((message) => message.role);
    assert.deepStrictEqual(
      roles,
      [
        "system",
        // Round 1: THOUGHT envelope
        "assistant",
        "user", // observation feedback for THOUGHT
        // Round 2: ACTION envelope
        "assistant",
        "user", // observation feedback for ACTION (tool result)
        // Round 3: RUN_COMPLETED envelope
        "assistant",
        // No observation appended after RUN_COMPLETED — loop exits.
      ],
      "message history should reflect THOUGHT/ACTION/RUN_COMPLETED in order",
    );
  });

  it("aborts cleanly after DOOM_LOOP_THRESHOLD same-shape parse failures", async () => {
    // harness-r3 P1: parse failures no longer abort on the first occurrence —
    // they're fed back as observations and tracked. After 3 same-shape
    // failures in a row the existing doom-loop seam aborts. The 2nd repeat
    // additionally triggers a REFLECT injection (asserted in a separate
    // test below).
    const malformed = "this is not a JSON envelope, sorry";
    const scripted = [okResult(malformed), okResult(malformed), okResult(malformed)];
    const { client } = makeScriptedClient(scripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge, calls } = makeRecordingBridge(new Map());

    await runToolLoop({
      sessionId: "test-session",
      messages: [{ role: "system", content: "(system)" }],
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    assert.strictEqual(calls.length, 0, "no tool call expected on parse failure");
    const finalUpdate = updates.at(-1);
    assert.strictEqual(finalUpdate?.update.sessionUpdate, "agent_message_chunk");
    const finalContent =
      finalUpdate?.update.sessionUpdate === "agent_message_chunk"
        ? finalUpdate.update.content
        : undefined;
    assert.match(
      finalContent && finalContent.type === "text" ? finalContent.text : "",
      /non-schema-valid agent output 3× in a row\. Aborting run/,
    );
  });

  it("injects a REFLECT directive after 2 consecutive same-shape parse failures (BMW pattern)", async () => {
    // harness-r3 P1 — fixture-shaped after the canonical journey-1-bmw trace
    // at evals/traces/wave-harness-r2-plan-update/gemma-react__journey-1-car-configurator-bmw.ndjson.
    // The model recognizes the cookie-banner gap in <thought>, then emits an
    // ACTION envelope with `args:{uid:"1_182"}` missing the `command`
    // discriminator, which fails the per-tool union parse. Pre-r3 the loop
    // aborted on the first SchemaError; post-r3 the loop feeds it back as an
    // observation, and on the second identical emission injects a REFLECT
    // directive into the next observation (and surfaces a chunk to the UI).
    const cookieBannerThought = envelope({
      _tag: "THOUGHT",
      stepId: "step-2",
      thought: "The page has a cookie banner that needs to be dismissed.",
    });
    // Malformed envelope: `_tag:"ACTION"`, `args.uid` only, no `command`.
    // The strict per-tool union (in @neuve/shared/react-envelope) rejects this.
    const malformedAction = envelope({
      _tag: "ACTION",
      stepId: "step-2",
      toolName: "interact",
      args: { uid: "1_182" },
    });
    const scripted = [
      okResult(cookieBannerThought),
      okResult(malformedAction),
      okResult(malformedAction),
      okResult(
        envelope({
          _tag: "RUN_COMPLETED",
          status: "passed",
          summary: "Trajectory complete after REFLECT recovery.",
        }),
      ),
    ];
    const { client } = makeScriptedClient(scripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge, calls } = makeRecordingBridge(new Map());
    const messages = [{ role: "system" as const, content: "(system)" }];

    await runToolLoop({
      sessionId: "test-session",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    assert.strictEqual(calls.length, 0, "no tool call expected on parse failure path");

    // After the second same-shape parse failure the harness must emit an
    // agent_message_chunk containing the REFLECT directive marker.
    const reflectMessage = updates
      .filter((entry) => entry.update.sessionUpdate === "agent_message_chunk")
      .find((entry) => {
        if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
        const text = entry.update.content.type === "text" ? entry.update.content.text : "";
        return text.includes("REFLECT:") && text.includes("PLAN_UPDATE");
      });
    assert.isDefined(reflectMessage, "expected an agent_message_chunk announcing REFLECT");

    // The user-role observation message that follows the second parse fail
    // must carry the <observation>REFLECT: ...</observation> prefix so the
    // model sees it on the next round.
    const observationMessages = messages.filter((message) => message.role === "user");
    const reflectObservation = observationMessages.find((message) =>
      message.content.includes("<observation>REFLECT:"),
    );
    assert.isDefined(reflectObservation, "expected REFLECT observation prefix in message history");
  });

  it("does not inject REFLECT on healthy trajectories (specificity)", async () => {
    // harness-r3 P1 — Gate 1.4 specificity check. THOUGHT -> ACTION -> success
    // -> RUN_COMPLETED has zero rejection signals; no REFLECT directive
    // should fire.
    const scripted = [
      okResult(envelope({ _tag: "THOUGHT", stepId: "step-1", thought: "Navigate first." })),
      okResult(
        envelope({
          _tag: "ACTION",
          stepId: "step-1",
          toolName: "interact",
          args: { command: "navigate", url: "https://example.com" },
        }),
      ),
      okResult(envelope({ _tag: "RUN_COMPLETED", status: "passed", summary: "Done." })),
    ];
    const { client } = makeScriptedClient(scripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge } = makeRecordingBridge(
      new Map<string, { text: string; isError: boolean }>([
        ["interact", { text: "navigated", isError: false }],
        ["observe", { text: "screenshot stub", isError: false }],
      ]),
    );
    const messages = [{ role: "system" as const, content: "(system)" }];

    await runToolLoop({
      sessionId: "test-session",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    const anyReflect = updates.some((entry) => {
      if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
      const text = entry.update.content.type === "text" ? entry.update.content.text : "";
      return text.includes("REFLECT:");
    });
    assert.isFalse(anyReflect, "REFLECT must not fire on a healthy trajectory");

    const anyReflectInHistory = messages.some(
      (message) => message.role === "user" && message.content.includes("REFLECT:"),
    );
    assert.isFalse(
      anyReflectInHistory,
      "REFLECT must not be injected into observation history on healthy trajectories",
    );
  });

  it("injects a REFLECT directive after 2 consecutive same-shape tool-error rejections", async () => {
    // harness-r3 P1 — second trigger path: ACTION parses cleanly, but the
    // MCP bridge returns isError=true on the same stepId+tool+args twice in
    // a row (e.g. wait_for{text:[]} not finding the text). Inject REFLECT
    // before the doom-loop's 3rd-strike abort.
    const stuckAction = envelope({
      _tag: "ACTION",
      stepId: "step-2",
      toolName: "interact",
      args: { command: "click", uid: "stale-uid" },
    });
    const scripted = [
      okResult(stuckAction),
      okResult(stuckAction),
      okResult(envelope({ _tag: "RUN_COMPLETED", status: "passed", summary: "Recovered." })),
    ];
    const { client } = makeScriptedClient(scripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge } = makeRecordingBridge(
      new Map<string, { text: string; isError: boolean }>([
        ["interact", { text: "Element not found for uid='stale-uid'", isError: true }],
      ]),
    );
    const messages = [{ role: "system" as const, content: "(system)" }];

    await runToolLoop({
      sessionId: "test-session",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    const reflectChunk = updates.some((entry) => {
      if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
      const text = entry.update.content.type === "text" ? entry.update.content.text : "";
      return text.includes("REFLECT:") && text.includes("PLAN_UPDATE");
    });
    assert.isTrue(reflectChunk, "expected REFLECT chunk after 2 same-shape tool errors");

    const reflectInHistory = messages.some(
      (message) => message.role === "user" && message.content.includes("<observation>REFLECT:"),
    );
    assert.isTrue(
      reflectInHistory,
      "expected REFLECT prefix in next observation after tool-error streak",
    );
  });

  // PLAN_UPDATE / STEP_DONE / ASSERTION_FAILED dispatch tests.  Each runs
  // the loop with one of the three "non-action, non-completed" envelopes
  // followed by RUN_COMPLETED, and asserts the loop continues, dispatches
  // through the expected ACP session-update channel, fires no MCP tool,
  // and the message history reflects "assistant + observation user msg"
  // before the RUN_COMPLETED turn.

  const runDispatchScenario = async (
    midTurnEnvelope: Record<string, unknown>,
  ): Promise<{
    updates: RecordedSessionUpdate[];
    calls: RecordedToolCall[];
    messages: Array<{
      readonly role: "system" | "user" | "assistant" | "tool";
      readonly content: string;
    }>;
  }> => {
    const scripted = [
      okResult(envelope(midTurnEnvelope)),
      okResult(
        envelope({
          _tag: "RUN_COMPLETED",
          status: "passed",
          summary: "Trajectory complete.",
        }),
      ),
    ];
    const { client } = makeScriptedClient(scripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge, calls } = makeRecordingBridge(new Map());
    const messages = [{ role: "system" as const, content: "(system)" }];
    await runToolLoop({
      sessionId: "test-session",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });
    return { updates, calls, messages };
  };

  it("dispatches PLAN_UPDATE through agent_thought_chunk and continues the loop", async () => {
    const { updates, calls, messages } = await runDispatchScenario({
      _tag: "PLAN_UPDATE",
      stepId: "step-02",
      action: "insert",
      payload: { id: "step-02", title: "Verify analytics", status: "pending" },
    });

    assert.strictEqual(calls.length, 0, "PLAN_UPDATE does not invoke tools");
    const thoughtUpdates = updates.filter(
      (entry) => entry.update.sessionUpdate === "agent_thought_chunk",
    );
    const matched = thoughtUpdates.some((entry) => {
      if (entry.update.sessionUpdate !== "agent_thought_chunk") return false;
      const text = entry.update.content.type === "text" ? entry.update.content.text : "";
      return text.includes("PLAN_UPDATE") && text.includes("step-02") && text.includes("insert");
    });
    assert.isTrue(matched, "expected PLAN_UPDATE to surface as agent_thought_chunk");
    assert.deepStrictEqual(
      messages.map((m) => m.role),
      [
        "system",
        "assistant", // PLAN_UPDATE envelope
        "user", // observation feedback
        "assistant", // RUN_COMPLETED
      ],
    );
  });

  it("dispatches STEP_DONE through agent_message_chunk and continues the loop", async () => {
    const { updates, calls, messages } = await runDispatchScenario({
      _tag: "STEP_DONE",
      stepId: "step-01",
      summary: "Navigated to /login and verified form is visible.",
    });

    assert.strictEqual(calls.length, 0, "STEP_DONE does not invoke tools");
    const messageUpdates = updates.filter(
      (entry) => entry.update.sessionUpdate === "agent_message_chunk",
    );
    const matched = messageUpdates.some((entry) => {
      if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
      const text = entry.update.content.type === "text" ? entry.update.content.text : "";
      return text.startsWith("[STEP_DONE step-01]");
    });
    assert.isTrue(matched, "expected STEP_DONE to surface as agent_message_chunk");
    assert.deepStrictEqual(
      messages.map((m) => m.role),
      [
        "system",
        "assistant", // STEP_DONE envelope
        "user", // observation feedback
        "assistant", // RUN_COMPLETED
      ],
    );
  });

  it("dispatches ASSERTION_FAILED through agent_message_chunk and continues the loop", async () => {
    const { updates, calls, messages } = await runDispatchScenario({
      _tag: "ASSERTION_FAILED",
      stepId: "step-03",
      category: "budget-violation",
      domain: "perf",
      reason: "LCP exceeded 2500ms budget",
      evidence: "LCP=3120ms; insight=LCPBreakdown",
    });

    assert.strictEqual(calls.length, 0, "ASSERTION_FAILED does not invoke tools");
    const messageUpdates = updates.filter(
      (entry) => entry.update.sessionUpdate === "agent_message_chunk",
    );
    const matched = messageUpdates.some((entry) => {
      if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
      const text = entry.update.content.type === "text" ? entry.update.content.text : "";
      return (
        text.startsWith("[ASSERTION_FAILED step-03") &&
        text.includes("category=budget-violation") &&
        text.includes("domain=perf")
      );
    });
    assert.isTrue(matched, "expected ASSERTION_FAILED to surface as agent_message_chunk");
    assert.deepStrictEqual(
      messages.map((m) => m.role),
      [
        "system",
        "assistant", // ASSERTION_FAILED envelope
        "user", // observation feedback
        "assistant", // RUN_COMPLETED
      ],
    );
  });
});

describe("runToolLoop — harness-r4 detectors", () => {
  it("injects REFLECT on 2 consecutive parse-fails on same stepId regardless of shape (vary-each-attempt)", async () => {
    // harness-r4: different parse-fail shapes on same stepId should still trigger
    // REFLECT injection. Previously different shapes would reset the streak.
    const cookieBannerThought = envelope({
      _tag: "THOUGHT",
      stepId: "step-02",
      thought: "The page has a cookie banner that needs to be dismissed.",
    });
    const malformed1 = envelope({
      _tag: "ACTION",
      stepId: "step-02",
      toolName: "interact",
      args: { uid: "1_182" }, // missing "command"
    });
    const malformed2 = envelope({
      _tag: "ACTION",
      stepId: "step-02",
      toolName: "click",
      args: { uid: "bad-uid" }, // different tool, different args
    });
    const scripted = [
      okResult(cookieBannerThought),
      okResult(malformed1),
      okResult(malformed2),
      okResult(
        envelope({
          _tag: "RUN_COMPLETED",
          status: "passed",
          summary: "Recovered via vary-each-attempt detector.",
        }),
      ),
    ];
    const { client } = makeScriptedClient(scripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge, calls } = makeRecordingBridge(new Map());
    const messages = [{ role: "system" as const, content: "(system)" }];

    await runToolLoop({
      sessionId: "test-session-vary-each",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    assert.strictEqual(calls.length, 0, "no tool call expected on parse failure path");

    // After the 2nd consecutive parse-fail on same stepId, REFLECT should fire
    // regardless of shape mismatch
    const reflectChunk = updates.some((entry) => {
      if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
      const text = entry.update.content.type === "text" ? entry.update.content.text : "";
      return text.includes("REFLECT:");
    });
    assert.isTrue(
      reflectChunk,
      "expected REFLECT on vary-each-attempt (different shapes, same stepId)",
    );
  });

  it("aborts after 6 consecutive THOUGHTs without progress (THOUGHT-only loop detector)", async () => {
    // harness-r4: 6 consecutive THOUGHTs should trigger abort at threshold+1
    const thoughtScripted = Array.from({ length: 6 }, (_, i) =>
      okResult(
        envelope({
          _tag: "THOUGHT",
          stepId: "step-01",
          thought: `Stuck in THOUGHT loop - iteration ${i + 1}`,
        }),
      ),
    );
    const { client } = makeScriptedClient(thoughtScripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge, calls } = makeRecordingBridge(new Map());
    const messages = [{ role: "system" as const, content: "(system)" }];

    await runToolLoop({
      sessionId: "test-session-thought-loop",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    // Should have 6 THOUGHT chat calls
    assert.strictEqual(calls.length, 0, "no tool calls expected during THOUGHT-only loop");

    // After 6 THOUGHTs, should see abort message
    const abortMessage = updates
      .filter((entry) => entry.update.sessionUpdate === "agent_message_chunk")
      .find((entry) => {
        if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
        const text = entry.update.content.type === "text" ? entry.update.content.text : "";
        return text.includes("consecutive THOUGHTs") && text.includes("Aborting");
      });
    assert.isDefined(abortMessage, "expected abort message after 6 THOUGHTs");
  });

  it("injects REFLECT at 5 THOUGHTs, then aborts at 6 THOUGHT-only detector", async () => {
    // harness-r4: REFLECT fires at 5, abort at 6
    const thoughtScripted = Array.from({ length: 6 }, (_, i) =>
      okResult(
        envelope({
          _tag: "THOUGHT",
          stepId: "step-01",
          thought: `THOUGHT iteration ${i + 1}`,
        }),
      ),
    );
    const { client } = makeScriptedClient(thoughtScripted);
    const { connection, updates } = makeRecordingConnection();
    const { bridge } = makeRecordingBridge(new Map());
    const messages = [{ role: "system" as const, content: "(system)" }];

    await runToolLoop({
      sessionId: "test-session-thought-reflect-abort",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: bridge,
      connection,
      signal: new AbortController().signal,
    });

    // Should see REFLECT at 5 THOUGHTs
    const reflectMessage = updates
      .filter((entry) => entry.update.sessionUpdate === "agent_message_chunk")
      .find((entry) => {
        if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
        const text = entry.update.content.type === "text" ? entry.update.content.text : "";
        return (
          text.includes("REFLECT:") && text.includes("THOUGHTs detected") && text.includes("5")
        );
      });
    assert.isDefined(reflectMessage, "expected REFLECT injection at 5 THOUGHTs");

    // Should also see abort at 6 THOUGHTs
    const abortMessage = updates
      .filter((entry) => entry.update.sessionUpdate === "agent_message_chunk")
      .find((entry) => {
        if (entry.update.sessionUpdate !== "agent_message_chunk") return false;
        const text = entry.update.content.type === "text" ? entry.update.content.text : "";
        return text.includes("consecutive THOUGHTs") && text.includes("Aborting");
      });
    assert.isDefined(abortMessage, "expected abort message at 6 THOUGHTs");
  });
});
