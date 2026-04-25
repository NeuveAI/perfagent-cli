// HACK: debug-only runner — NOT for production. The frontier planner was
// deliberately removed from `@neuve/supervisor` (see
// `project_frontier_removal.md` and `docs/handover/frontier-planner-removal/`).
// This runner exists exclusively under `@neuve/evals` to isolate planning
// quality from execution quality during the A:B regression sweep
// (see `docs/research/gemma-react-browsing/architecture-prd.md` §4 Decision #8).
// It MUST NOT be wired into the production CLI default; ship paths use
// `gemma-react` per R5-T3.

import { makeGemmaRunner, type GemmaRunnerOptions } from "./gemma";
import { GEMMA_ORACLE_PLAN_RUNNER_NAME } from "./runner-names";
import type { EvalRunner } from "./types";

export { GEMMA_ORACLE_PLAN_RUNNER_NAME } from "./runner-names";

/**
 * makeGemmaOraclePlanRunner — debug-only ablation runner that combines a
 * Gemini-decomposed oracle plan (frontier planner) with the Gemma + ReAct
 * executor.
 *
 * Used only by the A:B eval harness in `@neuve/evals` to isolate planning
 * quality from execution quality:
 *
 *   - `gemma-react`        → Gemma owns plan + execution (production runtime).
 *   - `gemini-react`       → Gemini owns plan + execution (frontier baseline).
 *   - `gemma-oracle-plan`  → Gemini decomposes upfront, Gemma executes via
 *                            ReAct. If `gemma-oracle-plan` outperforms
 *                            `gemma-react`, the gap is *planning* and
 *                            distillation should target plan authorship. If
 *                            they tie, the gap is *execution* — distillation
 *                            should target tool selection / observation
 *                            interpretation.
 *
 * NOT shipped to the production CLI — keeping the oracle planner out of the
 * runtime path is the whole point of the frontier-planner removal (per
 * `project_frontier_removal.md`). The runner exists exclusively under
 * `@neuve/evals`.
 *
 * The runnerName ("gemma-oracle-plan") drives trace filenames so its ndjson
 * files are distinguishable from the production gemma runner's traces in
 * `evals/traces/`. The `plannerMode` is locked to "oracle-plan" — overriding
 * it would defeat the purpose of the runner; the option is omitted from the
 * public surface to make this explicit.
 */
export const makeGemmaOraclePlanRunner = (
  options: Omit<GemmaRunnerOptions, "plannerMode" | "runnerName"> = {},
): EvalRunner =>
  makeGemmaRunner({
    ...options,
    plannerMode: "oracle-plan",
    runnerName: GEMMA_ORACLE_PLAN_RUNNER_NAME,
  });
