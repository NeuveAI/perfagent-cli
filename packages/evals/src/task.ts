import { Schema } from "effect";

export const PerfCapture = Schema.Literals(["required", "optional"] as const);
export type PerfCapture = typeof PerfCapture.Type;

export class KeyNode extends Schema.Class<KeyNode>("@evals/KeyNode")({
  urlPattern: Schema.String,
  domAssertion: Schema.String,
  perfCapture: Schema.optional(PerfCapture),
}) {}

export class PerfBudget extends Schema.Class<PerfBudget>("@evals/PerfBudget")({
  lcpMs: Schema.optional(Schema.Number),
  clsScore: Schema.optional(Schema.Number),
  inpMs: Schema.optional(Schema.Number),
}) {}

export const ExpectedFinalState = Schema.Struct({
  urlPattern: Schema.String,
  domAssertion: Schema.String,
});
export type ExpectedFinalState = typeof ExpectedFinalState.Type;

export class EvalTask extends Schema.Class<EvalTask>("@evals/EvalTask")({
  id: Schema.String,
  prompt: Schema.String,
  keyNodes: Schema.Array(KeyNode),
  expectedFinalState: ExpectedFinalState,
  perfBudget: Schema.optional(PerfBudget),
}) {
  static make = Schema.decodeUnknownSync(this);
  static decodeEffect = Schema.decodeUnknownEffect(this);
}

export class ToolCall extends Schema.Class<ToolCall>("@evals/ToolCall")({
  name: Schema.String,
  arguments: Schema.Record(Schema.String, Schema.Unknown),
  wellFormed: Schema.Boolean,
}) {}

export class ExecutedTrace extends Schema.Class<ExecutedTrace>("@evals/ExecutedTrace")({
  reachedKeyNodes: Schema.Array(KeyNode),
  toolCalls: Schema.Array(ToolCall),
  finalUrl: Schema.String,
  finalDom: Schema.String,
}) {}
