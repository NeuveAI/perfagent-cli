import * as path from "node:path";
import { assert, describe, it } from "vite-plus/test";
import {
  buildPerTaskRollup,
  comparePair,
  parseTraceFilename,
  RUNNER_NAMES,
  summarizeRunner,
  type PerTaskRollup,
} from "../scripts/wave-r5-ab/aggregate";
import { buildTracePath } from "../src/runners/trace-recorder";
import {
  GEMMA_REACT_RUNNER_NAME,
  GEMINI_REACT_RUNNER_NAME,
  GEMMA_ORACLE_PLAN_RUNNER_NAME,
} from "../src/runners/runner-names";

const buildTraceLines = (events: ReadonlyArray<unknown>): string =>
  events.map((event) => JSON.stringify(event)).join("\n") + "\n";

const successfulTrace = buildTraceLines([
  { type: "agent_message", ts: 1, turn: 1, content: "Starting." },
  {
    type: "tool_call",
    ts: 2,
    turn: 1,
    id: "tc-000",
    name: "interact",
    args: JSON.stringify({ command: "navigate", url: "https://example.com/" }),
  },
  {
    type: "tool_result",
    ts: 3,
    id: "tc-000",
    result: "Successfully navigated to https://example.com/.",
    ok: true,
  },
  {
    type: "plan_update",
    ts: 4,
    turn: 1,
    stepId: "step-01",
    action: "insert",
    payload: { id: "step-01", title: "Open landing" },
  },
  { type: "status_marker", ts: 5, marker: "STEP_DONE", payload: ["step-01", "Landed"] },
  { type: "status_marker", ts: 6, marker: "RUN_COMPLETED", payload: ["passed", "ok"] },
  {
    type: "task_tokenomics",
    ts: 7,
    totalPromptTokens: 1000,
    totalCompletionTokens: 200,
    totalTokens: 1200,
    peakPromptTokens: 800,
    turnCount: 5,
    plannerTokens: 0,
    executorTokens: 1200,
  },
  { type: "stream_terminated", ts: 8, reason: "run_finished:passed", remainingSteps: 0 },
]);

const failedTrace = buildTraceLines([
  { type: "agent_message", ts: 1, turn: 1, content: "Trying." },
  {
    type: "tool_call",
    ts: 2,
    turn: 1,
    id: "tc-000",
    name: "interact",
    args: JSON.stringify({ command: "click", ref: "[5]" }),
  },
  { type: "tool_result", ts: 3, id: "tc-000", result: "click failed", ok: false },
  { type: "status_marker", ts: 4, marker: "RUN_COMPLETED", payload: ["failed", "stuck"] },
  {
    type: "task_tokenomics",
    ts: 5,
    totalPromptTokens: 500,
    totalCompletionTokens: 100,
    totalTokens: 600,
    peakPromptTokens: 400,
    turnCount: 3,
    plannerTokens: 0,
    executorTokens: 600,
  },
  { type: "stream_terminated", ts: 6, reason: "run_finished:failed", remainingSteps: 1 },
]);

const incompleteTrace = buildTraceLines([
  { type: "agent_message", ts: 1, turn: 1, content: "Stuck." },
  {
    type: "tool_call",
    ts: 2,
    turn: 1,
    id: "tc-000",
    name: "interact",
    args: JSON.stringify({ command: "navigate", url: "https://example.com/" }),
  },
  {
    type: "tool_result",
    ts: 3,
    id: "tc-000",
    result: "Successfully navigated to https://example.com/.",
    ok: true,
  },
  { type: "stream_terminated", ts: 4, reason: "stream_ended", remainingSteps: 2 },
]);

describe("parseTraceFilename", () => {
  it("splits runner and taskId on double underscore", () => {
    const result = parseTraceFilename("gemma-react__calibration-1.ndjson");
    assert.deepEqual(result, { runnerName: "gemma-react", taskId: "calibration-1" });
  });

  it("returns undefined when shape doesn't match", () => {
    assert.isUndefined(parseTraceFilename("singlepart.ndjson"));
  });

  it("handles taskIds with internal dashes", () => {
    const result = parseTraceFilename("gemini-react__journey-1-car-configurator-bmw.ndjson");
    assert.deepEqual(result, {
      runnerName: "gemini-react",
      taskId: "journey-1-car-configurator-bmw",
    });
  });
});

describe("buildPerTaskRollup", () => {
  it("scores a successful trace at full marks for final-state and tool-call-validity", () => {
    const rollup = buildPerTaskRollup({
      runnerName: "gemma-react",
      taskId: "trivial-1",
      traceNdjson: successfulTrace,
      expectedKeyNodeCount: 1,
    });
    assert.strictEqual(rollup.scores.finalState, 1);
    assert.strictEqual(rollup.scores.toolCallValidity, 1);
    assert.strictEqual(rollup.scores.stepCoverage, 1);
    assert.strictEqual(rollup.runFinishedStatus, "passed");
    assert.strictEqual(rollup.tokenomics.totalTokens, 1200);
    assert.strictEqual(rollup.tokenomics.peakPromptTokens, 800);
    assert.strictEqual(rollup.tokenomics.turnCount, 5);
    assert.strictEqual(rollup.toolCallCount, 1);
    assert.strictEqual(rollup.planUpdateCount, 1);
    assert.strictEqual(rollup.stepDoneCount, 1);
    assert.strictEqual(rollup.streamTerminationReason, "run_finished:passed");
  });

  it("scores a failed trace at zero final-state and surfaces the runFinishedStatus", () => {
    const rollup = buildPerTaskRollup({
      runnerName: "gemma-react",
      taskId: "trivial-1",
      traceNdjson: failedTrace,
      expectedKeyNodeCount: 1,
    });
    assert.strictEqual(rollup.scores.finalState, 0);
    assert.strictEqual(rollup.runFinishedStatus, "failed");
    assert.strictEqual(rollup.tokenomics.turnCount, 3);
  });

  it("classifies stream_ended without RUN_COMPLETED as 'unfinished'", () => {
    const rollup = buildPerTaskRollup({
      runnerName: "gemma-react",
      taskId: "trivial-1",
      traceNdjson: incompleteTrace,
      expectedKeyNodeCount: 1,
    });
    assert.strictEqual(rollup.runFinishedStatus, "unfinished");
    assert.strictEqual(rollup.remainingSteps, 2);
    assert.strictEqual(rollup.streamTerminationReason, "stream_ended");
  });

  it("counts plan_update events distinct from status markers", () => {
    const trace = buildTraceLines([
      {
        type: "plan_update",
        ts: 1,
        turn: 1,
        stepId: "step-01",
        action: "insert",
        payload: { id: "step-01", title: "Open" },
      },
      {
        type: "plan_update",
        ts: 2,
        turn: 2,
        stepId: "step-02",
        action: "remove",
      },
      {
        type: "plan_update",
        ts: 3,
        turn: 2,
        stepId: "step-03",
        action: "replace",
        payload: { id: "step-03", title: "Click" },
      },
      { type: "status_marker", ts: 4, marker: "RUN_COMPLETED", payload: ["passed", "ok"] },
    ]);
    const rollup = buildPerTaskRollup({
      runnerName: "gemma-react",
      taskId: "synthetic",
      traceNdjson: trace,
      expectedKeyNodeCount: 0,
    });
    assert.strictEqual(rollup.planUpdateCount, 3);
  });
});

describe("summarizeRunner", () => {
  it("computes mean scores + pass/fail/unfinished counts across rollups", () => {
    const rollups: PerTaskRollup[] = [
      {
        runnerName: "gemma-react",
        taskId: "task-1",
        scores: { stepCoverage: 1, finalState: 1, toolCallValidity: 1, furthestKeyNode: 1 },
        tokenomics: { totalTokens: 1000, peakPromptTokens: 500, turnCount: 4, executorTokens: 1000 },
        toolCallCount: 5,
        planUpdateCount: 2,
        stepDoneCount: 3,
        assertionFailedCount: 0,
        runFinishedStatus: "passed",
        streamTerminationReason: "run_finished:passed",
        remainingSteps: 0,
        finalUrl: "https://example.com/a",
      },
      {
        runnerName: "gemma-react",
        taskId: "task-2",
        scores: { stepCoverage: 0, finalState: 0, toolCallValidity: 0.5, furthestKeyNode: 0 },
        tokenomics: { totalTokens: 800, peakPromptTokens: 400, turnCount: 3, executorTokens: 800 },
        toolCallCount: 2,
        planUpdateCount: 0,
        stepDoneCount: 0,
        assertionFailedCount: 1,
        runFinishedStatus: "failed",
        streamTerminationReason: "run_finished:failed",
        remainingSteps: 1,
        finalUrl: "",
      },
      {
        runnerName: "gemma-react",
        taskId: "task-3",
        scores: { stepCoverage: 0.5, finalState: 0, toolCallValidity: 1, furthestKeyNode: 0.5 },
        tokenomics: { totalTokens: 600, peakPromptTokens: 300, turnCount: 2, executorTokens: 600 },
        toolCallCount: 1,
        planUpdateCount: 1,
        stepDoneCount: 1,
        assertionFailedCount: 0,
        runFinishedStatus: "unfinished",
        streamTerminationReason: "stream_ended",
        remainingSteps: 2,
        finalUrl: "https://example.com/b",
      },
    ];
    const summary = summarizeRunner(rollups);
    assert.strictEqual(summary.runnerName, "gemma-react");
    assert.strictEqual(summary.taskCount, 3);
    assert.strictEqual(summary.passedCount, 1);
    assert.strictEqual(summary.failedCount, 1);
    assert.strictEqual(summary.unfinishedCount, 1);
    assert.closeTo(summary.meanStepCoverage, (1 + 0 + 0.5) / 3, 1e-9);
    assert.closeTo(summary.meanFinalState, 1 / 3, 1e-9);
    assert.closeTo(summary.meanToolCallValidity, (1 + 0.5 + 1) / 3, 1e-9);
    assert.closeTo(summary.meanPlanUpdateCount, (2 + 0 + 1) / 3, 1e-9);
    assert.closeTo(summary.meanTotalTokens, (1000 + 800 + 600) / 3, 1e-9);
  });

  it("returns zero-valued summary for empty rollup set", () => {
    const summary = summarizeRunner([]);
    assert.strictEqual(summary.taskCount, 0);
    assert.strictEqual(summary.meanStepCoverage, 0);
    assert.strictEqual(summary.passedCount, 0);
  });
});

describe("comparePair", () => {
  const buildRollup = (
    runnerName: string,
    taskId: string,
    finalState: 0 | 1,
    stepCoverage: number,
  ): PerTaskRollup => ({
    runnerName,
    taskId,
    scores: { stepCoverage, finalState, toolCallValidity: 1, furthestKeyNode: stepCoverage },
    tokenomics: { totalTokens: 0, peakPromptTokens: 0, turnCount: 0, executorTokens: 0 },
    toolCallCount: 0,
    planUpdateCount: 0,
    stepDoneCount: 0,
    assertionFailedCount: 0,
    runFinishedStatus: finalState === 1 ? "passed" : "failed",
    streamTerminationReason:
      finalState === 1 ? "run_finished:passed" : "run_finished:failed",
    remainingSteps: 0,
    finalUrl: "",
  });

  it("flags task-level deltas beyond the threshold", () => {
    const left = [
      buildRollup("gemma-react", "task-1", 1, 1.0),
      buildRollup("gemma-react", "task-2", 0, 0.0),
    ];
    const right = [
      buildRollup("gemini-react", "task-1", 1, 1.0),
      buildRollup("gemini-react", "task-2", 1, 1.0),
    ];
    const result = comparePair({
      leftRunner: "gemma-react",
      rightRunner: "gemini-react",
      leftRollups: left,
      rightRollups: right,
      regressionThreshold: 0.5,
    });
    const flaggedTasks = result.flaggedRegressions.map((flag) => flag.taskId);
    assert.include(flaggedTasks, "task-2");
    const finalStateDelta = result.flaggedRegressions.find(
      (flag) => flag.taskId === "task-2" && flag.metric === "finalState",
    );
    assert.isDefined(finalStateDelta);
    assert.strictEqual(finalStateDelta?.delta, 1);
    assert.strictEqual(finalStateDelta?.direction, "right-better");
  });

  it("emits zero deltas when both runners produce identical scores", () => {
    const both = [buildRollup("a", "task-1", 1, 1.0)];
    const right = [buildRollup("b", "task-1", 1, 1.0)];
    const result = comparePair({
      leftRunner: "a",
      rightRunner: "b",
      leftRollups: both,
      rightRollups: right,
      regressionThreshold: 0.1,
    });
    assert.strictEqual(result.flaggedRegressions.length, 0);
    for (const delta of result.perTaskDeltas) {
      assert.strictEqual(delta.delta, 0);
    }
  });

  it("treats a missing right-side rollup as zero (left-better when left scored)", () => {
    const left = [buildRollup("a", "task-only-on-left", 1, 0.8)];
    const result = comparePair({
      leftRunner: "a",
      rightRunner: "b",
      leftRollups: left,
      rightRollups: [],
      regressionThreshold: 0.1,
    });
    const flaggedDirections = result.flaggedRegressions.map((flag) => flag.direction);
    assert.isAtLeast(flaggedDirections.length, 1);
    assert.isTrue(
      flaggedDirections.every((direction) => direction === "left-better"),
      "missing right-side rollup is left-better when left scored above zero",
    );
  });
});

describe("RUNNER_NAMES contract", () => {
  it("exposes the three Wave R5 runner names in canonical order", () => {
    assert.deepEqual([...RUNNER_NAMES], [
      "gemma-react",
      "gemini-react",
      "gemma-oracle-plan",
    ]);
  });

  // C1 contract test: the trace-filename pattern produced by `buildTracePath`
  // (consumed by `recorder.append` at runtime) MUST round-trip through the
  // aggregator's `parseTraceFilename`. A drift between the two — the
  // class of bug C1 caught in review (eval driver wrote `gemma__*.ndjson`
  // but aggregator filtered on `gemma-react`) — silently produces empty
  // rows in the regression report and burns hours of sweep wall-clock.
  // Pinning the round-trip here catches the contract violation at test
  // time before any sweep is kicked off.
  it("trace-filename round-trip: every RUNNER_NAMES entry produced by buildTracePath parses back to the same runner + taskId", () => {
    const taskIds = [
      "trivial-1-example-homepage",
      "journey-1-car-configurator-bmw",
      "calibration-3-two-step-docs",
    ];
    for (const runnerName of RUNNER_NAMES) {
      for (const taskId of taskIds) {
        const tracePath = buildTracePath("evals/traces/wave-r5-ab", runnerName, taskId);
        const parsed = parseTraceFilename(path.basename(tracePath));
        assert.isDefined(
          parsed,
          `parseTraceFilename failed to parse ${tracePath} (runner=${runnerName}, taskId=${taskId})`,
        );
        if (parsed === undefined) continue;
        assert.strictEqual(
          parsed.runnerName,
          runnerName,
          `round-trip runner mismatch for trace ${tracePath}`,
        );
        assert.strictEqual(
          parsed.taskId,
          taskId,
          `round-trip taskId mismatch for trace ${tracePath}`,
        );
      }
    }
  });

  // C1 contract test, second leg: each runner-name CONSTANT exported by
  // its module file (the eval driver imports these) is the SAME token in
  // RUNNER_NAMES. Drift here would silently re-introduce C1.
  it("runner-name constants imported from each runner module are identical to their RUNNER_NAMES entries", () => {
    assert.strictEqual(GEMMA_REACT_RUNNER_NAME, "gemma-react");
    assert.strictEqual(GEMINI_REACT_RUNNER_NAME, "gemini-react");
    assert.strictEqual(GEMMA_ORACLE_PLAN_RUNNER_NAME, "gemma-oracle-plan");
    assert.include([...RUNNER_NAMES], GEMMA_REACT_RUNNER_NAME);
    assert.include([...RUNNER_NAMES], GEMINI_REACT_RUNNER_NAME);
    assert.include([...RUNNER_NAMES], GEMMA_ORACLE_PLAN_RUNNER_NAME);
  });
});
