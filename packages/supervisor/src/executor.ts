import {
  AcpProviderUnauthenticatedError,
  AcpProviderUsageLimitError,
  AcpSessionCreateError,
  AcpStreamError,
  Agent,
  AgentStreamOptions,
} from "@neuve/agent";
import { Effect, Layer, Option, Schema, ServiceMap, Stream } from "effect";
import {
  type AcpConfigOption,
  type AnalysisStep,
  type ChangesFor,
  type ChangedFile,
  type CommitSummary,
  ExecutedPerfPlan,
  PlanId,
  RunStarted,
  type SavedFlow,
  PerfPlan,
  type ExecutionEvent,
} from "@neuve/shared/models";
import {
  buildExecutionPrompt,
  buildExecutionSystemPrompt,
  type DevServerHint,
} from "@neuve/shared/prompts";
import { TokenUsageBus, TokenUsageEntry } from "@neuve/shared/token-usage-bus";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Git } from "./git/git";
import {
  PERF_AGENT_COOKIE_BROWSERS_ENV_NAME,
  PERF_AGENT_CDP_URL_ENV_NAME,
  PERF_AGENT_BASE_URL_ENV_NAME,
  PERF_AGENT_HEADED_ENV_NAME,
  PERF_AGENT_PROFILE_ENV_NAME,
} from "@neuve/devtools/mcp";
import {
  ALL_STEPS_TERMINAL_GRACE_MS,
  EXECUTION_CONTEXT_FILE_LIMIT,
  EXECUTION_RECENT_COMMIT_LIMIT,
} from "./constants";

export class ExecutionError extends Schema.ErrorClass<ExecutionError>("@supervisor/ExecutionError")(
  {
    _tag: Schema.tag("ExecutionError"),
    reason: Schema.Union([
      AcpStreamError,
      AcpSessionCreateError,
      AcpProviderUnauthenticatedError,
      AcpProviderUsageLimitError,
    ]),
  },
) {
  displayName = this.reason.displayName ?? `Performance analysis failed`;
  message = this.reason.message;
}

export interface ExecuteOptions {
  readonly changesFor: ChangesFor;
  readonly instruction: string;
  readonly isHeadless: boolean;
  readonly cookieBrowserKeys: readonly string[];
  readonly baseUrl?: string;
  readonly cdpUrl?: string;
  readonly profileName?: string;
  readonly savedFlow?: SavedFlow;
  readonly learnings?: string;
  readonly onConfigOptions?: (configOptions: readonly AcpConfigOption[]) => void;
  readonly modelPreference?: { configId: string; value: string };
  readonly devServerHints?: readonly DevServerHint[];
  /**
   * Pre-decomposed plan steps for the Executor to seed its initial plan with.
   * Runtime callers always omit this — Gemma plans and executes in a single
   * loop. Only the @neuve/evals A:B harness uses this to feed an oracle plan
   * decomposed upstream of `execute`.
   */
  readonly initialSteps?: readonly AnalysisStep[];
}

interface ExecutorAccumState {
  readonly plan: ExecutedPerfPlan;
  readonly allTerminalSince: number | undefined;
}

const resolveTerminalTimestamp = (executed: ExecutedPerfPlan, previous: number | undefined) => {
  if (!executed.allStepsTerminal) return undefined;
  return previous ?? Date.now();
};

const countNewRunFinished = (previous: ExecutedPerfPlan, next: ExecutedPerfPlan): number => {
  let previousCount = 0;
  for (const event of previous.events) {
    if (event._tag === "RunFinished") previousCount++;
  }
  let nextCount = 0;
  for (const event of next.events) {
    if (event._tag === "RunFinished") nextCount++;
  }
  return nextCount - previousCount;
};

const stripRunFinished = (plan: ExecutedPerfPlan): ExecutedPerfPlan =>
  new ExecutedPerfPlan({
    ...plan,
    events: plan.events.filter((event) => event._tag !== "RunFinished"),
  });

const runFinishedSatisfiesGate = (plan: ExecutedPerfPlan): boolean => {
  const lastRunFinished = [...plan.events]
    .reverse()
    .find(
      (event): event is Extract<ExecutionEvent, { _tag: "RunFinished" }> =>
        event._tag === "RunFinished",
    );
  if (!lastRunFinished) return false;
  if (lastRunFinished.abort !== undefined) return true;
  return plan.allPlanStepsTerminal;
};

export class Executor extends ServiceMap.Service<Executor>()("@supervisor/Executor", {
  make: Effect.gen(function* () {
    const agent = yield* Agent;
    const git = yield* Git;
    const tokenUsageBus = yield* TokenUsageBus;

    const gatherContext = Effect.fn("Executor.gatherContext")(function* (changesFor: ChangesFor) {
      yield* Effect.annotateCurrentSpan({ changesFor: changesFor._tag });

      const currentBranch = yield* git.getCurrentBranch;
      const mainBranch = yield* git.getMainBranch;
      const changedFiles = yield* git.getChangedFiles(changesFor);
      const diffPreview = yield* git.getDiffPreview(changesFor);

      const commitRange =
        changesFor._tag === "Branch" || changesFor._tag === "Changes"
          ? `${changesFor.mainBranch}..HEAD`
          : changesFor._tag === "Commit"
            ? `-1 ${changesFor.hash}`
            : `HEAD~${EXECUTION_RECENT_COMMIT_LIMIT}..HEAD`;

      const recentCommits = yield* git.getRecentCommits(commitRange);

      yield* Effect.logDebug("Execution context gathered", {
        currentBranch,
        mainBranch,
        changedFileCount: changedFiles.length,
        commitCount: recentCommits.length,
        diffPreviewLength: diffPreview.length,
      });

      return {
        currentBranch,
        mainBranch,
        changedFiles: changedFiles.slice(0, EXECUTION_CONTEXT_FILE_LIMIT) as ChangedFile[],
        recentCommits: recentCommits.slice(0, EXECUTION_RECENT_COMMIT_LIMIT) as CommitSummary[],
        diffPreview,
      };
    });

    const execute = Effect.fn("Executor.execute")(function* (options: ExecuteOptions) {
      yield* Effect.annotateCurrentSpan({
        changesFor: options.changesFor._tag,
        isHeadless: options.isHeadless,
      });
      yield* Effect.logInfo("Execution started", {
        instructionLength: options.instruction.length,
        changesFor: options.changesFor._tag,
        isHeadless: options.isHeadless,
        cookieBrowserCount: options.cookieBrowserKeys.length,
      });

      const context = yield* gatherContext(options.changesFor);

      const systemPrompt = buildExecutionSystemPrompt();

      const prompt = buildExecutionPrompt({
        userInstruction: options.instruction,
        scope: options.changesFor._tag,
        currentBranch: context.currentBranch,
        mainBranch: context.mainBranch,
        changedFiles: context.changedFiles,
        recentCommits: context.recentCommits,
        diffPreview: context.diffPreview,
        baseUrl: options.baseUrl,
        isHeadless: options.isHeadless,
        cookieBrowserKeys: options.cookieBrowserKeys,
        savedFlow: options.savedFlow,
        learnings: options.learnings,
        devServerHints: options.devServerHints,
      });

      const initialSteps = options.initialSteps ?? [];

      const initialPlan = new PerfPlan({
        id: PlanId.makeUnsafe(crypto.randomUUID()),
        changesFor: options.changesFor,
        currentBranch: context.currentBranch,
        diffPreview: context.diffPreview,
        fileStats: [],
        instruction: options.instruction,
        baseUrl: options.baseUrl ? Option.some(options.baseUrl) : Option.none(),
        isHeadless: options.isHeadless,
        cookieBrowserKeys: options.cookieBrowserKeys,
        targetUrls: [],
        perfBudget: Option.none(),
        title: options.instruction,
        rationale: initialSteps.length > 0 ? "Seeded with pre-decomposed steps" : "Direct execution",
        steps: initialSteps,
      });

      yield* Effect.logInfo("Execution plan prepared", {
        planId: initialPlan.id,
        stepCount: initialPlan.steps.length,
      });

      const initial = new ExecutedPerfPlan({
        ...initialPlan,
        events: [new RunStarted({ plan: initialPlan })],
      });

      const mcpEnv: Array<{ name: string; value: string }> = [];
      if (options.cdpUrl) {
        mcpEnv.push({ name: PERF_AGENT_CDP_URL_ENV_NAME, value: options.cdpUrl });
      }
      if (options.baseUrl) {
        mcpEnv.push({ name: PERF_AGENT_BASE_URL_ENV_NAME, value: options.baseUrl });
      }
      mcpEnv.push({
        name: PERF_AGENT_HEADED_ENV_NAME,
        value: options.isHeadless ? "false" : "true",
      });
      if (options.profileName) {
        mcpEnv.push({ name: PERF_AGENT_PROFILE_ENV_NAME, value: options.profileName });
      }
      if (options.cookieBrowserKeys.length > 0) {
        mcpEnv.push({
          name: PERF_AGENT_COOKIE_BROWSERS_ENV_NAME,
          value: options.cookieBrowserKeys.join(","),
        });
      }

      yield* Effect.logInfo("Agent stream starting", {
        planId: initialPlan.id,
        promptLength: prompt.length,
        mcpEnvCount: mcpEnv.length,
      });

      const streamOptions = new AgentStreamOptions({
        cwd: process.cwd(),
        sessionId: Option.none(),
        prompt,
        systemPrompt: Option.some(systemPrompt),
        mcpEnv,
        modelPreference: options.modelPreference,
      });

      return agent.stream(streamOptions).pipe(
        Stream.tap((update) => {
          const callback = options.onConfigOptions;
          if (update.sessionUpdate === "config_option_update" && callback) {
            return Effect.sync(() => callback(update.configOptions));
          }
          return Effect.void;
        }),
        Stream.tap((update) => {
          // Executor tokens stream in-band via the ACP `usage_update` extension
          // the local-agent (Ollama + Gemma) emits after every chat completion.
          // Per-call prompt/completion split lives in `_meta` (ACP standard
          // extensibility channel). Other ACP adapters (Gemini CLI / Claude
          // Code / etc.) leave these absent — in that case we publish nothing,
          // keeping tokenomics a Gemma-specific signal per the
          // baseline-measurement scope.
          if (update.sessionUpdate !== "usage_update") return Effect.void;
          const promptTokens = update.promptTokens;
          const completionTokens = update.completionTokens;
          if (promptTokens === undefined && completionTokens === undefined) return Effect.void;
          const resolvedPrompt = promptTokens ?? 0;
          const resolvedCompletion = completionTokens ?? 0;
          const totalTokens = update.totalTokens ?? resolvedPrompt + resolvedCompletion;
          return tokenUsageBus.publish(
            new TokenUsageEntry({
              source: "executor",
              promptTokens: resolvedPrompt,
              completionTokens: resolvedCompletion,
              totalTokens,
              timestamp: Date.now(),
            }),
          );
        }),
        Stream.mapAccumEffect(
          (): ExecutorAccumState => ({
            plan: initial,
            allTerminalSince: undefined,
          }),
          (state, part) =>
            Effect.gen(function* () {
              const updated = state.plan.addEvent(part);
              const terminalTimestamp = resolveTerminalTimestamp(updated, state.allTerminalSince);
              const withGrace =
                terminalTimestamp !== undefined &&
                !updated.hasRunFinished &&
                Date.now() - terminalTimestamp >= ALL_STEPS_TERMINAL_GRACE_MS
                  ? updated.synthesizeRunFinished()
                  : updated;

              const newRunFinished = countNewRunFinished(state.plan, withGrace);
              if (newRunFinished > 0 && !runFinishedSatisfiesGate(withGrace)) {
                const terminalSteps = withGrace.steps.filter(
                  (step) =>
                    step.status === "passed" ||
                    step.status === "failed" ||
                    step.status === "skipped",
                ).length;
                const remainingSteps = withGrace.steps.length - terminalSteps;
                yield* Effect.logWarning("premature-run-completed", {
                  planId: withGrace.id,
                  totalSteps: withGrace.steps.length,
                  terminalSteps,
                  remainingSteps,
                });
                const filtered = stripRunFinished(withGrace);
                return [
                  { plan: filtered, allTerminalSince: terminalTimestamp },
                  [filtered],
                ] as const;
              }

              return [
                { plan: withGrace, allTerminalSince: terminalTimestamp },
                [withGrace],
              ] as const;
            }),
        ),
        Stream.takeUntil((executed) => executed.hasRunFinished),
        Stream.mapError((reason) => new ExecutionError({ reason })),
      );
    }, Stream.unwrap);

    return { execute } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(NodeServices.layer));
}
