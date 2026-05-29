import * as http from "node:http";
import { Config, Effect, Layer, Schema, Scope, ServiceMap } from "effect";

/**
 * OllamaApiAdapter — R11 P6 Path B HTTP proxy that exposes a subset of
 * Ollama's `/api/chat` + `/api/version` API on a local port and
 * translates incoming requests into llama-server's
 * `/v1/chat/completions` shape.
 *
 * Why a proxy and not a TS-level OllamaClient subclass: `@neuve/local-agent`
 * constructs `OllamaClient` directly via `createOllamaClient()` — there's
 * no Layer/ServiceMap injection seam at the agent boundary. Touching
 * local-agent source would trip the build-cache trap (see
 * `project_eval_build_cache_trap.md`) and require a `pnpm --filter
 * @neuve/local-agent build` between iterations. The HTTP proxy keeps
 * R11's runtime fork (locked decision #9) entirely inside the evals
 * package — the runner sets `PERF_AGENT_OLLAMA_URL=http://127.0.0.1:<port>`
 * via Effect's ConfigProvider overlay (the same pattern `gemma.ts`
 * already uses for `PERF_AGENT_LOCAL_MODEL`).
 *
 * Translation rules (sub-probe-one, 2026-04-30, verified):
 *
 * Request `/api/chat` → `/v1/chat/completions`:
 *   - Drop `model` field (we already targeted llama-server with --model
 *     or -hf at spawn time).
 *   - Drop `stream: true` boolean — we forward as `stream: false` and
 *     emit ONE final ndjson chunk to the caller (OllamaClient
 *     accumulator handles single-chunk streams correctly; see
 *     `consumeChunk` in `packages/local-agent/src/ollama-client.ts:269`).
 *   - Drop `tools` field — Path B uses `format`/`response_format` JSON
 *     schema constraint exclusively per R7+ stack.
 *   - `format` → `response_format: { type: "json_schema", json_schema:
 *     { name: "AgentTurn", schema: <format>, strict: true } }`. Probed
 *     live with `AgentTurnLoose` JSON Schema; llama-server returns
 *     valid AgentTurn envelopes.
 *   - Pull `temperature` from `options.temperature` if present.
 *   - Drop `images` (no multimodal in browsing-gemma's R11 scope).
 *   - Strip assistant-message `tool_calls` field; OllamaClient sends
 *     these in conversation history but llama-server's OpenAI-compat
 *     endpoint rejects them.
 *
 * Response (single chunk; stream: false from llama-server):
 *   - llama-server returns `{ choices: [{ message: { role, content,
 *     reasoning_content }, finish_reason }], usage: { prompt_tokens,
 *     completion_tokens, total_tokens } }`.
 *   - DROP `reasoning_content` — Gemma 4 thinking tokens leak there;
 *     Ollama path strips equivalent `<|channel|>thought>` tokens via R4
 *     stripThoughtChannel; distillation training data should not
 *     include reasoning.
 *   - Emit ONE Ollama ndjson line: `{ message: { role: "assistant",
 *     content: <openai content> }, done: true, done_reason:
 *     <openai finish_reason>, prompt_eval_count: <usage.prompt_tokens>,
 *     eval_count: <usage.completion_tokens>, total_duration: 0 }`.
 *
 * `/api/version`: returns `{"version":"adapter-0.1.0"}` so OllamaClient's
 * health check passes.
 */

// `0` lets the OS pick a free ephemeral port. The adapter then reads
// the actual bound port off `server.address()` and exposes it to
// callers as the `url` field. This avoids EADDRINUSE collisions when
// evalite runs tasks in parallel and each per-task scope spins its own
// adapter — production sweep flag (R11 P6).
const DEFAULT_LISTEN_PORT = 0;
const DEFAULT_LISTEN_HOST = "127.0.0.1";
const HTTP_REQUEST_TIMEOUT_MS = 600_000;

export class OllamaApiAdapterStartError extends Schema.ErrorClass<OllamaApiAdapterStartError>(
  "OllamaApiAdapterStartError",
)({
  _tag: Schema.tag("OllamaApiAdapterStartError"),
  port: Schema.Number,
  cause: Schema.String,
}) {
  message = `OllamaApiAdapter failed to bind on port ${this.port}: ${this.cause}`;
}

export class LlamaServerUpstreamError extends Schema.ErrorClass<LlamaServerUpstreamError>(
  "LlamaServerUpstreamError",
)({
  _tag: Schema.tag("LlamaServerUpstreamError"),
  status: Schema.Number,
  body: Schema.String,
}) {
  message = `llama-server upstream returned HTTP ${this.status}: ${this.body.slice(0, 800)}`;
}

const portConfig = Config.int("EVAL_OLLAMA_ADAPTER_PORT").pipe(
  Config.withDefault(DEFAULT_LISTEN_PORT),
);
const hostConfig = Config.string("EVAL_OLLAMA_ADAPTER_HOST").pipe(
  Config.withDefault(DEFAULT_LISTEN_HOST),
);
// The configured model name for `/api/tags`. Defaults to `browsing-gemma`
// per `project_lora_name.md`. The runner's ConfigProvider overlay sets
// this via `PERF_AGENT_LOCAL_MODEL` for the local-agent's preflight; the
// adapter advertises the same name so the preflight finds it.
const modelNameConfig = Config.string("EVAL_OLLAMA_ADAPTER_MODEL_NAME").pipe(
  Config.withDefault("browsing-gemma"),
);
interface OllamaChatMessage {
  readonly role: string;
  readonly content?: string;
}

interface OllamaChatRequest {
  readonly messages: ReadonlyArray<OllamaChatMessage>;
  readonly options?: { readonly temperature?: number; readonly num_ctx?: number };
  readonly format?: unknown;
}

const buildLlamaServerBody = (request: OllamaChatRequest): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content ?? "",
    })),
    stream: false,
  };
  if (request.options?.temperature !== undefined) {
    body["temperature"] = request.options.temperature;
  }
  if (request.format !== undefined) {
    body["response_format"] = {
      type: "json_schema",
      json_schema: { name: "AgentTurn", schema: request.format, strict: true },
    };
  }
  return body;
};

interface LlamaServerChoiceMessage {
  readonly role?: string;
  readonly content?: string | null;
  readonly reasoning_content?: string | null;
}

interface LlamaServerChoice {
  readonly index?: number;
  readonly finish_reason?: string | null;
  readonly message: LlamaServerChoiceMessage;
}

interface LlamaServerUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}

interface LlamaServerCompletion {
  readonly choices?: ReadonlyArray<LlamaServerChoice>;
  readonly usage?: LlamaServerUsage;
}

const renderOllamaResponseChunk = (completion: LlamaServerCompletion): string => {
  const choice = completion.choices?.[0];
  const content = choice?.message.content ?? "";
  const finishReason = choice?.finish_reason ?? null;
  const usage = completion.usage;
  const chunk = {
    message: { role: "assistant", content },
    done: true,
    done_reason: finishReason ?? "stop",
    prompt_eval_count: usage?.prompt_tokens ?? 0,
    eval_count: usage?.completion_tokens ?? 0,
    total_duration: 0,
  };
  return JSON.stringify(chunk) + "\n";
};

const proxyChatRequest = async (
  resolveUpstream: () => string,
  ollamaBody: OllamaChatRequest,
): Promise<{ readonly status: number; readonly bodyText: string; readonly chunkLine?: string }> => {
  const upstreamUrl = resolveUpstream();
  const llamaBody = buildLlamaServerBody(ollamaBody);
  const upstreamResponse = await fetch(`${upstreamUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(llamaBody),
    signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
  });
  if (!upstreamResponse.ok) {
    const text = await upstreamResponse.text();
    return { status: upstreamResponse.status, bodyText: text };
  }
  const completion = (await upstreamResponse.json()) as LlamaServerCompletion;
  return {
    status: 200,
    bodyText: "",
    chunkLine: renderOllamaResponseChunk(completion),
  };
};

const handleApiVersion = (response: http.ServerResponse): void => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ version: "adapter-0.1.0" }));
};

/**
 * `/api/tags` — Ollama-shape model listing. Required by `@neuve/agent`'s
 * AcpAdapter.layerLocal preflight (`packages/agent/src/acp-client.ts:600`)
 * which lists Ollama models and verifies the configured model name is
 * present. The adapter advertises a single virtual model per the
 * `EVAL_OLLAMA_ADAPTER_MODEL_NAME` env (default "browsing-gemma") so the
 * preflight passes without a real Ollama instance running. The actual
 * model served by llama-server is whatever `--model` / `--lora` it was
 * launched with — the preflight is name-only validation.
 */
const handleApiTags = (modelName: string, response: http.ServerResponse): void => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      models: [{ name: modelName }, { name: `${modelName}:latest` }],
    }),
  );
};

const handleHealthCheck = (response: http.ServerResponse): void => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("Ollama is running");
};

const readRequestBody = (request: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const handleApiChat = async (
  resolveUpstream: () => string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> => {
  const bodyText = await readRequestBody(request);
  let parsed: OllamaChatRequest;
  try {
    parsed = JSON.parse(bodyText) as OllamaChatRequest;
  } catch (cause) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: `OllamaApiAdapter: invalid JSON body: ${(cause as Error).message}`,
      }),
    );
    return;
  }
  const proxy = await proxyChatRequest(resolveUpstream, parsed);
  if (proxy.status !== 200) {
    response.writeHead(proxy.status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: proxy.bodyText.slice(0, 1500) }));
    return;
  }
  response.writeHead(200, { "content-type": "application/x-ndjson" });
  response.end(proxy.chunkLine ?? "");
};

const startServer = (
  resolveUpstream: () => string,
  modelName: string,
  port: number,
  host: string,
): Effect.Effect<
  { readonly url: string; readonly server: http.Server },
  OllamaApiAdapterStartError
> =>
  Effect.callback<
    { readonly url: string; readonly server: http.Server },
    OllamaApiAdapterStartError
  >((resume) => {
    const server = http.createServer((request, response) => {
      const url = request.url ?? "/";
      if (request.method === "GET" && url === "/") {
        handleHealthCheck(response);
        return;
      }
      if (request.method === "GET" && url.startsWith("/api/version")) {
        handleApiVersion(response);
        return;
      }
      if (request.method === "GET" && url.startsWith("/api/tags")) {
        handleApiTags(modelName, response);
        return;
      }
      if (request.method === "POST" && url.startsWith("/api/chat")) {
        handleApiChat(resolveUpstream, request, response).catch((cause) => {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              error: `OllamaApiAdapter: handler failed: ${(cause as Error).message}`,
            }),
          );
        });
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: `OllamaApiAdapter: route not found: ${request.method} ${url}`,
        }),
      );
    });
    server.on("error", (cause) => {
      resume(
        Effect.fail(
          new OllamaApiAdapterStartError({
            port,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
      );
    });
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resume(Effect.succeed({ url: `http://${host}:${boundPort}`, server }));
    });
  });

export class OllamaApiAdapter extends ServiceMap.Service<
  OllamaApiAdapter,
  {
    readonly url: string;
  }
>()("@evals/OllamaApiAdapter", {
  make: Effect.gen(function* () {
    const port = yield* Effect.gen(function* () {
      return yield* portConfig;
    }).pipe(Effect.catchTags({ ConfigError: Effect.die }));
    const host = yield* Effect.gen(function* () {
      return yield* hostConfig;
    }).pipe(Effect.catchTags({ ConfigError: Effect.die }));
    const modelName = yield* Effect.gen(function* () {
      return yield* modelNameConfig;
    }).pipe(Effect.catchTags({ ConfigError: Effect.die }));

    // Lazy-resolve upstream URL on every chat request — Layer-init time
    // may be before the upstream env is set (e.g. when the test boots
    // both LlamaServerClient + OllamaApiAdapter concurrently). Reading
    // process.env at request time is safe; the URL is stable once set.
    const resolveUpstream = (): string => {
      const url = process.env["PERF_AGENT_LLAMA_SERVER_URL"];
      if (url === undefined || url.length === 0) {
        throw new Error(
          "PERF_AGENT_LLAMA_SERVER_URL not set when /api/chat fired. The OllamaApiAdapter requires the upstream llama-server URL via env.",
        );
      }
      return url;
    };

    yield* Effect.logInfo("Starting OllamaApiAdapter", { port, host, modelName });

    const handle = yield* Effect.acquireRelease(
      startServer(resolveUpstream, modelName, port, host),
      (resource) =>
        Effect.callback<void>((resume) => {
          resource.server.close(() => resume(Effect.void));
        }),
    );

    yield* Effect.logInfo("OllamaApiAdapter listening", { url: handle.url });

    return { url: handle.url } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make);
}

export type OllamaApiAdapterShape = {
  readonly url: string;
};
export type OllamaApiAdapterEffect<A, E> = Effect.Effect<A, E, OllamaApiAdapter | Scope.Scope>;
