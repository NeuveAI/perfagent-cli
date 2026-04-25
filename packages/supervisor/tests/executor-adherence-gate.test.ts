import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Layer, Logger, Option, Stream } from "effect";
import {
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpSessionUpdate,
  AnalysisStep,
  ChangesFor,
  ExecutedPerfPlan,
  PlanId,
  StepId,
} from "@neuve/shared/models";
import { TokenUsageBus } from "@neuve/shared/token-usage-bus";
import { Agent } from "@neuve/agent";
import { Executor } from "../src/executor";
import { Git, GitRepoRoot } from "../src/git/git";

const VOLVO_TRACE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "evals",
  "traces",
  "2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson",
);

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

const makeVolvoSteps = (): readonly AnalysisStep[] => [
  makeStep("step-01", "Navigate to volvocars.com"),
  makeStep("step-02", "Open Buy menu"),
  makeStep("step-03", "Click Build your Volvo"),
  makeStep("step-04", "Select EX90 model"),
  makeStep("step-05", "Pick spec options"),
  makeStep("step-06", "Reach the order request form"),
];

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

const gitStubLayer = Layer.succeed(
  Git,
  Git.of({
    withRepoRoot:
      (_cwd: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(GitRepoRoot, "/tmp/stub-repo")),
    getMainBranch: Effect.succeed("main"),
    getCurrentBranch: Effect.succeed("feature/test-branch"),
    isInsideWorkTree: () => Effect.succeed(true),
    getFileStats: () => Effect.succeed([]),
    getChangedFiles: () => Effect.succeed([]),
    getDiffPreview: () => Effect.succeed(""),
    getRecentCommits: () => Effect.succeed([]),
    getCommitSummary: () => Effect.succeed(Option.none()),
    getState: Effect.succeed({
      isGitRepo: true,
      currentBranch: "feature/test-branch",
      mainBranch: "main",
      hasUnstagedChanges: false,
      hasUncommittedChanges: false,
      hasBranchChanges: false,
      changedFiles: [],
      workingTreeFileStats: [],
      fingerprint: Option.none(),
      savedFingerprint: Option.none(),
    }),
    computeFingerprint: () => Effect.succeed(Option.none()),
    saveTestedFingerprint: () => Effect.void,
  }),
);

const scriptedAgentLayer = (updates: readonly AcpSessionUpdate[]) =>
  Layer.succeed(
    Agent,
    Agent.of({
      stream: () => Stream.fromIterable(updates),
      createSession: () => Effect.die("createSession not used in this test"),
      setConfigOption: () => Effect.die("setConfigOption not used in this test"),
      fetchConfigOptions: () => Effect.die("fetchConfigOptions not used in this test"),
    }),
  );

const buildLayer = (updates: readonly AcpSessionUpdate[]) =>
  Layer.provideMerge(
    Executor.layer,
    Layer.mergeAll(scriptedAgentLayer(updates), gitStubLayer, TokenUsageBus.layerNoop),
  );

const runExecutor = (
  updates: readonly AcpSessionUpdate[],
  initialSteps: readonly AnalysisStep[],
) =>
  Effect.gen(function* () {
    const executor = yield* Executor;
    const stream = executor.execute({
      changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
      instruction: "go to volvocars.com and build an ex90",
      isHeadless: true,
      cookieBrowserKeys: [],
      initialSteps,
    });
    return yield* stream.pipe(Stream.runCollect);
  }).pipe(Effect.provide(buildLayer(updates)));

const lastPlanOf = (plans: readonly ExecutedPerfPlan[]): ExecutedPerfPlan => {
  if (plans.length === 0) throw new Error("expected at least one emitted plan");
  return plans[plans.length - 1];
};

describe("Executor adherence gate", () => {
  it("does NOT terminate on a single RUN_COMPLETED when plan steps remain pending (Volvo trace replay)", async () => {
    const rawTrace = fs
      .readFileSync(VOLVO_TRACE_PATH, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; marker?: string; payload?: unknown });
    const runCompletedMarker = rawTrace.find(
      (event) => event.type === "status_marker" && event.marker === "RUN_COMPLETED",
    );
    expect(runCompletedMarker).toBeDefined();

    const payload = runCompletedMarker?.payload;
    expect(Array.isArray(payload)).toBe(true);
    const [status, summary] = payload as [string, string];
    expect(status).toBe("failed");

    const runCompletedLine = `RUN_COMPLETED|${status}|${summary}`;
    const updates: AcpSessionUpdate[] = [
      messageChunk("Starting analysis...\n"),
      thoughtChunk("..."),
      ...markerMessage([runCompletedLine]),
    ];

    const warnings: { message: string; level: string }[] = [];
    const warningLogger = Logger.make((options) => {
      warnings.push({
        level: String(options.logLevel),
        message: Array.isArray(options.message)
          ? options.message.map((part) => String(part)).join(" ")
          : String(options.message),
      });
    });
    const logCapture = Logger.layer([warningLogger]);

    const emitted = await Effect.runPromise(
      runExecutor(updates, makeVolvoSteps()).pipe(Effect.provide(logCapture)),
    );

    const finalPlan = lastPlanOf(emitted);

    expect(finalPlan.hasRunFinished).toBe(false);
    expect(finalPlan.allPlanStepsTerminal).toBe(false);
    expect(finalPlan.steps.length).toBe(6);
    expect(
      warnings.some(
        (entry) => entry.level === "Warn" && entry.message.includes("premature-run-completed"),
      ),
    ).toBe(true);
  });

  it("terminates cleanly when all plan steps are terminal before RUN_COMPLETED", async () => {
    const steps = makeVolvoSteps();
    const updates: AcpSessionUpdate[] = [];
    steps.forEach((step, index) => {
      updates.push(
        ...markerMessage([
          `STEP_START|${step.id}|${step.title}`,
          `STEP_DONE|${step.id}|step ${index + 1} done`,
        ]),
      );
    });
    updates.push(...markerMessage(["RUN_COMPLETED|passed|all six steps complete"]));

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const finalPlan = lastPlanOf(emitted);

    expect(finalPlan.hasRunFinished).toBe(true);
    expect(finalPlan.allPlanStepsTerminal).toBe(true);
    expect(finalPlan.steps.every((step) => step.status === "passed")).toBe(true);
  });

  it("terminates cleanly when ASSERTION_FAILED category=abort precedes RUN_COMPLETED", async () => {
    const steps = makeVolvoSteps();
    const updates: AcpSessionUpdate[] = [
      ...markerMessage([
        `STEP_START|${steps[0].id}|${steps[0].title}`,
        `STEP_DONE|${steps[0].id}|landed`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[1].id}|${steps[1].title}`,
        `STEP_DONE|${steps[1].id}|menu opened`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[2].id}|${steps[2].title}`,
        `ASSERTION_FAILED|${steps[2].id}|category=abort; domain=general; abort_reason=blocked-by-captcha; expected=submenu-visible; actual=captcha-overlay`,
        "RUN_COMPLETED|failed|aborted due to captcha",
      ]),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const finalPlan = lastPlanOf(emitted);

    expect(finalPlan.hasRunFinished).toBe(true);
    const runFinished = finalPlan.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.abort).toBeDefined();
      expect(runFinished.abort?.reason).toBe("blocked-by-captcha");
    }
    const abortedStep = finalPlan.steps.find((step) => step.id === steps[2].id);
    expect(abortedStep?.status).toBe("failed");
  });

  it("terminates cleanly on RUN_COMPLETED with empty initialSteps (runtime default)", async () => {
    const updates: AcpSessionUpdate[] = [
      messageChunk("Inspecting the target page...\n"),
      thoughtChunk("..."),
      ...markerMessage(["RUN_COMPLETED|passed|homepage profiled without regressions"]),
    ];

    const warnings: { message: string; level: string }[] = [];
    const capturingLogger = Logger.make((options) => {
      warnings.push({
        level: String(options.logLevel),
        message: Array.isArray(options.message)
          ? options.message.map((part) => String(part)).join(" ")
          : String(options.message),
      });
    });
    const logCapture = Logger.layer([capturingLogger]);

    const program = runExecutor(updates, []).pipe(Effect.provide(logCapture));

    const emitted = await Effect.runPromise(program);
    const finalPlan = lastPlanOf(emitted);

    expect(finalPlan.steps.length).toBe(0);
    expect(finalPlan.allPlanStepsTerminal).toBe(true);
    expect(finalPlan.hasRunFinished).toBe(true);
    expect(
      warnings.some(
        (entry) => entry.level === "Warn" && entry.message.includes("premature-run-completed"),
      ),
    ).toBe(false);
  });

  it("R3 rule — rejects passed RUN_COMPLETED when ASSERTION_FAILED in last 3 events lacks matching STEP_DONE", async () => {
    const steps = makeVolvoSteps();
    const updates: AcpSessionUpdate[] = [
      ...markerMessage([
        `STEP_START|${steps[0].id}|${steps[0].title}`,
        `STEP_DONE|${steps[0].id}|landed`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[1].id}|${steps[1].title}`,
        `STEP_DONE|${steps[1].id}|menu opened`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[2].id}|${steps[2].title}`,
        `ASSERTION_FAILED|${steps[2].id}|category=regression; domain=perf; reason=lcp-poor; evidence=lcp=4500ms`,
        "RUN_COMPLETED|passed|claimed pass despite unresolved failure",
      ]),
    ];

    const warnings: { message: string; level: string }[] = [];
    const capturingLogger = Logger.make((options) => {
      warnings.push({
        level: String(options.logLevel),
        message: Array.isArray(options.message)
          ? options.message.map((part) => String(part)).join(" ")
          : String(options.message),
      });
    });
    const logCapture = Logger.layer([capturingLogger]);

    const emitted = await Effect.runPromise(
      runExecutor(updates, steps).pipe(Effect.provide(logCapture)),
    );
    const finalPlan = lastPlanOf(emitted);

    expect(finalPlan.hasRunFinished).toBe(false);
    expect(finalPlan.allPlanStepsTerminal).toBe(false);
    expect(
      warnings.some(
        (entry) => entry.level === "Warn" && entry.message.includes("premature-run-completed"),
      ),
    ).toBe(true);
  });

  it("R3 rule — accepts passed RUN_COMPLETED when ASSERTION_FAILED is followed by matching STEP_DONE on same stepId", async () => {
    const steps = makeVolvoSteps().slice(0, 3);
    const updates: AcpSessionUpdate[] = [
      ...markerMessage([
        `STEP_START|${steps[0].id}|${steps[0].title}`,
        `STEP_DONE|${steps[0].id}|landed`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[1].id}|${steps[1].title}`,
        `STEP_DONE|${steps[1].id}|menu opened`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[2].id}|${steps[2].title}`,
        `ASSERTION_FAILED|${steps[2].id}|category=regression; domain=perf; reason=lcp-initial-poor; evidence=lcp=4500ms`,
        `STEP_DONE|${steps[2].id}|recovered after retry`,
        "RUN_COMPLETED|passed|all three steps complete",
      ]),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const finalPlan = lastPlanOf(emitted);

    expect(finalPlan.hasRunFinished).toBe(true);
    expect(finalPlan.allPlanStepsTerminal).toBe(true);
    const runFinished = finalPlan.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("passed");
    }
  });

  it("R3 rule — accepts failed RUN_COMPLETED with unresolved ASSERTION_FAILED (failure is honest)", async () => {
    const steps = makeVolvoSteps().slice(0, 3);
    const updates: AcpSessionUpdate[] = [
      ...markerMessage([
        `STEP_START|${steps[0].id}|${steps[0].title}`,
        `STEP_DONE|${steps[0].id}|landed`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[1].id}|${steps[1].title}`,
        `STEP_DONE|${steps[1].id}|menu opened`,
      ]),
      ...markerMessage([
        `STEP_START|${steps[2].id}|${steps[2].title}`,
        `ASSERTION_FAILED|${steps[2].id}|category=regression; domain=perf; reason=lcp-poor; evidence=lcp=4500ms`,
        "RUN_COMPLETED|failed|honest failure",
      ]),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const finalPlan = lastPlanOf(emitted);

    expect(finalPlan.hasRunFinished).toBe(true);
    const runFinished = finalPlan.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("failed");
    }
  });

  it("auto-synthesizes RunFinished via the grace-period safety net", () => {
    const steps = makeVolvoSteps();
    let current = new ExecutedPerfPlan({
      id: PlanId.makeUnsafe("plan-volvo-01"),
      changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
      currentBranch: "main",
      diffPreview: "",
      fileStats: [],
      instruction: "go to volvocars.com and build an ex90",
      baseUrl: Option.none(),
      isHeadless: true,
      cookieBrowserKeys: [],
      targetUrls: [],
      perfBudget: Option.none(),
      title: "Volvo EX90 configurator journey",
      rationale: "Seeded with pre-decomposed steps",
      steps,
      events: [],
    });
    for (const step of steps) {
      current = current.addEvent(
        new AcpAgentMessageChunk({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `STEP_START|${step.id}|${step.title}\nSTEP_DONE|${step.id}|done\n`,
          },
        }),
      );
      current = current.addEvent(
        new AcpAgentThoughtChunk({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "." },
        }),
      );
    }
    expect(current.allPlanStepsTerminal).toBe(true);
    expect(current.hasRunFinished).toBe(false);

    const synthesized = current.synthesizeRunFinished();
    expect(synthesized.hasRunFinished).toBe(true);
    const runFinished = synthesized.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("passed");
      expect(runFinished.abort).toBeUndefined();
    }
  });
});
