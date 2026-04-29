import { Effect } from "effect";
import { afterEach, assert, beforeEach, describe, it, vi } from "vite-plus/test";

import { createOllamaClient } from "../src/ollama-client.ts";

// R8 P3 (2026-04-30): regression guard for the lazy-grammar × structured-output
// grammar collision. LM Studio's llama.cpp runtime returns HTTP 400 `"Cannot
// combine structured output constraints with lazy grammar"` for `tools +
// response_format: json_schema`. Ollama 0.22.0 silently accepts both but the
// collision intermittently emits zero tokens (the production empty-content
// failure mode). The fix in `ollama-client.ts buildRequestBody` strips
// `tools` from the wire request whenever `format` is set; production callers
// (`tool-loop.ts`) always set `format` and treat native `message.tool_calls`
// as decorative (envelope dispatch is keyed on `_tag`). These tests pin the
// wire contract so future drift toward "send both" is caught at unit-test
// time. See `docs/handover/ollama-empty-content/diary/r8-2026-04-30.md`.

interface CapturedBody {
  readonly model: string;
  readonly stream: true;
  readonly options: { readonly num_ctx: number; readonly temperature: number };
  readonly tools?: ReadonlyArray<unknown>;
  readonly format?: unknown;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
}

const noopStreamingResponse = (): Response => {
  const ndjson = `${JSON.stringify({ message: { content: "" }, done: true, done_reason: "stop", prompt_eval_count: 0, eval_count: 0, total_duration: 0 })}\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(ndjson));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
};

const stubFetch = (): { capturedBodies: CapturedBody[] } => {
  const capturedBodies: CapturedBody[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const raw = init?.body;
      if (typeof raw === "string") {
        capturedBodies.push(JSON.parse(raw) as CapturedBody);
      }
      return noopStreamingResponse();
    }),
  );
  return { capturedBodies };
};

const sampleTools = [
  {
    type: "function" as const,
    function: {
      name: "interact",
      description: "navigate / click / type",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

const sampleFormat = {
  anyOf: [
    {
      type: "object",
      properties: {
        _tag: { const: "THOUGHT" },
        stepId: { type: "string" },
        thought: { type: "string" },
      },
      required: ["_tag", "stepId", "thought"],
    },
  ],
};

describe("OllamaClient.chat — tools/format mutual exclusion", () => {
  beforeEach(() => {
    // The startup config reads `PERF_AGENT_OLLAMA_URL` and
    // `PERF_AGENT_LOCAL_MODEL` once via `Effect.runSync`. Default values
    // (http://localhost:11434, gemma4:e4b) keep the test independent of the
    // dev's environment.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips `tools` from the wire body when `format` is provided", async () => {
    const { capturedBodies } = stubFetch();
    const client = createOllamaClient();
    await Effect.runPromise(
      client.chat({
        messages: [{ role: "user", content: "hello" }],
        tools: sampleTools,
        format: sampleFormat,
      }),
    );
    assert.lengthOf(capturedBodies, 1);
    const body = capturedBodies[0];
    if (!body) throw new Error("no body captured");
    assert.deepEqual(body.format, sampleFormat, "format must reach the wire");
    assert.isUndefined(
      body.tools,
      `tools must NOT reach the wire when format is set; received: ${JSON.stringify(body.tools)}`,
    );
  });

  it("forwards `tools` when `format` is omitted (legacy callers without grammar)", async () => {
    const { capturedBodies } = stubFetch();
    const client = createOllamaClient();
    await Effect.runPromise(
      client.chat({
        messages: [{ role: "user", content: "hello" }],
        tools: sampleTools,
      }),
    );
    assert.lengthOf(capturedBodies, 1);
    const body = capturedBodies[0];
    if (!body) throw new Error("no body captured");
    assert.isUndefined(body.format, "format absent when caller omits it");
    assert.deepEqual(body.tools, sampleTools, "tools must reach the wire when no format collides");
  });

  it("forwards `format` when no `tools` are provided", async () => {
    const { capturedBodies } = stubFetch();
    const client = createOllamaClient();
    await Effect.runPromise(
      client.chat({
        messages: [{ role: "user", content: "hello" }],
        format: sampleFormat,
      }),
    );
    assert.lengthOf(capturedBodies, 1);
    const body = capturedBodies[0];
    if (!body) throw new Error("no body captured");
    assert.deepEqual(body.format, sampleFormat);
    assert.isUndefined(body.tools);
  });

  it("omits both fields when neither is provided", async () => {
    const { capturedBodies } = stubFetch();
    const client = createOllamaClient();
    await Effect.runPromise(
      client.chat({
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    assert.lengthOf(capturedBodies, 1);
    const body = capturedBodies[0];
    if (!body) throw new Error("no body captured");
    assert.isUndefined(body.format);
    assert.isUndefined(body.tools);
  });
});
