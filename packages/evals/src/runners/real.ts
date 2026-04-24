import { Effect, Layer, Option, Schema, Stream } from "effect";
import { Agent, type AgentBackend } from "@neuve/agent";
import { Executor, Git } from "@neuve/supervisor";
import { ChangesFor, type ExecutedPerfPlan, type ExecutionEvent } from "@neuve/shared/models";
import { TokenUsageBus, TokenUsageEntry } from "@neuve/shared/token-usage-bus";
import { PlanDecomposer } from "../planning/plan-decomposer";
import type { PlannerMode } from "../planning/errors";
import { ExecutedTrace, KeyNode, ToolCall, type EvalTask } from "../task";
import { EvalRunError, type EvalRunner } from "./types";
import {
  TraceRecorderFactory,
  TraceWriteError,
  buildTracePath,
  type StatusMarkerLabel,
  type TraceEvent,
} from "./trace-recorder";
import { keyNodeMatches } from "../scorers/key-node-matches";
import { extractUrlFromToolInput, extractUrlFromToolResult } from "./url-extraction";

export interface RealRunnerOptions {
  readonly agentBackend: AgentBackend;
  readonly plannerMode?: PlannerMode;
  readonly rootDir?: string;
  readonly traceDir?: string;
  readonly isHeadless?: boolean;
  readonly baseUrl?: string;
}

export interface RealRunContext {
  readonly runnerName: string;
  readonly traceDir: string;
  readonly plannerMode: PlannerMode;
  readonly isHeadless: boolean;
  readonly baseUrl?: string;
}

const DEFAULT_PLANNER_MODE: PlannerMode = "oracle-plan";
const DEFAULT_TRACE_DIR = "evals/traces";

const UnknownJsonShape = Schema.fromJsonString(Schema.Unknown);
const decodeJsonOption = Schema.decodeUnknownOption(UnknownJsonShape);

const isWellFormedToolCall = (toolName: string, input: unknown): boolean => {
  if (typeof toolName !== "string" || toolName.length === 0) return false;
  if (typeof input !== "string" || input.length === 0) return false;
  return Option.isSome(decodeJsonOption(input));
};

const diffEvents = (
  previous: ExecutedPerfPlan | undefined,
  next: ExecutedPerfPlan,
): readonly ExecutionEvent[] => {
  const previousCount = previous?.events.length ?? 0;
  return next.events.slice(previousCount);
};

const statusMarkerForEvent = (
  event: ExecutionEvent,
): { readonly marker: StatusMarkerLabel; readonly payload: unknown } | undefined => {
  switch (event._tag) {
    case "StepStarted":
      return { marker: "STEP_START", payload: [event.stepId, event.title] };
    case "StepCompleted":
      return { marker: "STEP_DONE", payload: [event.stepId, event.summary] };
    case "StepFailed":
      return {
        marker: "ASSERTION_FAILED",
        payload: [event.stepId, event.message, event.category ?? null, event.abortReason ?? null],
      };
    case "StepSkipped":
      return { marker: "STEP_SKIPPED", payload: [event.stepId, event.reason] };
    case "RunFinished":
      return { marker: "RUN_COMPLETED", payload: [event.status, event.summary] };
    default:
      return undefined;
  }
};

interface RunAccumulator {
  readonly turn: number;
  readonly toolCallIndex: number;
  readonly recordedToolCalls: ReadonlyArray<ToolCall>;
  readonly reachedUrls: ReadonlyArray<string>;
  readonly lastRunFinished:
    | { readonly status: "passed" | "failed"; readonly summary: string }
    | undefined;
  readonly lastSnapshot: ExecutedPerfPlan | undefined;
}

const INITIAL_ACC: RunAccumulator = {
  turn: 0,
  toolCallIndex: 0,
  recordedToolCalls: [],
  reachedUrls: [],
  lastRunFinished: undefined,
  lastSnapshot: undefined,
};

const buildReachedKeyNodes = (
  reachedUrls: ReadonlyArray<string>,
  expected: ReadonlyArray<KeyNode>,
): ReadonlyArray<KeyNode> => {
  const reached: KeyNode[] = [];
  for (const expectedNode of expected) {
    const matchedUrl = reachedUrls.find((url) => {
      const candidate = new KeyNode({
        urlPattern: url,
        domAssertion: expectedNode.domAssertion,
        perfCapture: expectedNode.perfCapture,
      });
      return keyNodeMatches(candidate, expectedNode);
    });
    if (matchedUrl !== undefined) {
      reached.push(
        new KeyNode({
          urlPattern: expectedNode.urlPattern,
          domAssertion: expectedNode.domAssertion,
          perfCapture: expectedNode.perfCapture,
        }),
      );
    }
  }
  return reached;
};

const finalUrlFromReached = (reachedUrls: ReadonlyArray<string>): string =>
  reachedUrls.length === 0 ? "" : reachedUrls[reachedUrls.length - 1];

const padToolCallId = (index: number): string => `tc-${String(index).padStart(3, "0")}`;

type WriteTraceEvent = (event: TraceEvent) => Effect.Effect<void>;

const makeWriteTraceEvent = (
  append: (event: TraceEvent) => Effect.Effect<void, TraceWriteError>,
): WriteTraceEvent => {
  const write = (event: TraceEvent) =>
    append(event).pipe(
      Effect.tapError((error) =>
        Effect.logError("Failed to append trace event", {
          error: error.message,
          type: event.type,
        }),
      ),
      Effect.catchTag("TraceWriteError", () => Effect.void),
      Effect.withSpan(`TraceEvent.write.${event.type}`),
    );
  return write;
};

const applyExecutionEvent = Effect.fn("RealRunner.applyExecutionEvent")(function* (
  event: ExecutionEvent,
  acc: RunAccumulator,
  write: WriteTraceEvent,
) {
  if (event._tag === "AgentText" || event._tag === "AgentThinking") {
    const nextTurn = acc.turn + 1;
    yield* write({ type: "agent_message", ts: Date.now(), turn: nextTurn, content: event.text });
    return { ...acc, turn: nextTurn };
  }
  if (event._tag === "ToolCall") {
    const callId = padToolCallId(acc.toolCallIndex);
    const wellFormed = isWellFormedToolCall(event.toolName, event.input);
    const url = extractUrlFromToolInput(event.input);
    const reachedUrls = url !== undefined ? [...acc.reachedUrls, url] : acc.reachedUrls;
    yield* write({
      type: "tool_call",
      ts: Date.now(),
      turn: acc.turn,
      id: callId,
      name: event.toolName,
      args: event.input,
    });
    return {
      ...acc,
      toolCallIndex: acc.toolCallIndex + 1,
      reachedUrls,
      recordedToolCalls: [
        ...acc.recordedToolCalls,
        new ToolCall({
          name: event.toolName,
          arguments: { input: event.input, id: callId },
          wellFormed,
        }),
      ],
    };
  }
  if (event._tag === "ToolResult") {
    const lastCall = acc.recordedToolCalls[acc.recordedToolCalls.length - 1];
    const callId =
      lastCall !== undefined && typeof lastCall.arguments["id"] === "string"
        ? lastCall.arguments["id"]
        : padToolCallId(Math.max(0, acc.toolCallIndex - 1));
    yield* write({
      type: "tool_result",
      ts: Date.now(),
      id: callId,
      result: event.result,
      ok: !event.isError,
    });
    const resultUrl = event.isError ? undefined : extractUrlFromToolResult(event.result);
    if (resultUrl === undefined) return acc;
    return { ...acc, reachedUrls: [...acc.reachedUrls, resultUrl] };
  }
  const marker = statusMarkerForEvent(event);
  if (marker === undefined) return acc;
  yield* write({
    type: "status_marker",
    ts: Date.now(),
    marker: marker.marker,
    payload: marker.payload,
  });
  if (event._tag === "RunFinished") {
    return {
      ...acc,
      lastRunFinished: { status: event.status, summary: event.summary },
    };
  }
  return acc;
});

/**
 * runRealTask — drives one EvalTask through the supervisor pipeline, tees
 * agent+tool events into the trace recorder, and returns an ExecutedTrace for
 * the scorers.
 *
 * Consumes: Executor, TraceRecorderFactory, plus their transitive deps (Agent,
 * Git, PlanDecomposer). Exposed as a standalone effect so tests can inject
 * scripted Agent/Git/PlanDecomposer layers without touching production wiring.
 */
export const runRealTask = Effect.fn("RealRunner.run")(function* (
  task: EvalTask,
  context: RealRunContext,
) {
  yield* Effect.annotateCurrentSpan({
    runner: context.runnerName,
    taskId: task.id,
    plannerMode: context.plannerMode,
  });

  const executor = yield* Executor;
  const planDecomposer = yield* PlanDecomposer;
  const traceFactory = yield* TraceRecorderFactory;
  const tokenUsageBus = yield* TokenUsageBus;
  const recorder = yield* traceFactory.open(
    buildTracePath(context.traceDir, context.runnerName, task.id),
  );

  yield* Effect.logInfo("Real runner starting", {
    runner: context.runnerName,
    taskId: task.id,
    plannerMode: context.plannerMode,
    tracePath: recorder.filePath,
  });

  const write = makeWriteTraceEvent(recorder.append);

  // Two-step flow: decompose the prompt into oracle steps (when the harness
  // asks for frontier/template mode) BEFORE invoking the supervisor Executor.
  // The Executor itself no longer owns PlanDecomposer; the eval harness wires
  // it up only here so runtime (CLI/TUI) stays Gemma-only.
  const decomposedPlan =
    context.plannerMode === "none"
      ? undefined
      : yield* planDecomposer.decompose(task.prompt, context.plannerMode, {
          changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
          currentBranch: "main",
          diffPreview: "",
          baseUrl: context.baseUrl,
          isHeadless: context.isHeadless,
          cookieBrowserKeys: [],
        });

  const stream = executor.execute({
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    instruction: task.prompt,
    isHeadless: context.isHeadless,
    cookieBrowserKeys: [],
    baseUrl: context.baseUrl,
    initialSteps: decomposedPlan?.steps,
  });

  const finalAcc = yield* stream.pipe(
    Stream.mapAccumEffect(
      () => INITIAL_ACC,
      (acc, snapshot) =>
        Effect.gen(function* () {
          const newEvents = diffEvents(acc.lastSnapshot, snapshot);
          let next: RunAccumulator = { ...acc, lastSnapshot: snapshot };
          for (const event of newEvents) {
            next = yield* applyExecutionEvent(event, next, write);
          }
          return [next, [next]] as const;
        }),
    ),
    Stream.runFold(
      () => INITIAL_ACC,
      (_acc: RunAccumulator, next: RunAccumulator) => next,
    ),
    Effect.catchTag("ExecutionError", (error) =>
      Effect.logWarning("Executor failed; closing trace without further events", {
        runner: context.runnerName,
        taskId: task.id,
        error: error.message,
      }).pipe(Effect.as(INITIAL_ACC)),
    ),
  );

  // Drain the token-usage bus and write one `token_usage` event per model call
  // followed by a single `task_tokenomics` aggregate — both BEFORE the
  // `stream_terminated` sentinel so that replay tools can still rely on
  // `stream_terminated` being the last line of every trace (existing invariant
  // enforced by the Wave 0.A test suite). Entries are written in publish order
  // (planner-first, then per-executor-turn); downstream tools can re-sort by
  // timestamp if needed.
  const tokenUsages = yield* tokenUsageBus.drain;
  let executorTurn = 0;
  for (const entry of tokenUsages) {
    if (entry.source === "executor") executorTurn += 1;
    const eventTurn = entry.source === "planner" ? 0 : executorTurn;
    yield* write({
      type: "token_usage",
      ts: entry.timestamp,
      turn: eventTurn,
      source: entry.source,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      totalTokens: entry.totalTokens,
    });
  }

  const reachedKeyNodes = buildReachedKeyNodes(finalAcc.reachedUrls, task.keyNodes);
  const finalUrl = finalUrlFromReached(finalAcc.reachedUrls);
  const finalDom = finalAcc.lastRunFinished?.summary ?? "";

  const executedTrace = new ExecutedTrace({
    reachedKeyNodes,
    toolCalls: finalAcc.recordedToolCalls,
    finalUrl,
    finalDom,
    tokenUsages,
  });
  const tokenomics = executedTrace.tokenomics;

  yield* write({
    type: "task_tokenomics",
    ts: Date.now(),
    totalPromptTokens: tokenomics.totalPromptTokens,
    totalCompletionTokens: tokenomics.totalCompletionTokens,
    totalTokens: tokenomics.totalTokens,
    peakPromptTokens: tokenomics.peakPromptTokens,
    turnCount: tokenomics.turnCount,
    plannerTokens: tokenomics.plannerTokens,
    executorTokens: tokenomics.executorTokens,
  });

  const remainingSteps =
    finalAcc.lastSnapshot !== undefined
      ? finalAcc.lastSnapshot.steps.filter(
          (step) => step.status === "pending" || step.status === "active",
        ).length
      : 0;
  const reason = finalAcc.lastRunFinished
    ? `run_finished:${finalAcc.lastRunFinished.status}`
    : "stream_ended";
  yield* write({ type: "stream_terminated", ts: Date.now(), reason, remainingSteps });

  yield* Effect.logInfo("Real runner finished", {
    runner: context.runnerName,
    taskId: task.id,
    toolCalls: finalAcc.recordedToolCalls.length,
    reachedKeyNodes: reachedKeyNodes.length,
    tracePath: recorder.filePath,
    totalTokens: tokenomics.totalTokens,
    peakPromptTokens: tokenomics.peakPromptTokens,
    plannerTokens: tokenomics.plannerTokens,
    executorTokens: tokenomics.executorTokens,
    turnCount: tokenomics.turnCount,
  });

  return executedTrace;
});

const toRunError =
  (runnerName: string, taskId: string) => (tag: string) => (error: { readonly message?: string }) =>
    new EvalRunError({
      runner: runnerName,
      taskId,
      cause: `${tag}: ${error.message ?? tag}`,
    }).asEffect();

/**
 * Drives the full @neuve supervisor pipeline end-to-end and produces an
 * ExecutedTrace plus a persisted ndjson file matching the Wave 0.A trace
 * schema. Orchestration only — no site-specific heuristics.
 */
export const makeRealRunner = (runnerName: string, options: RealRunnerOptions): EvalRunner => {
  const plannerMode = options.plannerMode ?? DEFAULT_PLANNER_MODE;
  const isHeadless = options.isHeadless ?? true;
  const rootDir = options.rootDir ?? process.cwd();
  const traceDir = options.traceDir ?? DEFAULT_TRACE_DIR;

  const agentLayer = Agent.layerFor(options.agentBackend);
  const gitLayer = Git.withRepoRoot(rootDir);
  const planDecomposerLayer = PlanDecomposer.layer;
  const executorLayer = Executor.layer.pipe(Layer.provide(gitLayer));
  // Each task gets a fresh TokenUsageBus Ref (layerRef builds a new Ref per
  // layer build). `provideMerge` satisfies it for PlanDecomposer + Executor
  // AND exposes it so `runRealTask` can drain after the stream terminates.
  const runtimeLayer = Layer.mergeAll(
    executorLayer,
    gitLayer,
    planDecomposerLayer,
    TraceRecorderFactory.layer,
  ).pipe(Layer.provideMerge(agentLayer), Layer.provideMerge(TokenUsageBus.layerRef));

  const context: RealRunContext = {
    runnerName,
    traceDir,
    plannerMode,
    isHeadless,
    baseUrl: options.baseUrl,
  };

  const run = (task: EvalTask) => {
    const translate = toRunError(runnerName, task.id);
    return Effect.scoped(runRealTask(task, context)).pipe(
      Effect.provide(runtimeLayer),
      Effect.catchTags({
        DecomposeError: translate("plan-decomposer"),
        TraceWriteError: translate("trace-writer"),
        AcpProviderNotInstalledError: translate("agent-not-installed"),
        AcpProviderUnauthenticatedError: translate("agent-unauthenticated"),
        AcpConnectionInitError: translate("agent-connection-init"),
        AcpAdapterNotFoundError: translate("agent-adapter-missing"),
        FindRepoRootError: translate("git-repo-root"),
        PlatformError: translate("platform"),
        ConfigError: translate("config"),
        SchemaError: translate("schema"),
      }),
    );
  };

  return {
    name: runnerName,
    run,
  } satisfies EvalRunner;
};
