import { Effect, Option } from "effect";
import { assert, describe, expect, it } from "vite-plus/test";
import {
  AnalysisStep,
  ChangesFor,
  ExecutedPerfPlan,
  PerfPlan,
  PlanId,
  PlanUpdate as PlanUpdateEvent,
  RunStarted,
  StepId,
} from "../src/models";
import {
  Action,
  AssertionFailed,
  parseAgentTurn,
  parseAgentTurnFromString,
  PlanUpdate as PlanUpdateTurn,
  RunCompleted,
  StepDone,
  Thought,
} from "../src/react-envelope";

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

const makeThreeStepPlan = (): PerfPlan =>
  new PerfPlan({
    id: PlanId.makeUnsafe("plan-r1"),
    title: "ReAct foundation",
    rationale: "Round-trip envelope",
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    currentBranch: "main",
    diffPreview: "",
    fileStats: [],
    instruction: "Test the envelope",
    baseUrl: Option.none(),
    isHeadless: false,
    cookieBrowserKeys: [],
    targetUrls: [],
    perfBudget: Option.none(),
    steps: [
      makeStep("step-1", "Open page"),
      makeStep("step-2", "Fill form"),
      makeStep("step-3", "Submit"),
    ],
  });

const makeExecutedFromPlan = (plan: PerfPlan): ExecutedPerfPlan =>
  new ExecutedPerfPlan({ ...plan, events: [new RunStarted({ plan })] });

describe("parseAgentTurn — round-trip parse", () => {
  it("decodes a THOUGHT envelope into a Thought class instance", async () => {
    const wire = { _tag: "THOUGHT", stepId: "step-1", thought: "I should click the login button" };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Thought);
    expect(result._tag).toBe("THOUGHT");
    if (result._tag === "THOUGHT") {
      expect(result.stepId).toBe("step-1");
      expect(result.thought).toBe("I should click the login button");
    }
  });

  it("decodes an ACTION envelope into an Action class instance with unknown args", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-2",
      toolName: "browser_navigate",
      args: { url: "https://example.com" },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
    if (result._tag === "ACTION") {
      expect(result.toolName).toBe("browser_navigate");
      assert.deepStrictEqual(result.args, { url: "https://example.com" });
    }
  });

  it("preserves deeply-nested ACTION args verbatim through Schema.Unknown", async () => {
    const deepArgs = {
      selector: { ref: "5", strategy: "som" },
      options: {
        modifiers: ["shift", "alt"],
        retries: 3,
        timeout: { value: 1500, unit: "ms" },
        nested: { level: { deeper: [{ id: 1 }, { id: 2 }] } },
      },
    };
    const wire = { _tag: "ACTION", stepId: "step-1", toolName: "browser_click", args: deepArgs };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
    if (result._tag === "ACTION") {
      assert.deepStrictEqual(result.args, deepArgs);
    }
  });

  it("decodes a PLAN_UPDATE envelope with all action literals", async () => {
    const actions = ["insert", "replace", "remove", "replace_step"] as const;
    for (const action of actions) {
      const wire = { _tag: "PLAN_UPDATE", stepId: "step-1", action, payload: { foo: "bar" } };
      const result = await Effect.runPromise(parseAgentTurn(wire));
      assert.instanceOf(result, PlanUpdateTurn);
      if (result._tag === "PLAN_UPDATE") {
        expect(result.action).toBe(action);
        expect(result.stepId).toBe("step-1");
      }
    }
  });

  it("decodes a STEP_DONE envelope", async () => {
    const wire = { _tag: "STEP_DONE", stepId: "step-3", summary: "Form submitted successfully" };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, StepDone);
    if (result._tag === "STEP_DONE") {
      expect(result.summary).toBe("Form submitted successfully");
    }
  });

  const ASSERTION_CATEGORIES = [
    "budget-violation",
    "regression",
    "resource-blocker",
    "memory-leak",
    "abort",
  ] as const;
  const ASSERTION_DOMAINS = ["design", "responsive", "perf", "a11y", "other"] as const;

  for (const category of ASSERTION_CATEGORIES) {
    for (const domain of ASSERTION_DOMAINS) {
      it(`decodes ASSERTION_FAILED with category=${category} domain=${domain}`, async () => {
        const wire = {
          _tag: "ASSERTION_FAILED",
          stepId: "step-2",
          category,
          domain,
          reason: "test reason",
          evidence: "test evidence",
        };
        const result = await Effect.runPromise(parseAgentTurn(wire));
        assert.instanceOf(result, AssertionFailed);
        if (result._tag === "ASSERTION_FAILED") {
          expect(result.category).toBe(category);
          expect(result.domain).toBe(domain);
          expect(result.abortReason).toBeUndefined();
        }
      });
    }
  }

  it("decodes an ASSERTION_FAILED envelope with abortReason populated", async () => {
    const wire = {
      _tag: "ASSERTION_FAILED",
      stepId: "step-2",
      category: "abort",
      domain: "other",
      reason: "Context budget exceeded",
      evidence: "tokens=125000",
      abortReason: "context-budget-exceeded",
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, AssertionFailed);
    if (result._tag === "ASSERTION_FAILED") {
      expect(result.abortReason).toBe("context-budget-exceeded");
    }
  });

  it("decodes a RUN_COMPLETED envelope with passed status", async () => {
    const wire = { _tag: "RUN_COMPLETED", status: "passed", summary: "All steps complete" };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, RunCompleted);
    if (result._tag === "RUN_COMPLETED") {
      expect(result.status).toBe("passed");
    }
  });

  it("decodes a RUN_COMPLETED envelope with failed status", async () => {
    const wire = { _tag: "RUN_COMPLETED", status: "failed", summary: "Aborted" };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, RunCompleted);
    if (result._tag === "RUN_COMPLETED") {
      expect(result.status).toBe("failed");
    }
  });
});

describe("parseAgentTurn — narrowed type access", () => {
  it("narrows Action to expose toolName only inside the Action branch", async () => {
    const wire = { _tag: "ACTION", stepId: "step-1", toolName: "browser_click", args: {} };
    const result = await Effect.runPromise(parseAgentTurn(wire));

    let observedToolName: string | undefined;
    if (result._tag === "ACTION") {
      observedToolName = result.toolName;
    }

    expect(observedToolName).toBe("browser_click");
  });

  it("narrows AssertionFailed to expose category in its branch", async () => {
    const wire = {
      _tag: "ASSERTION_FAILED",
      stepId: "step-1",
      category: "regression",
      domain: "design",
      reason: "Layout shift detected",
      evidence: "before/after screenshots differ",
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));

    let observedCategory: string | undefined;
    if (result._tag === "ASSERTION_FAILED") {
      observedCategory = result.category;
    }

    expect(observedCategory).toBe("regression");
  });
});

describe("parseAgentTurn — bad input rejection", () => {
  it("fails when _tag is missing entirely", async () => {
    const exit = await Effect.runPromiseExit(
      parseAgentTurn({ stepId: "step-1", thought: "no tag here" }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("fails when _tag is unknown", async () => {
    const exit = await Effect.runPromiseExit(
      parseAgentTurn({ _tag: "UNKNOWN_VARIANT", stepId: "step-1" }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("fails when a required field is missing", async () => {
    const exit = await Effect.runPromiseExit(parseAgentTurn({ _tag: "THOUGHT", stepId: "step-1" }));
    expect(exit._tag).toBe("Failure");
  });

  it("fails when a field has the wrong type", async () => {
    const exit = await Effect.runPromiseExit(
      parseAgentTurn({ _tag: "THOUGHT", stepId: "step-1", thought: 42 }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("fails when category is outside the allowed literal set", async () => {
    const exit = await Effect.runPromiseExit(
      parseAgentTurn({
        _tag: "ASSERTION_FAILED",
        stepId: "step-1",
        category: "invalid-category",
        domain: "perf",
        reason: "x",
        evidence: "y",
      }),
    );
    expect(exit._tag).toBe("Failure");
  });
});

describe("parseAgentTurnFromString — JSON string entry point", () => {
  it("decodes a JSON string into the matching AgentTurn class", async () => {
    const json = JSON.stringify({ _tag: "STEP_DONE", stepId: "step-1", summary: "ok" });
    const result = await Effect.runPromise(parseAgentTurnFromString(json));
    assert.instanceOf(result, StepDone);
  });

  it("fails on malformed JSON", async () => {
    const exit = await Effect.runPromiseExit(parseAgentTurnFromString("{not json"));
    expect(exit._tag).toBe("Failure");
  });

  it("tolerates leading and trailing whitespace around the JSON payload", async () => {
    const json = `   \n\t${JSON.stringify({ _tag: "STEP_DONE", stepId: "step-1", summary: "ok" })}\n  `;
    const result = await Effect.runPromise(parseAgentTurnFromString(json));
    assert.instanceOf(result, StepDone);
  });
});

describe("ExecutedPerfPlan.applyPlanUpdate", () => {
  it("insert: places the new step at the index of the matching stepId and preserves originals", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const stepsBefore = original.steps;
    const eventsBefore = original.events;
    const newStep = makeStep("step-1b", "Wait for hydration");

    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "insert",
      payload: newStep,
    });
    const result = original.applyPlanUpdate(update);

    expect(result).not.toBe(original);
    expect(result.steps).not.toBe(original.steps);
    expect(original.steps).toBe(stepsBefore);
    expect(original.events).toBe(eventsBefore);

    expect(result.steps.length).toBe(4);
    expect(result.steps.map((step) => step.id)).toEqual(["step-1", "step-1b", "step-2", "step-3"]);
    expect(result.events.at(-1)).toBeInstanceOf(PlanUpdateEvent);
  });

  it("insert: appends to the end when stepId is not found", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const newStep = makeStep("step-99", "Tail step");
    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("does-not-exist"),
      action: "insert",
      payload: newStep,
    });

    const result = original.applyPlanUpdate(update);
    expect(result.steps.length).toBe(4);
    expect(result.steps.at(-1)?.id).toBe("step-99");
  });

  it("replace: substitutes the matching step in place", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const replacementStep = makeStep("step-2", "Fill form (v2)");
    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "replace",
      payload: replacementStep,
    });

    const result = original.applyPlanUpdate(update);
    expect(result.steps.length).toBe(3);
    expect(result.steps[1]?.title).toBe("Fill form (v2)");
    expect(original.steps[1]?.title).toBe("Fill form");
  });

  it("replace_step: behaves identically to replace", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const replacementStep = makeStep("step-2", "Fill form (alias)");
    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "replace_step",
      payload: replacementStep,
    });

    const result = original.applyPlanUpdate(update);
    expect(result.steps[1]?.title).toBe("Fill form (alias)");
  });

  it("remove: drops the matching step and shrinks the steps array", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "remove",
      payload: undefined,
    });

    const result = original.applyPlanUpdate(update);
    expect(result.steps.length).toBe(2);
    expect(result.steps.map((step) => step.id)).toEqual(["step-1", "step-3"]);
    expect(original.steps.length).toBe(3);
  });

  it("appends the PlanUpdate event to the trajectory on every call", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const insert = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-1"),
      action: "insert",
      payload: makeStep("step-0", "Bootstrap"),
    });
    const remove = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-3"),
      action: "remove",
      payload: undefined,
    });

    const afterInsert = original.applyPlanUpdate(insert);
    const afterRemove = afterInsert.applyPlanUpdate(remove);

    const planUpdateEvents = afterRemove.events.filter((event) => event._tag === "PlanUpdate");
    expect(planUpdateEvents.length).toBe(2);
    expect(planUpdateEvents[0]).toBe(insert);
    expect(planUpdateEvents[1]).toBe(remove);
  });

  it("preserves all pre-existing events at their original indices through chained calls", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const originalEvents = original.events;
    expect(originalEvents.length).toBe(1);
    expect(originalEvents[0]?._tag).toBe("RunStarted");

    const insert = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "insert",
      payload: makeStep("step-2a", "Inserted"),
    });
    const replace = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-1"),
      action: "replace",
      payload: makeStep("step-1", "Replaced"),
    });
    const remove = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-3"),
      action: "remove",
      payload: undefined,
    });

    const final = original.applyPlanUpdate(insert).applyPlanUpdate(replace).applyPlanUpdate(remove);

    expect(final.events.length).toBe(originalEvents.length + 3);
    for (let index = 0; index < originalEvents.length; index += 1) {
      expect(final.events[index]).toBe(originalEvents[index]);
    }
    expect(final.events[1]).toBe(insert);
    expect(final.events[2]).toBe(replace);
    expect(final.events[3]).toBe(remove);
  });

  it("throws when insert is called with a non-AnalysisStep payload (defect — bad caller)", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "insert",
      payload: { id: "step-2a", title: "raw object" },
    });
    assert.throws(() => original.applyPlanUpdate(update), /AnalysisStep instance/);
  });

  it("throws when replace is called with an undefined payload (defect — bad caller)", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "replace",
      payload: undefined,
    });
    assert.throws(() => original.applyPlanUpdate(update), /AnalysisStep instance/);
  });

  it("throws when replace_step is called with a non-AnalysisStep payload (defect — bad caller)", () => {
    const original = makeExecutedFromPlan(makeThreeStepPlan());
    const update = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-2"),
      action: "replace_step",
      payload: "string-not-step",
    });
    assert.throws(() => original.applyPlanUpdate(update), /AnalysisStep instance/);
  });

  it("AgentTurn wire variant carries SCREAMING _tag distinct from in-domain PlanUpdate event", () => {
    const turn = new PlanUpdateTurn({
      stepId: "step-1",
      action: "insert",
      payload: { id: "step-1b" },
    });
    const event = new PlanUpdateEvent({
      stepId: StepId.makeUnsafe("step-1"),
      action: "insert",
      payload: undefined,
    });
    expect(turn._tag).toBe("PLAN_UPDATE");
    expect(event._tag).toBe("PlanUpdate");
  });
});
