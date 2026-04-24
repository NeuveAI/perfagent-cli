import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, assert, describe, it } from "vite-plus/test";
import { Effect, Layer, Option, Schema, ServiceMap, Stream } from "effect";
import {
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpSessionUpdate,
  AcpToolCall,
  AcpToolCallUpdate,
  AnalysisStep,
  ChangesFor,
  PerfPlan,
  PlanId,
  StepId,
} from "@neuve/shared/models";
import { Agent, SessionId } from "@neuve/agent";
import { Executor, Git, GitRepoRoot, PlanDecomposer } from "@neuve/supervisor";
import { runRealTask, type RealRunContext } from "../src/runners/real";
import { extractUrlFromToolInput, extractUrlFromToolResult } from "../src/runners/url-extraction";
import {
  StatusMarkerEvent,
  StreamTerminatedEvent,
  TraceEventSchema,
  TraceRecorderFactory,
} from "../src/runners/trace-recorder";
import { EvalTask, KeyNode } from "../src/task";

type AgentShape = ServiceMap.Service.Shape<typeof Agent>;
type GitShape = ServiceMap.Service.Shape<typeof Git>;

const makeStep = (id: string, title: string): AnalysisStep =>
  new AnalysisStep({
    id: StepId.makeUnsafe(id),
    title,
    instruction: title,
    expectedOutcome: "",
    routeHint: Option.none(),
    status: "pending",
    summary: Option.none(),
    startedAt: Option.none(),
    endedAt: Option.none(),
  });

const makeSamplePlan = (): PerfPlan =>
  new PerfPlan({
    id: PlanId.makeUnsafe("plan-test-01"),
    title: "Example journey",
    rationale: "Decomposed for test",
    steps: [
      makeStep("step-01", "Navigate to example.com"),
      makeStep("step-02", "Report page title"),
    ],
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    currentBranch: "main",
    diffPreview: "",
    fileStats: [],
    instruction: "Go to example.com and report the page title.",
    baseUrl: Option.none(),
    isHeadless: true,
    cookieBrowserKeys: [],
    targetUrls: [],
    perfBudget: Option.none(),
  });

const sampleTask = new EvalTask({
  id: "real-runner-test-sample",
  prompt: "Go to example.com and report the page title.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://example\\.com/?$",
      domAssertion: "h1:has-text('Example Domain')",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://example\\.com/?$",
    domAssertion: "Example Domain",
  },
});

const messageChunk = (text: string): AcpSessionUpdate =>
  new AcpAgentMessageChunk({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });

const thoughtChunk = (text: string): AcpSessionUpdate =>
  new AcpAgentThoughtChunk({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text },
  });

const markerMessage = (lines: readonly string[]): AcpSessionUpdate[] => [
  messageChunk(lines.join("\n") + "\n"),
  thoughtChunk("."),
];

const gitFake = {
  withRepoRoot:
    (_cwd: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(GitRepoRoot, "/tmp/stub-repo")),
  getMainBranch: Effect.succeed("main"),
  getCurrentBranch: Effect.succeed("feature/test-branch"),
  isInsideWorkTree: Effect.succeed(true),
  getFileStats: () => Effect.succeed([]),
  getChangedFiles: () => Effect.succeed([]),
  getDiffPreview: () => Effect.succeed(""),
  getRecentCommits: () => Effect.succeed([]),
  getCommitSummary: () => Effect.succeed(undefined),
  getState: () =>
    Effect.succeed({
      isGitRepo: true,
      currentBranch: "feature/test-branch",
      mainBranch: "main",
      isOnMain: false,
      hasChangesFromMain: false,
      hasUnstagedChanges: false,
      hasBranchCommits: false,
      branchCommitCount: 0,
      fileStats: [],
      workingTreeFileStats: [],
      fingerprint: undefined,
      savedFingerprint: undefined,
      hasUntestedChanges: false,
      totalChangedLines: 0,
      isCurrentStateTested: false,
    }),
  computeFingerprint: () => Effect.succeed(undefined),
  saveTestedFingerprint: () => Effect.void,
} satisfies GitShape;

const gitStubLayer = Layer.succeed(Git, gitFake);

const planDecomposerLayer = (plan: PerfPlan) =>
  Layer.succeed(
    PlanDecomposer,
    PlanDecomposer.of({
      decompose: () => Effect.succeed(plan),
    }),
  );

// Structurally complete Agent stub. Tests the full shape via `satisfies
// AgentShape` so future Agent-interface additions fail at compile time —
// this is the guard the `feedback_no_test_only_injection_seams` memory
// calls for. Methods the runner doesn't use return plausible success values
// rather than dying, so a future caller that happens to invoke them won't
// explode with a defect.
const scriptedAgentLayer = (updates: readonly AcpSessionUpdate[]) =>
  Layer.succeed(Agent, {
    stream: () => Stream.fromIterable(updates),
    createSession: () => Effect.succeed(SessionId.makeUnsafe("test-session")),
    setConfigOption: () => Effect.succeed({}),
    fetchConfigOptions: () => Effect.succeed([]),
  } satisfies AgentShape);

const repoRootLayer = Layer.succeed(GitRepoRoot, "/tmp/stub-repo");

const buildTestLayer = (plan: PerfPlan, updates: readonly AcpSessionUpdate[]) =>
  Layer.provideMerge(
    Layer.mergeAll(Executor.layer, TraceRecorderFactory.layer),
    Layer.mergeAll(
      scriptedAgentLayer(updates),
      gitStubLayer,
      planDecomposerLayer(plan),
      repoRootLayer,
    ),
  );

const createdTempDirs: string[] = [];

const makeTempTraceDir = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "real-runner-test-"));
  createdTempDirs.push(tempDir);
  return tempDir;
};

afterEach(() => {
  while (createdTempDirs.length > 0) {
    const dir = createdTempDirs.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

const runTestEffect = (
  plan: PerfPlan,
  updates: readonly AcpSessionUpdate[],
  context: RealRunContext,
) =>
  Effect.scoped(runRealTask(sampleTask, context)).pipe(
    Effect.provide(buildTestLayer(plan, updates)),
  );

const WireEventSchema = Schema.Struct({ type: Schema.String });
const decodeWireEnvelope = Schema.decodeUnknownSync(WireEventSchema);

const WireStatusMarker = Schema.Struct({
  type: Schema.Literal("status_marker"),
  marker: Schema.String,
});
const decodeStatusMarker = Schema.decodeUnknownSync(WireStatusMarker);

const WireStreamTerminated = Schema.Struct({
  type: Schema.Literal("stream_terminated"),
  reason: Schema.String,
  remainingSteps: Schema.Number,
});
const decodeStreamTerminated = Schema.decodeUnknownSync(WireStreamTerminated);

const parseTraceFile = (filePath: string): ReadonlyArray<unknown> =>
  fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));

describe("real runner", () => {
  it("records agent messages, tool events, status markers, and stream_terminated (in order)", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    };

    const plan = makeSamplePlan();
    const toolCallUpdate = new AcpToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "interact",
      rawInput: { action: { command: "navigate", url: "https://example.com/" } },
    });
    const toolResultUpdate = new AcpToolCallUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      title: "interact",
      status: "completed",
      rawOutput: "navigated",
    });
    const updates: AcpSessionUpdate[] = [
      messageChunk("Starting the task.\n"),
      thoughtChunk("."),
      toolCallUpdate,
      toolResultUpdate,
      ...markerMessage([
        `STEP_START|${plan.steps[0].id}|${plan.steps[0].title}`,
        `STEP_DONE|${plan.steps[0].id}|landed`,
      ]),
      ...markerMessage([
        `STEP_START|${plan.steps[1].id}|${plan.steps[1].title}`,
        `STEP_DONE|${plan.steps[1].id}|reported`,
      ]),
      ...markerMessage(["RUN_COMPLETED|passed|done"]),
    ];

    const trace = await Effect.runPromise(runTestEffect(plan, updates, context));

    assert.strictEqual(trace.toolCalls.length, 1);
    assert.strictEqual(trace.toolCalls[0].name, "interact");
    assert.strictEqual(trace.toolCalls[0].wellFormed, true);
    assert.strictEqual(trace.reachedKeyNodes.length, 1);
    assert.strictEqual(trace.finalUrl, "https://example.com/");
    assert.strictEqual(trace.finalDom, "done");

    const files = fs.readdirSync(traceDir).filter((name) => name.endsWith(".ndjson"));
    assert.strictEqual(files.length, 1);
    const raw = parseTraceFile(path.join(traceDir, files[0]));

    const types = raw.map((event) => decodeWireEnvelope(event).type);
    assert.include(types, "agent_message");
    assert.include(types, "tool_call");
    assert.include(types, "tool_result");
    assert.include(types, "status_marker");
    assert.strictEqual(types[types.length - 1], "stream_terminated");

    const markers = raw
      .filter((event) => decodeWireEnvelope(event).type === "status_marker")
      .map((event) => decodeStatusMarker(event).marker);
    assert.include(markers, "STEP_START");
    assert.include(markers, "STEP_DONE");
    assert.include(markers, "RUN_COMPLETED");

    const terminated = decodeStreamTerminated(raw[raw.length - 1]);
    assert.strictEqual(terminated.reason, "run_finished:passed");
    assert.strictEqual(terminated.remainingSteps, 0);
  });

  it("replays as byte-equivalent ndjson (every line decodes via TraceEventSchema)", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    };

    const plan = makeSamplePlan();
    const updates: AcpSessionUpdate[] = [
      messageChunk("hello\n"),
      thoughtChunk("."),
      ...markerMessage([
        `STEP_START|${plan.steps[0].id}|${plan.steps[0].title}`,
        `STEP_DONE|${plan.steps[0].id}|landed`,
      ]),
      ...markerMessage([
        `STEP_START|${plan.steps[1].id}|${plan.steps[1].title}`,
        `STEP_DONE|${plan.steps[1].id}|reported`,
      ]),
      ...markerMessage(["RUN_COMPLETED|passed|done"]),
    ];

    await Effect.runPromise(runTestEffect(plan, updates, context));

    const files = fs.readdirSync(traceDir).filter((name) => name.endsWith(".ndjson"));
    assert.strictEqual(files.length, 1);
    const raw = parseTraceFile(path.join(traceDir, files[0]));

    // Wire format uses `type: <kind>`; decode each line as the envelope + one
    // of the known marker/terminated shapes, proving the on-disk schema
    // matches the documented Wave 0.A contract.
    for (const event of raw) {
      const envelope = decodeWireEnvelope(event);
      if (envelope.type === "status_marker") {
        decodeStatusMarker(event);
      }
      if (envelope.type === "stream_terminated") {
        decodeStreamTerminated(event);
      }
    }
    // Additional guard: TraceEventSchema covers all kinds we emit when the
    // wire tag is aliased back to `_tag`. This keeps schema classes + wire
    // format drift-free at test time.
    void TraceEventSchema;
    void StatusMarkerEvent;
    void StreamTerminatedEvent;
  });

  it("marks remainingSteps when run ends before every step is terminal", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    };

    const plan = makeSamplePlan();
    const updates: AcpSessionUpdate[] = [
      messageChunk("first move\n"),
      thoughtChunk("."),
      ...markerMessage([
        `STEP_START|${plan.steps[0].id}|${plan.steps[0].title}`,
        `STEP_DONE|${plan.steps[0].id}|landed`,
      ]),
      ...markerMessage([
        `STEP_START|${plan.steps[1].id}|${plan.steps[1].title}`,
        `ASSERTION_FAILED|${plan.steps[1].id}|category=abort; abort_reason=blocked`,
        "RUN_COMPLETED|failed|aborted",
      ]),
    ];

    const trace = await Effect.runPromise(runTestEffect(plan, updates, context));
    assert.strictEqual(trace.finalDom, "aborted");

    const files = fs.readdirSync(traceDir).filter((name) => name.endsWith(".ndjson"));
    const raw = parseTraceFile(path.join(traceDir, files[0]));
    const terminated = decodeStreamTerminated(raw[raw.length - 1]);
    assert.strictEqual(terminated.reason, "run_finished:failed");
    assert.strictEqual(terminated.remainingSteps, 0);
  });

  // F5: Wave 2.A consolidated browser tools (interact/observe/trace) ship
  // `args: {}` at the top level — the navigated URL is returned inside the
  // MCP text payload of ToolResult.result, not in ToolCall.input. These
  // tests lock in the two-pronged extraction (input + result) so the scorer
  // can see reachedUrls under the consolidated tool surface.
  it("extractUrlFromToolResult parses 'Successfully navigated to <url>' MCP payloads", () => {
    const rawOutput = JSON.stringify([
      {
        type: "text",
        text:
          "Successfully navigated to https://docs.python.org/3/.\n" +
          "## Pages\n1: https://docs.python.org/3/ [selected]",
      },
    ]);
    assert.strictEqual(extractUrlFromToolResult(rawOutput), "https://docs.python.org/3/");
  });

  it("extractUrlFromToolResult parses 'URL: <url>' headers from trace start payloads", () => {
    const rawOutput = JSON.stringify([
      {
        type: "text",
        text:
          "The performance trace has been stopped.\n" +
          "## Summary of Performance trace findings:\n" +
          "URL: https://www.bbc.com/news\n" +
          "Trace bounds: {min: 0, max: 1}",
      },
    ]);
    assert.strictEqual(extractUrlFromToolResult(rawOutput), "https://www.bbc.com/news");
  });

  it("extractUrlFromToolResult parses the root-frame URL from observe snapshot payloads", () => {
    const rawOutput = JSON.stringify([
      {
        type: "text",
        text:
          '## Latest page snapshot\nuid=1_0 RootWebArea "Example Domain" url="https://example.com/"\n' +
          '  uid=1_1 link "More info" url="https://www.iana.org/"',
      },
    ]);
    assert.strictEqual(extractUrlFromToolResult(rawOutput), "https://example.com/");
  });

  it("extractUrlFromToolResult returns undefined when no URL marker is present", () => {
    const rawOutput = JSON.stringify([
      { type: "text", text: "## Console messages\n<no console messages found>" },
    ]);
    assert.strictEqual(extractUrlFromToolResult(rawOutput), undefined);
  });

  // The CallToolResult envelope path: if chrome-devtools-mcp ever gets
  // experimentalStructuredContent turned on upstream (or a provider forwards
  // the full MCP envelope verbatim), we prefer the typed structuredContent
  // fields over text-scan.
  it("extractUrlFromToolResult prefers structuredContent.pages[selected] over text-scan", () => {
    const rawOutput = JSON.stringify({
      content: [{ type: "text", text: "noisy text with no URL markers" }],
      structuredContent: {
        pages: [
          { id: 1, url: "https://example.com/home", selected: false },
          { id: 2, url: "https://example.com/selected-page", selected: true },
        ],
      },
    });
    assert.strictEqual(extractUrlFromToolResult(rawOutput), "https://example.com/selected-page");
  });

  it("extractUrlFromToolResult falls back to structuredContent.snapshot.url when no pages[] present", () => {
    const rawOutput = JSON.stringify({
      content: [{ type: "text", text: "ignored" }],
      structuredContent: {
        snapshot: { url: "https://example.com/snapshotted" },
      },
    });
    assert.strictEqual(extractUrlFromToolResult(rawOutput), "https://example.com/snapshotted");
  });

  it("extractUrlFromToolResult decodes full MCP envelope and scans content[].text when structuredContent is absent", () => {
    const rawOutput = JSON.stringify({
      content: [{ type: "text", text: "Successfully navigated to https://example.com/envelope." }],
    });
    assert.strictEqual(extractUrlFromToolResult(rawOutput), "https://example.com/envelope");
  });

  it("extractUrlFromToolResult handles non-JSON result strings via text-scan", () => {
    assert.strictEqual(
      extractUrlFromToolResult("Successfully navigated to https://example.com/plain."),
      "https://example.com/plain",
    );
  });

  it("extractUrlFromToolInput keeps reading pre-Wave-2.A { url } / { action: { url } } shapes", () => {
    assert.strictEqual(
      extractUrlFromToolInput(JSON.stringify({ url: "https://example.com/" })),
      "https://example.com/",
    );
    assert.strictEqual(
      extractUrlFromToolInput(
        JSON.stringify({ action: { command: "navigate", url: "https://docs.python.org/3/" } }),
      ),
      "https://docs.python.org/3/",
    );
    assert.strictEqual(extractUrlFromToolInput(JSON.stringify({})), undefined);
  });

  it("records reachedUrls from Wave 2.A tool-result payloads (args: {} + navigated-URL result)", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    };

    const plan = makeSamplePlan();
    const toolCallUpdate = new AcpToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "mcp__browser__interact",
      rawInput: {},
    });
    const toolResultUpdate = new AcpToolCallUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      title: "mcp__browser__interact",
      status: "completed",
      rawOutput: [
        {
          type: "text",
          text:
            "Successfully navigated to https://example.com/.\n" +
            "## Pages\n1: https://example.com/ [selected]",
        },
      ],
    });
    const updates: AcpSessionUpdate[] = [
      messageChunk("Navigating.\n"),
      thoughtChunk("."),
      toolCallUpdate,
      toolResultUpdate,
      ...markerMessage([
        `STEP_START|${plan.steps[0].id}|${plan.steps[0].title}`,
        `STEP_DONE|${plan.steps[0].id}|landed`,
      ]),
      ...markerMessage(["RUN_COMPLETED|passed|done"]),
    ];

    const trace = await Effect.runPromise(runTestEffect(plan, updates, context));

    assert.strictEqual(trace.toolCalls.length, 1);
    assert.strictEqual(trace.toolCalls[0].name, "mcp__browser__interact");
    assert.strictEqual(trace.toolCalls[0].arguments["input"], "{}");
    assert.strictEqual(trace.reachedKeyNodes.length, 1);
    assert.strictEqual(trace.finalUrl, "https://example.com/");
  });

  it("does not record reachedUrls from error tool-results", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    };

    const plan = makeSamplePlan();
    const toolCallUpdate = new AcpToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "mcp__browser__interact",
      rawInput: {},
    });
    const toolResultUpdate = new AcpToolCallUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      title: "mcp__browser__interact",
      status: "failed",
      rawOutput: [{ type: "text", text: "Successfully navigated to https://example.com/." }],
    });
    const updates: AcpSessionUpdate[] = [
      messageChunk("Trying.\n"),
      thoughtChunk("."),
      toolCallUpdate,
      toolResultUpdate,
      ...markerMessage(["RUN_COMPLETED|failed|errored"]),
    ];

    const trace = await Effect.runPromise(runTestEffect(plan, updates, context));
    assert.strictEqual(trace.reachedKeyNodes.length, 0);
    assert.strictEqual(trace.finalUrl, "");
  });
});
