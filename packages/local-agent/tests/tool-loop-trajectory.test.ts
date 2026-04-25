import type * as acp from "@agentclientprotocol/sdk";
import { Effect } from "effect";
import { assert, describe, it } from "vite-plus/test";

import { runToolLoop } from "../src/tool-loop.ts";
import type {
  OllamaChatResult,
  OllamaClient,
  OllamaCompletionOptions,
  OllamaMessage,
} from "../src/ollama-client.ts";
import type { McpBridge } from "../src/mcp-bridge.ts";

// R4-T3 wires `rollTrajectory` into the live tool-loop so each Ollama chat
// call sees a bounded prompt: system + initial user + summary block (when
// applicable) + last 10 assistant/observation pairs verbatim. This test
// drives the loop past the verbatim window and asserts:
//   1. Late-round chat calls receive a rolled message array
//   2. The summary block carries the canonical `<trajectory_summary>` tag
//   3. The full `messages` array (caller-owned) keeps growing — only the
//      view passed to Ollama is bounded.

interface RecordedSessionUpdate {
  readonly sessionId: string;
  readonly update: acp.SessionNotification["update"];
}

interface RecordedChatRequest {
  readonly options: OllamaCompletionOptions;
}

const makeRecordingConnection = (): {
  connection: acp.AgentSideConnection;
  updates: RecordedSessionUpdate[];
} => {
  const updates: RecordedSessionUpdate[] = [];
  const connection = {
    sessionUpdate: async (params: acp.SessionNotification): Promise<void> => {
      updates.push({ sessionId: params.sessionId, update: params.update });
    },
    extNotification: async (): Promise<void> => {},
  } as unknown as acp.AgentSideConnection;
  return { connection, updates };
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

const makeScriptedClient = (
  scriptedResults: ReadonlyArray<OllamaChatResult>,
): {
  client: OllamaClient;
  requests: RecordedChatRequest[];
} => {
  const requests: RecordedChatRequest[] = [];
  let cursor = 0;
  const chat = (
    options: OllamaCompletionOptions,
  ): ReturnType<OllamaClient["chat"]> => {
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
  return {
    client: {
      model: "gemma4:e4b-test",
      baseUrl: "http://localhost:11434",
      chat,
      checkHealth,
    },
    requests,
  };
};

const makeNoopBridge = (): McpBridge => ({
  listTools: () => [],
  callTool: async () => ({ text: "ok", isError: false }),
  close: async () => {},
});

describe("runToolLoop — R4 trajectory rolling", () => {
  it("collapses older turns into a summary block once the verbatim window is exceeded", async () => {
    // Script 14 turns (12 ACTION + 1 STEP_DONE + 1 RUN_COMPLETED).
    // Verbatim window is 10 → after the 11th turn, summarization kicks in.
    const actionEnvelopes: OllamaChatResult[] = [];
    for (let index = 0; index < 12; index++) {
      actionEnvelopes.push(
        okResult(
          envelope({
            _tag: "ACTION",
            stepId: `step-${index}`,
            toolName: "interact",
            args: { command: "navigate", url: `https://x.example/${index}` },
          }),
        ),
      );
    }
    const stepDone = okResult(
      envelope({ _tag: "STEP_DONE", stepId: "step-11", summary: "page loaded" }),
    );
    const runCompleted = okResult(
      envelope({
        _tag: "RUN_COMPLETED",
        status: "passed",
        summary: "All journeys covered.",
      }),
    );
    const scripted = [...actionEnvelopes, stepDone, runCompleted];
    const { client, requests } = makeScriptedClient(scripted);
    const { connection } = makeRecordingConnection();

    const messages: OllamaMessage[] = [
      { role: "system", content: "(system)" },
      { role: "user", content: "Initial task description" },
    ];
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "interact",
          description: "Interact",
          parameters: { type: "object" as const, properties: {} },
        },
      },
    ];

    await runToolLoop({
      sessionId: "test-session",
      messages,
      tools,
      ollamaClient: client,
      mcpBridge: makeNoopBridge(),
      connection,
      signal: new AbortController().signal,
    });

    assert.strictEqual(requests.length, 14, "14 chat calls scripted");

    // Round 11 (index 10) is the FIRST round where >10 prior turns exist:
    // by then 10 ACTIONs have completed (each appended assistant + user
    // observation pairs) so going into round 11 the trajectory has 10 turns
    // and is still verbatim. Round 12 (index 11) is the first that sees 11
    // prior turns → must roll. We assert on round index 12 (one full round
    // past the boundary so it's unambiguous).
    const lateRequest = requests[12]?.options.messages;
    assert.isDefined(lateRequest, "expected late-round chat request to be recorded");
    if (!lateRequest) return;

    const roles = lateRequest.map((message) => message.role);
    assert.strictEqual(roles[0], "system");
    assert.strictEqual(roles[1], "user", "initial user prompt preserved");
    // The 3rd message must be the synthesized summary user-message.
    assert.strictEqual(roles[2], "user", "trajectory summary occupies index 2");
    const summary = lateRequest[2];
    assert.isTrue(
      summary.content.startsWith("<trajectory_summary>"),
      "summary block must be wrapped in <trajectory_summary>",
    );
    assert.isTrue(
      summary.content.endsWith("</trajectory_summary>"),
      "summary block must close with </trajectory_summary>",
    );
    // Each older turn becomes one event line. Two turns are expected to be
    // summarized at round index 12 (12 prior turns − 10 verbatim window = 2
    // older turns).
    const eventLines = summary.content
      .split("\n")
      .filter((line) => line.startsWith("<event>") && line.endsWith("</event>"));
    assert.strictEqual(
      eventLines.length,
      2,
      "expected exactly 2 summarized event lines at round 12",
    );

    // The summary lines should reference ACTION (the older turns are all ACTIONs).
    for (const line of eventLines) {
      assert.isTrue(
        line.includes("ACTION interact"),
        "older ACTION envelopes should summarize as `ACTION interact`",
      );
    }

    // The verbatim tail must contain exactly 10 turns × 2 messages = 20 entries
    // (after preface=2 + summary=1).
    const verbatimTail = lateRequest.slice(3);
    assert.strictEqual(
      verbatimTail.length,
      20,
      "verbatim window should keep last 10 pairs (20 messages)",
    );
    // The full caller-owned messages array keeps growing untouched.
    // After 13 chat calls we have 13 turns, each with 1 assistant + 1
    // observation user message (RUN_COMPLETED has no observation since the
    // loop exits). So messages length = 2 (preface) + 12 × 2 (full pairs) +
    // 1 (STEP_DONE assistant + observation) + 0 = 28 ... actually let's
    // just verify it grew well past the rolled length.
    assert.isAbove(
      messages.length,
      lateRequest.length,
      "the caller's full message history must keep growing beyond the rolled view",
    );
  });

  it("does NOT roll until the verbatim window threshold is crossed", async () => {
    // 5 turns + RUN_COMPLETED. 5 < 10 → no summarization on any chat call.
    const scripted: OllamaChatResult[] = [];
    for (let index = 0; index < 5; index++) {
      scripted.push(
        okResult(
          envelope({
            _tag: "ACTION",
            stepId: `s-${index}`,
            toolName: "interact",
            args: { command: "navigate", url: `https://x.example/${index}` },
          }),
        ),
      );
    }
    scripted.push(
      okResult(
        envelope({ _tag: "RUN_COMPLETED", status: "passed", summary: "done" }),
      ),
    );
    const { client, requests } = makeScriptedClient(scripted);
    const { connection } = makeRecordingConnection();
    const messages: OllamaMessage[] = [
      { role: "system", content: "(system)" },
      { role: "user", content: "Task" },
    ];

    await runToolLoop({
      sessionId: "session-no-roll",
      messages,
      tools: [],
      ollamaClient: client,
      mcpBridge: makeNoopBridge(),
      connection,
      signal: new AbortController().signal,
    });

    for (let index = 0; index < requests.length; index++) {
      const sent = requests[index].options.messages;
      const userMessages = sent.filter((message) => message.role === "user");
      const summaryHits = userMessages.filter((message) =>
        message.content.includes("<trajectory_summary>"),
      );
      assert.strictEqual(
        summaryHits.length,
        0,
        `expected zero summary blocks at round ${index} (turns below verbatim window)`,
      );
    }
  });
});
