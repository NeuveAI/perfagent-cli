import { Config, Effect, Schema } from "effect";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "gemma4:e4b";
const DEFAULT_TEMPERATURE = 0.1;
// Gemma 4 E4B's native context window is 131072 tokens (verified via
// `ollama show gemma4:e4b`). We were previously capped at 32768 — 25% of
// the real window — which left no headroom once the system prompt + 8
// tool schemas pushed the prompt past ~4 KB. Bump to the full model
// context so long trajectories (observe → trace → analyze loops) don't
// silently truncate. Probe D 2026-04-25 confirmed `/v1/chat/completions`
// silently drops `num_ctx`; native `/api/chat` honours it. Both fixes
// land here.
const DEFAULT_NUM_CTX = 131_072;

// --- Wire schemas (subset of native /api/chat surface that we consume) ---

const OllamaResponseToolCallFunction = Schema.Struct({
  name: Schema.String,
  arguments: Schema.Record(Schema.String, Schema.Unknown),
});

const OllamaResponseToolCall = Schema.Struct({
  function: OllamaResponseToolCallFunction,
});

const OllamaResponseMessage = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  tool_calls: Schema.optional(Schema.Array(OllamaResponseToolCall)),
});

const OllamaChatChunk = Schema.Struct({
  message: Schema.optional(OllamaResponseMessage),
  done: Schema.optional(Schema.Boolean),
  done_reason: Schema.optional(Schema.String),
  prompt_eval_count: Schema.optional(Schema.Number),
  eval_count: Schema.optional(Schema.Number),
  total_duration: Schema.optional(Schema.Number),
});

const decodeChatChunk = Schema.decodeEffect(Schema.fromJsonString(OllamaChatChunk));

// --- Public types ---

export interface OllamaToolCall {
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

export type OllamaMessageRole = "system" | "user" | "assistant" | "tool";

export interface OllamaImage {
  readonly data: string;
  readonly mimeType: string;
}

export interface OllamaMessage {
  readonly role: OllamaMessageRole;
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<OllamaToolCall>;
  // R6 multi-modal: base64-encoded images attached to a user observation.
  // The wire serializer in `toWireMessage` flattens these to the native
  // Ollama `images: string[]` field (Probe 1, 2026-04-27 — verified shape
  // for `gemma4:e4b` against `/api/chat`).
  readonly images?: ReadonlyArray<OllamaImage>;
}

export interface OllamaToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface OllamaCompletionOptions {
  readonly messages: ReadonlyArray<OllamaMessage>;
  readonly tools?: ReadonlyArray<OllamaToolDefinition>;
  // JSON Schema-shaped grammar override. R2-T2 passes the `AgentTurn`
  // schema here so Gemma's output is constrained to the discriminated
  // union. Pass-through verbatim — the caller is responsible for shaping.
  readonly format?: unknown;
  readonly signal?: AbortSignal;
}

export interface OllamaUsage {
  readonly promptEvalCount: number;
  readonly evalCount: number;
  readonly totalDuration: number;
}

export interface OllamaChatResult {
  readonly content: string;
  readonly toolCalls: ReadonlyArray<OllamaToolCall>;
  readonly doneReason: string | undefined;
  readonly usage: OllamaUsage | undefined;
}

// --- Errors ---

export class OllamaRequestError extends Schema.ErrorClass<OllamaRequestError>(
  "OllamaRequestError",
)({
  _tag: Schema.tag("OllamaRequestError"),
  status: Schema.Number,
  body: Schema.String,
}) {
  message = `Ollama /api/chat returned HTTP ${this.status}: ${this.body}`;
}

export class OllamaTransportError extends Schema.ErrorClass<OllamaTransportError>(
  "OllamaTransportError",
)({
  _tag: Schema.tag("OllamaTransportError"),
  cause: Schema.String,
}) {
  message = `Ollama /api/chat transport error: ${this.cause}`;
}

export class OllamaStreamError extends Schema.ErrorClass<OllamaStreamError>(
  "OllamaStreamError",
)({
  _tag: Schema.tag("OllamaStreamError"),
  cause: Schema.String,
}) {
  message = `Ollama /api/chat stream error: ${this.cause}`;
}

export class OllamaHealthCheckError extends Schema.ErrorClass<OllamaHealthCheckError>(
  "OllamaHealthCheckError",
)({
  _tag: Schema.tag("OllamaHealthCheckError"),
  status: Schema.Number,
  body: Schema.String,
}) {
  message = `Ollama health check failed: HTTP ${this.status} ${this.body}`;
}

// --- Public client interface ---

export interface OllamaClient {
  readonly model: string;
  readonly baseUrl: string;
  readonly chat: (
    options: OllamaCompletionOptions,
  ) => Effect.Effect<
    OllamaChatResult,
    OllamaRequestError | OllamaTransportError | OllamaStreamError
  >;
  readonly checkHealth: () => Effect.Effect<
    void,
    OllamaHealthCheckError | OllamaTransportError
  >;
}

// --- Internal helpers ---

interface WireMessage {
  readonly role: OllamaMessageRole;
  readonly content: string;
  readonly tool_calls?: ReadonlyArray<OllamaToolCall>;
  readonly images?: ReadonlyArray<string>;
}

const toWireMessage = (message: OllamaMessage): WireMessage => {
  const wire: {
    role: OllamaMessageRole;
    content: string;
    tool_calls?: ReadonlyArray<OllamaToolCall>;
    images?: ReadonlyArray<string>;
  } = {
    role: message.role,
    content: message.content,
  };
  if (message.toolCalls && message.toolCalls.length > 0) {
    wire.tool_calls = message.toolCalls;
  }
  if (message.images && message.images.length > 0) {
    // Ollama's native `/api/chat` carries images as `images: ["<base64>"]`
    // siblings to `content` — raw base64 strings, no `data:` URL prefix.
    // Probe 1 (2026-04-27, `docs/handover/multi-modal-react/probes/`) verified
    // the shape against `gemma4:e4b`. We keep `mimeType` on `OllamaMessage`
    // for parity with the gemini-react loop's AI SDK multipart shape, but
    // discard it on the wire — Ollama infers format from the PNG/JPEG header.
    wire.images = message.images.map((image) => image.data);
  }
  return wire;
};

interface RequestBody {
  readonly model: string;
  readonly messages: ReadonlyArray<WireMessage>;
  readonly stream: true;
  readonly options: {
    readonly num_ctx: number;
    readonly temperature: number;
  };
  readonly tools?: ReadonlyArray<OllamaToolDefinition>;
  readonly format?: unknown;
}

const buildRequestBody = (
  model: string,
  options: OllamaCompletionOptions,
): RequestBody => ({
  model,
  messages: options.messages.map(toWireMessage),
  stream: true,
  options: {
    num_ctx: DEFAULT_NUM_CTX,
    temperature: DEFAULT_TEMPERATURE,
  },
  ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  ...(options.format !== undefined ? { format: options.format } : {}),
});

const stripTrailingSlashes = (raw: string): string => {
  let result = raw;
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
};

const resolveStartupConfig = Effect.gen(function* () {
  const rawBaseUrl = yield* Config.string("PERF_AGENT_OLLAMA_URL").pipe(
    Config.withDefault(DEFAULT_BASE_URL),
  );
  const trimmedBaseUrl = stripTrailingSlashes(rawBaseUrl);
  // Pre-R2 callers (and a handful of remaining hardcoded sites in this
  // repo) point at `/v1/` — the OpenAI-compat shim path. Native
  // `/api/chat` is sibling on the root URL, so we accept both shapes.
  // The strip is silent in production but loud in logs so a future
  // reader can see it firing.
  let baseUrl = trimmedBaseUrl;
  if (trimmedBaseUrl.endsWith("/v1")) {
    baseUrl = trimmedBaseUrl.slice(0, -3);
    yield* Effect.logWarning(
      "OllamaClient: base URL contains /v1 suffix; stripped for native /api/chat",
      { rawBaseUrl, sanitizedBaseUrl: baseUrl },
    );
  }
  const model = yield* Config.string("PERF_AGENT_LOCAL_MODEL").pipe(
    Config.withDefault(DEFAULT_MODEL),
  );
  return { baseUrl, model } as const;
});

interface AccumulatorState {
  content: string;
  toolCalls: OllamaToolCall[];
  usage: OllamaUsage | undefined;
  doneReason: string | undefined;
}

const consumeChunk = (
  state: AccumulatorState,
  chunk: typeof OllamaChatChunk.Type,
): void => {
  const message = chunk.message;
  if (message?.content) {
    state.content += message.content;
  }
  if (message?.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      state.toolCalls.push({
        function: {
          name: toolCall.function.name,
          arguments: { ...toolCall.function.arguments },
        },
      });
    }
  }
  if (chunk.done) {
    if (
      chunk.prompt_eval_count !== undefined &&
      chunk.eval_count !== undefined
    ) {
      state.usage = {
        promptEvalCount: chunk.prompt_eval_count,
        evalCount: chunk.eval_count,
        totalDuration: chunk.total_duration ?? 0,
      };
    }
    if (chunk.done_reason) {
      state.doneReason = chunk.done_reason;
    }
  }
};

// --- Public factory ---

export const createOllamaClient = (): OllamaClient => {
  // Config.string with withDefault never fails — using runSync here is safe
  // and avoids forcing the LocalAgent (a non-Effect class) to accept an
  // Effect-shaped factory. Per CLAUDE.md, we route env access through
  // Config.string (validated, no raw process.env).
  const { baseUrl, model } = Effect.runSync(resolveStartupConfig);

  const chat = Effect.fn("OllamaClient.chat")(function* (
    options: OllamaCompletionOptions,
  ) {
    yield* Effect.annotateCurrentSpan({
      model,
      messageCount: options.messages.length,
      toolCount: options.tools?.length ?? 0,
      hasFormat: options.format !== undefined,
    });

    const requestBody = buildRequestBody(model, options);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: options.signal,
        }),
      catch: (cause) => new OllamaTransportError({ cause: String(cause) }),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new OllamaTransportError({ cause: String(cause) }),
      });
      return yield* new OllamaRequestError({ status: response.status, body });
    }

    if (!response.body) {
      return yield* new OllamaStreamError({
        cause: "response body is missing — cannot stream NDJSON",
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const state: AccumulatorState = {
      content: "",
      toolCalls: [],
      usage: undefined,
      doneReason: undefined,
    };

    while (true) {
      const { done, value } = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: (cause) => new OllamaStreamError({ cause: String(cause) }),
      });
      if (done) {
        // Flush any trailing partial chunk in the buffer. A schema-decode
        // failure here means Ollama's wire protocol diverged from our
        // expectation — that's an unrecoverable defect, not a domain
        // error (per CLAUDE.md "Unrecoverable Errors Must Defect").
        const trimmed = buffer.trim();
        if (trimmed.length > 0) {
          const chunk = yield* decodeChatChunk(trimmed).pipe(
            Effect.catchTags({ SchemaError: Effect.die }),
          );
          consumeChunk(state, chunk);
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) break;
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length === 0) continue;
        const chunk = yield* decodeChatChunk(line).pipe(
          Effect.catchTags({ SchemaError: Effect.die }),
        );
        consumeChunk(state, chunk);
      }
    }

    const result: OllamaChatResult = {
      content: state.content,
      toolCalls: state.toolCalls,
      usage: state.usage,
      doneReason: state.doneReason,
    };

    yield* Effect.annotateCurrentSpan({
      contentLength: result.content.length,
      toolCallCount: result.toolCalls.length,
      promptEvalCount: result.usage?.promptEvalCount,
      evalCount: result.usage?.evalCount,
      doneReason: result.doneReason,
    });

    return result;
  });

  const checkHealth = Effect.fn("OllamaClient.checkHealth")(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/api/version`, {
          signal: AbortSignal.timeout(5000),
        }),
      catch: (cause) => new OllamaTransportError({ cause: String(cause) }),
    });
    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new OllamaTransportError({ cause: String(cause) }),
      });
      return yield* new OllamaHealthCheckError({
        status: response.status,
        body,
      });
    }
  });

  return { model, baseUrl, chat, checkHealth } as const;
};
