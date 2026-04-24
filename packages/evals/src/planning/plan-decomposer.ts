import { Config, Effect, Layer, Option, Redacted, Schema, ServiceMap } from "effect";
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import {
  AnalysisStep,
  ChangesFor,
  DraftId,
  PerfPlan,
  PerfPlanDraft,
  PlanId,
  StepId,
} from "@neuve/shared/models";
import { TokenUsageBus, TokenUsageEntry } from "@neuve/shared/token-usage-bus";
import { DecomposeError, PlannerCallError, PlannerConfigError, type PlannerMode } from "./errors";
import {
  PLAN_DECOMPOSER_MAX_STEPS,
  PLAN_DECOMPOSER_MODEL_ID,
  PLAN_DECOMPOSER_TEMPERATURE,
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
} from "./planner-prompt";

const MIN_CLAUSE_CHARS = 8;
const DEFAULT_ROUTE_HINT_LIMIT = 80;

const FrontierStepSchema = z.object({
  title: z.string().describe("Short imperative label for this step (<=60 chars recommended)."),
  instruction: z
    .string()
    .describe("Single sentence describing the action or navigation for this step."),
  expectedOutcome: z
    .string()
    .describe("Observable state after this step (URL, visible element, captured metric)."),
  routeHint: z
    .string()
    .optional()
    .describe("Optional URL fragment or path if known; omit if unknown."),
});

const FrontierPlanSchema = z.object({
  steps: z
    .array(FrontierStepSchema)
    .min(1)
    .max(PLAN_DECOMPOSER_MAX_STEPS)
    .describe("Ordered list of sub-goals the browser-driving agent must execute."),
});

export type FrontierPlan = z.infer<typeof FrontierPlanSchema>;
export type FrontierStep = z.infer<typeof FrontierStepSchema>;

const CONNECTIVE_SPLIT_PATTERN =
  /\s*(?:,?\s*(?:and\s+then|then|next|after\s+that|afterwards|,\s*and)\s+|;\s+|\.\s+(?=[A-Z]))/i;

const LEADING_VERB_PATTERN =
  /^(?:lets?|let\s+us|please\s+|now\s+|first,?\s+|also\s+|go\s+and\s+|go\s+ahead\s+and\s+)+/i;

const URL_PATTERN = /https?:\/\/[^\s,]+|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s,]*)?/i;

const extractUrl = (text: string): string | undefined => {
  const match = URL_PATTERN.exec(text);
  if (!match) return undefined;
  return match[0].replace(/[.,;]+$/, "");
};

const makeStepId = (index: number): StepId =>
  StepId.makeUnsafe(`step-${String(index + 1).padStart(2, "0")}`);

const makeEmptyStep = (index: number, title: string, instruction: string): AnalysisStep =>
  new AnalysisStep({
    id: makeStepId(index),
    title: title.slice(0, 80),
    instruction,
    expectedOutcome: "",
    routeHint: Option.none(),
    status: "pending",
    summary: Option.none(),
    startedAt: Option.none(),
    endedAt: Option.none(),
  });

const toDraft = (
  instruction: string,
  changesFor: ChangesFor,
  currentBranch: string,
  diffPreview: string,
  baseUrl: string | undefined,
  isHeadless: boolean,
  cookieBrowserKeys: readonly string[],
): PerfPlanDraft =>
  new PerfPlanDraft({
    id: DraftId.makeUnsafe(crypto.randomUUID()),
    changesFor,
    currentBranch,
    diffPreview,
    fileStats: [],
    instruction,
    baseUrl: baseUrl ? Option.some(baseUrl) : Option.none(),
    isHeadless,
    cookieBrowserKeys,
    targetUrls: [],
    perfBudget: Option.none(),
  });

const toPerfPlan = (
  instruction: string,
  changesFor: ChangesFor,
  currentBranch: string,
  diffPreview: string,
  baseUrl: string | undefined,
  isHeadless: boolean,
  cookieBrowserKeys: readonly string[],
  steps: readonly AnalysisStep[],
  title: string,
  rationale: string,
): PerfPlan =>
  new PerfPlan({
    ...toDraft(
      instruction,
      changesFor,
      currentBranch,
      diffPreview,
      baseUrl,
      isHeadless,
      cookieBrowserKeys,
    ),
    id: PlanId.makeUnsafe(crypto.randomUUID()),
    title,
    rationale,
    steps,
  });

const capitalize = (value: string): string => {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const cleanClause = (clause: string): string =>
  clause
    .replace(LEADING_VERB_PATTERN, "")
    .trim()
    .replace(/^[,;.]+|[,;.]+$/g, "")
    .trim();

const clauseTitle = (clause: string): string => {
  const normalized = clause.replace(/\s+/g, " ").trim();
  if (normalized.length <= 60) return capitalize(normalized);
  return capitalize(normalized.slice(0, 57)) + "…";
};

export const splitByConnectives = (prompt: string): string[] => {
  const stripped = prompt.trim();
  if (stripped.length === 0) return [];

  const parts = stripped
    .split(CONNECTIVE_SPLIT_PATTERN)
    .map((part) => cleanClause(part))
    .filter((part) => part.length >= MIN_CLAUSE_CHARS);

  return parts;
};

const frontierStepsToAnalysisSteps = (steps: readonly FrontierStep[]): AnalysisStep[] =>
  steps.slice(0, PLAN_DECOMPOSER_MAX_STEPS).map(
    (step, index) =>
      new AnalysisStep({
        id: makeStepId(index),
        title: step.title.slice(0, 80),
        instruction: step.instruction,
        expectedOutcome: step.expectedOutcome,
        routeHint:
          step.routeHint && step.routeHint.length > 0
            ? Option.some(step.routeHint.slice(0, DEFAULT_ROUTE_HINT_LIMIT))
            : Option.none(),
        status: "pending",
        summary: Option.none(),
        startedAt: Option.none(),
        endedAt: Option.none(),
      }),
  );

const buildTemplateSteps = (prompt: string): AnalysisStep[] => {
  const clauses = splitByConnectives(prompt);
  if (clauses.length === 0) {
    const url = extractUrl(prompt);
    if (url) {
      return [makeEmptyStep(0, `Navigate to ${url}`, `Navigate to ${url}`)];
    }
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return [];
    return [makeEmptyStep(0, clauseTitle(trimmed), trimmed)];
  }

  return clauses.map((clause, index) => makeEmptyStep(index, clauseTitle(clause), clause));
};

export interface PlannerAgentOptions {
  readonly temperature?: number;
}

// Sibling counterpart for `PERF_AGENT_LOCAL_MODEL` used by the Gemma runner
// (see packages/evals/src/runners/gemma.ts). Both env vars follow the same
// `PERF_AGENT_<ROLE>_MODEL` naming convention.
const PlannerModelIdSchema = Schema.String.check(Schema.isStartsWith("gemini-"));
const decodePlannerModelId = Schema.decodeUnknownEffect(PlannerModelIdSchema);

const makePlannerAgentService = (
  getModel: Effect.Effect<LanguageModel, PlannerConfigError>,
  temperature: number,
) => {
  const planFrontier = Effect.fn("PlannerAgent.planFrontier")(function* (userPrompt: string) {
    yield* Effect.annotateCurrentSpan({ promptLength: userPrompt.length });
    const tokenUsageBus = yield* TokenUsageBus;
    const model = yield* getModel;
    const result = yield* Effect.tryPromise({
      try: () =>
        generateObject({
          model,
          schema: FrontierPlanSchema,
          schemaName: "PerfAgentFrontierPlan",
          schemaDescription:
            "Ordered sub-goals for a browser-driving agent to execute the user's performance-testing instruction.",
          temperature,
          system: buildPlannerSystemPrompt(),
          prompt: buildPlannerUserPrompt(userPrompt),
        }),
      catch: (cause) =>
        new PlannerCallError({
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    const promptTokens = result.usage.inputTokens ?? 0;
    const completionTokens = result.usage.outputTokens ?? 0;
    const totalTokens = result.usage.totalTokens ?? promptTokens + completionTokens;
    yield* tokenUsageBus.publish(
      new TokenUsageEntry({
        source: "planner",
        promptTokens,
        completionTokens,
        totalTokens,
        timestamp: Date.now(),
      }),
    );
    yield* Effect.logInfo("Frontier plan generated", {
      stepCount: result.object.steps.length,
      finishReason: result.finishReason,
      promptTokens,
      completionTokens,
      totalTokens,
    });
    return result.object satisfies FrontierPlan;
  });

  return { planFrontier } as const;
};

/**
 * PlannerAgent — Gemini 3 Flash preview-backed frontier planner. Wraps
 * `generateObject` from the AI SDK with a fixed Zod schema (`FrontierPlanSchema`)
 * and a domain-specific system prompt. Structured output mode is used so the
 * model is constrained at the API level to return schema-conformant JSON —
 * no markdown fences, no preamble prose, no chain-of-thought leakage.
 *
 * Wiring (eval-only post frontier-planner removal):
 *   - Production `static layer` builds an always-succeeding service whose
 *     `planFrontier` method lazily reads `Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY")`
 *     (and `Config.string("PERF_AGENT_PLANNER_MODEL")`) on FIRST call and
 *     memoizes the result. Layer build never fails for missing API key —
 *     `template` and `none` modes build the layer but never call
 *     `planFrontier`, so they work without the key. A missing or empty key
 *     surfaces as `PlannerConfigError` only at the first frontier decompose
 *     call, with an actionable message directing the user to set the key.
 *   - `static layerFromModel(model, options)` bypasses provider construction
 *     entirely and takes a pre-built `LanguageModel`. Tests pass
 *     `MockLanguageModelV4` from `ai/test`. Production code never uses this.
 *
 * This mirrors the `@evals/LlmJudge` pattern so production and test code paths
 * are identical past the model boundary (both go through `generateObject`),
 * keeping test coverage representative of production behavior.
 */
export class PlannerAgent extends ServiceMap.Service<PlannerAgent>()("@evals/PlannerAgent", {
  make: Effect.gen(function* () {
    const loadModel = Effect.gen(function* () {
      const apiKeyOption = yield* Config.option(Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY"));
      if (!Option.isSome(apiKeyOption)) {
        return yield* new PlannerConfigError({
          reason: "GOOGLE_GENERATIVE_AI_API_KEY is unset",
        });
      }
      const apiKey = Redacted.value(apiKeyOption.value);
      if (apiKey.trim().length === 0) {
        return yield* new PlannerConfigError({
          reason: "GOOGLE_GENERATIVE_AI_API_KEY is empty",
        });
      }
      const rawModelIdOption = yield* Config.option(Config.string("PERF_AGENT_PLANNER_MODEL"));
      const rawModelId = Option.isSome(rawModelIdOption)
        ? rawModelIdOption.value
        : PLAN_DECOMPOSER_MODEL_ID;
      const modelId = yield* decodePlannerModelId(rawModelId).pipe(
        Effect.catchTag("SchemaError", (schemaError) =>
          new PlannerConfigError({
            reason: `PERF_AGENT_PLANNER_MODEL value "${rawModelId}" is invalid (expected prefix "gemini-"): ${schemaError.message}`,
          }).asEffect(),
        ),
      );
      const provider = createGoogleGenerativeAI({ apiKey });
      const model = provider(modelId) satisfies LanguageModel;
      yield* Effect.logInfo("PlannerAgent ready", { modelId });
      return model;
    }).pipe(
      // Config.option swallows MissingKey for both reads above; any remaining
      // ConfigError would be a ConfigProvider bug, so die on it.
      Effect.catchTag("ConfigError", Effect.die),
    );
    // Memoize across planFrontier calls: first call reads Config + builds the
    // provider; subsequent calls replay the cached model (or the cached error
    // if the key was missing/empty on first call).
    const getModel = yield* Effect.cached(loadModel);
    return makePlannerAgentService(getModel, PLAN_DECOMPOSER_TEMPERATURE);
  }),
}) {
  static layer = Layer.effect(this)(this.make);

  static layerFromModel = (model: LanguageModel, options: PlannerAgentOptions = {}) =>
    Layer.succeed(
      this,
      makePlannerAgentService(
        Effect.succeed(model),
        options.temperature ?? PLAN_DECOMPOSER_TEMPERATURE,
      ),
    );
}

export class PlanDecomposer extends ServiceMap.Service<PlanDecomposer>()("@evals/PlanDecomposer", {
  make: Effect.gen(function* () {
    const plannerAgent = yield* PlannerAgent;

    const decomposeFrontier = Effect.fn("PlanDecomposer.decomposeFrontier")(function* (
      prompt: string,
    ) {
      const plan = yield* plannerAgent.planFrontier(prompt).pipe(
        Effect.catchTag("PlannerCallError", (error) =>
          new DecomposeError({ mode: "frontier", cause: error.cause }).asEffect(),
        ),
        Effect.catchTag("PlannerConfigError", (error) =>
          new DecomposeError({ mode: "frontier", cause: error.message }).asEffect(),
        ),
      );

      yield* Effect.logInfo("Frontier plan decomposed", {
        stepCount: plan.steps.length,
      });

      return frontierStepsToAnalysisSteps(plan.steps);
    });

    const decompose = Effect.fn("PlanDecomposer.decompose")(function* (
      prompt: string,
      mode: PlannerMode,
      context: {
        readonly changesFor: ChangesFor;
        readonly currentBranch: string;
        readonly diffPreview: string;
        readonly baseUrl: string | undefined;
        readonly isHeadless: boolean;
        readonly cookieBrowserKeys: readonly string[];
      },
    ) {
      yield* Effect.annotateCurrentSpan({ mode, promptLength: prompt.length });

      if (mode === "none") {
        return yield* Effect.die("PlanDecomposer.decompose should not be called with mode=none");
      }

      const steps: readonly AnalysisStep[] =
        mode === "frontier" ? yield* decomposeFrontier(prompt) : buildTemplateSteps(prompt);

      if (steps.length === 0) {
        return yield* new DecomposeError({
          mode,
          cause: `No steps produced from prompt (length ${prompt.length})`,
        });
      }

      const title = prompt.split(/\s+/).slice(0, 8).join(" ").slice(0, 80);

      yield* Effect.logInfo("Plan decomposition complete", {
        mode,
        stepCount: steps.length,
      });

      return toPerfPlan(
        prompt,
        context.changesFor,
        context.currentBranch,
        context.diffPreview,
        context.baseUrl,
        context.isHeadless,
        context.cookieBrowserKeys,
        steps,
        title.length > 0 ? title : prompt.slice(0, 80),
        `Decomposed via ${mode} planner`,
      );
    });

    return { decompose } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(PlannerAgent.layer));

  static layerWithPlannerAgent = (plannerAgentLayer: Layer.Layer<PlannerAgent>) =>
    Layer.effect(this)(this.make).pipe(Layer.provide(plannerAgentLayer));
}
