import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import type { LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Executor, Git } from "@neuve/supervisor";
import { TokenUsageBus } from "@neuve/shared/token-usage-bus";
import { PlanDecomposer } from "../planning/plan-decomposer";
import type { PlannerMode } from "../planning/errors";
import { runRealTask, type RealRunContext } from "./real";
import { TraceRecorderFactory } from "./trace-recorder";
import { EvalRunError, type EvalRunner } from "./types";
import {
  GEMINI_REACT_DEFAULT_MODEL_ID,
  GEMINI_REACT_RUNNER_NAME,
} from "./gemini-react-constants";
import { makeGeminiAgentLayer } from "./gemini-agent";

export class GeminiReactConfigError extends Schema.ErrorClass<GeminiReactConfigError>(
  "GeminiReactConfigError",
)({
  _tag: Schema.tag("GeminiReactConfigError"),
  reason: Schema.String,
}) {
  message = `Gemini-react runner not configured: ${this.reason}. Set GOOGLE_GENERATIVE_AI_API_KEY in your shell (or a dotenv file loaded by perf-agent) before running the eval harness with the gemini-react runner.`;
}

// Gemini-react drives the ReAct loop the same way gemma-react does — Gemini
// owns plan authorship via PLAN_UPDATE envelopes. Pre-decomposition would
// short-circuit the very capability T5's regression sweep needs to measure
// for the A:B comparison.
const DEFAULT_PLANNER_MODE: PlannerMode = "gemma-react";
const DEFAULT_TRACE_DIR = "evals/traces";

export interface GeminiRunnerOptions {
  readonly model?: LanguageModel;
  readonly modelId?: string;
  readonly plannerMode?: PlannerMode;
  readonly rootDir?: string;
  readonly traceDir?: string;
  readonly isHeadless?: boolean;
  readonly evalBaseUrl?: string;
  /**
   * Override the runner identifier baked into trace filenames. Defaults to
   * "gemini-react". Useful when wiring up paired suites
   * (`gemini-react-strict`, `gemini-react-staging`, etc).
   */
  readonly runnerName?: string;
}

const translate =
  (runnerName: string, taskId: string) => (tag: string) => (error: { readonly message?: string }) =>
    new EvalRunError({
      runner: runnerName,
      taskId,
      cause: `${tag}: ${error.message ?? tag}`,
    }).asEffect();

const loadDefaultModel = Effect.gen(function* () {
  const apiKeyOption = yield* Config.option(Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY"));
  if (!Option.isSome(apiKeyOption)) {
    return yield* new GeminiReactConfigError({
      reason: "GOOGLE_GENERATIVE_AI_API_KEY is unset",
    });
  }
  const apiKey = Redacted.value(apiKeyOption.value);
  if (apiKey.trim().length === 0) {
    return yield* new GeminiReactConfigError({
      reason: "GOOGLE_GENERATIVE_AI_API_KEY is empty",
    });
  }
  const modelIdOption = yield* Config.option(Config.string("PERF_AGENT_GEMINI_REACT_MODEL"));
  const modelId = Option.isSome(modelIdOption)
    ? modelIdOption.value
    : GEMINI_REACT_DEFAULT_MODEL_ID;
  const provider = createGoogleGenerativeAI({ apiKey });
  yield* Effect.logInfo("Gemini-react default model loaded", { modelId });
  return { model: provider(modelId) satisfies LanguageModel, modelId } as const;
}).pipe(Effect.catchTag("ConfigError", Effect.die));

/**
 * makeGeminiRunner — drives the same supervisor pipeline as the real and
 * gemma runners, but with Gemini Flash 3 as the in-process LLM backend
 * running the ReAct loop. The runner is the **A:B baseline** for
 * gemma-react: it executes the identical agent contract (AgentTurn JSON
 * envelopes consumed by the supervisor's React reducer) so per-task score
 * deltas are attributable to the LLM, not the harness.
 *
 * Eval-only — never wired into the production CLI. The supervisor is
 * Gemma-only at runtime per the frontier-planner removal; this runner
 * exists exclusively under `@neuve/evals` for measurement and teacher-data
 * generation (R5-T4).
 *
 * Caller can pre-construct the `LanguageModel` (e.g. via
 * `MockLanguageModelV4` in tests) or omit it, in which case the runner
 * lazily resolves `GOOGLE_GENERATIVE_AI_API_KEY` + `PERF_AGENT_GEMINI_REACT_MODEL`.
 * If the key is missing, layer build still succeeds; the failure surfaces
 * on the first task as a `GeminiReactConfigError` so `none`/template eval
 * setups that don't actually run Gemini don't fail at startup.
 */
export const makeGeminiRunner = (options: GeminiRunnerOptions = {}): EvalRunner => {
  const runnerName = options.runnerName ?? GEMINI_REACT_RUNNER_NAME;
  const plannerMode = options.plannerMode ?? DEFAULT_PLANNER_MODE;
  const rootDir = options.rootDir ?? process.cwd();
  const traceDir = options.traceDir ?? DEFAULT_TRACE_DIR;
  const isHeadless = options.isHeadless ?? true;

  const modelLoader: Effect.Effect<
    { readonly model: LanguageModel; readonly modelId: string },
    GeminiReactConfigError
  > =
    options.model !== undefined
      ? Effect.succeed({
          model: options.model,
          modelId: options.modelId ?? GEMINI_REACT_DEFAULT_MODEL_ID,
        })
      : loadDefaultModel;

  const gitLayer = Git.withRepoRoot(rootDir);
  const planDecomposerLayer = PlanDecomposer.layer;
  const executorLayer = Executor.layer.pipe(Layer.provide(gitLayer));
  const baseRuntime = Layer.mergeAll(
    executorLayer,
    gitLayer,
    planDecomposerLayer,
    TraceRecorderFactory.layer,
  ).pipe(Layer.provideMerge(TokenUsageBus.layerRef));

  const context: RealRunContext = {
    runnerName,
    traceDir,
    plannerMode,
    isHeadless,
    baseUrl: options.evalBaseUrl,
  };

  const run = (task: import("../task").EvalTask) => {
    const toError = translate(runnerName, task.id);
    return Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        runner: runnerName,
        taskId: task.id,
        plannerMode,
      });

      const { model, modelId } = yield* modelLoader.pipe(
        Effect.catchTag("GeminiReactConfigError", (error) =>
          new EvalRunError({
            runner: runnerName,
            taskId: task.id,
            cause: `gemini-config: ${error.message}`,
          }).asEffect(),
        ),
      );

      const agentLayer = makeGeminiAgentLayer({ model, modelId });
      const runtimeLayer = baseRuntime.pipe(Layer.provideMerge(agentLayer));

      return yield* Effect.scoped(runRealTask(task, context)).pipe(
        Effect.provide(runtimeLayer),
        Effect.catchTags({
          DecomposeError: toError("plan-decomposer"),
          TraceWriteError: toError("trace-writer"),
          GeminiBrowserMcpResolutionError: toError("browser-mcp-bin-missing"),
          FindRepoRootError: toError("git-repo-root"),
        }),
      );
    }).pipe(Effect.withSpan("GeminiRunner.run"));
  };

  return {
    name: runnerName,
    run,
  } satisfies EvalRunner;
};
