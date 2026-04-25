import { ConfigProvider, Effect, Layer } from "effect";
import { Agent } from "@neuve/agent";
import { Executor, Git } from "@neuve/supervisor";
import { TokenUsageBus } from "@neuve/shared/token-usage-bus";
import type { EvalTask } from "../task";
import { PlanDecomposer } from "../planning/plan-decomposer";
import type { PlannerMode } from "../planning/errors";
import { runRealTask, type RealRunContext } from "./real";
import { TraceRecorderFactory } from "./trace-recorder";
import { EvalRunError, type EvalRunner } from "./types";

// Re-exported from `runner-names.ts` so this heavyweight module stays the
// canonical "import this for `makeGemmaRunner`" entry point while the
// lightweight string constants are also reachable from the `aggregate.ts`
// scripts without dragging this file's full dependency graph.
export { GEMMA_RUNNER_NAME, GEMMA_REACT_RUNNER_NAME } from "./runner-names";
import { GEMMA_RUNNER_NAME } from "./runner-names";

export const GEMMA_DEFAULT_MODEL = "gemma4:e4b";
export const GEMMA_DEFAULT_BASE_URL = "http://localhost:11434/v1/";
// Production default: Gemma owns plan authorship via PLAN_UPDATE envelopes
// inside the ReAct loop (R3+R4 wiring). PRD §R5 line 276 + project_react_migration_plan.md
// flip target. Legacy `template` and `oracle-plan` modes stay reachable via
// the option override + the `gemma-oracle-plan` debug runner.
const DEFAULT_PLANNER_MODE: PlannerMode = "gemma-react";
const DEFAULT_TRACE_DIR = "evals/traces";

export interface GemmaRunnerOptions {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly plannerMode?: PlannerMode;
  readonly rootDir?: string;
  readonly traceDir?: string;
  readonly isHeadless?: boolean;
  readonly evalBaseUrl?: string;
  /**
   * Runner identifier used in trace filenames, log annotations, and the
   * scoreboard column. Defaults to GEMMA_RUNNER_NAME ("gemma"). The
   * gemma-oracle-plan debug runner overrides this to keep its trace files
   * separate from the production gemma runner so A:B regressions can compare
   * them side-by-side.
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

/**
 * makeGemmaRunner — drives the same supervisor pipeline as the real runner but
 * with the @neuve/local-agent (Ollama + Gemma) as the ACP backend. The local
 * agent's own Ollama preflight lives in AcpAdapter.layerLocal — this runner
 * just surfaces its AcpConnectionInitError as an EvalRunError so the eval
 * scoreboard shows the same "start Ollama" / "pull the model" remediation
 * the CLI would show its user.
 *
 * The model + base URL flow into AcpAdapter.layerLocal's
 * `Config.string("PERF_AGENT_LOCAL_MODEL")` / `"PERF_AGENT_OLLAMA_URL"` via a
 * scoped ConfigProvider overlay — no process.env mutation.
 */
export const makeGemmaRunner = (options: GemmaRunnerOptions = {}): EvalRunner => {
  const runnerName = options.runnerName ?? GEMMA_RUNNER_NAME;
  const model = options.model ?? GEMMA_DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? GEMMA_DEFAULT_BASE_URL;
  const plannerMode = options.plannerMode ?? DEFAULT_PLANNER_MODE;
  const rootDir = options.rootDir ?? process.cwd();
  const traceDir = options.traceDir ?? DEFAULT_TRACE_DIR;
  const isHeadless = options.isHeadless ?? true;

  const agentLayer = Agent.layerLocal;
  const gitLayer = Git.withRepoRoot(rootDir);
  const planDecomposerLayer = PlanDecomposer.layer;
  const executorLayer = Executor.layer.pipe(Layer.provide(gitLayer));
  // See `real.ts`: TokenUsageBus is provided at the root so both PlanDecomposer
  // and Executor publish into the same per-task buffer and `runRealTask` can
  // drain it after the stream terminates.
  const runtimeLayer = Layer.mergeAll(
    executorLayer,
    gitLayer,
    planDecomposerLayer,
    TraceRecorderFactory.layer,
  ).pipe(Layer.provideMerge(agentLayer), Layer.provideMerge(TokenUsageBus.layerRef));

  const gemmaConfigOverlay = ConfigProvider.fromUnknown({
    PERF_AGENT_LOCAL_MODEL: model,
    PERF_AGENT_OLLAMA_URL: baseUrl,
  });
  const configProviderLayer = ConfigProvider.layerAdd(gemmaConfigOverlay, { asPrimary: true });

  const context: RealRunContext = {
    runnerName,
    traceDir,
    plannerMode,
    isHeadless,
    baseUrl: options.evalBaseUrl,
  };

  const run = (task: EvalTask) => {
    const toError = translate(runnerName, task.id);
    return Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        runner: runnerName,
        taskId: task.id,
        model,
        plannerMode,
      });
      return yield* Effect.scoped(runRealTask(task, context)).pipe(
        Effect.provide(runtimeLayer),
        Effect.provide(configProviderLayer),
        Effect.catchTags({
          DecomposeError: toError("plan-decomposer"),
          TraceWriteError: toError("trace-writer"),
          AcpProviderNotInstalledError: toError("agent-not-installed"),
          AcpConnectionInitError: toError("agent-connection-init"),
          FindRepoRootError: toError("git-repo-root"),
          PlatformError: toError("platform"),
          ConfigError: toError("config"),
        }),
      );
    }).pipe(Effect.withSpan("GemmaRunner.run"));
  };

  return {
    name: runnerName,
    run,
  } satisfies EvalRunner;
};
