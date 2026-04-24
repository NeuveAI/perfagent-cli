import { Schema } from "effect";

export const PLANNER_MODES = ["oracle-plan", "template", "none"] as const;

export const PlannerMode = Schema.Literals(PLANNER_MODES);
export type PlannerMode = typeof PlannerMode.Type;

export const DEFAULT_PLANNER_MODE: PlannerMode = "oracle-plan";

export const isPlannerMode = (value: string): value is PlannerMode =>
  (PLANNER_MODES as readonly string[]).includes(value);

export const parsePlannerMode = (raw: string | undefined): PlannerMode => {
  if (raw === undefined) return DEFAULT_PLANNER_MODE;
  if (isPlannerMode(raw)) return raw;
  throw new Error(`Unknown planner mode "${raw}". Expected one of: ${PLANNER_MODES.join(", ")}.`);
};

export class DecomposeError extends Schema.ErrorClass<DecomposeError>("@evals/DecomposeError")({
  _tag: Schema.tag("DecomposeError"),
  mode: PlannerMode,
  cause: Schema.String,
}) {
  displayName = `Plan decomposition failed`;
  message = `Plan decomposition (${this.mode}) failed: ${this.cause}`;
}

export class PlannerConfigError extends Schema.ErrorClass<PlannerConfigError>(
  "@evals/PlannerConfigError",
)({
  _tag: Schema.tag("PlannerConfigError"),
  reason: Schema.String,
}) {
  displayName = `Frontier planner not configured`;
  message = `Frontier planner not configured: ${this.reason}. Set GOOGLE_GENERATIVE_AI_API_KEY in your shell (or a dotenv file loaded by perf-agent) before running the eval harness with EVAL_PLANNER=frontier.`;
}

export class PlannerCallError extends Schema.ErrorClass<PlannerCallError>(
  "@evals/PlannerCallError",
)({
  _tag: Schema.tag("PlannerCallError"),
  cause: Schema.String,
}) {
  displayName = `Frontier planner call failed`;
  message = `Frontier planner call failed: ${this.cause}`;
}
