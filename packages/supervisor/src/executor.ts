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
  type ChangesFor,
  type ChangedFile,
  type CommitSummary,
  ExecutedPerfPlan,
  PlanId,
  RunStarted,
  type SavedFlow,
  PerfPlan,
} from "@neuve/shared/models";
import {
  buildExecutionPrompt,
  buildExecutionSystemPrompt,
  type DevServerHint,
} from "@neuve/shared/prompts";
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
import { PlanDecomposer } from "./plan-decomposer";
import { DecomposeError, type PlannerMode } from "./errors";

export class ExecutionError extends Schema.ErrorClass<ExecutionError>("@supervisor/ExecutionError")(
  {
    _tag: Schema.tag("ExecutionError"),
    reason: Schema.Union([
      AcpStreamError,
      AcpSessionCreateError,
      AcpProviderUnauthenticatedError,
      AcpProviderUsageLimitError,
      DecomposeError,
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
  readonly plannerMode?: PlannerMode;
}

interface ExecutorAccumState {
  readonly plan: ExecutedPerfPlan;
  readonly allTerminalSince: number | undefined;
}

const resolveTerminalTimestamp = (executed: ExecutedPerfPlan, previous: number | undefined) => {
  if (!executed.allStepsTerminal) return undefined;
  return previous ?? Date.now();
};

export class Executor extends ServiceMap.Service<Executor>()("@supervisor/Executor", {
  make: Effect.gen(function* () {
    const agent = yield* Agent;
    const git = yield* Git;
    const planDecomposer = yield* PlanDecomposer;

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

      const plannerMode: PlannerMode = options.plannerMode ?? "none";

      const decomposedPlan =
        plannerMode === "none"
          ? undefined
          : yield* planDecomposer
              .decompose(options.instruction, plannerMode, {
                changesFor: options.changesFor,
                currentBranch: context.currentBranch,
                diffPreview: context.diffPreview,
                baseUrl: options.baseUrl,
                isHeadless: options.isHeadless,
                cookieBrowserKeys: options.cookieBrowserKeys,
              })
              .pipe(
                Effect.catchTag("DecomposeError", (error) =>
                  new ExecutionError({ reason: error }).asEffect(),
                ),
              );

      const initialPlan =
        decomposedPlan ??
        new PerfPlan({
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
          rationale: "Direct execution",
          steps: [],
        });

      yield* Effect.logInfo("Execution plan prepared", {
        planId: initialPlan.id,
        plannerMode,
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
        Stream.mapAccum(
          (): ExecutorAccumState => ({
            plan: initial,
            allTerminalSince: undefined,
          }),
          (state, part) => {
            const updated = state.plan.addEvent(part);
            const terminalTimestamp = resolveTerminalTimestamp(updated, state.allTerminalSince);
            const finalized =
              terminalTimestamp !== undefined &&
              !updated.hasRunFinished &&
              Date.now() - terminalTimestamp >= ALL_STEPS_TERMINAL_GRACE_MS
                ? updated.synthesizeRunFinished()
                : updated;

            return [{ plan: finalized, allTerminalSince: terminalTimestamp }, [finalized]] as const;
          },
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
