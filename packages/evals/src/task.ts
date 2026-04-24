import { Schema } from "effect";
import { TokenUsageEntry } from "@neuve/shared/token-usage-bus";

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
  // Per-call token usage captured during the task (one entry per planner
  // call + one per Gemma executor turn). Empty for runs where tokenomics
  // instrumentation isn't wired (e.g. mock runner, non-Ollama backends).
  tokenUsages: Schema.Array(TokenUsageEntry),
}) {
  /**
   * Per-task tokenomics rollup — sum of prompt/completion tokens across the
   * full run, the peak single-call prompt size (proxy for context growth
   * that drives Q6), and the planner/executor split. Computed from
   * `tokenUsages` to keep the domain model the single source of truth;
   * trace writers and analysis scripts should prefer this getter over
   * re-implementing the aggregation.
   */
  get tokenomics(): {
    readonly totalPromptTokens: number;
    readonly totalCompletionTokens: number;
    readonly totalTokens: number;
    readonly peakPromptTokens: number;
    readonly turnCount: number;
    readonly plannerTokens: number;
    readonly executorTokens: number;
  } {
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let peakPromptTokens = 0;
    let plannerTokens = 0;
    let executorTokens = 0;
    let executorTurnCount = 0;
    for (const entry of this.tokenUsages) {
      totalPromptTokens += entry.promptTokens;
      totalCompletionTokens += entry.completionTokens;
      totalTokens += entry.totalTokens;
      if (entry.promptTokens > peakPromptTokens) peakPromptTokens = entry.promptTokens;
      if (entry.source === "planner") plannerTokens += entry.totalTokens;
      if (entry.source === "executor") {
        executorTokens += entry.totalTokens;
        executorTurnCount += 1;
      }
    }
    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      peakPromptTokens,
      turnCount: executorTurnCount,
      plannerTokens,
      executorTokens,
    };
  }
}
