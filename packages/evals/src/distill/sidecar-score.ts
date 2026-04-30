import * as path from "node:path";
import { Schema } from "effect";

/**
 * SidecarScore — per-trace score record written next to every
 * `<runner>__<taskId>.ndjson` file as `<runner>__<taskId>.scores.json`.
 *
 * Why a sidecar (not in-band): the existing trace ndjson schema
 * (`runners/trace-recorder.ts`) is wire-only — it captures events as
 * they stream from the agent, with no scoring layer. `finalState` and
 * `stepCoverage` require an `EvalTask` reference (expected URL + DOM
 * assertion + key-nodes) which the recorder does not have at write
 * time. The score-computing layer is `scripts/wave-r5-ab/build-report.ts`,
 * which already iterates every ndjson with the task registry in scope.
 *
 * Sidecar emission piggybacks on that pass: build-report writes a
 * companion JSON next to each ndjson with the three fields the
 * distillation strict filter needs. Old archives can be retroactively
 * backfilled by re-running build-report against the existing trace
 * directory — no re-eval / re-sweep required.
 *
 * Strict filter (R11 P2, R10 closure note in
 * `docs/handover/teacher-viability/diary/r10-2026-04-30.md`): a trace
 * is admitted to teacher-data export iff
 *   `status == "passed" AND finalState == 1.0 AND stepCoverage == 1.0`.
 * Status-only filtering would let Pro 3's two-shape stopping-criterion
 * problem (premature `RUN_COMPLETED:passed` before finalState; or
 * over-execution past success state) pollute training data. The
 * conjunction isolates clean teacher trajectories — at the cost of
 * yielding only 2/20 R10 traces, which is an accepted data-scarcity
 * constraint for R11 (R12 owns dataset growth).
 */

export const SidecarRunFinishedStatus = Schema.Literals([
  "passed",
  "failed",
  "unfinished",
] as const);
export type SidecarRunFinishedStatus = typeof SidecarRunFinishedStatus.Type;

export class SidecarScore extends Schema.Class<SidecarScore>("@evals/distill/SidecarScore")({
  status: SidecarRunFinishedStatus,
  finalState: Schema.Number,
  stepCoverage: Schema.Number,
}) {}

export const SidecarScoreFromJsonString = Schema.fromJsonString(SidecarScore);

/**
 * sidecarPathForTrace — derive the `<runner>__<taskId>.scores.json`
 * path that lives next to the given `<runner>__<taskId>.ndjson` trace.
 * Pure function; no I/O.
 */
export const sidecarPathForTrace = (tracePath: string): string => {
  const dir = path.dirname(tracePath);
  const base = path.basename(tracePath, ".ndjson");
  return path.join(dir, `${base}.scores.json`);
};
