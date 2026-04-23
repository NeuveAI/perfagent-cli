import { Schema } from "effect";

export const PLANNER_MODES = ["frontier", "template", "none"] as const;

export const PlannerMode = Schema.Literals(PLANNER_MODES);
export type PlannerMode = typeof PlannerMode.Type;

export const DEFAULT_PLANNER_MODE: PlannerMode = "frontier";

export const isPlannerMode = (value: string): value is PlannerMode =>
  (PLANNER_MODES as readonly string[]).includes(value);

export const parsePlannerMode = (raw: string | undefined): PlannerMode => {
  if (raw === undefined) return DEFAULT_PLANNER_MODE;
  if (isPlannerMode(raw)) return raw;
  throw new Error(`Unknown planner mode "${raw}". Expected one of: ${PLANNER_MODES.join(", ")}.`);
};

export class DecomposeError extends Schema.ErrorClass<DecomposeError>("@supervisor/DecomposeError")(
  {
    _tag: Schema.tag("DecomposeError"),
    mode: PlannerMode,
    cause: Schema.String,
  },
) {
  displayName = `Plan decomposition failed`;
  message = `Plan decomposition (${this.mode}) failed: ${this.cause}`;
}
