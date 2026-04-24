import * as path from "node:path";
import { Effect, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TrainingSample } from "./types";

export class JsonlWriteError extends Schema.ErrorClass<JsonlWriteError>("JsonlWriteError")({
  _tag: Schema.tag("JsonlWriteError"),
  filePath: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to write JSONL file ${this.filePath}: ${this.cause}`;
}

const encodeSample = Schema.encodeUnknownEffect(TrainingSample);

/**
 * renderSamplesToJsonl — pure helper that converts a set of TrainingSamples
 * to the newline-delimited JSON string that Ollama's fine-tune ingestors
 * expect. Ensures a trailing newline so `cat file1 file2 > combined`
 * concatenations stay valid.
 */
export const renderSamplesToJsonl = Effect.fn("renderSamplesToJsonl")(function* (
  samples: ReadonlyArray<TrainingSample>,
) {
  const lines: string[] = [];
  for (const sample of samples) {
    const encoded = yield* encodeSample(sample);
    lines.push(JSON.stringify(encoded));
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
});

/**
 * writeSamplesToJsonl — serializes TrainingSample[] to a JSONL file at
 * `outputPath`. Creates parent directories as needed. Overwrites any existing
 * file — callers who need append semantics should render separately and
 * append via fs themselves.
 */
export const writeSamplesToJsonl = Effect.fn("writeSamplesToJsonl")(function* (
  outputPath: string,
  samples: ReadonlyArray<TrainingSample>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  yield* Effect.annotateCurrentSpan({ outputPath, sampleCount: samples.length });

  const directory = path.dirname(outputPath);
  yield* fileSystem.makeDirectory(directory, { recursive: true }).pipe(
    Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
    Effect.catchTag("PlatformError", (platformError) =>
      new JsonlWriteError({
        filePath: outputPath,
        cause: platformError.message,
      }).asEffect(),
    ),
  );

  const body = yield* renderSamplesToJsonl(samples).pipe(
    Effect.catchTag("SchemaError", (schemaError) =>
      new JsonlWriteError({
        filePath: outputPath,
        cause: `encode: ${schemaError.message}`,
      }).asEffect(),
    ),
  );

  yield* fileSystem.writeFileString(outputPath, body).pipe(
    Effect.catchTag("PlatformError", (platformError) =>
      new JsonlWriteError({
        filePath: outputPath,
        cause: platformError.message,
      }).asEffect(),
    ),
  );

  yield* Effect.logInfo("JSONL file written", { outputPath, sampleCount: samples.length });
  return { filePath: outputPath, byteCount: body.length } as const;
});
