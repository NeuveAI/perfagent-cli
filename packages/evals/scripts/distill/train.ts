import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Config, Effect, Schema } from "effect";
import { TrainingSample } from "../../src/distill/types";

/**
 * train — R11 P4 HF transformers + peft LoRA training driver.
 *
 * Effect wrapper around `peft_train.py` (sibling Python script).
 * Consumes the OpenAI-chat JSONL produced by `distill:export` and
 * produces a Safetensors LoRA adapter via HF transformers + peft on
 * Apple Silicon MPS.
 *
 * Why Python under the hood (vs. MLX-LM the plan originally pinned):
 * MLX-LM 0.31.3 cannot load `mlx-community/gemma-4-e4b-it-bf16` due to
 * a strict-loader rejection of redundant K/V weights for kv-shared
 * layers. HF transformers tolerates the same checkpoint cleanly. See
 * `docs/handover/distillation-pipeline/probes/p4-mlx-lm-gemma4-incompat.md`
 * + `p4-pathE-hf-peft-results.md` for the full diagnosis. Locked
 * decision #4 in `docs/research/distillation-pipeline/plan.md` was
 * flipped accordingly.
 *
 * Pipeline:
 *   1. Validate the venv `python` has peft + transformers + torch
 *      importable (one subprocess `python -c "import peft, transformers, torch"`).
 *   2. Decode each JSONL line through `TrainingSample` so malformed
 *      teacher data fails fast with a structured error rather than
 *      mid-training crash.
 *   3. Spawn `python peft_train.py --input ... --output ...` via
 *      `Effect.tryPromise` + `child_process.spawn`. Streams stdout/
 *      stderr live so an operator sees per-iteration loss + download
 *      progress.
 *   4. On exit-0, verify the adapter artifact exists at
 *      `<output>/adapter_model.safetensors`.
 *   5. Print a structured summary so callers can pipe to `jq`.
 *
 * R11 hyperparams (locked by plan §P4): rank 8, 1 epoch, lr 5e-5,
 * batch_size 1, max_seq_length 4096. Validation split 0%.
 */

const DEFAULT_INPUT = "data/distill/out/teacher-data.jsonl";
const DEFAULT_OUTPUT = "data/distill/out/adapters";
/**
 * Default base-model HF id. `google/gemma-4-e4b-it` is the full-precision
 * Gemma 4 E4B instruction-tuned checkpoint (multimodal:
 * Gemma4ForConditionalGeneration, language_model + vision_tower +
 * audio_tower). LoRA wraps the language_model branch only via the
 * regex pattern hard-coded inside `peft_train.py`.
 */
const DEFAULT_BASE_MODEL = "google/gemma-4-e4b-it";
const DEFAULT_RANK = 8;
const DEFAULT_EPOCHS = 1;
const DEFAULT_LEARNING_RATE = 5e-5;
const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_MAX_SEQ_LENGTH = 4096;
const DEFAULT_DEVICE = "auto";
const DEFAULT_PYTHON = "python3";
/**
 * Default LoRA `target_modules` regex. Targets only the language_model
 * branch of Gemma 4 multimodal — vision_tower + audio_tower stay frozen
 * for browsing-gemma (text-only ReAct workload). Override via
 * `EVAL_DISTILL_TRAIN_TARGET_MODULES` for non-Gemma-4 base models
 * (e.g. SmolLM2 smoke uses `q_proj,k_proj,v_proj,o_proj`).
 */
const DEFAULT_TARGET_MODULES =
  "model\\.language_model\\.layers\\.\\d+\\.self_attn\\.(q|k|v|o)_proj$";
const ADAPTER_ARTIFACT_NAME = "adapter_model.safetensors";

class HFPeftUnavailableError extends Schema.ErrorClass<HFPeftUnavailableError>(
  "HFPeftUnavailableError",
)({
  _tag: Schema.tag("HFPeftUnavailableError"),
  pythonPath: Schema.String,
  cause: Schema.String,
}) {
  message = `Python venv at ${this.pythonPath} cannot import peft + transformers + torch (${this.cause}). Create a venv and \`pip install peft>=0.13 transformers>=4.46 torch accelerate safetensors sentencepiece\`. Set EVAL_DISTILL_TRAIN_PYTHON to point at the venv's python.`;
}

class JsonlValidationError extends Schema.ErrorClass<JsonlValidationError>("JsonlValidationError")({
  _tag: Schema.tag("JsonlValidationError"),
  inputPath: Schema.String,
  lineNumber: Schema.Number,
  cause: Schema.String,
}) {
  message = `Invalid TrainingSample at ${this.inputPath}:${this.lineNumber}: ${this.cause}. Re-run \`pnpm --filter @neuve/evals distill:export\`.`;
}

class JsonlReadError extends Schema.ErrorClass<JsonlReadError>("JsonlReadError")({
  _tag: Schema.tag("JsonlReadError"),
  inputPath: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to read teacher JSONL at ${this.inputPath}: ${this.cause}. Run \`pnpm --filter @neuve/evals distill:export\` first.`;
}

class JsonlEmptyError extends Schema.ErrorClass<JsonlEmptyError>("JsonlEmptyError")({
  _tag: Schema.tag("JsonlEmptyError"),
  inputPath: Schema.String,
}) {
  message = `Teacher JSONL at ${this.inputPath} is empty. Run \`pnpm --filter @neuve/evals distill:export\` against a strict-pass trace archive.`;
}

class HFPeftTrainFailedError extends Schema.ErrorClass<HFPeftTrainFailedError>(
  "HFPeftTrainFailedError",
)({
  _tag: Schema.tag("HFPeftTrainFailedError"),
  exitCode: Schema.Number,
  stderr: Schema.String,
}) {
  message = `\`python peft_train.py\` exited with code ${this.exitCode}: ${this.stderr.slice(-1500)}`;
}

class AdapterArtifactMissingError extends Schema.ErrorClass<AdapterArtifactMissingError>(
  "AdapterArtifactMissingError",
)({
  _tag: Schema.tag("AdapterArtifactMissingError"),
  expectedPath: Schema.String,
}) {
  message = `peft_train.py exited 0 but no adapter artifact at ${this.expectedPath}. Inspect the training stdout for warnings about save_pretrained falling back to .bin.`;
}

const decodeJsonLine = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeTrainingSample = Schema.decodeUnknownEffect(TrainingSample);

const inputConfig = Config.string("EVAL_DISTILL_INPUT").pipe(Config.withDefault(DEFAULT_INPUT));
const outputConfig = Config.string("EVAL_DISTILL_TRAIN_OUTPUT").pipe(
  Config.withDefault(DEFAULT_OUTPUT),
);
const baseModelConfig = Config.string("EVAL_DISTILL_BASE_MODEL_PATH").pipe(
  Config.withDefault(DEFAULT_BASE_MODEL),
);
const rankConfig = Config.int("EVAL_DISTILL_TRAIN_RANK").pipe(Config.withDefault(DEFAULT_RANK));
const epochsConfig = Config.int("EVAL_DISTILL_TRAIN_EPOCHS").pipe(
  Config.withDefault(DEFAULT_EPOCHS),
);
const learningRateConfig = Config.number("EVAL_DISTILL_TRAIN_LR").pipe(
  Config.withDefault(DEFAULT_LEARNING_RATE),
);
const batchSizeConfig = Config.int("EVAL_DISTILL_TRAIN_BATCH_SIZE").pipe(
  Config.withDefault(DEFAULT_BATCH_SIZE),
);
const maxSeqLengthConfig = Config.int("EVAL_DISTILL_TRAIN_MAX_SEQ_LENGTH").pipe(
  Config.withDefault(DEFAULT_MAX_SEQ_LENGTH),
);
const deviceConfig = Config.string("EVAL_DISTILL_TRAIN_DEVICE").pipe(
  Config.withDefault(DEFAULT_DEVICE),
);
const pythonConfig = Config.string("EVAL_DISTILL_TRAIN_PYTHON").pipe(
  Config.withDefault(DEFAULT_PYTHON),
);
const targetModulesConfig = Config.string("EVAL_DISTILL_TRAIN_TARGET_MODULES").pipe(
  Config.withDefault(DEFAULT_TARGET_MODULES),
);

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * spawnPython — generic Python subprocess runner. Streams stdout/stderr
 * live so progress (download bars + per-iter loss) is visible to the
 * operator. Resolves with accumulated streams + exit code on `close`,
 * rejects with the spawn error on `error` (binary missing, permission).
 */
const spawnPython = (
  python: string,
  args: ReadonlyArray<string>,
  options: { readonly streamLive: boolean } = { streamLive: true },
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(python, [...args], { env: process.env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (next: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(next);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (options.streamLive) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (options.streamLive) process.stderr.write(text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => settle({ stdout, stderr, code: code ?? -1 }));
  });

const validateHFPeftAvailable = Effect.fn("validateHFPeftAvailable")(function* (
  pythonPath: string,
) {
  const result = yield* Effect.tryPromise({
    try: () =>
      spawnPython(
        pythonPath,
        [
          "-c",
          "import peft, transformers, torch; print(peft.__version__, transformers.__version__, torch.__version__)",
        ],
        { streamLive: false },
      ),
    catch: (cause) =>
      new HFPeftUnavailableError({
        pythonPath,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (result.code !== 0) {
    return yield* new HFPeftUnavailableError({
      pythonPath,
      cause: `python -c \"import peft, transformers, torch\" exited ${result.code}: ${result.stderr.trim()}`,
    });
  }
  return result.stdout.trim();
});

const loadAndValidateJsonl = Effect.fn("loadAndValidateJsonl")(function* (inputPath: string) {
  const contents = yield* Effect.try({
    try: () => fs.readFileSync(inputPath, "utf8"),
    catch: (cause) =>
      new JsonlReadError({
        inputPath,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  const lines = contents.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) {
    return yield* new JsonlEmptyError({ inputPath });
  }
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const parsed = yield* decodeJsonLine(lines[index]).pipe(
      Effect.catchTag("SchemaError", (schemaError) =>
        new JsonlValidationError({
          inputPath,
          lineNumber,
          cause: schemaError.message,
        }).asEffect(),
      ),
    );
    yield* decodeTrainingSample(parsed).pipe(
      Effect.catchTag("SchemaError", (schemaError) =>
        new JsonlValidationError({
          inputPath,
          lineNumber,
          cause: schemaError.message,
        }).asEffect(),
      ),
    );
  }
  return { lineCount: lines.length };
});

const PEFT_TRAIN_SCRIPT_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "peft_train.py",
);

const program = Effect.gen(function* () {
  const inputPath = yield* inputConfig;
  const outputPath = yield* outputConfig;
  const baseModel = yield* baseModelConfig;
  const rank = yield* rankConfig;
  const epochs = yield* epochsConfig;
  const learningRate = yield* learningRateConfig;
  const batchSize = yield* batchSizeConfig;
  const maxSeqLength = yield* maxSeqLengthConfig;
  const device = yield* deviceConfig;
  const python = yield* pythonConfig;
  const targetModules = yield* targetModulesConfig;

  const absoluteInput = path.resolve(inputPath);
  const absoluteOutput = path.resolve(outputPath);

  yield* Effect.logInfo("HF+peft LoRA training starting", {
    inputPath: absoluteInput,
    outputPath: absoluteOutput,
    baseModel,
    rank,
    epochs,
    learningRate,
    batchSize,
    maxSeqLength,
    device,
    python,
  });

  // Validate Python venv has the right deps. Surfaces structured error
  // before any heavy work (model download, tokenization, etc).
  const versions = yield* validateHFPeftAvailable(python);
  yield* Effect.logInfo("python venv ok", { versions });

  // Validate JSONL conforms BEFORE spawning the training subprocess —
  // catches malformed teacher data at the wrapper boundary instead of
  // mid-iteration crash.
  const { lineCount } = yield* loadAndValidateJsonl(absoluteInput);

  fs.mkdirSync(absoluteOutput, { recursive: true });

  yield* Effect.logInfo("Spawning peft_train.py", {
    lineCount,
    pyScript: PEFT_TRAIN_SCRIPT_PATH,
  });

  const result = yield* Effect.tryPromise({
    try: () =>
      spawnPython(python, [
        PEFT_TRAIN_SCRIPT_PATH,
        "--input",
        absoluteInput,
        "--output",
        absoluteOutput,
        "--base-model",
        baseModel,
        "--target-modules",
        targetModules,
        "--rank",
        String(rank),
        "--epochs",
        String(epochs),
        "--lr",
        String(learningRate),
        "--batch-size",
        String(batchSize),
        "--max-seq-length",
        String(maxSeqLength),
        "--device",
        device,
      ]),
    catch: (cause) =>
      new HFPeftUnavailableError({
        pythonPath: python,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });

  if (result.code !== 0) {
    return yield* new HFPeftTrainFailedError({
      exitCode: result.code,
      stderr: result.stderr,
    });
  }

  const adapterPath = path.join(absoluteOutput, ADAPTER_ARTIFACT_NAME);
  if (!fs.existsSync(adapterPath)) {
    return yield* new AdapterArtifactMissingError({ expectedPath: adapterPath });
  }
  const stat = fs.statSync(adapterPath);

  yield* Effect.logInfo("HF+peft LoRA training complete", {
    adapterPath,
    adapterBytes: stat.size,
    sampleCount: lineCount,
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        adapterPath,
        adapterBytes: stat.size,
        sampleCount: lineCount,
        baseModel,
        rank,
        epochs,
        learningRate,
        batchSize,
        device,
      },
      null,
      2,
    ),
  );
});

await Effect.runPromise(program);
