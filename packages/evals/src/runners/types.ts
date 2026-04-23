import { Effect, Schema } from "effect";
import type { EvalTask, ExecutedTrace } from "../task";

/**
 * EvalRunError — a runner-level failure the orchestrator cannot recover from.
 *
 * Runners MUST report only unrecoverable failures here (MCP unreachable, agent
 * adapter unavailable, trace writer failed). Per-task agent mistakes (bad
 * output, no progress, failed scorer) are NOT errors — they are scored zeros
 * by the scorers on the returned ExecutedTrace.
 */
export class EvalRunError extends Schema.ErrorClass<EvalRunError>("EvalRunError")({
  _tag: Schema.tag("EvalRunError"),
  runner: Schema.String,
  taskId: Schema.String,
  cause: Schema.String,
}) {
  message = `Eval run failed [${this.runner}/${this.taskId}]: ${this.cause}`;
}

/**
 * EvalRunner — shared contract for every runner that produces ExecutedTrace
 * values for the evalite harness to score.
 *
 * Contract:
 *  - `name` is a short stable identifier used in trace filenames, logs, and
 *    scoreboard columns. Must be unique per runner implementation
 *    (e.g. "mock", "real-claude", "gemma-local").
 *  - `run(task)` MUST resolve to an ExecutedTrace on *any* task outcome —
 *    success, partial, or the agent gave up. The only acceptable failure
 *    channel is an `EvalRunError` for unrecoverable orchestration problems.
 *  - Runners that persist traces MUST write ndjson matching the Wave 0.A
 *    schema documented in `evals/traces/README.md`. The ExecutedTrace
 *    returned to the harness is an in-memory projection of that trace,
 *    tailored to what the scorers need.
 *  - Runners are expected to drive the full harness pipeline (plan
 *    decomposition, adherence gate, interaction tools) end-to-end without
 *    shortcuts. The runner's job is orchestration only; no site-specific
 *    heuristics belong here.
 *
 * Wave 3.C's gemma runner implements this same interface; switching runners
 * is a matter of picking a different implementation at eval startup.
 */
export interface EvalRunner {
  readonly name: string;
  readonly run: (task: EvalTask) => Effect.Effect<ExecutedTrace, EvalRunError>;
}
