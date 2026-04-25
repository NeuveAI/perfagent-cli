#!/usr/bin/env tsx
/**
 * build-report.ts — produce the Wave R5 A:B regression report from
 * trace ndjson files emitted by `pnpm eval:wave-r5-ab`.
 *
 * Usage:
 *   pnpm wave-r5-ab:report
 *   # or directly
 *   tsx packages/evals/scripts/wave-r5-ab/build-report.ts \
 *     --trace-dir packages/evals/evals/traces/wave-r5-ab \
 *     --output docs/handover/harness-evals/baselines/wave-r5-ab.md
 *
 * Defaults match the wave-r5-ab.eval.ts trace directory and the canonical
 * report path under `docs/handover/harness-evals/baselines/`.
 *
 * The eval driver writes one ndjson per (runner × task) into the trace dir
 * with filename shape `${runnerName}__${taskId}.ndjson`. This script
 * groups by runner, scores via the Wave 0.A scorers, and emits a markdown
 * report with:
 *   - Per-runner aggregate scoreboard.
 *   - Per-task comparison table (3-column: gemma-react vs gemini-react vs gemma-oracle-plan).
 *   - Flagged regressions (per-task deltas exceeding the threshold).
 *
 * Scoring uses the same Wave 0.A scorers (`stepCoverage`, `finalState`,
 * `toolCallValidity`, `furthestKeyNode`) as the eval driver, with the
 * EvalTask fixtures providing reference KeyNodes — so the report column
 * values match what `pnpm eval:wave-r5-ab` printed at run time.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Option, Schema } from "effect";
import { TraceEventSchema } from "../../src/runners/trace-recorder";
import { ExecutedTrace, KeyNode, ToolCall } from "../../src/task";
import { TokenUsageEntry } from "@neuve/shared/token-usage-bus";
import { stepCoverage } from "../../src/scorers/step-coverage";
import { finalState } from "../../src/scorers/final-state";
import { toolCallValidity } from "../../src/scorers/tool-call-validity";
import { furthestKeyNode } from "../../src/scorers/furthest-key-node";
import { keyNodeMatches } from "../../src/scorers/key-node-matches";
import {
  comparePair,
  parseTraceFilename,
  RUNNER_NAMES,
  summarizeRunner,
  type PerRunnerSummary,
  type PerTaskRollup,
} from "./aggregate";
import { calibration1SingleNavPythonDocs } from "../../tasks/calibration-1-single-nav-python-docs";
import { calibration2SingleNavNews } from "../../tasks/calibration-2-single-nav-news";
import { calibration3TwoStepDocs } from "../../tasks/calibration-3-two-step-docs";
import { calibration4TwoStepEcom } from "../../tasks/calibration-4-two-step-ecom";
import { calibration5ThreeStepSearch } from "../../tasks/calibration-5-three-step-search";
import { hardVolvoEx90 } from "../../tasks/hard-volvo-ex90";
import { journey1CarConfiguratorBmw } from "../../tasks/journey-1-car-configurator-bmw";
import { journey2EcomCheckout } from "../../tasks/journey-2-ecom-checkout";
import { journey3FlightSearch } from "../../tasks/journey-3-flight-search";
import { journey4AccountSignup } from "../../tasks/journey-4-account-signup";
import { journey5InsuranceQuote } from "../../tasks/journey-5-insurance-quote";
import { journey6MediaStreaming } from "../../tasks/journey-6-media-streaming";
import { journey7DashboardFilter } from "../../tasks/journey-7-dashboard-filter";
import { journey8HelpCenter } from "../../tasks/journey-8-help-center";
import { journey9FormWizard } from "../../tasks/journey-9-form-wizard";
import { journey10MarketplaceFilter } from "../../tasks/journey-10-marketplace-filter";
import { moderate1 } from "../../tasks/moderate-1";
import { moderate2 } from "../../tasks/moderate-2";
import { trivial1 } from "../../tasks/trivial-1";
import { trivial2 } from "../../tasks/trivial-2";
import type { EvalTask } from "../../src/task";

const DEFAULT_TRACE_DIR = "packages/evals/evals/traces/wave-r5-ab";
const DEFAULT_OUTPUT = "docs/handover/harness-evals/baselines/wave-r5-ab.md";
const REGRESSION_THRESHOLD = 0.2;

const TASK_REGISTRY: ReadonlyArray<EvalTask> = [
  calibration1SingleNavPythonDocs,
  calibration2SingleNavNews,
  calibration3TwoStepDocs,
  calibration4TwoStepEcom,
  calibration5ThreeStepSearch,
  hardVolvoEx90,
  journey1CarConfiguratorBmw,
  journey2EcomCheckout,
  journey3FlightSearch,
  journey4AccountSignup,
  journey5InsuranceQuote,
  journey6MediaStreaming,
  journey7DashboardFilter,
  journey8HelpCenter,
  journey9FormWizard,
  journey10MarketplaceFilter,
  moderate1,
  moderate2,
  trivial1,
  trivial2,
];

const TASKS_BY_ID = new Map(TASK_REGISTRY.map((task) => [task.id, task] as const));

interface CliArgs {
  readonly traceDir: string;
  readonly output: string;
}

const parseCliArgs = (argv: ReadonlyArray<string>): CliArgs => {
  let traceDir = DEFAULT_TRACE_DIR;
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--trace-dir" && i + 1 < argv.length) {
      traceDir = argv[i + 1];
      i += 1;
    } else if (arg === "--output" && i + 1 < argv.length) {
      output = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: tsx scripts/wave-r5-ab/build-report.ts [--trace-dir <path>] [--output <path>]",
      );
      process.exit(0);
    }
  }
  return { traceDir, output };
};

const decodeTraceLine = Schema.decodeUnknownSync(TraceEventSchema);

// Effect-pattern JSON parseability check (same as runners/real.ts):
// Some = parseable, None = not. No try/catch.
const UnknownJsonShape = Schema.fromJsonString(Schema.Unknown);
const decodeJsonOption = Schema.decodeUnknownOption(UnknownJsonShape);

const URL_FROM_TOOL_RESULT_PATTERN = /Successfully navigated to (\S+)/;
const URL_FROM_TOOL_INPUT_PATTERN = /"url"\s*:\s*"([^"]+)"/;

const extractUrlFromText = (
  pattern: RegExp,
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = pattern.exec(value);
  if (!match) return undefined;
  return match[1].replace(/[.,;]+$/, "");
};

const readTraceFile = (filePath: string): string => fs.readFileSync(filePath, "utf8");

interface TraceProjection {
  readonly trace: ExecutedTrace;
  readonly runFinishedStatus: "passed" | "failed" | "unfinished";
  readonly streamTerminationReason: string;
  readonly remainingSteps: number;
  readonly planUpdateCount: number;
}

const buildExecutedTrace = (task: EvalTask, ndjson: string): TraceProjection => {
  const lines = ndjson.split("\n").filter((line) => line.length > 0);
  const events = lines.map((line) => decodeTraceLine(JSON.parse(line)));

  const reachedUrls: string[] = [];
  const toolCalls: ToolCall[] = [];
  let finalDom = "";
  let runFinishedStatus: "passed" | "failed" | "unfinished" = "unfinished";
  let streamTerminationReason = "unknown";
  let remainingSteps = 0;
  let planUpdateCount = 0;
  const tokenUsages: TokenUsageEntry[] = [];

  for (const event of events) {
    if (event.type === "tool_call") {
      const argsLooksValid =
        typeof event.args === "string" && event.args.length > 0
          ? Option.isSome(decodeJsonOption(event.args))
          : false;
      toolCalls.push(
        new ToolCall({
          name: event.name,
          arguments: { input: event.args, id: event.id },
          wellFormed: argsLooksValid,
        }),
      );
      const inputUrl = extractUrlFromText(URL_FROM_TOOL_INPUT_PATTERN, event.args);
      if (inputUrl !== undefined) reachedUrls.push(inputUrl);
    } else if (event.type === "tool_result") {
      const url = extractUrlFromText(URL_FROM_TOOL_RESULT_PATTERN, event.result);
      if (url !== undefined) reachedUrls.push(url);
    } else if (event.type === "status_marker") {
      if (event.marker === "RUN_COMPLETED" && Array.isArray(event.payload)) {
        const payload = event.payload as ReadonlyArray<unknown>;
        const status = payload[0];
        const summary = payload[1];
        if (status === "passed" || status === "failed") runFinishedStatus = status;
        if (typeof summary === "string") finalDom = summary;
      }
    } else if (event.type === "plan_update") {
      planUpdateCount += 1;
    } else if (event.type === "stream_terminated") {
      streamTerminationReason = event.reason;
      remainingSteps = event.remainingSteps;
    } else if (event.type === "token_usage") {
      tokenUsages.push(
        new TokenUsageEntry({
          source: event.source,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
          timestamp: event.ts,
        }),
      );
    }
  }

  const reachedKeyNodes: KeyNode[] = [];
  for (const expected of task.keyNodes) {
    const matched = reachedUrls.find((url) => {
      const candidate = new KeyNode({
        urlPattern: url,
        domAssertion: expected.domAssertion,
        perfCapture: expected.perfCapture,
      });
      return keyNodeMatches(candidate, expected);
    });
    if (matched !== undefined) {
      reachedKeyNodes.push(
        new KeyNode({
          urlPattern: expected.urlPattern,
          domAssertion: expected.domAssertion,
          perfCapture: expected.perfCapture,
        }),
      );
    }
  }

  const finalUrl = reachedUrls.length > 0 ? reachedUrls[reachedUrls.length - 1] : "";

  return {
    trace: new ExecutedTrace({
      reachedKeyNodes,
      toolCalls,
      finalUrl,
      finalDom,
      tokenUsages,
    }),
    runFinishedStatus,
    streamTerminationReason,
    remainingSteps,
    planUpdateCount,
  };
};

const score = (task: EvalTask, projection: TraceProjection): PerTaskRollup => {
  const trace = projection.trace;
  const stepCoverageScore = stepCoverage(trace.reachedKeyNodes, task.keyNodes);
  const finalStateScore = finalState(trace.finalUrl, trace.finalDom, task.expectedFinalState)
    ? 1
    : 0;
  const toolCallValidityScore = toolCallValidity(trace.toolCalls);
  const furthestIndex = furthestKeyNode(trace.reachedKeyNodes, task.keyNodes);
  const furthestKeyNodeScore =
    furthestIndex < 0 || task.keyNodes.length === 0
      ? 0
      : (furthestIndex + 1) / task.keyNodes.length;
  const tokenomics = trace.tokenomics;
  return {
    runnerName: "",
    taskId: task.id,
    scores: {
      stepCoverage: stepCoverageScore,
      finalState: finalStateScore,
      toolCallValidity: toolCallValidityScore,
      furthestKeyNode: furthestKeyNodeScore,
    },
    tokenomics: {
      totalTokens: tokenomics.totalTokens,
      peakPromptTokens: tokenomics.peakPromptTokens,
      turnCount: tokenomics.turnCount,
      executorTokens: tokenomics.executorTokens,
    },
    toolCallCount: trace.toolCalls.length,
    planUpdateCount: projection.planUpdateCount,
    stepDoneCount: 0,
    assertionFailedCount: 0,
    runFinishedStatus: projection.runFinishedStatus,
    streamTerminationReason: projection.streamTerminationReason,
    remainingSteps: projection.remainingSteps,
    finalUrl: trace.finalUrl,
  };
};

const formatNumber = (value: number, fractionDigits: number): string =>
  value.toFixed(fractionDigits);

const formatStatus = (status: PerTaskRollup["runFinishedStatus"]): string => {
  if (status === "passed") return "OK";
  if (status === "failed") return "FAIL";
  return "INCOMPLETE";
};

const buildAggregateTable = (summaries: ReadonlyArray<PerRunnerSummary>): string => {
  const header =
    "| Runner | Tasks | Pass | Fail | Incomplete | Mean step-coverage | Mean final-state | Mean tool-validity | Mean furthest-key-node | Mean total tokens | Mean peak prompt | Mean turns | Mean PLAN_UPDATEs |";
  const divider =
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = summaries.map(
    (summary) =>
      `| ${summary.runnerName} | ${summary.taskCount} | ${summary.passedCount} | ${summary.failedCount} | ${summary.unfinishedCount} | ${formatNumber(summary.meanStepCoverage, 3)} | ${formatNumber(summary.meanFinalState, 3)} | ${formatNumber(summary.meanToolCallValidity, 3)} | ${formatNumber(summary.meanFurthestKeyNode, 3)} | ${formatNumber(summary.meanTotalTokens, 0)} | ${formatNumber(summary.meanPeakPromptTokens, 0)} | ${formatNumber(summary.meanTurnCount, 1)} | ${formatNumber(summary.meanPlanUpdateCount, 1)} |`,
  );
  return [header, divider, ...rows].join("\n");
};

const buildPerTaskTable = (
  rollupsByRunnerByTask: ReadonlyMap<string, ReadonlyMap<string, PerTaskRollup>>,
): string => {
  const header =
    "| Task | gemma-react | gemini-react | gemma-oracle-plan |";
  const divider = "|---|---|---|---|";
  const rows: string[] = [];
  for (const task of TASK_REGISTRY) {
    const cells: string[] = [task.id];
    for (const runnerName of RUNNER_NAMES) {
      const rollup = rollupsByRunnerByTask.get(runnerName)?.get(task.id);
      if (rollup === undefined) {
        cells.push("—");
        continue;
      }
      const status = formatStatus(rollup.runFinishedStatus);
      const stepCov = formatNumber(rollup.scores.stepCoverage, 2);
      const planUpdates = rollup.planUpdateCount;
      const turns = rollup.tokenomics.turnCount;
      cells.push(`${status}  cov=${stepCov}  pu=${planUpdates}  turns=${turns}`);
    }
    rows.push(`| ${cells.join(" | ")} |`);
  }
  return [header, divider, ...rows].join("\n");
};

const buildFlaggedRegressionsBlock = (
  rollupsByRunner: Record<string, ReadonlyArray<PerTaskRollup>>,
): string => {
  const blocks: string[] = [];
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["gemma-react", "gemini-react"],
    ["gemma-react", "gemma-oracle-plan"],
    ["gemma-oracle-plan", "gemini-react"],
  ];
  for (const [left, right] of pairs) {
    const leftRollups = rollupsByRunner[left] ?? [];
    const rightRollups = rollupsByRunner[right] ?? [];
    const comparison = comparePair({
      leftRunner: left,
      rightRunner: right,
      leftRollups,
      rightRollups,
      regressionThreshold: REGRESSION_THRESHOLD,
    });
    if (comparison.flaggedRegressions.length === 0) {
      blocks.push(`### ${left} vs ${right}\n\n_No deltas above ±${REGRESSION_THRESHOLD}._`);
      continue;
    }
    const lines = [
      `### ${left} vs ${right}`,
      "",
      "| Task | Metric | Left | Right | Δ | Direction |",
      "|---|---|---|---|---|---|",
      ...comparison.flaggedRegressions.map(
        (flag) =>
          `| ${flag.taskId} | ${flag.metric} | ${formatNumber(flag.leftValue, 3)} | ${formatNumber(flag.rightValue, 3)} | ${formatNumber(flag.delta, 3)} | ${flag.direction} |`,
      ),
    ];
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
};

const main = Effect.gen(function* () {
  const args = parseCliArgs(process.argv.slice(2));
  const traceDir = path.resolve(args.traceDir);
  const outputPath = path.resolve(args.output);

  yield* Effect.logInfo("Wave R5 A:B regression report — building", {
    traceDir,
    outputPath,
  });

  if (!fs.existsSync(traceDir)) {
    yield* Effect.logError("Trace directory not found — run `pnpm eval:wave-r5-ab` first", {
      traceDir,
    });
    process.exit(2);
  }

  const ndjsonFiles = fs
    .readdirSync(traceDir)
    .filter((name) => name.endsWith(".ndjson"))
    .sort();

  if (ndjsonFiles.length === 0) {
    yield* Effect.logWarning("No trace files found in directory", { traceDir });
  }

  const rollupsByRunner = new Map<string, PerTaskRollup[]>();
  const rollupsByRunnerByTask = new Map<string, Map<string, PerTaskRollup>>();
  for (const runnerName of RUNNER_NAMES) {
    rollupsByRunner.set(runnerName, []);
    rollupsByRunnerByTask.set(runnerName, new Map());
  }

  for (const fileName of ndjsonFiles) {
    const parsed = parseTraceFilename(fileName);
    if (parsed === undefined) {
      yield* Effect.logWarning("Skipping unparseable trace filename", { fileName });
      continue;
    }
    const task = TASKS_BY_ID.get(parsed.taskId);
    if (task === undefined) {
      yield* Effect.logWarning("Skipping trace — taskId not in 20-task registry", {
        fileName,
        taskId: parsed.taskId,
      });
      continue;
    }
    const ndjson = readTraceFile(path.join(traceDir, fileName));
    const projection = buildExecutedTrace(task, ndjson);
    const rollup: PerTaskRollup = {
      ...score(task, projection),
      runnerName: parsed.runnerName,
    };
    if (!rollupsByRunner.has(parsed.runnerName)) {
      yield* Effect.logWarning("Trace runner not in known set — including but verify", {
        runner: parsed.runnerName,
      });
      rollupsByRunner.set(parsed.runnerName, []);
      rollupsByRunnerByTask.set(parsed.runnerName, new Map());
    }
    rollupsByRunner.get(parsed.runnerName)!.push(rollup);
    rollupsByRunnerByTask.get(parsed.runnerName)!.set(parsed.taskId, rollup);
  }

  const summaries: PerRunnerSummary[] = [];
  for (const runnerName of RUNNER_NAMES) {
    const rollups = rollupsByRunner.get(runnerName) ?? [];
    if (rollups.length === 0) continue;
    summaries.push({ ...summarizeRunner(rollups), runnerName });
  }

  const generatedAt = new Date().toISOString();
  const taskCount = ndjsonFiles.length;
  const expectedTotal = RUNNER_NAMES.length * TASK_REGISTRY.length;

  const aggregateTable = buildAggregateTable(summaries);
  const perTaskTable = buildPerTaskTable(rollupsByRunnerByTask);
  const flaggedBlock = buildFlaggedRegressionsBlock(
    Object.fromEntries(
      Array.from(rollupsByRunner.entries()).map(([key, value]) => [key, value]),
    ),
  );

  const lines = [
    "# Wave R5 A:B Regression Report",
    "",
    `_Generated ${generatedAt} from \`${path.relative(process.cwd(), traceDir)}\` (${taskCount}/${expectedTotal} traces present)._`,
    "",
    "**Runners:**",
    "- `gemma-react` — production runtime; Gemma 4 E4B owns plan + execute via the ReAct loop.",
    "- `gemini-react` — frontier baseline; Gemini Flash 3 driving the same ReAct loop.",
    "- `gemma-oracle-plan` — ablation; Gemini decomposes upfront, Gemma executes via ReAct.",
    "",
    "## Aggregate scoreboard",
    "",
    aggregateTable,
    "",
    "## Per-task summary",
    "",
    "Cells: `<status>  cov=<step-coverage>  pu=<plan-update-count>  turns=<turn-count>`.",
    "Status legend: `OK` = RUN_COMPLETED:passed, `FAIL` = RUN_COMPLETED:failed, `INCOMPLETE` = stream ended without RUN_COMPLETED.",
    "",
    perTaskTable,
    "",
    `## Flagged regressions (Δ ≥ ${REGRESSION_THRESHOLD})`,
    "",
    flaggedBlock,
    "",
    "---",
    "",
    "Generated by `pnpm wave-r5-ab:report` from trace ndjson at run-time. Re-run after each sweep.",
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");

  yield* Effect.logInfo("Wave R5 A:B report written", {
    outputPath,
    runnerCount: summaries.length,
    taskCount,
  });
}).pipe(Effect.withSpan("WaveR5AbReport.build"));

Effect.runPromise(main).catch((cause) => {
  process.stderr.write(`build-report failed: ${String(cause)}\n`);
  process.exit(1);
});
