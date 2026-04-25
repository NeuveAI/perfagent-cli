import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import type { LanguageModel } from "ai";
import {
  Agent,
  AcpStreamError,
  AcpSessionCreateError,
  type AgentStreamOptions,
  type SessionId,
} from "@neuve/agent";
import {
  type AcpConfigOption,
  type AcpSessionUpdate,
} from "@neuve/shared/models";
import { buildLocalAgentSystemPrompt } from "@neuve/shared/prompts";
import { createMcpBridge } from "@neuve/local-agent/mcp-bridge";
import { runGeminiReactLoop, GeminiReactCallError } from "./gemini-react-loop";

export class GeminiBrowserMcpResolutionError extends Schema.ErrorClass<GeminiBrowserMcpResolutionError>(
  "GeminiBrowserMcpResolutionError",
)({
  _tag: Schema.tag("GeminiBrowserMcpResolutionError"),
  reason: Schema.String,
}) {
  message = `Cannot locate browser-mcp.js bundle for the gemini-react runner: ${this.reason}. Build the CLI first with \`pnpm --filter perf-agent-cli build\` so apps/cli/dist/browser-mcp.js exists.`;
}

const BROWSER_MCP_RELATIVE_FROM_AGENT_PACKAGE =
  "../../../apps/cli/dist/browser-mcp.js";
const BROWSER_MCP_WORKSPACE_WALKUP_LIMIT = 8;

const resolveBrowserMcpBin = Effect.fn("GeminiAgent.resolveBrowserMcpBin")(function* () {
  const baseUrl = new URL(import.meta.url);
  const candidate = fileURLToPath(
    new URL(`../../${BROWSER_MCP_RELATIVE_FROM_AGENT_PACKAGE}`, baseUrl),
  );
  if (fs.existsSync(candidate)) return candidate;
  let cursor = path.dirname(fileURLToPath(baseUrl));
  for (let depth = 0; depth < BROWSER_MCP_WORKSPACE_WALKUP_LIMIT; depth++) {
    const guess = path.join(cursor, "apps", "cli", "dist", "browser-mcp.js");
    if (fs.existsSync(guess)) return guess;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return yield* new GeminiBrowserMcpResolutionError({
    reason: `tried ${candidate} and walked up from ${path.dirname(fileURLToPath(baseUrl))}`,
  });
});

const acquireMcpBridge = Effect.fn("GeminiAgent.acquireMcpBridge")(function* (
  binPath: string,
  mcpEnv: ReadonlyArray<{ readonly name: string; readonly value: string }>,
) {
  const env: Record<string, string> = {};
  for (const entry of mcpEnv) {
    env[entry.name] = entry.value;
  }
  return yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        createMcpBridge({
          browser: {
            command: process.execPath,
            args: [binPath],
            env,
          },
        }),
      catch: (cause) =>
        new AcpStreamError({
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
    // Per CLAUDE.md "Never Swallow Errors" — bridge.close() spawns a stdio
    // child via `process.execPath`; a hung close during the 60-eval sweep
    // would leak zombie processes silently. Wrap the close in
    // `Effect.tryPromise` so a transport-level rejection turns into a
    // typed Effect error, then log it as a warning rather than failing
    // the surrounding scope (close is best-effort during teardown — we
    // don't want a teardown error to block the next task in the sweep,
    // but it should be visible in the log file for triage).
    (bridge) =>
      Effect.tryPromise({
        try: () => bridge.close(),
        catch: (cause) =>
          new AcpStreamError({
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
      }).pipe(
        Effect.catchTag("AcpStreamError", (error) =>
          Effect.logWarning("McpBridge close error during gemini-agent teardown", {
            cause: error.message,
          }),
        ),
      ),
  );
});

const generateSessionIdString = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

interface MakeGeminiAgentLayerOptions {
  readonly model: LanguageModel;
  readonly modelId: string;
}

/**
 * Builds an in-process Agent ServiceMap layer backed by Gemini Flash 3 (or
 * any LanguageModel). The supervisor's executor consumes the standard
 * AcpSessionUpdate stream — same wire shape as the local-agent ACP path —
 * so the React reducer, budget monitor, and adherence gate operate
 * unchanged.
 *
 * Lifecycle per `stream()` call:
 *   1. `Stream.callback` opens a managed scope for the call. Inside, we
 *      acquire a fresh McpBridge (spawns browser-mcp via stdio) under the
 *      scope so its release fires when the consumer terminates the stream.
 *   2. Run the Gemini-react loop inline (no fork — Stream.callback owns the
 *      lifetime). Updates push into the queue parameter; consumer drains.
 *   3. On loop completion or failure, the queue closes automatically; the
 *      McpBridge release runs in the scope's finalizer.
 *
 * The only subprocess is browser-mcp; Gemini calls go straight from this
 * process to Google's API. Same MCP tools, same wrapper-key auto-wrap as
 * the gemma runner via `@neuve/local-agent/mcp-bridge`.
 */
export const makeGeminiAgentLayer = ({
  model,
  modelId,
}: MakeGeminiAgentLayerOptions): Layer.Layer<Agent, GeminiBrowserMcpResolutionError> =>
  Layer.effect(Agent)(
    Effect.gen(function* () {
      const browserMcpBin = yield* resolveBrowserMcpBin();
      yield* Effect.logInfo("Gemini-react agent ready", { modelId, browserMcpBin });

      const stream = (options: AgentStreamOptions) =>
        Stream.callback<AcpSessionUpdate, AcpStreamError>((queue) =>
          Effect.gen(function* () {
            const sessionId = Option.match(options.sessionId, {
              onNone: () => generateSessionIdString(),
              onSome: (id) => id,
            });

            const mcpEnv: ReadonlyArray<{ readonly name: string; readonly value: string }> =
              options.mcpEnv ?? [];

            const mcpBridge = yield* acquireMcpBridge(browserMcpBin, mcpEnv);

            const systemPrompt = Option.match(options.systemPrompt, {
              onNone: () => buildLocalAgentSystemPrompt(),
              onSome: (value) => value,
            });

            yield* Effect.logInfo("Gemini-react session started", {
              sessionId,
              modelId,
              promptLength: options.prompt.length,
              mcpEnvCount: mcpEnv.length,
              toolCount: mcpBridge.listTools().length,
            });

            yield* runGeminiReactLoop({
              sessionId,
              model,
              mcpBridge,
              systemPrompt,
              userPrompt: options.prompt,
              modelId,
              emit: (update: AcpSessionUpdate) => {
                Queue.offerUnsafe(queue, update);
              },
            }).pipe(
              Effect.catchTag("GeminiReactCallError", (error) =>
                new AcpStreamError({ cause: error.message }).asEffect(),
              ),
            );
          }),
        );

      const createSession = (_cwd: string) =>
        Effect.sync(() => generateSessionIdString() as SessionId).pipe(
          Effect.tap((sessionId) =>
            Effect.logInfo("Gemini-react session id allocated", { sessionId }),
          ),
        );

      const setConfigOption = (
        _sessionId: SessionId,
        _configId: string,
        _value: string | boolean,
      ) =>
        new AcpStreamError({
          cause: "Gemini-react agent does not expose ACP config options",
        }).asEffect();

      const fetchConfigOptions = (_cwd: string) =>
        Effect.succeed([] as readonly AcpConfigOption[]) as Effect.Effect<
          readonly AcpConfigOption[],
          AcpSessionCreateError
        >;

      return Agent.of({ stream, createSession, setConfigOption, fetchConfigOptions });
    }),
  );

export { GeminiReactCallError } from "./gemini-react-loop";
