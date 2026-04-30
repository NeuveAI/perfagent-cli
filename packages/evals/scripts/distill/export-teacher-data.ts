import * as fs from "node:fs";
import * as path from "node:path";
import { Config, Effect, Layer, Schema } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { buildLocalAgentSystemPrompt } from "@neuve/shared/prompts";
import { TeacherDataExporter } from "../../src/distill/teacher-data-exporter";
import { writeSamplesToJsonl } from "../../src/distill/jsonl-writer";
import { allEvalTasks } from "../../src/distill/task-registry";
import { ExportGranularity, ExportOptions } from "../../src/distill/types";

const DEFAULT_TRACE_DIR = "evals/traces";
const DEFAULT_OUTPUT_PATH = "data/distill/out/teacher-data.jsonl";
const DEFAULT_TEACHER_MODEL = "claude-sonnet-4-5";
/**
 * Default runner filter — distillation philosophy says train on TEACHER
 * trajectories only. Including the student's own strict-pass traces
 * (e.g. `gemma-react`) teaches the student what it already does, near-
 * zero gradient on already-mastered tasks. R10 elected `gemini-react`
 * (Pro 3) as the canonical teacher; R11 P1-P3 default to the same.
 *
 * Override via `EVAL_DISTILL_RUNNER=<name>` for a single runner (e.g.
 * `gemma-react`), `EVAL_DISTILL_RUNNER=runnerA,runnerB` for an
 * explicit allowlist, or `EVAL_DISTILL_RUNNER=*` to disable filtering
 * entirely (R12 multi-sweep cross-runner mixing experiment).
 *
 * The actual filter logic lives at the exporter library boundary
 * (`ExportOptions.runnerFilter`) — this script only parses the env
 * into an allowlist and threads it through. The P4 training driver
 * and other downstream consumers stay runner-aware-free.
 */
const DEFAULT_RUNNER_FILTER = "gemini-react";

const listTraceFiles = (directory: string): ReadonlyArray<string> => {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".ndjson"))
    .map((entry) => path.join(directory, entry));
};

const parseRunnerFilter = (envValue: string): ReadonlyArray<string> | undefined => {
  if (envValue === "*") return undefined;
  return envValue
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const traceDirectoryConfig = Config.string("EVAL_TRACE_DIR").pipe(
  Config.withDefault(DEFAULT_TRACE_DIR),
);
const outputPathConfig = Config.string("EVAL_DISTILL_OUTPUT").pipe(
  Config.withDefault(DEFAULT_OUTPUT_PATH),
);
const teacherModelConfig = Config.string("EVAL_DISTILL_TEACHER").pipe(
  Config.withDefault(DEFAULT_TEACHER_MODEL),
);
const granularityConfig = Config.schema(ExportGranularity, "EVAL_DISTILL_GRANULARITY").pipe(
  Config.withDefault(Schema.decodeUnknownSync(ExportGranularity)("per-trajectory")),
);
const strictConfig = Config.boolean("EVAL_DISTILL_STRICT").pipe(Config.withDefault(true));
const runnerFilterConfig = Config.string("EVAL_DISTILL_RUNNER").pipe(
  Config.withDefault(DEFAULT_RUNNER_FILTER),
);

const program = Effect.gen(function* () {
  const traceDir = yield* traceDirectoryConfig;
  const outputPath = yield* outputPathConfig;
  const teacherModel = yield* teacherModelConfig;
  const granularity = yield* granularityConfig;
  const strict = yield* strictConfig;
  const runnerFilterEnv = yield* runnerFilterConfig;
  const runnerFilter = parseRunnerFilter(runnerFilterEnv);

  const tracePaths = listTraceFiles(traceDir);
  yield* Effect.logInfo("Teacher-data export starting", {
    traceDir,
    traceCount: tracePaths.length,
    outputPath,
    teacherModel,
    granularity,
    strict,
    runnerFilter: runnerFilter === undefined ? "all" : runnerFilter.join(","),
  });

  const exporter = yield* TeacherDataExporter;
  const result = yield* exporter.export({
    tracePaths,
    tasks: allEvalTasks,
    options: new ExportOptions({
      granularity,
      teacherModel,
      systemPrompt: buildLocalAgentSystemPrompt(),
      strict,
      runnerFilter,
    }),
  });

  yield* writeSamplesToJsonl(outputPath, result.samples);

  yield* Effect.logInfo("Teacher-data export done", {
    tracesScanned: result.summary.tracesScanned,
    tracesAccepted: result.summary.tracesAccepted,
    tracesRejected: result.summary.tracesRejected,
    samplesWritten: result.summary.samplesWritten,
    duplicatesSkipped: result.summary.duplicatesSkipped,
    outputPath,
  });

  console.log(
    JSON.stringify(
      {
        tracesScanned: result.summary.tracesScanned,
        tracesAccepted: result.summary.tracesAccepted,
        tracesRejected: result.summary.tracesRejected,
        samplesWritten: result.summary.samplesWritten,
        duplicatesSkipped: result.summary.duplicatesSkipped,
        runnerFilter: runnerFilter === undefined ? "all" : runnerFilter.join(","),
        outputPath,
      },
      null,
      2,
    ),
  );
});

const layer = TeacherDataExporter.layer.pipe(Layer.provideMerge(NodeServices.layer));

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(layer)));
