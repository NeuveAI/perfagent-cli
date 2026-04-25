import { describe, it, expect } from "vitest";
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from "effect";
import { ChangesFor } from "@neuve/shared/models";
import { TokenUsageBus } from "@neuve/shared/token-usage-bus";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import {
  PlanDecomposer,
  PlannerAgent,
  splitByConnectives,
  type FrontierPlan,
} from "../src/planning/plan-decomposer";
import { PlannerConfigError } from "../src/planning/errors";

// Generic multi-step journey prompts. The prior revision keyed every test off
// a single Apr-24 Volvo crash prompt which tied the decode-contract suite to
// one site shape. Per CLAUDE.md + memory `feedback_avoid_prompt_overfitting`,
// prompts teach reasoning frameworks, not site-specific nav heuristics — so
// the test fixtures use neutral multi-domain prompts and the 20-task eval
// suite (packages/evals/tasks/) owns real-world coverage.
const CATALOG_CHECKOUT_PROMPT =
  "navigate to example.com, open the catalog menu, select any item, proceed to checkout, and capture web vitals on the final confirmation page";
const DOCS_SEARCH_PROMPT =
  "visit docs.example.com, then open the search palette, search for 'configuration', click the first result, and report core web vitals";
const FORM_WIZARD_PROMPT =
  "go to forms.example.com, start the signup wizard, fill the account step, advance to the profile step, submit the form, and capture vitals";

const decomposeContext = {
  changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
  currentBranch: "main",
  diffPreview: "",
  baseUrl: undefined,
  isHeadless: true,
  cookieBrowserKeys: [],
} as const;

const dummyResponseBase = {
  finishReason: { unified: "stop", raw: "stop" } as const,
  usage: {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 20, text: 20, reasoning: undefined },
  },
  warnings: [],
};

const buildModelReturning = (plan: FrontierPlan) =>
  new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-planner",
    doGenerate: async (_options: LanguageModelV4CallOptions) => ({
      ...dummyResponseBase,
      content: [{ type: "text" as const, text: JSON.stringify(plan) }],
    }),
  });

const buildModelThrowing = (cause: Error) =>
  new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-planner",
    doGenerate: async () => {
      throw cause;
    },
  });

const buildModelReturningRawText = (rawText: string) =>
  new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-planner",
    doGenerate: async (_options: LanguageModelV4CallOptions) => ({
      ...dummyResponseBase,
      content: [{ type: "text" as const, text: rawText }],
    }),
  });

const decomposerLayerFromModel = (model: MockLanguageModelV4) =>
  Layer.mergeAll(
    PlanDecomposer.layerWithPlannerAgent(PlannerAgent.layerFromModel(model)),
    TokenUsageBus.layerNoop,
  );

// `PlanDecomposer.decompose` transitively requires `TokenUsageBus` through
// `PlannerAgent.planFrontier`. Both test layers (`decomposerLayerFromModel` +
// `decomposerLayerNoKey`) merge `TokenUsageBus.layerNoop` alongside the
// decomposer, so the helper signatures advertise the union.
const runWithLayer = <A, E>(
  effect: Effect.Effect<A, E, PlanDecomposer | TokenUsageBus>,
  layer: Layer.Layer<PlanDecomposer | TokenUsageBus>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(layer)));

const runExitWithLayer = <A, E>(
  effect: Effect.Effect<A, E, PlanDecomposer | TokenUsageBus>,
  layer: Layer.Layer<PlanDecomposer | TokenUsageBus>,
) => Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));

const catalogCheckoutPlan: FrontierPlan = {
  steps: [
    {
      title: "Open landing page",
      instruction: "Navigate to https://example.com/",
      expectedOutcome: "Homepage renders",
      routeHint: "/",
    },
    {
      title: "Open catalog menu",
      instruction: "Click the top-nav catalog menu",
      expectedOutcome: "Catalog dropdown visible",
    },
    {
      title: "Choose a featured item",
      instruction: "Click the first featured catalog item",
      expectedOutcome: "Item detail page loads",
      routeHint: "/catalog",
    },
    {
      title: "Add to cart",
      instruction: "Click the add-to-cart button on the detail page",
      expectedOutcome: "Cart counter increments",
    },
    {
      title: "Proceed to checkout",
      instruction: "Advance through the cart into the checkout summary",
      expectedOutcome: "Checkout summary visible",
    },
    {
      title: "Capture web vitals",
      instruction: "Capture web vitals on landing and checkout pages",
      expectedOutcome: "Metrics reported",
    },
  ],
};

describe("PlanDecomposer template mode", () => {
  it("produces at least 2 steps for a multi-step journey prompt", async () => {
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(CATALOG_CHECKOUT_PROMPT, "template", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturning(catalogCheckoutPlan)),
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.every((step) => step.status === "pending")).toBe(true);
  });

  it("produces a single navigation step when the prompt is a bare URL", async () => {
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose("https://example.com", "template", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturning(catalogCheckoutPlan)),
    );
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].title.toLowerCase()).toContain("example.com");
  });
});

describe("PlanDecomposer oracle-plan mode (structured output)", () => {
  it("decodes the structured plan from the AI SDK into >=4 steps", async () => {
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(CATALOG_CHECKOUT_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturning(catalogCheckoutPlan)),
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.steps[0].id).toBe("step-01");
    expect(plan.steps[3].id).toBe("step-04");
    expect(Option.isSome(plan.steps[0].routeHint)).toBe(true);
  });

  it("accepts the structured-output happy path (single JSON object)", async () => {
    const shortPlan: FrontierPlan = {
      steps: [
        {
          title: "Open landing",
          instruction: "Navigate to the site",
          expectedOutcome: "Page loads",
        },
        {
          title: "Capture vitals",
          instruction: "Record CWV",
          expectedOutcome: "Metrics recorded",
        },
      ],
    };
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(DOCS_SEARCH_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturning(shortPlan)),
    );
    expect(plan.steps.length).toBe(2);
  });

  it("surfaces a DecomposeError when the model wraps JSON in a markdown fence (structured-output violation)", async () => {
    // Gemini's native structured-output mode is API-level constrained to emit
    // raw JSON — no fences. If a non-conforming model somehow emits fenced
    // JSON, the AI SDK's generateObject parse fails and we surface a typed
    // DecomposeError, not an uncaught SyntaxError crash.
    const fencedJson =
      "```json\n" +
      JSON.stringify({
        steps: [
          {
            title: "Open landing",
            instruction: "Navigate to the site",
            expectedOutcome: "Page loads",
          },
        ],
      }) +
      "\n```";

    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(DOCS_SEARCH_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturningRawText(fencedJson)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
      }
    }
  });

  it("surfaces a DecomposeError when the model returns prose instead of JSON", async () => {
    const reachedPreambleResponse =
      "Reached the conclusion that the user wants to perform a multi-step browser journey. Here is the plan:\n- Step 1: Navigate\n- Step 2: Open menu";

    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(CATALOG_CHECKOUT_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturningRawText(reachedPreambleResponse)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
      }
    }
  });

  it("surfaces a DecomposeError when the model response is malformed JSON", async () => {
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(FORM_WIZARD_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturningRawText("definitely not json {{{")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
      }
    }
  });

  it("surfaces a DecomposeError when the model call throws (network/rate-limit)", async () => {
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(DOCS_SEARCH_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelThrowing(new Error("429 rate limit exceeded"))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
        expect(failure.value.cause).toContain("429 rate limit");
      }
    }
  });

  it("surfaces a DecomposeError when the model prepends a 'Reached …' preamble (Apr-24 regression)", async () => {
    // This is the JSON-preamble failure shape that crashed perf-agent tui on
    // 2026-04-24: the planner's raw JSON.parse saw an unquoted "Reached"
    // identifier at the start of the accumulated stream text and threw a
    // SyntaxError. With structured output via generateObject, the same shape
    // now surfaces as a typed DecomposeError instead of a crash. The prompt
    // content is intentionally generic; the bug is about JSON parse
    // resilience, not any particular user prompt.
    const preambleResponse =
      "Reached the following plan for the user's request:\n\n" +
      JSON.stringify({
        steps: [
          {
            title: "Open landing",
            instruction: "Navigate to the site",
            expectedOutcome: "Page loads",
          },
        ],
      });
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(CATALOG_CHECKOUT_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturningRawText(preambleResponse)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
      }
    }
  });

  it("surfaces a DecomposeError when the model appends trailing commentary after the JSON", async () => {
    const trailingResponse =
      JSON.stringify({
        steps: [
          {
            title: "Open landing",
            instruction: "Navigate to the site",
            expectedOutcome: "Page loads",
          },
        ],
      }) + "\n\nNote: this plan focuses on landing-page metrics.";
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(DOCS_SEARCH_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerFromModel(buildModelReturningRawText(trailingResponse)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
      }
    }
  });
});

describe("PlanDecomposer no-API-key path (CRITICAL-1 regression)", () => {
  // These tests lock in the CRITICAL-1 fix: PlanDecomposer.layer (the layer
  // the eval harness wires up via @neuve/evals) must build without the
  // Gemini API key. Template-mode and `none` callers never touch the oracle
  // planner, so requiring the key at layer-build time would break the gemma
  // runner (Gemma-only; no business requiring a Gemini key).
  const emptyConfigProvider = ConfigProvider.fromUnknown({});
  const emptyConfigProviderLayer = ConfigProvider.layerAdd(emptyConfigProvider, {
    asPrimary: true,
  });
  const decomposerLayerNoKey = Layer.mergeAll(
    PlanDecomposer.layer.pipe(Layer.provide(emptyConfigProviderLayer)),
    TokenUsageBus.layerNoop,
  );

  it("PlanDecomposer.layer resolves without GOOGLE_GENERATIVE_AI_API_KEY (template mode works)", async () => {
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(CATALOG_CHECKOUT_PROMPT, "template", decomposeContext);
      }),
      decomposerLayerNoKey,
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
  });

  it("PlanDecomposer.layer resolves without the API key; plannerMode='none' never calls the planner (dies by design)", async () => {
    // `decompose` with mode=none is an `Effect.die` per contract — callers
    // (Executor) skip the decomposer entirely. What matters here is that
    // layer BUILD succeeds even though planFrontier would fail.
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(DOCS_SEARCH_PROMPT, "none", decomposeContext);
      }),
      decomposerLayerNoKey,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Layer built successfully (no PlannerConfigError at layer build), so
      // the failure here is the deliberate `Effect.die` from inside
      // decompose(mode=none), which surfaces as a defect in the cause.
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }
  });

  it("plannerMode='gemma-react' also defects when called — Gemma owns the plan via PLAN_UPDATE inside the ReAct loop", async () => {
    // Symmetrical to the `none` defect. The R5 `gemma-react` literal signals
    // "ReAct mode owns plan authorship"; if the harness ever calls
    // `decompose(prompt, "gemma-react", ...)`, it's a contract violation by
    // the runner — the executor's `runRealTask` short-circuits both `none`
    // and `gemma-react` before reaching `decompose`. Defecting on the
    // unexpected path keeps mistakes loud.
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(DOCS_SEARCH_PROMPT, "gemma-react", decomposeContext);
      }),
      decomposerLayerNoKey,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }
  });

  it("oracle-plan mode without the key surfaces a DecomposeError (lazy key read fires on first planFrontier call)", async () => {
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(CATALOG_CHECKOUT_PROMPT, "oracle-plan", decomposeContext);
      }),
      decomposerLayerNoKey,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
        expect(failure.value.cause).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
        expect(failure.value.cause).toContain("EVAL_PLANNER=oracle-plan");
      }
    }
  });

  it("PlannerConfigError surfaces an actionable message", () => {
    const error = new PlannerConfigError({ reason: "GOOGLE_GENERATIVE_AI_API_KEY is unset" });
    expect(error.message).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(error.message).toContain("EVAL_PLANNER=oracle-plan");
  });
});

describe("splitByConnectives", () => {
  it("splits a connective-rich multi-step prompt into clauses", () => {
    // Specifically exercises the connective-splitting semantics: `, and`, `,`,
    // `and then`, `then`, and sentence-boundary splits should all produce
    // clauses >= MIN_CLAUSE_CHARS.
    const clauses = splitByConnectives(
      "open example.com, then click the login button and then fill the form. Next, submit the form",
    );
    expect(clauses.length).toBeGreaterThanOrEqual(3);
  });

  it("returns an empty array for an empty prompt", () => {
    expect(splitByConnectives("")).toEqual([]);
  });
});
