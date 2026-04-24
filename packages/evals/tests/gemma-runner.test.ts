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
import { TokenUsageBus } from "@neuve/shared/token-usage-bus";
import { Agent, SessionId } from "@neuve/agent";
import { Executor, Git, GitRepoRoot } from "@neuve/supervisor";
import { PlanDecomposer } from "../src/planning/plan-decomposer";
import { runRealTask, type RealRunContext } from "../src/runners/real";
import { TraceRecorderFactory } from "../src/runners/trace-recorder";
import { GEMMA_RUNNER_NAME } from "../src/runners/gemma";
import { makeDualRunner } from "../src/runners/dual";
import { EvalRunError, type EvalRunner } from "../src/runners/types";
import { EvalTask, KeyNode } from "../src/task";

type AgentShape = ServiceMap.Service.Shape<typeof Agent>;
type GitShape = ServiceMap.Service.Shape<typeof Git>;

const sampleTask = new EvalTask({
  id: "gemma-runner-test-sample",
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
    id: PlanId.makeUnsafe("plan-gemma-test-01"),
    title: "Sample Gemma journey",
    rationale: "Decomposed for gemma-runner test",
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

const scriptedAgentLayer = (updates: readonly AcpSessionUpdate[]) =>
  Layer.succeed(Agent, {
    stream: () => Stream.fromIterable(updates),
    createSession: () => Effect.succeed(SessionId.makeUnsafe("gemma-test-session")),
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-runner-test-"));
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

const WireEventSchema = Schema.Struct({ type: Schema.String });
const decodeWireEnvelope = Schema.decodeUnknownSync(WireEventSchema);

const parseTraceFile = (filePath: string): ReadonlyArray<unknown> =>
  fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));

describe("gemma runner trace projection", () => {
  it("writes a gemma__<task-id>.ndjson trace with the Wave 0.A schema", async () => {
    const traceDir = makeTempTraceDir();
    const context: RealRunContext = {
      runnerName: GEMMA_RUNNER_NAME,
      traceDir,
      plannerMode: "template",
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
      messageChunk("Starting with local Gemma.\n"),
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

    const trace = await Effect.runPromise(
      Effect.scoped(runRealTask(sampleTask, context)).pipe(
        Effect.provide(buildTestLayer(plan, updates)),
      ),
    );

    assert.strictEqual(trace.reachedKeyNodes.length, 1);
    assert.strictEqual(trace.finalUrl, "https://example.com/");

    const files = fs.readdirSync(traceDir).filter((name) => name.endsWith(".ndjson"));
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0], `${GEMMA_RUNNER_NAME}__${sampleTask.id}.ndjson`);

    const raw = parseTraceFile(path.join(traceDir, files[0]));
    const types = raw.map((event) => decodeWireEnvelope(event).type);
    assert.include(types, "agent_message");
    assert.include(types, "tool_call");
    assert.include(types, "tool_result");
    assert.include(types, "status_marker");
    assert.strictEqual(types[types.length - 1], "stream_terminated");
  });
});

describe("dual runner orchestration", () => {
  it("primary+secondary runners run independently on the same task, each emitting its own trace", async () => {
    const traceDir = makeTempTraceDir();
    const plan = makeSamplePlan();
    const updates: AcpSessionUpdate[] = [
      messageChunk("hello from scripted backend\n"),
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

    const buildScriptedRunner = (runnerName: string): EvalRunner => ({
      name: runnerName,
      run: (task) =>
        Effect.scoped(
          runRealTask(task, {
            runnerName,
            traceDir,
            plannerMode: "template",
            isHeadless: true,
            baseUrl: undefined,
          }),
        ).pipe(
          Effect.provide(buildTestLayer(plan, updates)),
          Effect.catchTag("TraceWriteError", (error) =>
            new EvalRunError({
              runner: runnerName,
              taskId: task.id,
              cause: `trace-writer: ${error.message}`,
            }).asEffect(),
          ),
        ),
    });

    const primary = buildScriptedRunner("real");
    const secondary = buildScriptedRunner(GEMMA_RUNNER_NAME);
    const dual = makeDualRunner(primary, secondary);

    assert.strictEqual(dual.name, `real+${GEMMA_RUNNER_NAME}`);

    await Effect.runPromise(dual.primary.run(sampleTask));
    await Effect.runPromise(dual.secondary.run(sampleTask));

    const files = fs.readdirSync(traceDir).sort();
    assert.deepStrictEqual(
      files.sort(),
      [`${GEMMA_RUNNER_NAME}__${sampleTask.id}.ndjson`, `real__${sampleTask.id}.ndjson`].sort(),
    );
  });
});
