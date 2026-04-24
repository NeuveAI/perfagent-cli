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

const listTraceFiles = (directory: string): ReadonlyArray<string> => {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".ndjson"))
    .map((entry) => path.join(directory, entry));
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

const program = Effect.gen(function* () {
  const traceDir = yield* traceDirectoryConfig;
  const outputPath = yield* outputPathConfig;
  const teacherModel = yield* teacherModelConfig;
  const granularity = yield* granularityConfig;

  const tracePaths = listTraceFiles(traceDir);
  yield* Effect.logInfo("Teacher-data export starting", {
    traceDir,
    traceCount: tracePaths.length,
    outputPath,
    teacherModel,
    granularity,
  });

  const exporter = yield* TeacherDataExporter;
  const result = yield* exporter.export({
    tracePaths,
    tasks: allEvalTasks,
    options: new ExportOptions({
      granularity,
      teacherModel,
      systemPrompt: buildLocalAgentSystemPrompt(),
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
        outputPath,
      },
      null,
      2,
    ),
  );
});

const layer = TeacherDataExporter.layer.pipe(Layer.provideMerge(NodeServices.layer));

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(layer)));
