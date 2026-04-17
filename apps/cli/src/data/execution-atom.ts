import { Effect, Option, Predicate, Stream } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as path from "node:path";
import {
  ExecutedPerfPlan,
  Executor,
  Git,
  Reporter,
  ReportStorage,
  type ExecuteOptions,
} from "@neuve/supervisor";
import { Analytics } from "@neuve/shared/observability";
import type { AgentBackend } from "@neuve/agent";
import type { AcpConfigOption, PerfReport, PlanId } from "@neuve/shared/models";
import { cliAtomRuntime } from "./runtime";
import { recentReportsAtom } from "./recent-reports-atom";
import { stripUndefinedRequirement } from "../utils/strip-undefined-requirement";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { extractCloseArtifacts } from "../utils/extract-close-artifacts";

const REPORTS_DIRECTORY = "reports";

interface ExecuteInput {
  readonly options: ExecuteOptions;
  readonly agentBackend: AgentBackend;
  readonly onUpdate: (executed: ExecutedPerfPlan) => void;
  readonly onConfigOptions?: (configOptions: readonly AcpConfigOption[]) => void;
}

export interface ExecutionResult {
  readonly executedPlan: ExecutedPerfPlan;
  readonly report: PerfReport;
  readonly videoUrl?: string;
  readonly reportPath: Option.Option<string>;
}

// HACK: atom is read by testing-screen.tsx but never populated — screenshots are saved via McpSession instead
export const screenshotPathsAtom = Atom.make<readonly string[]>([]);

const executeCore = (input: ExecuteInput) =>
  Effect.gen(function* () {
    const reporter = yield* Reporter;
    const reportStorage = yield* ReportStorage;
    const executor = yield* Executor;
    const analytics = yield* Analytics;
    const git = yield* Git;

    yield* Effect.logInfo("Execution starting", {
      agentBackend: input.agentBackend,
      instructionLength: input.options.instruction.length,
      changesFor: input.options.changesFor._tag,
    });

    const runStartedAt = Date.now();

    const executeOptions: ExecuteOptions = {
      ...input.options,
      onConfigOptions: input.onConfigOptions,
    };

    yield* analytics.capture("analysis:started");

    const finalExecuted = yield* executor.execute(executeOptions).pipe(
      Stream.tap((executed) =>
        Effect.sync(() => {
          input.onUpdate(executed);
        }),
      ),
      Stream.runLast,
      Effect.map((option) =>
        (option._tag === "Some"
          ? option.value
          : new ExecutedPerfPlan({
              ...input.options,
              id: "" as PlanId,
              changesFor: input.options.changesFor,
              currentBranch: "",
              diffPreview: "",
              fileStats: [],
              instruction: input.options.instruction,
              baseUrl: Option.none(),
              isHeadless: input.options.isHeadless,
              cookieBrowserKeys: input.options.cookieBrowserKeys,
              targetUrls: [],
              perfBudget: Option.none(),
              title: input.options.instruction,
              rationale: "Direct execution",
              steps: [],
              events: [],
            })
        )
          .finalizeTextBlock()
          .synthesizeRunFinished(),
      ),
    );

    const artifacts = extractCloseArtifacts(finalExecuted.events);

    // HACK: InsightEnricher is NOT wired here on purpose. It currently spawns its
    // own chrome-devtools-mcp subprocess via DevToolsClient.layer — separate from
    // the agent's subprocess where the trace was recorded — so every insightSetId
    // lookup would fail. Primary path for insight bodies is the agent itself
    // (buildLocalAgentSystemPrompt now mandates per-insight drill-ins). The enricher
    // scaffolding stays in tree for when shared-session lands.
    const report = yield* reporter.report(finalExecuted);

    const persisted = yield* reportStorage.saveSafe(report);
    const reportPath = Option.map(persisted, (value) =>
      path.join(REPORTS_DIRECTORY, path.basename(value.jsonPath)),
    );
    yield* Atom.refresh(recentReportsAtom);

    const passedCount = report.steps.filter(
      (step) => report.stepStatuses.get(step.id)?.status === "passed",
    ).length;
    const failedCount = report.steps.filter(
      (step) => report.stepStatuses.get(step.id)?.status === "failed",
    ).length;

    const durationMs = Date.now() - runStartedAt;

    yield* Effect.logInfo("Execution completed", {
      status: report.status,
      passedCount,
      failedCount,
      stepCount: finalExecuted.steps.length,
      durationMs,
    });

    yield* analytics.capture("analysis:completed", {
      passed: passedCount,
      failed: failedCount,
      step_count: finalExecuted.steps.length,
      file_count: 0,
      duration_ms: durationMs,
    });

    if (report.status === "passed") {
      yield* git.saveTestedFingerprint();
    }

    return {
      executedPlan: finalExecuted,
      report,
      videoUrl: artifacts.videoUrl,
      reportPath,
    } satisfies ExecutionResult;
  }).pipe(Effect.withSpan("perf-agent.session"));

export const executeFn = cliAtomRuntime.fn<ExecuteInput>()((input) =>
  stripUndefinedRequirement(executeCore(input).pipe(Effect.annotateLogs({ fn: "executeFn" }))).pipe(
    Effect.tapError((error) =>
      Effect.gen(function* () {
        const analytics = yield* Analytics;
        const errorTag =
          Predicate.isObject(error) && "_tag" in error && typeof error._tag === "string"
            ? error._tag
            : Predicate.isError(error)
              ? error.constructor.name
              : "UnknownError";
        yield* analytics.capture("analysis:failed", {
          error_tag: errorTag,
        });
      }).pipe(
        // HACK: analytics must never crash the run — swallow all failures from telemetry
        Effect.catchCause(() => Effect.void),
      ),
    ),
    Effect.provide(NodeServices.layer),
  ),
);
