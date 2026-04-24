#!/usr/bin/env tsx
/**
 * aggregate-baseline-run.ts — ingest every ndjson trace in a baseline run
 * directory, decode via the shared TraceEventSchema, and emit a summarized
 * aggregated-scores JSON alongside. Consumed by Task #3 (baseline analysis
 * report) to populate the per-task results table.
 *
 * Usage:
 *   tsx scripts/aggregate-baseline-run.ts evals/traces/baseline/run-1
 *
 * Output (written to <dir>/aggregated_scores.json):
 *   {
 *     run: number,
 *     taskCount: number,
 *     tasks: Array<{
 *       taskId: string,
 *       tracePath: string,
 *       finalUrl: string,
 *       finalDomSummary: string,
 *       streamTerminatedReason: string,
 *       remainingSteps: number,
 *       tokenomics: {
 *         totalPromptTokens, totalCompletionTokens, totalTokens,
 *         peakPromptTokens, turnCount, plannerTokens, executorTokens
 *       },
 *       statusMarkerCounts: { STEP_START, STEP_DONE, ASSERTION_FAILED, STEP_SKIPPED, RUN_COMPLETED },
 *       toolCallCount: number,
 *       wellFormedToolCallCount: number,
 *       reachedUrls: readonly string[],
 *     }>,
 *     summary: {
 *       meanTotalTokens, meanPeakPrompt, meanTurnCount,
 *       completionCount, abortCount, unfinishedCount,
 *       meanPlannerTokens, meanExecutorTokens
 *     }
 *   }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Schema } from "effect";
import { TraceEventSchema } from "../src/runners/trace-recorder";

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: tsx aggregate-baseline-run.ts <run-dir>");
  process.exit(1);
}

const resolvedRunDir = path.resolve(runDir);
const runNumberMatch = /run-(\d+)$/.exec(resolvedRunDir);
const runNumber = runNumberMatch ? Number(runNumberMatch[1]) : undefined;

const decodeLine = Schema.decodeUnknownSync(TraceEventSchema);

interface TaskRollup {
  readonly taskId: string;
  readonly tracePath: string;
  readonly finalUrl: string;
  readonly finalDomSummary: string;
  readonly streamTerminatedReason: string;
  readonly remainingSteps: number;
  readonly tokenomics: {
    readonly totalPromptTokens: number;
    readonly totalCompletionTokens: number;
    readonly totalTokens: number;
    readonly peakPromptTokens: number;
    readonly turnCount: number;
    readonly plannerTokens: number;
    readonly executorTokens: number;
  };
  readonly statusMarkerCounts: {
    readonly STEP_START: number;
    readonly STEP_DONE: number;
    readonly ASSERTION_FAILED: number;
    readonly STEP_SKIPPED: number;
    readonly RUN_COMPLETED: number;
  };
  readonly toolCallCount: number;
  readonly reachedUrls: readonly string[];
}

const extractUrlFromToolResult = (result: unknown): string | undefined => {
  if (typeof result === "string") {
    const match = /Successfully navigated to (\S+)/.exec(result);
    if (match) return match[1].replace(/[.,;]+$/, "");
  }
  return undefined;
};

const processTrace = (tracePath: string): TaskRollup => {
  const fileName = path.basename(tracePath);
  const taskIdMatch = /^[^_]+__(.+)\.ndjson$/.exec(fileName);
  const taskId = taskIdMatch ? taskIdMatch[1] : fileName;

  const lines = fs.readFileSync(tracePath, "utf8").split("\n").filter((line) => line.length > 0);
  const events = lines.map((line) => decodeLine(JSON.parse(line)));

  const counts = {
    STEP_START: 0,
    STEP_DONE: 0,
    ASSERTION_FAILED: 0,
    STEP_SKIPPED: 0,
    RUN_COMPLETED: 0,
  };
  let toolCallCount = 0;
  let finalUrl = "";
  let finalDomSummary = "";
  let streamTerminatedReason = "unknown";
  let remainingSteps = 0;
  let tokenomics = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    peakPromptTokens: 0,
    turnCount: 0,
    plannerTokens: 0,
    executorTokens: 0,
  };
  const reachedUrls: string[] = [];

  for (const event of events) {
    if (event.type === "tool_call") {
      toolCallCount += 1;
    }
    if (event.type === "tool_result") {
      const url = extractUrlFromToolResult(event.result);
      if (url !== undefined) reachedUrls.push(url);
    }
    if (event.type === "status_marker") {
      counts[event.marker] = (counts[event.marker] ?? 0) + 1;
      if (event.marker === "RUN_COMPLETED" && Array.isArray(event.payload)) {
        const [, summary] = event.payload as readonly [string, string];
        finalDomSummary = typeof summary === "string" ? summary : "";
      }
    }
    if (event.type === "stream_terminated") {
      streamTerminatedReason = event.reason;
      remainingSteps = event.remainingSteps;
    }
    if (event.type === "task_tokenomics") {
      tokenomics = {
        totalPromptTokens: event.totalPromptTokens,
        totalCompletionTokens: event.totalCompletionTokens,
        totalTokens: event.totalTokens,
        peakPromptTokens: event.peakPromptTokens,
        turnCount: event.turnCount,
        plannerTokens: event.plannerTokens,
        executorTokens: event.executorTokens,
      };
    }
  }

  finalUrl = reachedUrls.length > 0 ? reachedUrls[reachedUrls.length - 1] : "";

  return {
    taskId,
    tracePath: path.relative(process.cwd(), tracePath),
    finalUrl,
    finalDomSummary,
    streamTerminatedReason,
    remainingSteps,
    tokenomics,
    statusMarkerCounts: counts,
    toolCallCount,
    reachedUrls,
  };
};

const ndjsonFiles = fs
  .readdirSync(resolvedRunDir)
  .filter((name) => name.endsWith(".ndjson"))
  .sort();

if (ndjsonFiles.length === 0) {
  console.error(`No .ndjson files found in ${resolvedRunDir}`);
  process.exit(1);
}

const tasks = ndjsonFiles.map((name) => processTrace(path.join(resolvedRunDir, name)));

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const totalTokensAll = tasks.map((t) => t.tokenomics.totalTokens);
const peakPromptAll = tasks.map((t) => t.tokenomics.peakPromptTokens);
const turnCountAll = tasks.map((t) => t.tokenomics.turnCount);
const plannerTokensAll = tasks.map((t) => t.tokenomics.plannerTokens);
const executorTokensAll = tasks.map((t) => t.tokenomics.executorTokens);

// Completion classification:
// - completion: stream terminated with run_finished:passed AND 0 remaining steps
// - abort: stream terminated with run_finished:failed (explicit abort / assertion-failed)
// - unfinished: stream ended without run_finished (timeout / remaining > 0 / stream_ended)
let completionCount = 0;
let abortCount = 0;
let unfinishedCount = 0;
for (const task of tasks) {
  if (task.streamTerminatedReason === "run_finished:passed" && task.remainingSteps === 0) {
    completionCount += 1;
  } else if (task.streamTerminatedReason.startsWith("run_finished:failed")) {
    abortCount += 1;
  } else {
    unfinishedCount += 1;
  }
}

const output = {
  run: runNumber,
  runDir: path.relative(process.cwd(), resolvedRunDir),
  taskCount: tasks.length,
  tasks,
  summary: {
    meanTotalTokens: finite(mean(totalTokensAll)),
    meanPeakPrompt: finite(mean(peakPromptAll)),
    meanTurnCount: finite(mean(turnCountAll)),
    meanPlannerTokens: finite(mean(plannerTokensAll)),
    meanExecutorTokens: finite(mean(executorTokensAll)),
    completionCount,
    abortCount,
    unfinishedCount,
    completionRate: tasks.length === 0 ? 0 : completionCount / tasks.length,
  },
};

const outPath = path.join(resolvedRunDir, "aggregated_scores.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

console.log(`Wrote ${outPath}`);
console.log(
  `summary: completions=${completionCount}/${tasks.length} (${(output.summary.completionRate * 100).toFixed(1)}%), ` +
    `mean_total_tokens=${output.summary.meanTotalTokens.toFixed(0)}, ` +
    `mean_peak_prompt=${output.summary.meanPeakPrompt.toFixed(0)}, ` +
    `mean_turn_count=${output.summary.meanTurnCount.toFixed(1)}`,
);
