import { Effect, Option, Schema } from "effect";
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
  AgentTurn,
  AgentTurnLoose,
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

  it("decodes an ACTION envelope with a registered toolName + canonical args", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-2",
      toolName: "interact",
      args: { action: { command: "navigate", url: "https://example.com" } },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
    if (result._tag === "ACTION") {
      expect(result.toolName).toBe("interact");
      assert.deepStrictEqual(result.args, {
        action: { command: "navigate", url: "https://example.com" },
      });
    }
  });

  it("decodes an ACTION envelope with shorthand args (gemma's emission shape)", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "interact",
      args: { command: "click", uid: "abc123" },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
    if (result._tag === "ACTION") {
      assert.deepStrictEqual(result.args, { command: "click", uid: "abc123" });
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
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "click",
      args: { ref: "12" },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));

    let observedToolName: string | undefined;
    if (result._tag === "ACTION") {
      observedToolName = result.toolName;
    }

    expect(observedToolName).toBe("click");
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

// R7 strict tool-schema regression guards. Per the forensic report at
// `docs/research/gemini-investigation/why-gemini-fails.md` §2.1-§2.3, gemini
// emits three failure shapes the loose `Schema.Unknown` accepted: hallucinated
// upstream tool names from the chrome-devtools-mcp v0.21.0 catalog,
// flat-action `{action: "navigate"}` and array-action
// `{action: ["navigate", "..."]}`. The strict per-tool union rejects each at
// decode time so Gemini's responseSchema decoder loses the malformed-shape
// option entirely.
describe("parseAgentTurn — strict tool-schema rejection (R7)", () => {
  it("rejects hallucinated upstream tool names (navigate_page)", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "navigate_page",
      args: { url: "https://example.com" },
    };
    const exit = await Effect.runPromiseExit(parseAgentTurn(wire));
    expect(exit._tag).toBe("Failure");
  });

  it("rejects hallucinated upstream tool names (take_snapshot)", async () => {
    const wire = { _tag: "ACTION", stepId: "step-1", toolName: "take_snapshot", args: {} };
    const exit = await Effect.runPromiseExit(parseAgentTurn(wire));
    expect(exit._tag).toBe("Failure");
  });

  it("rejects hallucinated upstream tool names (performance_start_trace)", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "performance_start_trace",
      args: { reload: true },
    };
    const exit = await Effect.runPromiseExit(parseAgentTurn(wire));
    expect(exit._tag).toBe("Failure");
  });

  it('rejects flat-action gemini bug shape ({action: "navigate", url})', async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "interact",
      args: { action: "navigate", url: "https://example.com" },
    };
    const exit = await Effect.runPromiseExit(parseAgentTurn(wire));
    expect(exit._tag).toBe("Failure");
  });

  it('rejects array-action gemini bug shape ({action: ["navigate", "..."]})', async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "interact",
      args: { action: ["navigate", "https://example.com"] },
    };
    const exit = await Effect.runPromiseExit(parseAgentTurn(wire));
    expect(exit._tag).toBe("Failure");
  });

  it("rejects unknown command inside an interact dispatcher", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "interact",
      args: { action: { command: "teleport", url: "https://example.com" } },
    };
    const exit = await Effect.runPromiseExit(parseAgentTurn(wire));
    expect(exit._tag).toBe("Failure");
  });

  it("accepts canonical interact-navigate envelope", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "interact",
      args: { action: { command: "navigate", url: "https://example.com" } },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts canonical observe-snapshot envelope", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "observe",
      args: { action: { command: "snapshot" } },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts canonical trace-start envelope", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "trace",
      args: {
        action: { command: "start", reload: true, autoStop: true },
      },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts canonical trace-analyze envelope", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "trace",
      args: {
        action: {
          command: "analyze",
          insightSetId: "NAVIGATION_0",
          insightName: "LCPBreakdown",
        },
      },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts gemma shorthand interact-navigate (auto-wrap path)", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "interact",
      args: { command: "navigate", url: "https://example.com" },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts gemma shorthand observe-snapshot", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "observe",
      args: { command: "snapshot" },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts gemma shorthand observe-screenshot with format", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "observe",
      args: { command: "screenshot", format: "png" },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts flat click tool envelope", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "click",
      args: { ref: "12" },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts flat fill tool envelope", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "fill",
      args: { ref: "7", text: "hello", clearFirst: true },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
  });

  it("accepts flat wait_for tool envelope", async () => {
    const wire = {
      _tag: "ACTION",
      stepId: "step-1",
      toolName: "wait_for",
      args: { selector: "button.submit", state: "visible", timeout: 5000 },
    };
    const result = await Effect.runPromise(parseAgentTurn(wire));
    assert.instanceOf(result, Action);
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

// R7 phase 7 — guard the Ollama format-grammar size + nesting depth.
// Empirical evidence (`docs/handover/strict-tool-schema/diary/r7-2026-04-27.md`
// Phase 6): the strict per-tool union (depth-6 anyOf, ~27 KB) overwhelmed
// llama.cpp's grammar engine on 7/20 gemma tasks (35%) — model emitted zero
// bytes ("empty content at round 1 with done_reason='stop'"). The loose
// variant `AgentTurnLoose` mirrors R5b's shape (`args: Schema.Unknown`) so
// the grammar is small + shallow. These thresholds catch drift toward the
// strict shape on the Ollama path.
describe("AgentTurnLoose — Ollama format-grammar size + depth bounds (R7 phase 7)", () => {
  const document = Schema.toJsonSchemaDocument(AgentTurnLoose);
  const json = JSON.stringify({ ...document.schema, $defs: document.definitions });

  const measureMaxAnyOfOneOfDepth = (node: unknown, depth = 0): number => {
    if (Array.isArray(node)) {
      return node.reduce<number>(
        (max, entry) => Math.max(max, measureMaxAnyOfOneOfDepth(entry, depth)),
        depth,
      );
    }
    if (typeof node !== "object" || node === null) return depth;
    let max = depth;
    for (const [key, value] of Object.entries(node)) {
      const childDepth =
        key === "anyOf" || key === "oneOf"
          ? measureMaxAnyOfOneOfDepth(value, depth + 1)
          : measureMaxAnyOfOneOfDepth(value, depth);
      if (childDepth > max) max = childDepth;
    }
    return max;
  };

  it("emits a small grammar (≤ 8 KB) so llama.cpp's compiler doesn't choke", () => {
    expect(json.length).toBeLessThanOrEqual(8 * 1024);
  });

  it("keeps anyOf/oneOf nesting shallow (≤ 2 levels)", () => {
    const depth = measureMaxAnyOfOneOfDepth(document.schema);
    expect(depth).toBeLessThanOrEqual(2);
  });

  it("preserves the 6-variant union of envelope shapes (THOUGHT/ACTION/...)", () => {
    const top = document.schema as { anyOf?: unknown[] };
    expect(Array.isArray(top.anyOf)).toBe(true);
    expect(top.anyOf?.length).toBe(6);
  });

  it("Ollama-loose Action variant accepts arbitrary args (Schema.Unknown surface)", async () => {
    // Through the LOOSE schema, an envelope with an unregistered toolName +
    // exotic args still decodes — Ollama's format grammar must allow what
    // gemma actually emits today (canonical/shorthand variants the bridge
    // auto-wrap normalizes).
    const decoded = await Effect.runPromise(
      Schema.decodeUnknownEffect(AgentTurnLoose)({
        _tag: "ACTION",
        stepId: "s-1",
        toolName: "interact",
        args: { command: "navigate", url: "https://example.com" },
      }),
    );
    expect(decoded._tag).toBe("ACTION");
  });

  it("strict AgentTurn still rejects gemini's flat-action bug shape (regression guard)", async () => {
    // Both schemas are exported; the strict one keeps protecting the Gemini
    // path. This test pins the contract so a future change can't silently
    // weaken Gemini's enforcement while loosening Ollama.
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(AgentTurn)(
        {
          _tag: "ACTION",
          stepId: "s-1",
          toolName: "interact",
          args: { action: "navigate", url: "https://example.com" },
        },
        { onExcessProperty: "error" },
      ),
    );
    expect(exit._tag).toBe("Failure");
  });
});
