import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { assert, describe, it } from "vite-plus/test";

/**
 * R11 P5 — GGUF conversion wrapper smoke tests.
 *
 * Two tests:
 *
 * 1. Structured-error path (always-on): sets EVAL_DISTILL_LLAMA_CPP_PATH
 *    to a missing directory and asserts the script exits non-zero with
 *    LlamaCppUnavailableError before spawning conversion. Catches
 *    config-validation regressions at the wrapper boundary.
 *
 * 2. Live smoke (gated on llama.cpp clone + python venv with `gguf` having
 *    GEMMA4 + an existing peft adapter directory + the matching base
 *    model HF cache snapshot): runs the real conversion and asserts the
 *    output GGUF exists + non-empty.
 *
 * The live smoke does NOT pull a multi-gigabyte model. It reuses any
 * pre-existing peft adapter under PERF_AGENT_PEFT_ADAPTER_DIR (typically
 * the /tmp/r11-pathE/adapter from the Path E feasibility probe, or the
 * output of distill:train on the SmolLM2 smoke).
 */

const SCRIPT_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "scripts",
  "distill",
  "convert-gguf.ts",
);

const SCRIPT_CWD = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const PEFT_PYTHON =
  process.env.PERF_AGENT_PEFT_PYTHON ?? process.env.EVAL_DISTILL_TRAIN_PYTHON ?? "python3";

const isGgufPyGemma4Available = (): boolean => {
  const result = spawnSync(
    PEFT_PYTHON,
    ["-c", "import gguf; assert hasattr(gguf.MODEL_ARCH, 'GEMMA4')"],
    { stdio: "ignore" },
  );
  return result.status === 0;
};

const isLlamaCppAvailable = (llamaCppPath: string | undefined): boolean => {
  if (!llamaCppPath) return false;
  return fs.existsSync(path.join(llamaCppPath, "convert_lora_to_gguf.py"));
};

const isPathPresent = (filepath: string | undefined): boolean => {
  if (!filepath) return false;
  return fs.existsSync(filepath);
};

const LIVE_LLAMA_CPP_PATH = process.env.PERF_AGENT_LLAMA_CPP_PATH;
const LIVE_PEFT_ADAPTER_DIR = process.env.PERF_AGENT_PEFT_ADAPTER_DIR;
const LIVE_BASE_MODEL_PATH = process.env.PERF_AGENT_BASE_MODEL_PATH;

const runScript = (
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", SCRIPT_PATH], {
      env: { ...process.env, ...env },
      cwd: SCRIPT_CWD,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

describe("distill:convert-gguf", () => {
  it("fails with structured LlamaCppUnavailableError when EVAL_DISTILL_LLAMA_CPP_PATH points at a missing directory", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "r11-convert-empty-"));
    const result = await runScript({
      EVAL_DISTILL_ADAPTER_INPUT: tempDir,
      EVAL_DISTILL_ADAPTER_OUTPUT: path.join(tempDir, "out.gguf"),
      EVAL_DISTILL_LLAMA_CPP_PATH: path.join(tempDir, "no-such-llama-cpp"),
      EVAL_DISTILL_BASE_MODEL_PATH: tempDir,
      EVAL_DISTILL_TRAIN_PYTHON: PEFT_PYTHON,
    });
    assert.notStrictEqual(result.code, 0);
    const combined = result.stdout + "\n" + result.stderr;
    assert.match(
      combined,
      /LlamaCppUnavailableError/,
      "structured-error path fires before convert spawn",
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }, 60_000);

  it.skipIf(
    !isGgufPyGemma4Available() ||
      !isLlamaCppAvailable(LIVE_LLAMA_CPP_PATH) ||
      !isPathPresent(LIVE_PEFT_ADAPTER_DIR) ||
      !isPathPresent(LIVE_BASE_MODEL_PATH),
  )(
    "converts a peft Safetensors adapter to GGUF end-to-end via real convert_lora_to_gguf.py (live smoke)",
    async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "r11-convert-smoke-"));
      const outputGguf = path.join(tempDir, "smoke.gguf");
      const result = await runScript({
        EVAL_DISTILL_ADAPTER_INPUT: LIVE_PEFT_ADAPTER_DIR ?? "",
        EVAL_DISTILL_ADAPTER_OUTPUT: outputGguf,
        EVAL_DISTILL_LLAMA_CPP_PATH: LIVE_LLAMA_CPP_PATH ?? "",
        EVAL_DISTILL_BASE_MODEL_PATH: LIVE_BASE_MODEL_PATH ?? "",
        EVAL_DISTILL_TRAIN_PYTHON: PEFT_PYTHON,
      });
      assert.strictEqual(
        result.code,
        0,
        `convert_lora_to_gguf.py live smoke exited non-zero. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      assert.isTrue(fs.existsSync(outputGguf), `output GGUF not at ${outputGguf}`);
      const stat = fs.statSync(outputGguf);
      assert.isAbove(stat.size, 0, "output GGUF is non-empty");
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
    300_000,
  );
});
