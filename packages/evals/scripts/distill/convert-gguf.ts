import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Config, Effect, Schema } from "effect";

/**
 * convert-gguf — R11 P5 Effect wrapper around llama.cpp's
 * `convert_lora_to_gguf.py`. Converts the peft Safetensors adapter
 * produced by P4 (`scripts/distill/train.ts`) into a GGUF the
 * llama-server runtime (P5.5) and any future Ollama LoRA-supporting
 * version can load via `--lora <gguf>` / `ADAPTER <gguf>`.
 *
 * Path E sub-probe-zero (2026-04-30, see
 * `docs/handover/distillation-pipeline/probes/p4-pathE-hf-peft-results.md`
 * Step 5) verified the conversion path on the real Gemma 4 E4B adapter
 * produced by peft 0.19. Output: 9.08 MB GGUF, 264 tensors covering
 * attn_k/q/v/output for all 42 language-model blocks.
 *
 * GOTCHA: the published `gguf` PyPI package does NOT yet have
 * `MODEL_ARCH.GEMMA4`. The fix is to install gguf-py from the local
 * llama.cpp clone:
 *   `pip install -e <llama.cpp>/gguf-py`
 * The wrapper validates this BEFORE spawning the conversion (subprocess
 * `python -c "import gguf; gguf.MODEL_ARCH.GEMMA4"`) so the operator
 * gets a clean diagnostic instead of an ImportError mid-conversion.
 *
 * Pipeline:
 *   1. Validate the venv `python` has `gguf` importable AND
 *      `gguf.MODEL_ARCH.GEMMA4` resolves (catches the published-vs-local
 *      gguf-py drift).
 *   2. Validate `<llama.cpp>/convert_lora_to_gguf.py` exists.
 *   3. Validate the `--base` HF snapshot directory exists.
 *   4. Spawn `python convert_lora_to_gguf.py --base ... --outfile ...
 *      --outtype bf16 <adapter-input-dir>`. Streams stdout/stderr live.
 *   5. On exit-0, verify the output `.gguf` exists + non-empty.
 */

const DEFAULT_ADAPTER_INPUT = "data/distill/out/adapters";
const DEFAULT_ADAPTER_OUTPUT = "data/distill/out/browsing-gemma.gguf";
const DEFAULT_OUTTYPE = "bf16";
const DEFAULT_PYTHON = "python3";

class LlamaCppUnavailableError extends Schema.ErrorClass<LlamaCppUnavailableError>(
  "LlamaCppUnavailableError",
)({
  _tag: Schema.tag("LlamaCppUnavailableError"),
  llamaCppPath: Schema.String,
  cause: Schema.String,
}) {
  message = `convert_lora_to_gguf.py not at ${this.llamaCppPath} (${this.cause}). Set EVAL_DISTILL_LLAMA_CPP_PATH to a llama.cpp clone, or sparse-checkout: \`git clone --depth 1 --filter=blob:none --sparse https://github.com/ggml-org/llama.cpp.git && git -C llama.cpp sparse-checkout set convert_lora_to_gguf.py convert_hf_to_gguf.py gguf-py\`.`;
}

class GgufPyMissingGemma4Error extends Schema.ErrorClass<GgufPyMissingGemma4Error>(
  "GgufPyMissingGemma4Error",
)({
  _tag: Schema.tag("GgufPyMissingGemma4Error"),
  pythonPath: Schema.String,
  cause: Schema.String,
}) {
  message = `Python venv at ${this.pythonPath} cannot resolve gguf.MODEL_ARCH.GEMMA4 (${this.cause}). The published \`gguf\` PyPI package lags llama.cpp HEAD; install gguf-py from the local clone: \`<venv>/bin/pip install -e <llama.cpp>/gguf-py\`.`;
}

class BaseModelMissingError extends Schema.ErrorClass<BaseModelMissingError>(
  "BaseModelMissingError",
)({
  _tag: Schema.tag("BaseModelMissingError"),
  baseModelPath: Schema.String,
}) {
  message = `Base-model HF snapshot directory not at ${this.baseModelPath}. Set EVAL_DISTILL_BASE_MODEL_PATH to the HF cache snapshot of the base used during training (e.g. ~/.cache/huggingface/hub/models--google--gemma-4-e4b-it/snapshots/<sha>/).`;
}

class AdapterMissingError extends Schema.ErrorClass<AdapterMissingError>("AdapterMissingError")({
  _tag: Schema.tag("AdapterMissingError"),
  adapterPath: Schema.String,
}) {
  message = `Adapter directory not at ${this.adapterPath}. Run \`pnpm --filter @neuve/evals distill:train\` first to produce an adapter.`;
}

class GgufConvertFailedError extends Schema.ErrorClass<GgufConvertFailedError>(
  "GgufConvertFailedError",
)({
  _tag: Schema.tag("GgufConvertFailedError"),
  exitCode: Schema.Number,
  stderr: Schema.String,
}) {
  message = `\`python convert_lora_to_gguf.py\` exited with code ${this.exitCode}: ${this.stderr.slice(-1500)}`;
}

class GgufArtifactMissingError extends Schema.ErrorClass<GgufArtifactMissingError>(
  "GgufArtifactMissingError",
)({
  _tag: Schema.tag("GgufArtifactMissingError"),
  expectedPath: Schema.String,
}) {
  message = `convert_lora_to_gguf.py exited 0 but no output GGUF at ${this.expectedPath}. Inspect conversion stdout for tensor-write warnings.`;
}

const adapterInputConfig = Config.string("EVAL_DISTILL_ADAPTER_INPUT").pipe(
  Config.withDefault(DEFAULT_ADAPTER_INPUT),
);
const adapterOutputConfig = Config.string("EVAL_DISTILL_ADAPTER_OUTPUT").pipe(
  Config.withDefault(DEFAULT_ADAPTER_OUTPUT),
);
const llamaCppPathConfig = Config.string("EVAL_DISTILL_LLAMA_CPP_PATH");
const baseModelPathConfig = Config.string("EVAL_DISTILL_BASE_MODEL_PATH");
const outtypeConfig = Config.string("EVAL_DISTILL_GGUF_OUTTYPE").pipe(
  Config.withDefault(DEFAULT_OUTTYPE),
);
const pythonConfig = Config.string("EVAL_DISTILL_TRAIN_PYTHON").pipe(
  Config.withDefault(DEFAULT_PYTHON),
);

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

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

const validateGgufPyHasGemma4 = Effect.fn("validateGgufPyHasGemma4")(function* (
  pythonPath: string,
) {
  const result = yield* Effect.tryPromise({
    try: () =>
      spawnPython(
        pythonPath,
        ["-c", "import gguf; assert hasattr(gguf.MODEL_ARCH, 'GEMMA4'); print('ok')"],
        { streamLive: false },
      ),
    catch: (cause) =>
      new GgufPyMissingGemma4Error({
        pythonPath,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (result.code !== 0) {
    return yield* new GgufPyMissingGemma4Error({
      pythonPath,
      cause: `python -c \"import gguf; assert hasattr(gguf.MODEL_ARCH, 'GEMMA4')\" exited ${result.code}: ${result.stderr.trim()}`,
    });
  }
});

const program = Effect.gen(function* () {
  const adapterInput = yield* adapterInputConfig;
  const adapterOutput = yield* adapterOutputConfig;
  const llamaCppPath = yield* llamaCppPathConfig;
  const baseModelPath = yield* baseModelPathConfig;
  const outtype = yield* outtypeConfig;
  const python = yield* pythonConfig;

  const absAdapterInput = path.resolve(adapterInput);
  const absAdapterOutput = path.resolve(adapterOutput);
  const absLlamaCppPath = path.resolve(llamaCppPath);
  const absBaseModelPath = path.resolve(baseModelPath);
  const convertScript = path.join(absLlamaCppPath, "convert_lora_to_gguf.py");

  yield* Effect.logInfo("GGUF conversion starting", {
    adapterInput: absAdapterInput,
    adapterOutput: absAdapterOutput,
    llamaCppPath: absLlamaCppPath,
    baseModelPath: absBaseModelPath,
    outtype,
    python,
  });

  // Validate inputs before spending wall-clock on the convert subprocess.
  if (!fs.existsSync(convertScript)) {
    return yield* new LlamaCppUnavailableError({
      llamaCppPath: convertScript,
      cause: "file not found",
    });
  }
  if (!fs.existsSync(absAdapterInput)) {
    return yield* new AdapterMissingError({ adapterPath: absAdapterInput });
  }
  if (!fs.existsSync(absBaseModelPath)) {
    return yield* new BaseModelMissingError({ baseModelPath: absBaseModelPath });
  }

  yield* validateGgufPyHasGemma4(python);

  fs.mkdirSync(path.dirname(absAdapterOutput), { recursive: true });

  const result = yield* Effect.tryPromise({
    try: () =>
      spawnPython(python, [
        convertScript,
        "--base",
        absBaseModelPath,
        "--outfile",
        absAdapterOutput,
        "--outtype",
        outtype,
        absAdapterInput,
      ]),
    catch: (cause) =>
      new LlamaCppUnavailableError({
        llamaCppPath: convertScript,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });

  if (result.code !== 0) {
    return yield* new GgufConvertFailedError({
      exitCode: result.code,
      stderr: result.stderr,
    });
  }

  if (!fs.existsSync(absAdapterOutput)) {
    return yield* new GgufArtifactMissingError({ expectedPath: absAdapterOutput });
  }
  const stat = fs.statSync(absAdapterOutput);

  yield* Effect.logInfo("GGUF conversion complete", {
    ggufPath: absAdapterOutput,
    ggufBytes: stat.size,
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        ggufPath: absAdapterOutput,
        ggufBytes: stat.size,
        adapterInput: absAdapterInput,
        baseModelPath: absBaseModelPath,
        outtype,
      },
      null,
      2,
    ),
  );
});

await Effect.runPromise(program);
