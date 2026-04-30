import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import { assert, describe, it } from "vite-plus/test";
import { LlamaServerClient } from "../src/runners/llama-server-client";

/**
 * R11 P5.5 — LlamaServerClient live smoke test.
 *
 * Spawns a real `llama-server --lora` subprocess via Effect.acquireRelease,
 * sends one chat completion through `/v1/chat/completions`, asserts a
 * non-empty response, and lets the scope close kill the subprocess.
 *
 * Gated on:
 *   - `llama-server` binary on PATH (homebrew `llama.cpp` 8980+).
 *   - `PERF_AGENT_LLAMA_SERVER_LORA` env-var pointing at a GGUF LoRA
 *     adapter (e.g. the P4 → P5 output, or the Path E probe artifact
 *     at /tmp/r11-pathE/probing-gemma.gguf).
 *   - Either `PERF_AGENT_LLAMA_SERVER_MODEL` (local base GGUF) or
 *     `PERF_AGENT_LLAMA_SERVER_HF_REPO` (HF auto-pull) must be set.
 *
 * `it.skipIf` keeps engineers without these green. Real services per
 * `feedback_no_test_only_injection_seams.md` — no
 * `MockLanguageModelV4`.
 *
 * Structured-error paths (LlamaServerUnavailableError,
 * LlamaServerBaseModelMissingError, LlamaServerNotReadyError, etc.)
 * are exercised at the wrapper boundaries in the manual end-to-end
 * pipeline runs documented in the R11 diary.
 */

const isLlamaServerAvailable = (): boolean => {
  const result = spawnSync("llama-server", ["--help"], { stdio: "ignore" });
  return result.status === 0;
};

const LIVE_LORA = process.env.PERF_AGENT_LLAMA_SERVER_LORA;
const LIVE_BASE_LOCAL = process.env.PERF_AGENT_LLAMA_SERVER_MODEL;
const LIVE_BASE_HF = process.env.PERF_AGENT_LLAMA_SERVER_HF_REPO;

const liveSmokePossible =
  isLlamaServerAvailable() &&
  LIVE_LORA !== undefined &&
  fs.existsSync(LIVE_LORA) &&
  ((LIVE_BASE_LOCAL !== undefined && fs.existsSync(LIVE_BASE_LOCAL)) || LIVE_BASE_HF !== undefined);

describe("LlamaServerClient", () => {
  it.skipIf(!liveSmokePossible)(
    "spawns llama-server with --lora, gets a non-empty chat completion, kills subprocess on scope close (live smoke)",
    async () => {
      // Use an off-default port so we don't collide with a manual probe
      // server an engineer might have running on 8090.
      process.env.PERF_AGENT_LLAMA_SERVER_PORT = "8091";

      const program = Effect.gen(function* () {
        const client = yield* LlamaServerClient;
        return yield* client.chat({
          messages: [{ role: "user", content: "Reply with one word: ok" }],
          maxTokens: 24,
        });
      });

      const exit = await Effect.runPromiseExit(
        Effect.scoped(program).pipe(Effect.provide(LlamaServerClient.layer)),
      );

      assert.strictEqual(exit._tag, "Success", JSON.stringify(exit, null, 2));
      if (exit._tag === "Success") {
        const result = exit.value;
        const merged = result.content + (result.reasoningContent ?? "");
        assert.isAbove(
          merged.trim().length,
          0,
          `response (content + reasoning) is non-empty. content=${JSON.stringify(result.content)} reasoning=${JSON.stringify(result.reasoningContent)}`,
        );
      }

      delete process.env.PERF_AGENT_LLAMA_SERVER_PORT;
    },
    300_000,
  );
});
