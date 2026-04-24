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
}) {}
