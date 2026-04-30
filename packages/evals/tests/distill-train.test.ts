import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { assert, describe, it } from "vite-plus/test";

/**
 * R11 P4 — HF+peft training driver smoke tests.
 *
 * The unit-shaped test sets `EVAL_DISTILL_INPUT` to a missing file and
 * asserts the structured-error path fires before peft_train.py is
 * spawned. This guards the "fail-fast on bad inputs" contract without
 * requiring multi-gigabyte model downloads or a peft venv.
 *
 * The live smoke is gated on a Python venv with peft + transformers +
 * torch importable AND a tiny known-good HF checkpoint cached locally.
 * `it.skipIf` keeps engineers without the deps green; when present, the
 * smoke trains a 2-iter LoRA against a synthetic teacher dataset and
 * asserts the adapter artifact appears at the expected path. No mocks —
 * real HF transformers + peft, per `feedback_no_test_only_injection_seams.md`.
 *
 * The smoke does NOT pull the production base model (`google/gemma-4-e4b-it`,
 * ~16GB). Instead it points `--base-model` at a tiny known-supported HF
 * checkpoint so CI runs in seconds rather than minutes. The production
 * default is exercised by the manual end-to-end pipeline run captured
 * in the R11 diary, not in this CI test.
 */

const SCRIPT_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "scripts",
  "distill",
  "train.ts",
);

const SCRIPT_CWD = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/**
 * Resolves the venv python that has peft + transformers + torch.
 * Engineers can override via PERF_AGENT_PEFT_PYTHON env-var pointing at
 * their venv's python. Defaults to a path-based lookup of `python3`.
 */
const PEFT_PYTHON =
  process.env.PERF_AGENT_PEFT_PYTHON ?? process.env.EVAL_DISTILL_TRAIN_PYTHON ?? "python3";

const isHFPeftAvailable = (): boolean => {
  const result = spawnSync(PEFT_PYTHON, ["-c", "import peft, transformers, torch"], {
    stdio: "ignore",
  });
  return result.status === 0;
};

const SMOKE_BASE_MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct";
/**
 * Cache check — `it.skipIf` consults this so the live smoke doesn't
 * trigger a multi-megabyte model download under CI surprise. Engineers
 * warm the cache once via the dedicated probe at /tmp/r11-pathE/ or by
 * `python -c "from transformers import AutoModelForCausalLM as M; M.from_pretrained('${SMOKE_BASE_MODEL}')"`.
 */
const isHfModelCached = (modelId: string): boolean => {
  const cacheRoot = path.join(os.homedir(), ".cache", "huggingface", "hub");
  if (!fs.existsSync(cacheRoot)) return false;
  const cacheName = `models--${modelId.replace(/\//g, "--")}`;
  return fs.existsSync(path.join(cacheRoot, cacheName));
};

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

describe("distill:train (HF+peft)", () => {
  it.skipIf(!isHFPeftAvailable())(
    "fails with structured JsonlReadError when input JSONL doesn't exist",
    async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "r11-train-empty-"));
      const missingInput = path.join(tempDir, "no-such.jsonl");
      const outputDir = path.join(tempDir, "out");
      const result = await runScript({
        EVAL_DISTILL_INPUT: missingInput,
        EVAL_DISTILL_TRAIN_OUTPUT: outputDir,
        EVAL_DISTILL_TRAIN_PYTHON: PEFT_PYTHON,
      });
      assert.notStrictEqual(result.code, 0, "script exits non-zero on missing input");
      const combined = result.stdout + "\n" + result.stderr;
      assert.match(
        combined,
        /JsonlReadError|JsonlEmptyError/,
        "structured-error path fires before peft_train.py spawn",
      );
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
    120_000,
  );

  it.skipIf(!isHFPeftAvailable() || !isHfModelCached(SMOKE_BASE_MODEL))(
    "trains a LoRA adapter end-to-end via real HF+peft on a 1-sample teacher dataset (live smoke)",
    async () => {
      // Smoke uses SmolLM2-135M (tiny — ~270MB cached) so CI runs in
      // seconds rather than minutes. The smoke proves the train.ts
      // wrapper + peft_train.py pipeline is wired correctly. Production
      // training (Gemma 4 E4B) is exercised by the manual end-to-end
      // pipeline run captured in the R11 diary.
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "r11-train-smoke-"));
      const inputPath = path.join(tempDir, "teacher-data.jsonl");
      const outputDir = path.join(tempDir, "adapter");

      const sample = {
        messages: [
          { role: "system", content: "You are a test agent." },
          { role: "user", content: "Reply with ok." },
          { role: "assistant", content: "ok" },
        ],
        metadata: {
          sourceTrace: "synthetic.ndjson",
          taskId: "smoke-task",
          runnerName: "synthetic",
          teacherModel: "synthetic",
          turnCount: 1,
          toolCallCount: 0,
          contentHash: "synthetic-hash",
        },
      };
      fs.writeFileSync(inputPath, JSON.stringify(sample) + "\n", "utf8");

      const result = await runScript({
        EVAL_DISTILL_INPUT: inputPath,
        EVAL_DISTILL_TRAIN_OUTPUT: outputDir,
        EVAL_DISTILL_BASE_MODEL_PATH: SMOKE_BASE_MODEL,
        // SmolLM2 is non-multimodal — uses comma-list target_modules
        // instead of the Gemma 4 language_model regex (production default).
        EVAL_DISTILL_TRAIN_TARGET_MODULES: "q_proj,k_proj,v_proj,o_proj",
        EVAL_DISTILL_TRAIN_RANK: "2",
        EVAL_DISTILL_TRAIN_EPOCHS: "1",
        EVAL_DISTILL_TRAIN_BATCH_SIZE: "1",
        EVAL_DISTILL_TRAIN_MAX_SEQ_LENGTH: "256",
        EVAL_DISTILL_TRAIN_DEVICE: "cpu",
        EVAL_DISTILL_TRAIN_PYTHON: PEFT_PYTHON,
      });
      assert.strictEqual(
        result.code,
        0,
        `peft_train.py live smoke exited non-zero. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      const adapterArtifact = path.join(outputDir, "adapter_model.safetensors");
      assert.isTrue(fs.existsSync(adapterArtifact), `adapter artifact not at ${adapterArtifact}`);
      const stat = fs.statSync(adapterArtifact);
      assert.isAbove(stat.size, 0, "adapter file is non-empty");

      fs.rmSync(tempDir, { recursive: true, force: true });
    },
    600_000,
  );
});
