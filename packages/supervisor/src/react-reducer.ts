import { Data, Effect, Exit, Schema } from "effect";
import {
  Action,
  type AgentTurn,
  AssertionFailed,
  PlanUpdate as PlanUpdateTurn,
  RunCompleted as RunCompletedTurn,
  StepDone,
  Thought,
} from "@neuve/shared/react-envelope";
import {
  AgentThinking,
  AnalysisStep,
  ExecutedPerfPlan,
  type ExecutionEvent,
  PlanUpdate as PlanUpdateEvent,
  RunFinished,
  StepCompleted,
  StepFailed,
  StepId,
  ToolCall,
} from "@neuve/shared/models";
import {
  REACT_PLAN_UPDATE_CAP,
  REACT_PREMATURE_RUN_WINDOW,
  REACT_REFLECT_THRESHOLD,
} from "./constants";

export class ReactRunState extends Schema.Class<ReactRunState>("@supervisor/ReactRunState")({
  planUpdateCount: Schema.Number,
  consecutiveAssertionFailures: Schema.Record(Schema.String, Schema.Number),
  lastTurnTag: Schema.optional(Schema.String),
  // R4 budget monitor: once we've emitted a warn or abort signal for this run,
  // we don't re-emit on every subsequent usage_update. A run with prompt
  // tokens parked above the warn threshold logs the warning once.
  budgetExceeded: Schema.Boolean,
}) {
  static readonly initial: ReactRunState = new ReactRunState({
    planUpdateCount: 0,
    consecutiveAssertionFailures: {},
    lastTurnTag: undefined,
    budgetExceeded: false,
  });
}

export type ReducerSignalLevel = "warn" | "abort";

export type ReducerSignal = Data.TaggedEnum<{
  ReflectTriggered: { readonly stepId: StepId; readonly failureCount: number };
  PlanUpdateCapExceeded: {
    readonly stepId: StepId;
    readonly action: PlanUpdateTurn["action"];
    readonly attemptedCount: number;
  };
  PrematureRunCompleted: {
    readonly status: RunCompletedTurn["status"];
    readonly unresolvedStepId: StepId;
    readonly reason: string;
  };
  InvalidPlanUpdatePayload: {
    readonly stepId: StepId;
    readonly action: PlanUpdateTurn["action"];
    readonly cause: string;
  };
  BudgetExceeded: {
    readonly level: ReducerSignalLevel;
    readonly promptTokens: number;
    readonly threshold: number;
  };
}>;
export const ReducerSignal = Data.taggedEnum<ReducerSignal>();

export interface ReduceResult {
  readonly plan: ExecutedPerfPlan;
  readonly runState: ReactRunState;
  readonly signals: readonly ReducerSignal[];
}

const formatAssertionMessage = (envelope: AssertionFailed): string =>
  `category=${envelope.category}; domain=${envelope.domain}; reason=${envelope.reason}; evidence=${envelope.evidence}`;

const findUnresolvedFailureInWindow = (
  events: readonly ExecutionEvent[],
): StepFailed | undefined => {
  if (events.length === 0) return undefined;
  const lastIndex = events.length - 1;
  const windowStart = Math.max(0, lastIndex - REACT_PREMATURE_RUN_WINDOW);
  for (let index = windowStart; index < lastIndex; index++) {
    const candidate = events[index];
    if (candidate._tag !== "StepFailed") continue;
    let resolved = false;
    for (let after = index + 1; after < lastIndex; after++) {
      const successor = events[after];
      if (successor._tag === "StepCompleted" && successor.stepId === candidate.stepId) {
        resolved = true;
        break;
      }
    }
    if (!resolved) return candidate;
  }
  return undefined;
};

const decodeAnalysisStepUnknown = Schema.decodeUnknownEffect(AnalysisStep);

const handleThought = (
  plan: ExecutedPerfPlan,
  runState: ReactRunState,
  envelope: Thought,
): ReduceResult => ({
  plan: new ExecutedPerfPlan({
    ...plan,
    events: [...plan.events, new AgentThinking({ text: envelope.thought })],
  }),
  runState: new ReactRunState({
    ...runState,
    lastTurnTag: envelope._tag,
  }),
  signals: [],
});

const handleAction = (
  plan: ExecutedPerfPlan,
  runState: ReactRunState,
  envelope: Action,
): ReduceResult => ({
  plan: new ExecutedPerfPlan({
    ...plan,
    events: [
      ...plan.events,
      new ToolCall({ toolName: envelope.toolName, input: envelope.args }),
    ],
  }),
  runState: new ReactRunState({
    ...runState,
    lastTurnTag: envelope._tag,
  }),
  signals: [],
});

const handleStepDone = (
  plan: ExecutedPerfPlan,
  runState: ReactRunState,
  envelope: StepDone,
): ReduceResult => {
  const stepId = StepId.makeUnsafe(envelope.stepId);
  const updatedFailures = {
    ...runState.consecutiveAssertionFailures,
    [stepId]: 0,
  };
  const stepCompleted = new StepCompleted({ stepId, summary: envelope.summary });
  const planWithEvent = new ExecutedPerfPlan({
    ...plan,
    events: [...plan.events, stepCompleted],
  });
  return {
    plan: planWithEvent.applyMarker(stepCompleted),
    runState: new ReactRunState({
      ...runState,
      consecutiveAssertionFailures: updatedFailures,
      lastTurnTag: envelope._tag,
    }),
    signals: [],
  };
};

const handleAssertionFailed = (
  plan: ExecutedPerfPlan,
  runState: ReactRunState,
  envelope: AssertionFailed,
): ReduceResult => {
  const stepId = StepId.makeUnsafe(envelope.stepId);
  const previousCount = runState.consecutiveAssertionFailures[stepId] ?? 0;
  const nextCount = previousCount + 1;
  const updatedFailures = {
    ...runState.consecutiveAssertionFailures,
    [stepId]: nextCount,
  };
  const isAbort = envelope.category === "abort";
  const stepFailed = new StepFailed({
    stepId,
    message: formatAssertionMessage(envelope),
    category: envelope.category,
    abortReason: isAbort ? envelope.abortReason : undefined,
  });
  const signals: ReducerSignal[] =
    nextCount >= REACT_REFLECT_THRESHOLD
      ? [ReducerSignal.ReflectTriggered({ stepId, failureCount: nextCount })]
      : [];
  const planWithEvent = new ExecutedPerfPlan({
    ...plan,
    events: [...plan.events, stepFailed],
  });
  return {
    plan: planWithEvent.applyMarker(stepFailed),
    runState: new ReactRunState({
      ...runState,
      consecutiveAssertionFailures: updatedFailures,
      lastTurnTag: envelope._tag,
    }),
    signals,
  };
};

const handlePlanUpdate = Effect.fn("ReactReducer.handlePlanUpdate")(function* (
  plan: ExecutedPerfPlan,
  runState: ReactRunState,
  envelope: PlanUpdateTurn,
) {
  const stepId = StepId.makeUnsafe(envelope.stepId);
  const attemptedCount = runState.planUpdateCount + 1;

  if (runState.planUpdateCount >= REACT_PLAN_UPDATE_CAP) {
    yield* Effect.logDebug("plan-update-cap-exceeded", {
      stepId,
      action: envelope.action,
      attemptedCount,
    });
    return {
      plan,
      runState: new ReactRunState({
        ...runState,
        planUpdateCount: attemptedCount,
        lastTurnTag: envelope._tag,
      }),
      signals: [
        ReducerSignal.PlanUpdateCapExceeded({
          stepId,
          action: envelope.action,
          attemptedCount,
        }),
      ],
    } satisfies ReduceResult;
  }

  if (envelope.action === "remove") {
    const planUpdateEvent = new PlanUpdateEvent({
      stepId,
      action: envelope.action,
      payload: undefined,
    });
    return {
      plan: plan.applyPlanUpdate(planUpdateEvent),
      runState: new ReactRunState({
        ...runState,
        planUpdateCount: attemptedCount,
        lastTurnTag: envelope._tag,
      }),
      signals: [],
    } satisfies ReduceResult;
  }

  const decodeExit = yield* Effect.exit(decodeAnalysisStepUnknown(envelope.payload));

  if (Exit.isFailure(decodeExit)) {
    const cause = String(decodeExit.cause);
    yield* Effect.logDebug("plan-update-invalid-payload", {
      stepId,
      action: envelope.action,
      cause,
    });
    return {
      plan,
      runState: new ReactRunState({
        ...runState,
        planUpdateCount: attemptedCount,
        lastTurnTag: envelope._tag,
      }),
      signals: [
        ReducerSignal.InvalidPlanUpdatePayload({
          stepId,
          action: envelope.action,
          cause,
        }),
      ],
    } satisfies ReduceResult;
  }

  const planUpdateEvent = new PlanUpdateEvent({
    stepId,
    action: envelope.action,
    payload: decodeExit.value,
  });

  yield* Effect.logInfo("react-plan-update-applied", {
    stepId,
    action: envelope.action,
    appliedCount: attemptedCount,
  });

  return {
    plan: plan.applyPlanUpdate(planUpdateEvent),
    runState: new ReactRunState({
      ...runState,
      planUpdateCount: attemptedCount,
      lastTurnTag: envelope._tag,
    }),
    signals: [],
  } satisfies ReduceResult;
});

const handleRunCompleted = Effect.fn("ReactReducer.handleRunCompleted")(function* (
  plan: ExecutedPerfPlan,
  runState: ReactRunState,
  envelope: RunCompletedTurn,
) {
  const runFinished = new RunFinished({
    status: envelope.status,
    summary: envelope.summary,
    abort: envelope.abort,
  });
  const updatedPlan = new ExecutedPerfPlan({
    ...plan,
    events: [...plan.events, runFinished],
  });

  const signals: ReducerSignal[] = [];
  if (envelope.status === "passed") {
    const unresolved = findUnresolvedFailureInWindow(updatedPlan.events);
    if (unresolved !== undefined) {
      yield* Effect.logDebug("premature-run-completed", {
        unresolvedStepId: unresolved.stepId,
        windowSize: REACT_PREMATURE_RUN_WINDOW,
      });
      signals.push(
        ReducerSignal.PrematureRunCompleted({
          status: envelope.status,
          unresolvedStepId: unresolved.stepId,
          reason: unresolved.message,
        }),
      );
    }
  }

  return {
    plan: updatedPlan,
    runState: new ReactRunState({
      ...runState,
      lastTurnTag: envelope._tag,
    }),
    signals,
  } satisfies ReduceResult;
});

export const reduceAgentTurn = Effect.fn("ReactReducer.reduceAgentTurn")(function* (
  plan: ExecutedPerfPlan,
  turn: AgentTurn,
  runState: ReactRunState,
) {
  yield* Effect.annotateCurrentSpan({
    turnTag: turn._tag,
    planUpdateCount: runState.planUpdateCount,
  });

  if (turn instanceof Thought) {
    return handleThought(plan, runState, turn);
  }
  if (turn instanceof Action) {
    return handleAction(plan, runState, turn);
  }
  if (turn instanceof StepDone) {
    return handleStepDone(plan, runState, turn);
  }
  if (turn instanceof AssertionFailed) {
    return handleAssertionFailed(plan, runState, turn);
  }
  if (turn instanceof PlanUpdateTurn) {
    return yield* handlePlanUpdate(plan, runState, turn);
  }
  if (turn instanceof RunCompletedTurn) {
    return yield* handleRunCompleted(plan, runState, turn);
  }
  return yield* Effect.die(
    `ReactReducer: unexpected AgentTurn variant — closed union exhausted`,
  );
});
