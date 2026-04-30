import { spawnSync } from "node:child_process";
import { Effect, Layer, Schema } from "effect";
import { assert, describe, it } from "vite-plus/test";
import { AgentTurnLoose, parseAgentTurnFromString } from "@neuve/shared/react-envelope";
import { OllamaApiAdapter } from "../src/runners/ollama-api-adapter";
import { LlamaServerClient } from "../src/runners/llama-server-client";

/**
 * R11 P6 — OllamaApiAdapter live smoke.
 *
 * Boots the Ollama-compatible HTTP proxy + a real llama-server
 * subprocess, sends an Ollama-shape `/api/chat` request with the
 * AgentTurnLoose JSON Schema as `format`, asserts the response is
 * Ollama-shape ndjson with valid AgentTurn `content`.
 *
 * This is the critical end-to-end proof that Path B's translation
 * layer works: `format` → `response_format`, `content` → `message.content`,
 * `stream:false` upstream → single ndjson chunk downstream. The
 * production runner wiring (browsing-gemma-react) calls into this
 * exact path through the existing OllamaClient.
 *
 * Gated on:
 *   - llama-server binary on PATH
 *   - PERF_AGENT_LLAMA_SERVER_LORA env-var pointing at a GGUF LoRA
 *   - PERF_AGENT_LLAMA_SERVER_HF_REPO or _MODEL for the base
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
  (LIVE_BASE_LOCAL !== undefined || LIVE_BASE_HF !== undefined);

const buildAgentTurnSchema = (): unknown => {
  const document = Schema.toJsonSchemaDocument(AgentTurnLoose);
  return { ...document.schema, $defs: document.definitions };
};

describe("OllamaApiAdapter (Path B HTTP proxy)", () => {
  it.skipIf(!liveSmokePossible)(
    "translates Ollama /api/chat with AgentTurn format → llama-server /v1/chat/completions; returns valid AgentTurn (live smoke)",
    async () => {
      // Use off-default ports to avoid colliding with manual probe servers
      // an engineer might have running on 8090 / 11434.
      process.env.PERF_AGENT_LLAMA_SERVER_PORT = "8094";
      process.env.EVAL_OLLAMA_ADAPTER_PORT = "11468";

      const agentTurnSchema = buildAgentTurnSchema();

      const program = Effect.gen(function* () {
        const llamaServer = yield* LlamaServerClient;
        // Touch the client once so it spawns + waits for ready BEFORE we
        // boot the adapter (which then proxies to it).
        yield* llamaServer.chat({
          messages: [{ role: "user", content: "warmup" }],
          maxTokens: 4,
        });
        // Now expose the upstream URL so the adapter Layer sees it.
        const upstreamUrl = `http://127.0.0.1:8094`;
        process.env.PERF_AGENT_LLAMA_SERVER_URL = upstreamUrl;

        const adapter = yield* OllamaApiAdapter;
        // Send an Ollama-shape /api/chat request with the AgentTurn format.
        const ollamaRequest = {
          model: "test",
          messages: [
            {
              role: "system",
              content: "You emit AgentTurn JSON envelopes only. Reply with a single JSON object.",
            },
            {
              role: "user",
              content: 'Emit a THOUGHT envelope with stepId "x" and thought "ok".',
            },
          ],
          stream: true,
          options: { temperature: 0.0, num_ctx: 4096 },
          format: agentTurnSchema,
        };
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${adapter.url}/api/chat`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(ollamaRequest),
            }),
          catch: (cause) => ({ _tag: "FetchError", cause: String(cause) }) as const,
        });
        const text = yield* Effect.promise(() => response.text());
        return { status: response.status, body: text };
      });

      const layered = program.pipe(
        Effect.provide(Layer.merge(LlamaServerClient.layer, OllamaApiAdapter.layer)),
      );
      const exit = await Effect.runPromiseExit(Effect.scoped(layered));
      delete process.env.PERF_AGENT_LLAMA_SERVER_PORT;
      delete process.env.EVAL_OLLAMA_ADAPTER_PORT;
      delete process.env.PERF_AGENT_LLAMA_SERVER_URL;

      assert.strictEqual(exit._tag, "Success", JSON.stringify(exit, null, 2));
      if (exit._tag !== "Success") return;
      const result = exit.value as { status: number; body: string };
      assert.strictEqual(
        result.status,
        200,
        `unexpected status: ${result.status} body=${result.body}`,
      );

      // Body should be one ndjson line (single Ollama-shape chunk).
      const lines = result.body.split("\n").filter((line) => line.trim().length > 0);
      assert.strictEqual(
        lines.length,
        1,
        `expected 1 ndjson chunk, got ${lines.length}: ${result.body}`,
      );
      const chunk = JSON.parse(lines[0]) as {
        message?: { role?: string; content?: string };
        done?: boolean;
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      assert.strictEqual(chunk.done, true);
      assert.strictEqual(chunk.message?.role, "assistant");
      const content = chunk.message?.content ?? "";
      assert.isAbove(content.length, 0, "content non-empty");
      assert.isAbove(chunk.eval_count ?? 0, 0, "eval_count non-zero");

      // The content should round-trip through parseAgentTurnFromString as
      // a valid AgentTurn (the whole point of `format` constraint).
      const parsed = await Effect.runPromise(parseAgentTurnFromString(content));
      assert.match(
        (parsed as { _tag: string })._tag,
        /THOUGHT|ACTION|PLAN_UPDATE|STEP_DONE|ASSERTION_FAILED|RUN_COMPLETED/,
      );
    },
    600_000,
  );
});
