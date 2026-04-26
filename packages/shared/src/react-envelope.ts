import { Effect, Schema } from "effect";

const PlanUpdateAction = Schema.Literals(["insert", "replace", "remove", "replace_step"] as const);
export type PlanUpdateAction = typeof PlanUpdateAction.Type;

const AssertionFailedCategory = Schema.Literals([
  "budget-violation",
  "regression",
  "resource-blocker",
  "memory-leak",
  "abort",
] as const);
export type AssertionFailedCategory = typeof AssertionFailedCategory.Type;

const AssertionFailedDomain = Schema.Literals([
  "design",
  "responsive",
  "perf",
  "a11y",
  "other",
] as const);
export type AssertionFailedDomain = typeof AssertionFailedDomain.Type;

const RunCompletedStatus = Schema.Literals(["passed", "failed"] as const);
export type RunCompletedStatus = typeof RunCompletedStatus.Type;

export class Thought extends Schema.TaggedClass<Thought>()("THOUGHT", {
  stepId: Schema.String,
  thought: Schema.String,
}) {}

export class Action extends Schema.TaggedClass<Action>()("ACTION", {
  stepId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,
}) {}

export class PlanUpdate extends Schema.TaggedClass<PlanUpdate>()("PLAN_UPDATE", {
  stepId: Schema.String,
  action: PlanUpdateAction,
  payload: Schema.Unknown,
}) {}

export class StepDone extends Schema.TaggedClass<StepDone>()("STEP_DONE", {
  stepId: Schema.String,
  summary: Schema.String,
}) {}

export class AssertionFailed extends Schema.TaggedClass<AssertionFailed>()("ASSERTION_FAILED", {
  stepId: Schema.String,
  category: AssertionFailedCategory,
  domain: AssertionFailedDomain,
  reason: Schema.String,
  evidence: Schema.String,
  abortReason: Schema.optional(Schema.String),
}) {}

export class RunCompleted extends Schema.TaggedClass<RunCompleted>()("RUN_COMPLETED", {
  status: RunCompletedStatus,
  summary: Schema.String,
  // Optional abort metadata that mirrors `RunFinished.abort` in
  // `@neuve/shared/models`. Set ONLY by runtime synthesizers (e.g. the
  // gemini-react eval runner's early-termination paths) to flag a non-natural
  // exit so the supervisor's `runFinishedSatisfiesGate` short-circuits and
  // emits the terminal envelope downstream instead of waiting for all plan
  // steps to be terminal. Reasons are short kebab-case identifiers
  // (`doom-loop`, `max-rounds`, `unexpected-envelope`) — richer detail goes
  // in `summary`. Models do NOT set this in normal operation; the field is
  // optional precisely to keep the natural happy-path schema unchanged.
  abort: Schema.optional(Schema.Struct({ reason: Schema.String })),
}) {}

export const AgentTurn = Schema.Union([
  Thought,
  Action,
  PlanUpdate,
  StepDone,
  AssertionFailed,
  RunCompleted,
]);
export type AgentTurn = typeof AgentTurn.Type;

const decodeAgentTurnUnknown = Schema.decodeUnknownEffect(AgentTurn);
const decodeAgentTurnFromString = Schema.decodeEffect(Schema.fromJsonString(AgentTurn));

export const parseAgentTurn = Effect.fn("parseAgentTurn")(function* (input: unknown) {
  return yield* decodeAgentTurnUnknown(input);
});

export const parseAgentTurnFromString = Effect.fn("parseAgentTurnFromString")(function* (
  input: string,
) {
  return yield* decodeAgentTurnFromString(input);
});
