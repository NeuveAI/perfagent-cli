import { Effect, Layer, Option, Schema, ServiceMap, Stream } from "effect";
import {
  AcpAgentMessageChunk,
  AnalysisStep,
  ChangesFor,
  DraftId,
  PerfPlan,
  PerfPlanDraft,
  PlanId,
  StepId,
} from "@neuve/shared/models";
import {
  Agent,
  AgentStreamOptions,
  type AcpProviderUnauthenticatedError,
  type AcpProviderUsageLimitError,
  type AcpSessionCreateError,
  type AcpStreamError,
} from "@neuve/agent";
import { DecomposeError, type PlannerMode } from "./errors";
import {
  PLAN_DECOMPOSER_MAX_STEPS,
  PLAN_DECOMPOSER_MODEL_CONFIG_ID,
  PLAN_DECOMPOSER_MODEL_ID,
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
} from "./planner-prompt";

const MIN_CLAUSE_CHARS = 8;
const DEFAULT_ROUTE_HINT_LIMIT = 80;

const FrontierStep = Schema.Struct({
  title: Schema.String,
  instruction: Schema.String,
  expectedOutcome: Schema.String,
  routeHint: Schema.optional(Schema.String),
});
type FrontierStep = typeof FrontierStep.Type;

const FrontierPlan = Schema.Struct({
  steps: Schema.Array(FrontierStep),
});

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
  return capitalize(normalized.slice(0, 57)) + "\u2026";
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

const stripMarkdownFence = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, "");
  return withoutOpen.replace(/```\s*$/i, "").trim();
};

const extractJsonObject = (raw: string): string => {
  const sanitized = stripMarkdownFence(raw);
  const firstBrace = sanitized.indexOf("{");
  if (firstBrace === -1) return sanitized;
  const lastBrace = sanitized.lastIndexOf("}");
  if (lastBrace <= firstBrace) return sanitized;
  return sanitized.slice(firstBrace, lastBrace + 1);
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

export class PlannerAgent extends ServiceMap.Service<
  PlannerAgent,
  {
    readonly stream: (
      options: AgentStreamOptions,
    ) => Stream.Stream<
      import("@neuve/shared/models").AcpSessionUpdate,
      | AcpStreamError
      | AcpSessionCreateError
      | AcpProviderUnauthenticatedError
      | AcpProviderUsageLimitError
    >;
  }
>()("@supervisor/PlannerAgent") {
  static layerFromAgent = Layer.effect(PlannerAgent)(
    Effect.gen(function* () {
      const agent = yield* Agent;
      return PlannerAgent.of({ stream: agent.stream });
    }),
  );

  static layerFromGemini = this.layerFromAgent.pipe(Layer.provide(Agent.layerGemini));
}

export class PlanDecomposer extends ServiceMap.Service<PlanDecomposer>()(
  "@supervisor/PlanDecomposer",
  {
    make: Effect.gen(function* () {
      const plannerAgent = yield* PlannerAgent;

      const callFrontier = Effect.fn("PlanDecomposer.callFrontier")(function* (userPrompt: string) {
        const streamOptions = new AgentStreamOptions({
          cwd: process.cwd(),
          sessionId: Option.none(),
          prompt: buildPlannerUserPrompt(userPrompt),
          systemPrompt: Option.some(buildPlannerSystemPrompt()),
          mcpEnv: [],
          modelPreference: {
            configId: PLAN_DECOMPOSER_MODEL_CONFIG_ID,
            value: PLAN_DECOMPOSER_MODEL_ID,
          },
        });

        const responseText = yield* plannerAgent.stream(streamOptions).pipe(
          Stream.filter(
            (update): update is AcpAgentMessageChunk =>
              update.sessionUpdate === "agent_message_chunk",
          ),
          Stream.map((update) => (update.content.type === "text" ? update.content.text : "")),
          Stream.runFold(
            () => "",
            (accumulated: string, chunk: string) => accumulated + chunk,
          ),
        );

        return responseText;
      });

      const decomposeFrontier = Effect.fn("PlanDecomposer.decomposeFrontier")(function* (
        prompt: string,
      ) {
        const raw = yield* callFrontier(prompt).pipe(
          Effect.catchTags({
            AcpStreamError: (error) =>
              new DecomposeError({ mode: "frontier", cause: String(error.cause) }).asEffect(),
            AcpSessionCreateError: (error) =>
              new DecomposeError({ mode: "frontier", cause: String(error.cause) }).asEffect(),
            AcpProviderUnauthenticatedError: (error) =>
              new DecomposeError({ mode: "frontier", cause: error.message }).asEffect(),
            AcpProviderUsageLimitError: (error) =>
              new DecomposeError({ mode: "frontier", cause: error.message }).asEffect(),
          }),
        );

        const jsonText = extractJsonObject(raw);
        const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(FrontierPlan))(
          jsonText,
        ).pipe(
          Effect.catchTag("SchemaError", (schemaError) =>
            new DecomposeError({
              mode: "frontier",
              cause: `Failed to decode planner response: ${schemaError.message}`,
            }).asEffect(),
          ),
        );

        yield* Effect.logInfo("Frontier plan decomposed", {
          rawLength: raw.length,
          stepCount: decoded.steps.length,
        });

        return frontierStepsToAnalysisSteps(decoded.steps);
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
  },
) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(PlannerAgent.layerFromGemini));
}
