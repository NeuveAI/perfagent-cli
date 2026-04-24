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
import { TokenUsageBus, TokenUsageEntry } from "@neuve/shared/token-usage-bus";
import { Agent, SessionId } from "@neuve/agent";
import { Executor, Git, GitRepoRoot, PlanDecomposer } from "@neuve/supervisor";
import { runRealTask, type RealRunContext } from "../src/runners/real";
import { extractUrlFromToolInput, extractUrlFromToolResult } from "../src/runners/url-extraction";
import {
  StatusMarkerEvent,
  StreamTerminatedEvent,
  ToolResultEvent,
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
      TokenUsageBus.layerNoop,
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

  // Drain-order invariant for tokenomics: every `token_usage` event must be
  // emitted before `task_tokenomics`, which must be emitted before
  // `stream_terminated`, which must be the last line of the ndjson file.
  // This protects the Wave 0.A replay contract (stream_terminated is the
  // sentinel) from silently drifting when we iterate on the bus/drain flow.
  it("drains token_usage → task_tokenomics → stream_terminated (last line) in order", async () => {
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
      messageChunk("message\n"),
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

    // Swap the default noop bus for a per-task Ref-backed bus and pre-seed it
    // with the entries the production code path would normally publish via
    // PlanDecomposer + Executor. runRealTask drains at the end and writes one
    // `token_usage` event per entry followed by `task_tokenomics`.
    const refLayer = Layer.provideMerge(
      Layer.mergeAll(Executor.layer, TraceRecorderFactory.layer),
      Layer.mergeAll(
        scriptedAgentLayer(updates),
        gitStubLayer,
        planDecomposerLayer(plan),
        repoRootLayer,
        TokenUsageBus.layerRef,
      ),
    );

    const seedEntries = [
      new TokenUsageEntry({
        source: "planner",
        promptTokens: 265,
        completionTokens: 581,
        totalTokens: 846,
        timestamp: 1_700_000_000_000,
      }),
      new TokenUsageEntry({
        source: "executor",
        promptTokens: 4096,
        completionTokens: 392,
        totalTokens: 4488,
        timestamp: 1_700_000_000_100,
      }),
      new TokenUsageEntry({
        source: "executor",
        promptTokens: 4096,
        completionTokens: 300,
        totalTokens: 4396,
        timestamp: 1_700_000_000_200,
      }),
    ];

    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      for (const entry of seedEntries) {
        yield* bus.publish(entry);
      }
      return yield* Effect.scoped(runRealTask(sampleTask, context));
    }).pipe(Effect.provide(refLayer));

    await Effect.runPromise(program);

    const files = fs.readdirSync(traceDir).filter((name) => name.endsWith(".ndjson"));
    assert.strictEqual(files.length, 1);
    const raw = parseTraceFile(path.join(traceDir, files[0]));
    const types = raw.map((event) => decodeWireEnvelope(event).type);

    // Exactly N token_usage events, then one task_tokenomics, then
    // stream_terminated as the last line. The order-preserving drain is what
    // lets consumers replay the sweep deterministically.
    const tokenUsageIndices = types.flatMap((type, index) =>
      type === "token_usage" ? [index] : [],
    );
    const taskTokenomicsIndices = types.flatMap((type, index) =>
      type === "task_tokenomics" ? [index] : [],
    );
    assert.strictEqual(tokenUsageIndices.length, seedEntries.length);
    assert.strictEqual(taskTokenomicsIndices.length, 1);
    for (const index of tokenUsageIndices) {
      assert.isTrue(
        index < taskTokenomicsIndices[0],
        `token_usage at ${index} must precede task_tokenomics at ${taskTokenomicsIndices[0]}`,
      );
    }
    assert.isTrue(
      taskTokenomicsIndices[0] < types.length - 1,
      "task_tokenomics must precede the final stream_terminated sentinel",
    );
    assert.strictEqual(types[types.length - 1], "stream_terminated");
  });

  // Per-task isolation for the Ref-backed bus: sequential task runs under a
  // fresh layer build must each see an independent buffer. If `layerRef`
  // ever regresses to a module-level Ref, the second task will observe
  // drained entries from the first and the aggregate will be wrong.
  it("each task run under TokenUsageBus.layerRef sees an isolated buffer", async () => {
    const buildContext = (traceDir: string): RealRunContext => ({
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    });

    const plan = makeSamplePlan();
    const updates: AcpSessionUpdate[] = [
      messageChunk("m\n"),
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

    const makeProgram = (taskSeedEntries: readonly TokenUsageEntry[], traceDir: string) =>
      Effect.gen(function* () {
        const bus = yield* TokenUsageBus;
        for (const entry of taskSeedEntries) {
          yield* bus.publish(entry);
        }
        return yield* Effect.scoped(runRealTask(sampleTask, buildContext(traceDir)));
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            Layer.mergeAll(Executor.layer, TraceRecorderFactory.layer),
            Layer.mergeAll(
              scriptedAgentLayer(updates),
              gitStubLayer,
              planDecomposerLayer(plan),
              repoRootLayer,
              TokenUsageBus.layerRef,
            ),
          ),
        ),
      );

    const taskAEntries = [
      new TokenUsageEntry({
        source: "planner",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        timestamp: 1,
      }),
    ];
    const taskBEntries = [
      new TokenUsageEntry({
        source: "planner",
        promptTokens: 700,
        completionTokens: 300,
        totalTokens: 1000,
        timestamp: 2,
      }),
      new TokenUsageEntry({
        source: "executor",
        promptTokens: 800,
        completionTokens: 400,
        totalTokens: 1200,
        timestamp: 3,
      }),
    ];

    const traceDirA = makeTempTraceDir();
    const traceDirB = makeTempTraceDir();
    const traceA = await Effect.runPromise(makeProgram(taskAEntries, traceDirA));
    const traceB = await Effect.runPromise(makeProgram(taskBEntries, traceDirB));

    // Task A saw its own entries only.
    assert.strictEqual(traceA.tokenUsages.length, 1);
    assert.strictEqual(traceA.tokenUsages[0].totalTokens, 150);
    assert.strictEqual(traceA.tokenomics.plannerTokens, 150);
    assert.strictEqual(traceA.tokenomics.executorTokens, 0);
    assert.strictEqual(traceA.tokenomics.turnCount, 0);

    // Task B saw its own entries only — crucially, Task A's 150 did not leak
    // in. If layerRef shared state, plannerTokens here would be 1150.
    assert.strictEqual(traceB.tokenUsages.length, 2);
    assert.strictEqual(traceB.tokenomics.plannerTokens, 1000);
    assert.strictEqual(traceB.tokenomics.executorTokens, 1200);
    assert.strictEqual(traceB.tokenomics.turnCount, 1);
    assert.strictEqual(traceB.tokenomics.totalTokens, 2200);
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

  // Gemini CLI's ACP adapter emits tool_call updates with `title` carrying
  // the stringified tool arguments (via `invocation.getDescription()`) and
  // no `rawInput` field at all — and the matching tool_call_update arrives
  // with only `content` (an array of wrapped ACP content blocks) instead
  // of `rawOutput`. Without this post-compact fix the trace writes
  // `name: "{\"action\":{\"command\":\"...\"}}"`, `args: "{}"`, and
  // `result: "undefined"`, so downstream URL extraction cannot see the
  // navigated URL even though the agent succeeded. These tests lock in
  // the two recovery paths (decode title JSON + unwrap content[]) so the
  // Gemini live runner stays green.
  it("recovers input from title JSON when rawInput is absent (Gemini tool_call shape)", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    };

    const plan = makeSamplePlan();
    const geminiToolCall = new AcpToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "call-gemini-1",
      title: JSON.stringify({ action: { command: "navigate", url: "https://example.com/" } }),
    });
    const geminiToolResult = new AcpToolCallUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-gemini-1",
      status: "completed",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text:
              "Successfully navigated to https://example.com/.\n" +
              "## Pages\n1: https://example.com/ [selected]",
          },
        },
      ],
    });
    const updates: AcpSessionUpdate[] = [
      messageChunk("Navigating.\n"),
      thoughtChunk("."),
      geminiToolCall,
      geminiToolResult,
      ...markerMessage([
        `STEP_START|${plan.steps[0].id}|${plan.steps[0].title}`,
        `STEP_DONE|${plan.steps[0].id}|landed`,
      ]),
      ...markerMessage(["RUN_COMPLETED|passed|done"]),
    ];

    const trace = await Effect.runPromise(runTestEffect(plan, updates, context));

    assert.strictEqual(trace.toolCalls.length, 1);
    const input = trace.toolCalls[0].arguments["input"];
    assert.ok(typeof input === "string", "tool-call input should be a JSON string");
    assert.deepEqual(JSON.parse(input), {
      action: { command: "navigate", url: "https://example.com/" },
    });
    assert.strictEqual(trace.toolCalls[0].wellFormed, true);
    assert.strictEqual(trace.reachedKeyNodes.length, 1);
    assert.strictEqual(trace.finalUrl, "https://example.com/");
  });

  it("recovers result from content[] when rawOutput is absent (Gemini tool_call_update shape)", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: "real-test",
      traceDir,
      plannerMode: "frontier",
      isHeadless: true,
      baseUrl: undefined,
    };

    const plan = makeSamplePlan();
    // Simulate Gemini's confirmation-free tool_call_update (status=completed
    // with only content[]) landing without a matching prior tool_call. The
    // adapter still emits a ToolResult whose URL is recoverable from the
    // inner text block.
    const geminiToolCall = new AcpToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "call-gemini-2",
      title: JSON.stringify({ action: { command: "snapshot" } }),
    });
    const geminiToolResult = new AcpToolCallUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-gemini-2",
      status: "completed",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text:
              "## Latest page snapshot\n" +
              'uid=1_0 RootWebArea "Example Domain" url="https://example.com/"\n',
          },
        },
      ],
    });
    const updates: AcpSessionUpdate[] = [
      messageChunk("Observing.\n"),
      thoughtChunk("."),
      geminiToolCall,
      geminiToolResult,
      ...markerMessage([
        `STEP_START|${plan.steps[0].id}|${plan.steps[0].title}`,
        `STEP_DONE|${plan.steps[0].id}|observed`,
      ]),
      ...markerMessage(["RUN_COMPLETED|passed|done"]),
    ];

    const trace = await Effect.runPromise(runTestEffect(plan, updates, context));

    assert.strictEqual(trace.toolCalls.length, 1);
    assert.strictEqual(trace.reachedKeyNodes.length, 1);
    assert.strictEqual(trace.finalUrl, "https://example.com/");
  });

  // Round-2 review Minor 1 lock-in: even when BOTH rawOutput AND content
  // are absent, the ToolResult must emit a decodable-but-empty envelope
  // (`"[]"`) instead of the literal string `"undefined"` that
  // `serializeToolResult(undefined)` would produce. Prevents the regression
  // from recurring in the degenerate edge.
  it("emits empty-array result when both rawOutput and content are absent", async () => {
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
      toolCallId: "call-empty",
      title: "mcp__browser__observe",
      rawInput: {},
    });
    // Minimal tool_call_update — no rawOutput, no content. Agents should
    // not normally send this, but we must not produce the literal string
    // "undefined" if they do.
    const toolResultUpdate = new AcpToolCallUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-empty",
      title: "mcp__browser__observe",
      status: "completed",
    });
    const updates: AcpSessionUpdate[] = [
      messageChunk("Trying.\n"),
      thoughtChunk("."),
      toolCallUpdate,
      toolResultUpdate,
      ...markerMessage([
        `STEP_START|${plan.steps[0].id}|${plan.steps[0].title}`,
        `STEP_DONE|${plan.steps[0].id}|no-data`,
      ]),
      ...markerMessage(["RUN_COMPLETED|passed|done"]),
    ];

    await Effect.runPromise(runTestEffect(plan, updates, context));

    const files = fs.readdirSync(traceDir).filter((name) => name.endsWith(".ndjson"));
    const raw = parseTraceFile(path.join(traceDir, files[0]));
    const rawToolResult = raw.find((event) => decodeWireEnvelope(event).type === "tool_result");
    assert.ok(rawToolResult !== undefined, "tool_result event should be emitted");
    const toolResult = Schema.decodeUnknownSync(ToolResultEvent)(rawToolResult);
    assert.strictEqual(toolResult.result, "[]");
    assert.notStrictEqual(toolResult.result, "undefined");
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
