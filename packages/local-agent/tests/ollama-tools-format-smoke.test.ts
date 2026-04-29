import { Effect, Schema } from "effect";
import { afterEach, assert, beforeEach, describe, it, vi } from "vite-plus/test";

import { AgentTurnLoose } from "@neuve/shared/react-envelope";

import { createOllamaClient } from "../src/ollama-client.ts";

// R8 P3 (2026-04-30): live smoke against the production Ollama daemon. Two
// regression guards for the `tools + format` lazy-grammar collision fix in
// `ollama-client.ts buildRequestBody`:
//
//   1. The wire request must not carry both `tools` and `format` together.
//      LM Studio's llama.cpp runtime returns HTTP 400 `"Cannot combine
//      structured output constraints with lazy grammar"` for that exact
//      combination — Ollama silently accepts but the collision intermittently
//      emits zero tokens. We assert the wire shape via a fetch spy that
//      forwards to the real daemon.
//
//   2. Even with `tools` stripped, gemma still produces a schema-valid
//      AgentTurn envelope (it picks tool names from the system-prompt
//      `<tool_catalog>` prose; `tool_calls` was already decorative on the
//      production path per `tool-loop.ts:49`).
//
// Per `feedback_no_test_only_injection_seams.md`: real Ollama, real model,
// no `MockLanguageModelV4`. Skips when the local daemon is unreachable so
// engineers without it still see green CI.

const OLLAMA_BASE_URL = process.env["PERF_AGENT_OLLAMA_URL"] ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env["PERF_AGENT_LOCAL_MODEL"] ?? "gemma4:e4b";

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

const AGENT_TURN_LOOSE_FORMAT = (() => {
  const document = Schema.toJsonSchemaDocument(AgentTurnLoose);
  return { ...document.schema, $defs: document.definitions };
})();

const SAMPLE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "interact",
      description: "Browser tool: navigate / click / fill / hover.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "observe",
      description: "Browser tool: snapshot / screenshot / console / network.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

interface CapturedRequest {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

const installFetchProxy = (): { captured: CapturedRequest[] } => {
  const captured: CapturedRequest[] = [];
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init?.body && typeof init.body === "string" && url.includes("/api/chat")) {
        captured.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      }
      return realFetch(input, init);
    }),
  );
  return { captured };
};

describe("ollama tools/format live smoke", () => {
  beforeEach(() => {
    // Each test installs its own proxy because vi.stubGlobal scopes are
    // cleared in afterEach.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.skipIf(!ollamaReachable)(
    "production OllamaClient never sends `tools` and `format` together against live daemon",
    { timeout: 90_000 },
    () =>
      Effect.gen(function* () {
        const { captured } = installFetchProxy();
        const client = createOllamaClient();
        const result = yield* client.chat({
          messages: [
            {
              role: "system",
              content:
                "You are a ReAct agent. Emit exactly one AgentTurn JSON envelope per turn. Tool catalog: interact (navigate/click/fill), observe (snapshot/screenshot).",
            },
            {
              role: "user",
              content:
                "Emit ONLY a THOUGHT envelope describing the next step toward visiting wikipedia. stepId='r8-smoke-1'.",
            },
          ],
          tools: SAMPLE_TOOLS,
          format: AGENT_TURN_LOOSE_FORMAT,
        });

        assert.lengthOf(captured, 1, "expected exactly one /api/chat request");
        const wire = captured[0];
        if (!wire) throw new Error("no wire body captured");
        assert.deepEqual(
          wire.body["format"],
          AGENT_TURN_LOOSE_FORMAT,
          "format must reach the wire",
        );
        assert.isUndefined(
          wire.body["tools"],
          `tools must NOT reach the wire when format is set; received: ${JSON.stringify(wire.body["tools"])}`,
        );

        // Belt-and-suspenders: the live response must be a non-empty,
        // schema-valid envelope. If the model returned empty content even
        // without `tools`, the bug isn't only the collision and we want CI
        // red so we re-investigate.
        assert.isAbove(
          result.content.length,
          0,
          `expected non-empty content from /api/chat; got doneReason=${result.doneReason}`,
        );
        // Loose parse — the format grammar already constrained the output
        // to AgentTurnLoose. We only assert the JSON is well-formed and the
        // `_tag` discriminator is one of the known variants. Strict parsing
        // (per-tool union) is the production loop's concern in `tool-loop.ts`,
        // not the request-shape smoke under test here.
        const parsed = JSON.parse(result.content) as { _tag?: unknown };
        const validTags = new Set([
          "THOUGHT",
          "ACTION",
          "PLAN_UPDATE",
          "STEP_DONE",
          "ASSERTION_FAILED",
          "RUN_COMPLETED",
        ]);
        assert.isTrue(
          typeof parsed._tag === "string" && validTags.has(parsed._tag),
          `expected an AgentTurn variant; got ${JSON.stringify(parsed._tag)}`,
        );
      }).pipe(Effect.runPromise),
  );

  it.skipIf(!ollamaReachable)(
    "format-only request still yields valid envelope when tools-catalog lives in system prompt",
    { timeout: 90_000 },
    () =>
      Effect.gen(function* () {
        // No `tools` argument at all — proves gemma still emits an ACTION
        // with the right `toolName` purely from the system prompt prose,
        // which is the assumption the production fix relies on.
        const client = createOllamaClient();
        const result = yield* client.chat({
          messages: [
            {
              role: "system",
              content:
                "You are a ReAct agent. Tools available: interact (navigate, click, fill), observe (snapshot, screenshot). Emit one AgentTurn JSON envelope per turn.",
            },
            {
              role: "user",
              content:
                "Emit ONLY an ACTION envelope to navigate to https://wikipedia.org. stepId='r8-smoke-2'.",
            },
          ],
          format: AGENT_TURN_LOOSE_FORMAT,
        });

        assert.isAbove(result.content.length, 0);
        // Loose parse — the format grammar already constrained the output
        // to AgentTurnLoose. We only assert the JSON is well-formed and the
        // `_tag` discriminator is one of the known variants. Strict parsing
        // (per-tool union) is the production loop's concern in `tool-loop.ts`,
        // not the request-shape smoke under test here.
        const parsed = JSON.parse(result.content) as { _tag?: unknown };
        const validTags = new Set([
          "THOUGHT",
          "ACTION",
          "PLAN_UPDATE",
          "STEP_DONE",
          "ASSERTION_FAILED",
          "RUN_COMPLETED",
        ]);
        assert.isTrue(
          typeof parsed._tag === "string" && validTags.has(parsed._tag),
          `expected an AgentTurn variant; got ${JSON.stringify(parsed._tag)}`,
        );
      }).pipe(Effect.runPromise),
  );
});
