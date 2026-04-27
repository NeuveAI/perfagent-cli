import { Effect, Schema } from "effect";
import { assert, describe, it } from "vite-plus/test";
import {
  AgentTurn,
  parseAgentTurn,
} from "@neuve/shared/react-envelope";

// R6 multi-modal: live regression guard for the Ollama `/api/chat` multipart
// shape the gemma-react production loop ships. Probe 1 (2026-04-27) verified
// that `gemma4:e4b` accepts `{role: "user", content: "...", images: [base64]}`
// and reasons over the bytes; this test pins that shape against the live
// server so any future Ollama upgrade or schema-grammar regression that
// breaks multipart inputs fails CI. Skips when the local Ollama daemon is
// unreachable so engineers without it still get green CI.

const OLLAMA_BASE_URL = process.env["PERF_AGENT_OLLAMA_URL"] ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env["PERF_AGENT_LOCAL_MODEL"] ?? "gemma4:e4b";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

const probeOllamaReachable = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { models?: ReadonlyArray<{ name?: string }> };
    if (!Array.isArray(body.models)) return false;
    return body.models.some((entry) => entry.name === OLLAMA_MODEL);
  } catch {
    return false;
  }
};

let ollamaReachable = false;
try {
  ollamaReachable = await probeOllamaReachable();
} catch {
  ollamaReachable = false;
}

const AGENT_TURN_FORMAT = (() => {
  const document = Schema.toJsonSchemaDocument(AgentTurn);
  return { ...document.schema, $defs: document.definitions };
})();

interface ChatStreamLine {
  readonly message?: { readonly content?: string };
  readonly done?: boolean;
}

const collectChat = async (body: Record<string, unknown>): Promise<string> => {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Ollama /api/chat returned HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let combined = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      const chunk = JSON.parse(line) as ChatStreamLine;
      if (chunk.message?.content) combined += chunk.message.content;
    }
  }
  if (buffer.trim().length > 0) {
    const chunk = JSON.parse(buffer.trim()) as ChatStreamLine;
    if (chunk.message?.content) combined += chunk.message.content;
  }
  return combined;
};

describe("gemma multi-modal smoke", () => {
  it.skipIf(!ollamaReachable)(
    "round-trips a multipart user message with images through /api/chat + AgentTurn grammar",
    { timeout: 90_000 },
    () =>
      Effect.gen(function* () {
        // Wire shape from Probe 1 (2026-04-27): `images` is an array of raw
        // base64 strings (no `data:` prefix) sibling to `content`. Native
        // Ollama infers PNG/JPEG from the byte header.
        const requestBody = {
          model: OLLAMA_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are a ReAct agent. Emit exactly one AgentTurn JSON envelope per turn.",
            },
            {
              role: "user",
              content:
                "Below is a viewport screenshot of the page after a navigation. Emit a THOUGHT envelope describing what you see in one short sentence, with stepId='r6-gemma-smoke-1'.",
              images: [TINY_PNG_BASE64],
            },
          ],
          stream: true,
          options: { num_ctx: 8192, temperature: 0 },
          format: AGENT_TURN_FORMAT,
        };

        const start = Date.now();
        const content = yield* Effect.tryPromise({
          try: () => collectChat(requestBody),
          catch: (cause) =>
            new Error(
              `Ollama multipart call failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
        });
        const elapsedMs = Date.now() - start;

        assert.isAbove(
          content.length,
          0,
          "expected non-empty content from /api/chat (format-grammar should yield an AgentTurn JSON)",
        );

        // The format-grammar pins the schema; we only need the envelope to
        // round-trip cleanly. Which variant Gemma picks (THOUGHT vs ACTION
        // etc.) is model-driven and not the property under test — the
        // multipart wire shape + grammar interplay is.
        const envelope = yield* parseAgentTurn(JSON.parse(content));
        const validTags = new Set([
          "THOUGHT",
          "ACTION",
          "PLAN_UPDATE",
          "STEP_DONE",
          "ASSERTION_FAILED",
          "RUN_COMPLETED",
        ]);
        assert.isTrue(
          validTags.has(envelope._tag),
          `expected one of the AgentTurn variants; got ${envelope._tag}`,
        );
        assert.isBelow(
          elapsedMs,
          90_000,
          `multipart live call should finish under 90s; took ${elapsedMs}ms`,
        );
      }).pipe(Effect.runPromise),
  );
});
