import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Config, Effect, Layer, Schema, Scope, ServiceMap } from "effect";

/**
 * LlamaServerClient — R11 P5.5 OpenAI-compatible chat-completions
 * client backed by llama.cpp's `llama-server`. Built specifically for
 * the browsing-gemma-react eval lane per locked decision #9 in
 * `docs/research/distillation-pipeline/plan.md` (Ollama 0.22.0 doesn't
 * yet implement LoRA inference; llama-server does, via the `--lora`
 * CLI flag).
 *
 * Two operating modes:
 *
 * 1. **Spawn-per-eval** (default): the service `acquireRelease`s a
 *    `llama-server` subprocess scoped to the Effect scope. Server
 *    spawns on first `chat()` call, killed on scope close. Clean
 *    isolation between eval runs at the cost of model-load latency
 *    per run.
 *
 * 2. **Pre-running instance** (via env `PERF_AGENT_LLAMA_SERVER_URL`):
 *    the service skips the spawn and proxies HTTP requests at the
 *    given URL. Faster for dev workflows where you want one
 *    long-lived server.
 *
 * Wire format: OpenAI `/v1/chat/completions` (verified live via the
 * P5.5 sub-probe-zero, see
 * `docs/handover/distillation-pipeline/diary/r11-2026-04-30.md` §P5.5).
 */

const DEFAULT_PORT = 8090;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_BINARY = "llama-server";
const DEFAULT_NUM_GPU_LAYERS = 999;
const SERVER_READY_TIMEOUT_MS = 180_000;
const SERVER_READY_POLL_MS = 1_000;
const HTTP_REQUEST_TIMEOUT_MS = 600_000;

export class LlamaServerUnavailableError extends Schema.ErrorClass<LlamaServerUnavailableError>(
  "LlamaServerUnavailableError",
)({
  _tag: Schema.tag("LlamaServerUnavailableError"),
  binary: Schema.String,
  cause: Schema.String,
}) {
  message = `llama-server binary at ${this.binary} is not available (${this.cause}). Install via \`brew install llama.cpp\` (Apple Silicon) or build from https://github.com/ggml-org/llama.cpp.`;
}

export class LlamaServerNotReadyError extends Schema.ErrorClass<LlamaServerNotReadyError>(
  "LlamaServerNotReadyError",
)({
  _tag: Schema.tag("LlamaServerNotReadyError"),
  url: Schema.String,
  timeoutMs: Schema.Number,
}) {
  message = `llama-server at ${this.url} did not become ready within ${this.timeoutMs} ms. Check stdout for model-load errors.`;
}

export class LlamaServerHttpError extends Schema.ErrorClass<LlamaServerHttpError>(
  "LlamaServerHttpError",
)({
  _tag: Schema.tag("LlamaServerHttpError"),
  url: Schema.String,
  status: Schema.Number,
  body: Schema.String,
}) {
  message = `llama-server HTTP ${this.status} at ${this.url}: ${this.body.slice(0, 800)}`;
}

export class LlamaServerEmptyResponseError extends Schema.ErrorClass<LlamaServerEmptyResponseError>(
  "LlamaServerEmptyResponseError",
)({
  _tag: Schema.tag("LlamaServerEmptyResponseError"),
}) {
  message = `llama-server returned a chat completion with empty content + empty reasoning_content. Likely model-load issue or chat-template mismatch.`;
}

export class LlamaServerBaseModelMissingError extends Schema.ErrorClass<LlamaServerBaseModelMissingError>(
  "LlamaServerBaseModelMissingError",
)({
  _tag: Schema.tag("LlamaServerBaseModelMissingError"),
  baseModel: Schema.String,
}) {
  message = `Base model GGUF not found at ${this.baseModel}. Set PERF_AGENT_LLAMA_SERVER_MODEL to a local GGUF path or omit it to use --hf-repo.`;
}

// --- Wire schemas ---

const ChatChoiceMessage = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  reasoning_content: Schema.optional(Schema.NullOr(Schema.String)),
});

const ChatChoice = Schema.Struct({
  index: Schema.Number,
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
  message: ChatChoiceMessage,
});

const ChatUsage = Schema.Struct({
  prompt_tokens: Schema.optional(Schema.Number),
  completion_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
});

const ChatCompletion = Schema.Struct({
  choices: Schema.Array(ChatChoice),
  usage: Schema.optional(ChatUsage),
});

const decodeChatCompletion = Schema.decodeUnknownEffect(ChatCompletion);

// --- Public types ---

export type LlamaServerMessageRole = "system" | "user" | "assistant" | "tool";

export interface LlamaServerMessage {
  readonly role: LlamaServerMessageRole;
  readonly content: string;
}

export interface LlamaServerChatOptions {
  readonly messages: ReadonlyArray<LlamaServerMessage>;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly responseFormat?: unknown;
  readonly signal?: AbortSignal;
}

export interface LlamaServerChatResult {
  readonly content: string;
  readonly reasoningContent: string | undefined;
  readonly finishReason: string | undefined;
  readonly promptTokens: number | undefined;
  readonly completionTokens: number | undefined;
  readonly totalTokens: number | undefined;
}

interface ServerHandle {
  readonly url: string;
  readonly child?: ChildProcess;
}

const baseUrlConfig = Config.option(Config.string("PERF_AGENT_LLAMA_SERVER_URL"));
const portConfig = Config.int("PERF_AGENT_LLAMA_SERVER_PORT").pipe(
  Config.withDefault(DEFAULT_PORT),
);
const hostConfig = Config.string("PERF_AGENT_LLAMA_SERVER_HOST").pipe(
  Config.withDefault(DEFAULT_HOST),
);
const binaryConfig = Config.string("PERF_AGENT_LLAMA_SERVER_BINARY").pipe(
  Config.withDefault(DEFAULT_BINARY),
);
const baseModelConfig = Config.option(Config.string("PERF_AGENT_LLAMA_SERVER_MODEL"));
const baseModelHfConfig = Config.option(Config.string("PERF_AGENT_LLAMA_SERVER_HF_REPO"));
const loraConfig = Config.string("PERF_AGENT_LLAMA_SERVER_LORA");
const numGpuLayersConfig = Config.int("PERF_AGENT_LLAMA_SERVER_GPU_LAYERS").pipe(
  Config.withDefault(DEFAULT_NUM_GPU_LAYERS),
);

const probeReady = (url: string, signal?: AbortSignal): Promise<boolean> =>
  fetch(`${url}/health`, { signal })
    .then((response) => response.ok)
    .catch(() => false);

const waitUntilReady = Effect.fn("LlamaServerClient.waitUntilReady")(function* (url: string) {
  const start = Date.now();
  while (Date.now() - start < SERVER_READY_TIMEOUT_MS) {
    const ready = yield* Effect.promise(() => probeReady(url));
    if (ready) return;
    yield* Effect.sleep(`${SERVER_READY_POLL_MS} millis`);
  }
  return yield* new LlamaServerNotReadyError({ url, timeoutMs: SERVER_READY_TIMEOUT_MS });
});

const acquireSpawnedServer = Effect.fn("LlamaServerClient.acquireSpawnedServer")(function* (input: {
  readonly host: string;
  readonly port: number;
  readonly binary: string;
  readonly baseModelLocal: string | undefined;
  readonly baseModelHfRepo: string | undefined;
  readonly loraPath: string;
  readonly numGpuLayers: number;
}) {
  const args: string[] = ["--port", String(input.port), "--host", input.host, "--no-webui"];
  if (input.baseModelLocal !== undefined) {
    if (!fs.existsSync(input.baseModelLocal)) {
      return yield* new LlamaServerBaseModelMissingError({ baseModel: input.baseModelLocal });
    }
    args.push("--model", input.baseModelLocal);
  } else if (input.baseModelHfRepo !== undefined) {
    args.push("-hf", input.baseModelHfRepo);
  } else {
    return yield* new LlamaServerBaseModelMissingError({
      baseModel: "(neither PERF_AGENT_LLAMA_SERVER_MODEL nor PERF_AGENT_LLAMA_SERVER_HF_REPO set)",
    });
  }
  args.push("--lora", input.loraPath);
  args.push("--n-gpu-layers", String(input.numGpuLayers));

  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const proc = spawn(input.binary, args, { stdio: "pipe", env: process.env });
        return proc;
      },
      catch: (cause) =>
        new LlamaServerUnavailableError({
          binary: input.binary,
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
    (proc) =>
      Effect.sync(() => {
        if (proc.exitCode === null && !proc.killed) {
          proc.kill("SIGINT");
        }
      }),
  );

  const url = `http://${input.host}:${input.port}`;
  yield* waitUntilReady(url);
  return { url, child } satisfies ServerHandle;
});

const acquireServerHandle = Effect.fn("LlamaServerClient.acquireServerHandle")(function* () {
  const explicitUrl = yield* baseUrlConfig;
  if (explicitUrl._tag === "Some") {
    yield* Effect.logInfo("Using pre-running llama-server", { url: explicitUrl.value });
    return { url: explicitUrl.value } satisfies ServerHandle;
  }
  const port = yield* portConfig;
  const host = yield* hostConfig;
  const binary = yield* binaryConfig;
  const baseModelLocalOption = yield* baseModelConfig;
  const baseModelHfOption = yield* baseModelHfConfig;
  const loraPath = yield* loraConfig;
  const numGpuLayers = yield* numGpuLayersConfig;

  yield* Effect.logInfo("Spawning llama-server", {
    binary,
    port,
    host,
    baseModelLocal: baseModelLocalOption._tag === "Some" ? baseModelLocalOption.value : undefined,
    baseModelHfRepo: baseModelHfOption._tag === "Some" ? baseModelHfOption.value : undefined,
    loraPath,
    numGpuLayers,
  });

  return yield* acquireSpawnedServer({
    host,
    port,
    binary,
    baseModelLocal: baseModelLocalOption._tag === "Some" ? baseModelLocalOption.value : undefined,
    baseModelHfRepo: baseModelHfOption._tag === "Some" ? baseModelHfOption.value : undefined,
    loraPath,
    numGpuLayers,
  });
});

const sendChat = Effect.fn("LlamaServerClient.chat")(function* (
  url: string,
  options: LlamaServerChatOptions,
) {
  yield* Effect.annotateCurrentSpan({
    url,
    messageCount: options.messages.length,
    maxTokens: options.maxTokens,
  });
  const body: Record<string, unknown> = {
    messages: options.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
  if (options.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;
  if (options.temperature !== undefined) body["temperature"] = options.temperature;
  if (options.responseFormat !== undefined) body["response_format"] = options.responseFormat;

  const endpoint = `${url}/v1/chat/completions`;
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal ?? AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      }),
    catch: (cause) =>
      new LlamaServerHttpError({
        url: endpoint,
        status: -1,
        body: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (!response.ok) {
    const text = yield* Effect.promise(() => response.text());
    return yield* new LlamaServerHttpError({ url: endpoint, status: response.status, body: text });
  }
  const json = yield* Effect.promise(() => response.json());
  const decoded = yield* decodeChatCompletion(json).pipe(
    Effect.catchTags({ SchemaError: Effect.die }),
  );
  if (decoded.choices.length === 0) {
    return yield* new LlamaServerEmptyResponseError();
  }
  const choice = decoded.choices[0];
  const content = choice.message.content ?? "";
  const reasoningContent = choice.message.reasoning_content ?? undefined;
  if (
    content.trim().length === 0 &&
    (reasoningContent === undefined || reasoningContent.trim().length === 0)
  ) {
    return yield* new LlamaServerEmptyResponseError();
  }
  const usage = decoded.usage;
  return {
    content,
    reasoningContent: reasoningContent === null ? undefined : reasoningContent,
    finishReason: choice.finish_reason === null ? undefined : choice.finish_reason,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
  } satisfies LlamaServerChatResult;
});

export class LlamaServerClient extends ServiceMap.Service<
  LlamaServerClient,
  {
    readonly chat: (
      options: LlamaServerChatOptions,
    ) => Effect.Effect<
      LlamaServerChatResult,
      | LlamaServerUnavailableError
      | LlamaServerNotReadyError
      | LlamaServerHttpError
      | LlamaServerEmptyResponseError
      | LlamaServerBaseModelMissingError,
      Scope.Scope
    >;
  }
>()("@evals/LlamaServerClient", {
  make: Effect.gen(function* () {
    let handlePromise: Promise<ServerHandle> | undefined;
    const ensureHandle = Effect.fn("LlamaServerClient.ensureHandle")(function* () {
      if (handlePromise === undefined) {
        // Config reads can fail with ConfigError (env-var malformed). Die
        // — config errors are unrecoverable env-setup bugs per CLAUDE.md
        // "Unrecoverable Errors Must Defect."
        const handle = yield* acquireServerHandle().pipe(
          Effect.catchTags({ ConfigError: Effect.die }),
        );
        handlePromise = Promise.resolve(handle);
        return handle;
      }
      return yield* Effect.promise(() => handlePromise!);
    });
    const chat = Effect.fn("LlamaServerClient.chat")(function* (options: LlamaServerChatOptions) {
      const handle = yield* ensureHandle();
      return yield* sendChat(handle.url, options);
    });
    return { chat } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make);
}
