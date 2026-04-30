import { Schema } from "effect";

/**
 * TrainingSample — one supervised fine-tune example for Gemma via Ollama.
 *
 * Shape rationale (see docs/handover/harness-evals/diary/wave-5-distillation.md):
 * we ship OpenAI-style chat messages (system + multi-turn user/assistant)
 * because Ollama's `/v1/chat/completions` endpoint and the Modelfile
 * `MESSAGE` directive already consume that format, and `@neuve/local-agent`
 * already emits `ChatCompletionMessageParam` shapes. No format shim between
 * teacher capture and Gemma training.
 *
 * Per-trajectory granularity (one TrainingSample per successful trace):
 * preserves the full tool_call → tool → tool_result chain so the student
 * learns sub-goal continuity, not just single-turn imitation. The alternative
 * (per-turn split) loses plan-level context and duplicates the system prompt
 * N times per trace.
 */
export const TrainingRole = Schema.Literals(["system", "user", "assistant", "tool"] as const);
export type TrainingRole = typeof TrainingRole.Type;

export class TrainingToolCall extends Schema.Class<TrainingToolCall>(
  "@evals/distill/TrainingToolCall",
)({
  id: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
}) {}

export class TrainingMessage extends Schema.Class<TrainingMessage>(
  "@evals/distill/TrainingMessage",
)({
  role: TrainingRole,
  content: Schema.String,
  toolCalls: Schema.optional(Schema.Array(TrainingToolCall)),
  toolCallId: Schema.optional(Schema.String),
}) {}

export class TrainingSampleMetadata extends Schema.Class<TrainingSampleMetadata>(
  "@evals/distill/TrainingSampleMetadata",
)({
  sourceTrace: Schema.String,
  taskId: Schema.String,
  runnerName: Schema.String,
  teacherModel: Schema.String,
  turnCount: Schema.Number,
  toolCallCount: Schema.Number,
  contentHash: Schema.String,
}) {}

export class TrainingSample extends Schema.Class<TrainingSample>("@evals/distill/TrainingSample")({
  messages: Schema.Array(TrainingMessage),
  metadata: TrainingSampleMetadata,
}) {}

export class ExportSummary extends Schema.Class<ExportSummary>("@evals/distill/ExportSummary")({
  tracesScanned: Schema.Number,
  tracesAccepted: Schema.Number,
  tracesRejected: Schema.Number,
  samplesWritten: Schema.Number,
  duplicatesSkipped: Schema.Number,
  outputPath: Schema.String,
}) {}

/**
 * ExportGranularity — per-trajectory ships one sample per successful trace
 * (default, recommended). per-turn splits every assistant turn into its own
 * sample — more samples at the cost of cross-turn context. Provided as an
 * option so future fine-tunes can experiment without re-authoring the exporter.
 */
export const ExportGranularity = Schema.Literals(["per-trajectory", "per-turn"] as const);
export type ExportGranularity = typeof ExportGranularity.Type;

export class ExportOptions extends Schema.Class<ExportOptions>("@evals/distill/ExportOptions")({
  granularity: Schema.optional(ExportGranularity),
  teacherModel: Schema.String,
  systemPrompt: Schema.String,
  /**
   * When true, apply R4's `rollTrajectory` to per-turn samples so prompt
   * context for late turns (turn 12+) collapses older assistant/observation
   * pairs into a single `<trajectory_summary>` block. Keeps training-time
   * prompt sizes under the same 96K/120K context budget the runtime
   * enforces (R4), preventing the distillation pipeline from teaching
   * Gemma to expect a 50K-prompt-token context it'll never see in
   * production. Defaults to false (existing behavior preserved). Per
   * R5-T4 brief — applies to per-turn granularity only; per-trajectory
   * samples are full traces by definition.
   */
  rollTrajectory: Schema.optional(Schema.Boolean),
  /**
   * R11 P2 strict tri-criterion filter (R10 closure note).
   *
   * When true: the exporter rejects traces that do not satisfy
   *   `RUN_COMPLETED:passed AND finalState == 1.0 AND stepCoverage == 1.0`.
   * The latter two come from a sidecar score file
   * (`<runner>__<taskId>.scores.json`) emitted by `wave-r5-ab/build-report.ts`.
   * Missing sidecar → reject (fail-closed; no status-only fallback).
   *
   * When false (default for back-compat with Wave 5 fixtures): the
   * exporter falls back to the status-only `isTraceSuccessful` filter —
   * RUN_COMPLETED:passed without abort, no sidecar consulted.
   *
   * Production scripts (`scripts/distill/export-teacher-data.ts`) flip
   * this to true so the strict R11 contract is the default for any
   * teacher-data export. The `EVAL_DISTILL_STRICT=false` env-var lets
   * operators temporarily relax the gate during diagnostics without
   * code change. Per-trace inclusion decision logs at debug level so a
   * sweep over R10 traces can be audited.
   */
  strict: Schema.optional(Schema.Boolean),
  /**
   * R11 P2.1 — runner-name allowlist (teacher-only by default).
   *
   * Distillation philosophy says train on TEACHER trajectories only.
   * Including the student's own strict-pass traces (e.g.
   * `gemma-react`) teaches the student what it already does — near-zero
   * gradient on already-mastered tasks. R10 elected `gemini-react`
   * (Pro 3) as the canonical teacher.
   *
   * When set: the exporter rejects any trace whose parsed runner is
   * not in the allowlist (after the strict tri-criterion check). Even
   * `gemma-react__calibration-1` strict-clean is excluded if the
   * allowlist is `["gemini-react"]`.
   *
   * When absent (or empty array): no runner gating — the exporter
   * accepts traces from every runner. R12 multi-sweep cross-runner
   * mixing experiments use this mode.
   *
   * Lives on the library boundary (not just at the script level)
   * because the P4 training driver and R12's pipeline are pure
   * consumers of the exporter — they should NOT carry runner-aware
   * logic. Filtering at the exporter keeps the separation of concerns
   * clean.
   */
  runnerFilter: Schema.optional(Schema.Array(Schema.String)),
}) {}
