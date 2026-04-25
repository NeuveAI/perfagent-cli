import { describe, it, expect } from "vitest";
import { Effect, Option } from "effect";
import {
  AnalysisStep,
  ChangesFor,
  ExecutedPerfPlan,
  PerfPlan,
  PlanId,
  StepId,
} from "@neuve/shared/models";
import {
  Action,
  AssertionFailed,
  PlanUpdate as PlanUpdateTurn,
  RunCompleted as RunCompletedTurn,
  StepDone,
  Thought,
} from "@neuve/shared/react-envelope";
import {
  ReactRunState,
  ReducerSignal,
  reduceAgentTurn,
} from "../src/react-reducer";
import { REACT_PLAN_UPDATE_CAP } from "../src/constants";

const makeStep = (id: string, title: string): AnalysisStep =>
  new AnalysisStep({
    id: StepId.makeUnsafe(id),
    title,
    instruction: title,
    expectedOutcome: "",
    routeHint: Option.none(),
    status: "pending",
    summary: Option.none(),
    startedAt: Option.none(),
    endedAt: Option.none(),
  });

const makePlan = (steps: readonly AnalysisStep[]): ExecutedPerfPlan =>
  new ExecutedPerfPlan({
    id: PlanId.makeUnsafe("plan-test"),
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    currentBranch: "main",
    diffPreview: "",
    fileStats: [],
    instruction: "test",
    baseUrl: Option.none(),
    isHeadless: true,
    cookieBrowserKeys: [],
    targetUrls: [],
    perfBudget: Option.none(),
    title: "test",
    rationale: "",
    steps,
    events: [],
  });

const reduceSync = (plan: ExecutedPerfPlan, turn: Parameters<typeof reduceAgentTurn>[1], state: ReactRunState) =>
  Effect.runSync(reduceAgentTurn(plan, turn, state));

describe("ReactRunState.initial", () => {
  it("starts with zero plan updates and an empty failure record", () => {
    expect(ReactRunState.initial.planUpdateCount).toBe(0);
    expect(ReactRunState.initial.consecutiveAssertionFailures).toEqual({});
    expect(ReactRunState.initial.lastTurnTag).toBeUndefined();
  });
});

describe("reduceAgentTurn — THOUGHT", () => {
  it("appends an AgentThinking event with the verbatim thought text and records lastTurnTag", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const turn = new Thought({ stepId: "step-01", thought: "I should navigate first." });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.signals).toEqual([]);
    expect(result.runState.lastTurnTag).toBe("THOUGHT");
    expect(result.runState.planUpdateCount).toBe(0);
    expect(result.plan.events).toHaveLength(1);
    const appended = result.plan.events[0];
    expect(appended._tag).toBe("AgentThinking");
    if (appended._tag === "AgentThinking") {
      expect(appended.text).toBe("I should navigate first.");
    }
  });

  it("does not mutate the input plan instance", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const originalEventsLength = plan.events.length;
    const turn = new Thought({ stepId: "step-01", thought: "thinking" });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.plan).not.toBe(plan);
    expect(plan.events.length).toBe(originalEventsLength);
  });
});

describe("reduceAgentTurn — ACTION", () => {
  it("appends a ToolCall event with the envelope's toolName and args", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const turn = new Action({
      stepId: "step-01",
      toolName: "interact",
      args: { command: "navigate", url: "https://example.com" },
    });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.signals).toEqual([]);
    expect(result.plan.events).toHaveLength(1);
    const appended = result.plan.events[0];
    expect(appended._tag).toBe("ToolCall");
    if (appended._tag === "ToolCall") {
      expect(appended.toolName).toBe("interact");
      expect(appended.input).toEqual({ command: "navigate", url: "https://example.com" });
    }
  });
});

describe("reduceAgentTurn — STEP_DONE", () => {
  it("appends a StepCompleted event and resets the failure counter for that step", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const stateWithFailures = new ReactRunState({
      planUpdateCount: 0,
      consecutiveAssertionFailures: { "step-01": 2, "step-02": 1 },
      lastTurnTag: "ASSERTION_FAILED",
      budgetExceeded: false,
    });
    const turn = new StepDone({ stepId: "step-01", summary: "Landed on homepage" });

    const result = reduceSync(plan, turn, stateWithFailures);

    expect(result.signals).toEqual([]);
    expect(result.runState.consecutiveAssertionFailures["step-01"]).toBe(0);
    expect(result.runState.consecutiveAssertionFailures["step-02"]).toBe(1);
    const appended = result.plan.events[0];
    expect(appended._tag).toBe("StepCompleted");
    if (appended._tag === "StepCompleted") {
      expect(appended.stepId).toBe("step-01");
      expect(appended.summary).toBe("Landed on homepage");
    }
  });
});

describe("reduceAgentTurn — ASSERTION_FAILED", () => {
  it("emits no REFLECT signal on the first failure for a step", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const turn = new AssertionFailed({
      stepId: "step-01",
      category: "regression",
      domain: "perf",
      reason: "LCP exceeded budget",
      evidence: "lcp=4200ms",
    });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.signals).toEqual([]);
    expect(result.runState.consecutiveAssertionFailures["step-01"]).toBe(1);
    const appended = result.plan.events[0];
    expect(appended._tag).toBe("StepFailed");
    if (appended._tag === "StepFailed") {
      expect(appended.stepId).toBe("step-01");
      expect(appended.category).toBe("regression");
      expect(appended.message).toContain("category=regression");
      expect(appended.message).toContain("domain=perf");
      expect(appended.message).toContain("reason=LCP exceeded budget");
      expect(appended.message).toContain("evidence=lcp=4200ms");
    }
  });

  it("emits a REFLECT signal on the second consecutive failure for the same step", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const stateWithOneFailure = new ReactRunState({
      planUpdateCount: 0,
      consecutiveAssertionFailures: { "step-01": 1 },
      lastTurnTag: "ASSERTION_FAILED",
      budgetExceeded: false,
    });
    const turn = new AssertionFailed({
      stepId: "step-01",
      category: "regression",
      domain: "perf",
      reason: "Still failing",
      evidence: "lcp=4500ms",
    });

    const result = reduceSync(plan, turn, stateWithOneFailure);

    expect(result.runState.consecutiveAssertionFailures["step-01"]).toBe(2);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toEqual(
      ReducerSignal.ReflectTriggered({
        stepId: StepId.makeUnsafe("step-01"),
        failureCount: 2,
      }),
    );
  });

  it("tracks failures separately per stepId and does not cross-pollute", () => {
    const plan = makePlan([makeStep("step-01", "Navigate"), makeStep("step-02", "Click")]);
    const stateWithStep01Failure = new ReactRunState({
      planUpdateCount: 0,
      consecutiveAssertionFailures: { "step-01": 1 },
      lastTurnTag: "ASSERTION_FAILED",
      budgetExceeded: false,
    });
    const turn = new AssertionFailed({
      stepId: "step-02",
      category: "regression",
      domain: "responsive",
      reason: "viewport mismatch",
      evidence: "expected=viewport-narrow",
    });

    const result = reduceSync(plan, turn, stateWithStep01Failure);

    expect(result.runState.consecutiveAssertionFailures["step-01"]).toBe(1);
    expect(result.runState.consecutiveAssertionFailures["step-02"]).toBe(1);
    expect(result.signals).toEqual([]);
  });

  it("preserves abortReason for category=abort failures", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const turn = new AssertionFailed({
      stepId: "step-01",
      category: "abort",
      domain: "other",
      reason: "captcha blocked navigation",
      evidence: "modal=captcha-overlay",
      abortReason: "captcha-blocked",
    });

    const result = reduceSync(plan, turn, ReactRunState.initial);
    const appended = result.plan.events[0];
    expect(appended._tag).toBe("StepFailed");
    if (appended._tag === "StepFailed") {
      expect(appended.category).toBe("abort");
      expect(appended.abortReason).toBe("captcha-blocked");
      expect(appended.isAbort).toBe(true);
    }
  });

  it("STEP_DONE after a single failure resets the counter so the next failure starts at 1", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const failureTurn = new AssertionFailed({
      stepId: "step-01",
      category: "regression",
      domain: "perf",
      reason: "first",
      evidence: "e1",
    });
    const doneTurn = new StepDone({ stepId: "step-01", summary: "recovered" });
    const secondFailureTurn = new AssertionFailed({
      stepId: "step-01",
      category: "regression",
      domain: "perf",
      reason: "second",
      evidence: "e2",
    });

    const r1 = reduceSync(plan, failureTurn, ReactRunState.initial);
    const r2 = reduceSync(r1.plan, doneTurn, r1.runState);
    const r3 = reduceSync(r2.plan, secondFailureTurn, r2.runState);

    expect(r3.runState.consecutiveAssertionFailures["step-01"]).toBe(1);
    expect(r3.signals).toEqual([]);
  });
});

describe("reduceAgentTurn — PLAN_UPDATE", () => {
  it("decodes payload into AnalysisStep, applies it, increments counter", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const newStepPayload = {
      id: "step-02",
      title: "Click Buy menu",
      instruction: "Open the Buy menu",
      expectedOutcome: "Buy menu visible",
      routeHint: null,
      status: "pending",
      summary: null,
      startedAt: null,
      endedAt: null,
    };
    const turn = new PlanUpdateTurn({
      stepId: "step-02",
      action: "insert",
      payload: newStepPayload,
    });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.signals).toEqual([]);
    expect(result.runState.planUpdateCount).toBe(1);
    expect(result.plan.steps).toHaveLength(2);
    expect(result.plan.steps[1].id).toBe("step-02");
    expect(result.plan.steps[1].title).toBe("Click Buy menu");
    const planUpdateEvent = result.plan.events.find((event) => event._tag === "PlanUpdate");
    expect(planUpdateEvent?._tag).toBe("PlanUpdate");
  });

  it("removes a step on action=remove without requiring payload decode", () => {
    const plan = makePlan([makeStep("step-01", "Navigate"), makeStep("step-02", "Click")]);
    const turn = new PlanUpdateTurn({
      stepId: "step-02",
      action: "remove",
      payload: undefined,
    });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.signals).toEqual([]);
    expect(result.runState.planUpdateCount).toBe(1);
    expect(result.plan.steps).toHaveLength(1);
    expect(result.plan.steps[0].id).toBe("step-01");
  });

  it("emits InvalidPlanUpdatePayload signal when payload does not decode to AnalysisStep", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const turn = new PlanUpdateTurn({
      stepId: "step-02",
      action: "insert",
      payload: { not_a_step: true },
    });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.runState.planUpdateCount).toBe(1);
    expect(result.plan.steps).toHaveLength(1);
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    expect(signal._tag).toBe("InvalidPlanUpdatePayload");
    if (signal._tag === "InvalidPlanUpdatePayload") {
      expect(signal.stepId).toBe("step-02");
      expect(signal.action).toBe("insert");
      expect(signal.cause.length).toBeGreaterThan(0);
    }
  });

  it("rejects the 6th PLAN_UPDATE with PlanUpdateCapExceeded — first 5 succeed", () => {
    let plan = makePlan([makeStep("step-01", "Navigate")]);
    let runState = ReactRunState.initial;

    for (let index = 1; index <= REACT_PLAN_UPDATE_CAP; index++) {
      const stepPayload = {
        id: `step-${index + 1}`,
        title: `Step ${index + 1}`,
        instruction: `Instruction ${index + 1}`,
        expectedOutcome: "",
        routeHint: null,
        status: "pending",
        summary: null,
        startedAt: null,
        endedAt: null,
      };
      const turn = new PlanUpdateTurn({
        stepId: `step-${index + 1}`,
        action: "insert",
        payload: stepPayload,
      });
      const result = reduceSync(plan, turn, runState);
      expect(result.signals).toEqual([]);
      expect(result.runState.planUpdateCount).toBe(index);
      plan = result.plan;
      runState = result.runState;
    }

    expect(plan.steps.length).toBe(REACT_PLAN_UPDATE_CAP + 1);

    const sixthPayload = {
      id: "step-7",
      title: "Step 7",
      instruction: "Instruction 7",
      expectedOutcome: "",
      routeHint: null,
      status: "pending",
      summary: null,
      startedAt: null,
      endedAt: null,
    };
    const sixthTurn = new PlanUpdateTurn({
      stepId: "step-7",
      action: "insert",
      payload: sixthPayload,
    });
    const rejected = reduceSync(plan, sixthTurn, runState);

    expect(rejected.signals).toHaveLength(1);
    expect(rejected.signals[0]._tag).toBe("PlanUpdateCapExceeded");
    if (rejected.signals[0]._tag === "PlanUpdateCapExceeded") {
      expect(rejected.signals[0].action).toBe("insert");
      expect(rejected.signals[0].attemptedCount).toBe(REACT_PLAN_UPDATE_CAP + 1);
    }
    expect(rejected.runState.planUpdateCount).toBe(REACT_PLAN_UPDATE_CAP + 1);
    expect(rejected.plan.steps.length).toBe(REACT_PLAN_UPDATE_CAP + 1);
  });
});

describe("reduceAgentTurn — RUN_COMPLETED", () => {
  it("appends a RunFinished event with the envelope's status and summary", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    const turn = new RunCompletedTurn({ status: "passed", summary: "all steps complete" });

    const result = reduceSync(plan, turn, ReactRunState.initial);

    expect(result.signals).toEqual([]);
    const runFinished = result.plan.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("passed");
      expect(runFinished.summary).toBe("all steps complete");
    }
  });

  it("emits PrematureRunCompleted when status=passed and an unresolved StepFailed sits in the last 3 events", () => {
    let plan = makePlan([makeStep("step-01", "Navigate")]);
    let runState = ReactRunState.initial;

    const failTurn = new AssertionFailed({
      stepId: "step-01",
      category: "regression",
      domain: "perf",
      reason: "LCP poor",
      evidence: "lcp=4500ms",
    });
    const r1 = reduceSync(plan, failTurn, runState);
    plan = r1.plan;
    runState = r1.runState;

    const completedTurn = new RunCompletedTurn({ status: "passed", summary: "done" });
    const r2 = reduceSync(plan, completedTurn, runState);

    expect(r2.signals).toHaveLength(1);
    expect(r2.signals[0]._tag).toBe("PrematureRunCompleted");
    if (r2.signals[0]._tag === "PrematureRunCompleted") {
      expect(r2.signals[0].status).toBe("passed");
      expect(r2.signals[0].unresolvedStepId).toBe("step-01");
    }
  });

  it("does NOT emit PrematureRunCompleted when status=failed even with unresolved StepFailed", () => {
    let plan = makePlan([makeStep("step-01", "Navigate")]);
    let runState = ReactRunState.initial;

    const failTurn = new AssertionFailed({
      stepId: "step-01",
      category: "regression",
      domain: "perf",
      reason: "LCP poor",
      evidence: "lcp=4500ms",
    });
    const r1 = reduceSync(plan, failTurn, runState);

    const completedTurn = new RunCompletedTurn({ status: "failed", summary: "real failure" });
    const r2 = reduceSync(r1.plan, completedTurn, r1.runState);

    expect(r2.signals).toEqual([]);
  });

  it("does NOT emit PrematureRunCompleted when StepFailed was followed by a matching StepCompleted (resolved)", () => {
    let plan = makePlan([makeStep("step-01", "Navigate")]);
    let runState = ReactRunState.initial;

    const failTurn = new AssertionFailed({
      stepId: "step-01",
      category: "regression",
      domain: "perf",
      reason: "LCP poor",
      evidence: "lcp=4500ms",
    });
    const r1 = reduceSync(plan, failTurn, runState);

    const doneTurn = new StepDone({ stepId: "step-01", summary: "recovered" });
    const r2 = reduceSync(r1.plan, doneTurn, r1.runState);

    const completedTurn = new RunCompletedTurn({ status: "passed", summary: "done" });
    const r3 = reduceSync(r2.plan, completedTurn, r2.runState);

    expect(r3.signals).toEqual([]);
  });

  it("does NOT emit PrematureRunCompleted when no recent ASSERTION_FAILED is present", () => {
    let plan = makePlan([makeStep("step-01", "Navigate"), makeStep("step-02", "Click")]);
    let runState = ReactRunState.initial;

    const r1 = reduceSync(
      plan,
      new StepDone({ stepId: "step-01", summary: "done-01" }),
      runState,
    );
    const r2 = reduceSync(
      r1.plan,
      new StepDone({ stepId: "step-02", summary: "done-02" }),
      r1.runState,
    );

    const completedTurn = new RunCompletedTurn({ status: "passed", summary: "all good" });
    const r3 = reduceSync(r2.plan, completedTurn, r2.runState);

    expect(r3.signals).toEqual([]);
  });

  it("does NOT emit PrematureRunCompleted when ASSERTION_FAILED is older than the last 3 events", () => {
    let plan = makePlan([makeStep("step-01", "Navigate"), makeStep("step-02", "Click")]);
    let runState = ReactRunState.initial;

    const r1 = reduceSync(
      plan,
      new AssertionFailed({
        stepId: "step-01",
        category: "regression",
        domain: "perf",
        reason: "first failure",
        evidence: "e1",
      }),
      runState,
    );
    const r2 = reduceSync(
      r1.plan,
      new StepDone({ stepId: "step-01", summary: "recovered" }),
      r1.runState,
    );
    const r3 = reduceSync(
      r2.plan,
      new Thought({ stepId: "step-02", thought: "next step now" }),
      r2.runState,
    );
    const r4 = reduceSync(
      r3.plan,
      new Action({
        stepId: "step-02",
        toolName: "interact",
        args: { command: "click" },
      }),
      r3.runState,
    );
    const r5 = reduceSync(
      r4.plan,
      new StepDone({ stepId: "step-02", summary: "clicked" }),
      r4.runState,
    );

    const completedTurn = new RunCompletedTurn({ status: "passed", summary: "all good" });
    const r6 = reduceSync(r5.plan, completedTurn, r5.runState);

    expect(r6.signals).toEqual([]);
  });
});

describe("reduceAgentTurn — step.status transitions", () => {
  it("STEP_DONE transitions step.status from pending to passed via applyMarker", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    expect(plan.steps[0].status).toBe("pending");

    const result = reduceSync(
      plan,
      new StepDone({ stepId: "step-01", summary: "done" }),
      ReactRunState.initial,
    );

    expect(result.plan.steps[0].status).toBe("passed");
  });

  it("ASSERTION_FAILED transitions step.status from pending to failed via applyMarker", () => {
    const plan = makePlan([makeStep("step-01", "Navigate")]);
    expect(plan.steps[0].status).toBe("pending");

    const result = reduceSync(
      plan,
      new AssertionFailed({
        stepId: "step-01",
        category: "regression",
        domain: "perf",
        reason: "fail",
        evidence: "ev",
      }),
      ReactRunState.initial,
    );

    expect(result.plan.steps[0].status).toBe("failed");
  });

  it("RUN_COMPLETED with all steps marked passed → allPlanStepsTerminal becomes true", () => {
    let plan = makePlan([makeStep("step-01", "Navigate"), makeStep("step-02", "Click")]);
    let runState = ReactRunState.initial;

    const r1 = reduceSync(plan, new StepDone({ stepId: "step-01", summary: "done" }), runState);
    plan = r1.plan;
    runState = r1.runState;
    const r2 = reduceSync(plan, new StepDone({ stepId: "step-02", summary: "done" }), runState);
    plan = r2.plan;
    runState = r2.runState;

    expect(plan.allPlanStepsTerminal).toBe(true);

    const r3 = reduceSync(
      plan,
      new RunCompletedTurn({ status: "passed", summary: "all done" }),
      runState,
    );
    expect(r3.plan.hasRunFinished).toBe(true);
  });
});

describe("reduceAgentTurn — immutability", () => {
  it("never mutates the input plan, runState, or events array across a sequence of reduces", () => {
    const initialPlan = makePlan([makeStep("step-01", "Navigate")]);
    const initialState = ReactRunState.initial;
    const planBeforeEventsRef = initialPlan.events;
    const stateBeforeFailuresRef = initialState.consecutiveAssertionFailures;

    const turn1 = new Thought({ stepId: "step-01", thought: "I will navigate" });
    const r1 = reduceSync(initialPlan, turn1, initialState);
    expect(initialPlan.events).toBe(planBeforeEventsRef);
    expect(initialState.consecutiveAssertionFailures).toBe(stateBeforeFailuresRef);
    expect(r1.plan).not.toBe(initialPlan);

    const turn2 = new Action({
      stepId: "step-01",
      toolName: "interact",
      args: { command: "navigate" },
    });
    const r2 = reduceSync(r1.plan, turn2, r1.runState);
    expect(r1.plan.events.length).toBe(1);
    expect(r2.plan.events.length).toBe(2);
  });
});
