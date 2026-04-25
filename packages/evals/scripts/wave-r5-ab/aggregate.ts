import { Option, Schema } from "effect";
import { TraceEventSchema, type TraceEvent } from "../../src/runners/trace-recorder";
import {
  GEMMA_REACT_RUNNER_NAME,
  GEMINI_REACT_RUNNER_NAME,
  GEMMA_ORACLE_PLAN_RUNNER_NAME,
} from "../../src/runners/runner-names";

// Pure aggregation helpers for the Wave R5 A:B regression sweep. Reads
// trace ndjson contents (NOT the filesystem — the orchestrator script
// owns IO so these helpers are unit-testable) and produces per-task and
// per-runner rollups suitable for the markdown report.

export const RUNNER_NAMES = [
  GEMMA_REACT_RUNNER_NAME,
  GEMINI_REACT_RUNNER_NAME,
  GEMMA_ORACLE_PLAN_RUNNER_NAME,
] as const;
export type RunnerName = (typeof RUNNER_NAMES)[number];

// Module-load contract assertion: the runner-name constants exported by
// the runner factory modules are the SAME tokens the eval driver writes
// into trace filenames AND the SAME tokens this aggregator filters on.
// A drift between any of them silently produces empty rows in the
// regression report (the C1 review finding); failing loud at boot here
// prevents that class of bug going forward.
const expectedNames = ["gemma-react", "gemini-react", "gemma-oracle-plan"] as const;
for (let index = 0; index < expectedNames.length; index += 1) {
  const expected = expectedNames[index];
  const actual = RUNNER_NAMES[index];
  if (actual !== expected) {
    throw new Error(
      `[wave-r5-ab/aggregate] RUNNER_NAMES[${index}] drift: expected "${expected}", got "${actual}". ` +
        `The runner-name constant in @neuve/evals/runners has diverged from the wire contract; ` +
        `regression report would silently exclude this runner's traces.`,
    );
  }
}

export interface PerTaskScores {
  readonly stepCoverage: number;
  readonly finalState: 0 | 1;
  readonly toolCallValidity: number;
  readonly furthestKeyNode: number;
}

export interface PerTaskTokenomics {
  readonly totalTokens: number;
  readonly peakPromptTokens: number;
  readonly turnCount: number;
  readonly executorTokens: number;
}

export interface PerTaskRollup {
  readonly runnerName: string;
  readonly taskId: string;
  readonly scores: PerTaskScores;
  readonly tokenomics: PerTaskTokenomics;
  readonly toolCallCount: number;
  readonly planUpdateCount: number;
  readonly stepDoneCount: number;
  readonly assertionFailedCount: number;
  readonly runFinishedStatus: "passed" | "failed" | "unfinished";
  readonly streamTerminationReason: string;
  readonly remainingSteps: number;
  readonly finalUrl: string;
}

export interface PerRunnerSummary {
  readonly runnerName: string;
  readonly taskCount: number;
  readonly meanStepCoverage: number;
  readonly meanFinalState: number;
  readonly meanToolCallValidity: number;
  readonly meanFurthestKeyNode: number;
  readonly meanTotalTokens: number;
  readonly meanPeakPromptTokens: number;
  readonly meanTurnCount: number;
  readonly meanPlanUpdateCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly unfinishedCount: number;
}

export interface PairwiseDelta {
  readonly taskId: string;
  readonly metric: keyof PerTaskScores;
  readonly leftRunner: string;
  readonly rightRunner: string;
  readonly leftValue: number;
  readonly rightValue: number;
  readonly delta: number;
}

export interface FlaggedRegression {
  readonly taskId: string;
  readonly leftRunner: string;
  readonly rightRunner: string;
  readonly metric: keyof PerTaskScores;
  readonly leftValue: number;
  readonly rightValue: number;
  readonly delta: number;
  readonly direction: "left-better" | "right-better";
}

const decodeTraceLine = Schema.decodeUnknownSync(TraceEventSchema);

const parseTraceLines = (ndjson: string): ReadonlyArray<TraceEvent> => {
  const lines = ndjson.split("\n").filter((line) => line.length > 0);
  return lines.map((line) => decodeTraceLine(JSON.parse(line)));
};

const TRACE_FILENAME_PATTERN = /^([^_]+)__(.+)\.ndjson$/;
export const parseTraceFilename = (
  filename: string,
): { readonly runnerName: string; readonly taskId: string } | undefined => {
  const match = TRACE_FILENAME_PATTERN.exec(filename);
  if (match === null) return undefined;
  return { runnerName: match[1], taskId: match[2] };
};

interface ScoreAccumulator {
  toolCallCount: number;
  wellFormedToolCallCount: number;
  reachedUrls: string[];
  finalUrl: string;
  finalDomSummary: string;
  remainingSteps: number;
  streamTerminationReason: string;
  runFinishedStatus: "passed" | "failed" | "unfinished";
  planUpdateCount: number;
  stepDoneCount: number;
  assertionFailedCount: number;
  tokenomics: PerTaskTokenomics;
}

const URL_FROM_TOOL_RESULT_PATTERN = /Successfully navigated to (\S+)/;

const extractUrlFromToolResult = (result: unknown): string | undefined => {
  if (typeof result !== "string") return undefined;
  const match = URL_FROM_TOOL_RESULT_PATTERN.exec(result);
  if (!match) return undefined;
  return match[1].replace(/[.,;]+$/, "");
};

const initialAccumulator: ScoreAccumulator = {
  toolCallCount: 0,
  wellFormedToolCallCount: 0,
  reachedUrls: [],
  finalUrl: "",
  finalDomSummary: "",
  remainingSteps: 0,
  streamTerminationReason: "unknown",
  runFinishedStatus: "unfinished",
  planUpdateCount: 0,
  stepDoneCount: 0,
  assertionFailedCount: 0,
  tokenomics: {
    totalTokens: 0,
    peakPromptTokens: 0,
    turnCount: 0,
    executorTokens: 0,
  },
};

// Use the same canonical Effect-Schema pattern as `runners/real.ts`'s
// `isWellFormedToolCall`: decode-to-Option of the unknown JSON shape.
// Some=parseable, None=not. No try/catch.
const UnknownJsonShape = Schema.fromJsonString(Schema.Unknown);
const decodeJsonOption = Schema.decodeUnknownOption(UnknownJsonShape);

const isJsonParseable = (input: unknown): boolean => {
  if (typeof input !== "string" || input.length === 0) return false;
  return Option.isSome(decodeJsonOption(input));
};

const accumulateEvents = (events: ReadonlyArray<TraceEvent>): ScoreAccumulator => {
  const acc: ScoreAccumulator = {
    ...initialAccumulator,
    reachedUrls: [],
    tokenomics: { ...initialAccumulator.tokenomics },
  };
  for (const event of events) {
    if (event.type === "tool_call") {
      acc.toolCallCount += 1;
      if (typeof event.name === "string" && event.name.length > 0 && isJsonParseable(event.args)) {
        acc.wellFormedToolCallCount += 1;
      }
    } else if (event.type === "tool_result") {
      const url = extractUrlFromToolResult(event.result);
      if (url !== undefined) acc.reachedUrls.push(url);
    } else if (event.type === "status_marker") {
      if (event.marker === "STEP_DONE") acc.stepDoneCount += 1;
      if (event.marker === "ASSERTION_FAILED") acc.assertionFailedCount += 1;
      if (event.marker === "RUN_COMPLETED" && Array.isArray(event.payload)) {
        const payload = event.payload as ReadonlyArray<unknown>;
        const status = payload[0];
        const summary = payload[1];
        if (status === "passed" || status === "failed") {
          acc.runFinishedStatus = status;
        }
        if (typeof summary === "string") {
          acc.finalDomSummary = summary;
        }
      }
    } else if (event.type === "plan_update") {
      acc.planUpdateCount += 1;
    } else if (event.type === "stream_terminated") {
      acc.streamTerminationReason = event.reason;
      acc.remainingSteps = event.remainingSteps;
    } else if (event.type === "task_tokenomics") {
      acc.tokenomics = {
        totalTokens: event.totalTokens,
        peakPromptTokens: event.peakPromptTokens,
        turnCount: event.turnCount,
        executorTokens: event.executorTokens,
      };
    }
  }
  acc.finalUrl = acc.reachedUrls.length > 0 ? acc.reachedUrls[acc.reachedUrls.length - 1] : "";
  return acc;
};

interface RollupContext {
  readonly task: { readonly id: string };
}

const computeScoresFromAcc = (
  acc: ScoreAccumulator,
  expectedKeyNodeCount: number,
): PerTaskScores => {
  const finalStateScore: 0 | 1 = acc.runFinishedStatus === "passed" ? 1 : 0;
  const toolCallValidity =
    acc.toolCallCount === 0 ? 0 : acc.wellFormedToolCallCount / acc.toolCallCount;
  // step-coverage and furthest-key-node need the EvalTask's reference KeyNodes
  // for a real key-node-match evaluation; from trace alone we approximate via
  // proportion of unique reachedUrls relative to expected count. The
  // orchestrator (build-report.ts) wires the real EvalTask + scorer for the
  // scoreboard; here we surface a coarse proxy that's still useful in the
  // aggregated table when the orchestrator hasn't run yet.
  const stepCoverage =
    expectedKeyNodeCount === 0
      ? 0
      : Math.min(1, new Set(acc.reachedUrls).size / expectedKeyNodeCount);
  const furthestKeyNode = stepCoverage;
  return { stepCoverage, finalState: finalStateScore, toolCallValidity, furthestKeyNode };
};

export interface BuildRollupOptions {
  readonly runnerName: string;
  readonly taskId: string;
  readonly traceNdjson: string;
  readonly expectedKeyNodeCount: number;
}

export const buildPerTaskRollup = (options: BuildRollupOptions): PerTaskRollup => {
  const events = parseTraceLines(options.traceNdjson);
  const acc = accumulateEvents(events);
  const scores = computeScoresFromAcc(acc, options.expectedKeyNodeCount);
  return {
    runnerName: options.runnerName,
    taskId: options.taskId,
    scores,
    tokenomics: acc.tokenomics,
    toolCallCount: acc.toolCallCount,
    planUpdateCount: acc.planUpdateCount,
    stepDoneCount: acc.stepDoneCount,
    assertionFailedCount: acc.assertionFailedCount,
    runFinishedStatus: acc.runFinishedStatus,
    streamTerminationReason: acc.streamTerminationReason,
    remainingSteps: acc.remainingSteps,
    finalUrl: acc.finalUrl,
  };
};

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export const summarizeRunner = (rollups: ReadonlyArray<PerTaskRollup>): PerRunnerSummary => {
  if (rollups.length === 0) {
    return {
      runnerName: "(empty)",
      taskCount: 0,
      meanStepCoverage: 0,
      meanFinalState: 0,
      meanToolCallValidity: 0,
      meanFurthestKeyNode: 0,
      meanTotalTokens: 0,
      meanPeakPromptTokens: 0,
      meanTurnCount: 0,
      meanPlanUpdateCount: 0,
      passedCount: 0,
      failedCount: 0,
      unfinishedCount: 0,
    };
  }
  const passedCount = rollups.filter((rollup) => rollup.runFinishedStatus === "passed").length;
  const failedCount = rollups.filter((rollup) => rollup.runFinishedStatus === "failed").length;
  const unfinishedCount = rollups.filter(
    (rollup) => rollup.runFinishedStatus === "unfinished",
  ).length;
  return {
    runnerName: rollups[0].runnerName,
    taskCount: rollups.length,
    meanStepCoverage: mean(rollups.map((rollup) => rollup.scores.stepCoverage)),
    meanFinalState: mean(rollups.map((rollup) => rollup.scores.finalState)),
    meanToolCallValidity: mean(rollups.map((rollup) => rollup.scores.toolCallValidity)),
    meanFurthestKeyNode: mean(rollups.map((rollup) => rollup.scores.furthestKeyNode)),
    meanTotalTokens: mean(rollups.map((rollup) => rollup.tokenomics.totalTokens)),
    meanPeakPromptTokens: mean(rollups.map((rollup) => rollup.tokenomics.peakPromptTokens)),
    meanTurnCount: mean(rollups.map((rollup) => rollup.tokenomics.turnCount)),
    meanPlanUpdateCount: mean(rollups.map((rollup) => rollup.planUpdateCount)),
    passedCount,
    failedCount,
    unfinishedCount,
  };
};

export interface ComparePairOptions {
  readonly leftRunner: string;
  readonly rightRunner: string;
  readonly leftRollups: ReadonlyArray<PerTaskRollup>;
  readonly rightRollups: ReadonlyArray<PerTaskRollup>;
  /** Threshold (absolute, in score units) above which a delta is flagged. */
  readonly regressionThreshold: number;
}

export interface PairwiseComparison {
  readonly leftRunner: string;
  readonly rightRunner: string;
  readonly perTaskDeltas: ReadonlyArray<PairwiseDelta>;
  readonly flaggedRegressions: ReadonlyArray<FlaggedRegression>;
}

export const comparePair = (options: ComparePairOptions): PairwiseComparison => {
  const leftByTaskId = new Map<string, PerTaskRollup>();
  for (const rollup of options.leftRollups) leftByTaskId.set(rollup.taskId, rollup);
  const rightByTaskId = new Map<string, PerTaskRollup>();
  for (const rollup of options.rightRollups) rightByTaskId.set(rollup.taskId, rollup);

  const taskIds = new Set<string>([...leftByTaskId.keys(), ...rightByTaskId.keys()]);

  const perTaskDeltas: PairwiseDelta[] = [];
  const flaggedRegressions: FlaggedRegression[] = [];

  const metrics: ReadonlyArray<keyof PerTaskScores> = [
    "stepCoverage",
    "finalState",
    "toolCallValidity",
    "furthestKeyNode",
  ];

  for (const taskId of taskIds) {
    const left = leftByTaskId.get(taskId);
    const right = rightByTaskId.get(taskId);
    for (const metric of metrics) {
      const leftValue = left?.scores[metric] ?? 0;
      const rightValue = right?.scores[metric] ?? 0;
      const delta = rightValue - leftValue;
      perTaskDeltas.push({
        taskId,
        metric,
        leftRunner: options.leftRunner,
        rightRunner: options.rightRunner,
        leftValue,
        rightValue,
        delta,
      });
      if (Math.abs(delta) >= options.regressionThreshold) {
        flaggedRegressions.push({
          taskId,
          leftRunner: options.leftRunner,
          rightRunner: options.rightRunner,
          metric,
          leftValue,
          rightValue,
          delta,
          direction: delta > 0 ? "right-better" : "left-better",
        });
      }
    }
  }

  return {
    leftRunner: options.leftRunner,
    rightRunner: options.rightRunner,
    perTaskDeltas,
    flaggedRegressions,
  };
};
