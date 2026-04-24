import { Effect } from "effect";
import type { EvalRunner } from "./types";

export interface DualRunner {
  readonly primary: EvalRunner;
  readonly secondary: EvalRunner;
  readonly name: string;
}

/**
 * makeDualRunner — pairs two EvalRunners (primary + secondary) for
 * cross-model evaluation on the same task set.
 *
 * Evalite emits one score per task per suite, so dual mode is *not* a single
 * merged runner: the orchestrator registers two evalite suites side-by-side,
 * one per runner, and scoring diffs (Δ) are computed post-hoc by reading the
 * per-suite scoreboard or the paired trace files (`<primary>__<taskId>.ndjson`
 * and `<secondary>__<taskId>.ndjson`) sharing the same `traceDir`.
 *
 * This helper bundles the pair + a composite display name so `smoke.eval.ts`
 * can feed both suites into evalite with one construction call.
 */
export const makeDualRunner = (primary: EvalRunner, secondary: EvalRunner): DualRunner => ({
  primary,
  secondary,
  name: `${primary.name}+${secondary.name}`,
});

/**
 * runDualSequential — convenience for ad-hoc scripts that want a single
 * Effect running both runners on one task (primary first, then secondary).
 *
 * Returns both ExecutedTrace projections so a caller can compute a Δ in
 * memory. NOT used inside evalite's task pipeline — that needs per-suite
 * scoring, see makeDualRunner above.
 */
export const runDualSequential = Effect.fn("DualRunner.runSequential")(function* (
  dual: DualRunner,
  task: Parameters<EvalRunner["run"]>[0],
) {
  yield* Effect.annotateCurrentSpan({
    dual: dual.name,
    primary: dual.primary.name,
    secondary: dual.secondary.name,
    taskId: task.id,
  });
  const primaryTrace = yield* dual.primary.run(task);
  const secondaryTrace = yield* dual.secondary.run(task);
  return { primary: primaryTrace, secondary: secondaryTrace } as const;
});
