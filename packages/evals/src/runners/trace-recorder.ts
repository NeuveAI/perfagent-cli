import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Layer, Schema, ServiceMap } from "effect";

export class TraceWriteError extends Schema.ErrorClass<TraceWriteError>("TraceWriteError")({
  _tag: Schema.tag("TraceWriteError"),
  filePath: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to write trace ${this.filePath}: ${this.cause}`;
}

// Wire-format event schemas. `type: <kind>` matches the Wave 0.A schema
// documented at evals/traces/README.md exactly, so replay tools and 3.C's
// dual-runner diff can decode the same ndjson without a format shim.

export const AgentMessageEvent = Schema.Struct({
  type: Schema.Literal("agent_message"),
  ts: Schema.Number,
  turn: Schema.Number,
  content: Schema.String,
});
export type AgentMessageEvent = typeof AgentMessageEvent.Type;

export const ToolCallEvent = Schema.Struct({
  type: Schema.Literal("tool_call"),
  ts: Schema.Number,
  turn: Schema.Number,
  id: Schema.String,
  name: Schema.String,
  args: Schema.Unknown,
});
export type ToolCallEvent = typeof ToolCallEvent.Type;

export const ToolResultEvent = Schema.Struct({
  type: Schema.Literal("tool_result"),
  ts: Schema.Number,
  id: Schema.String,
  result: Schema.Unknown,
  ok: Schema.Boolean,
});
export type ToolResultEvent = typeof ToolResultEvent.Type;

export const StatusMarkerLabel = Schema.Literals([
  "STEP_START",
  "STEP_DONE",
  "ASSERTION_FAILED",
  "STEP_SKIPPED",
  "RUN_COMPLETED",
] as const);
export type StatusMarkerLabel = typeof StatusMarkerLabel.Type;

export const StatusMarkerEvent = Schema.Struct({
  type: Schema.Literal("status_marker"),
  ts: Schema.Number,
  marker: StatusMarkerLabel,
  payload: Schema.Unknown,
});
export type StatusMarkerEvent = typeof StatusMarkerEvent.Type;

export const StreamTerminatedEvent = Schema.Struct({
  type: Schema.Literal("stream_terminated"),
  ts: Schema.Number,
  reason: Schema.String,
  remainingSteps: Schema.Number,
});
export type StreamTerminatedEvent = typeof StreamTerminatedEvent.Type;

// Token-usage events: emitted per model call (planner or executor) and a
// single aggregate per task on stream termination. Drives the baseline
// tokenomics analysis that gates Q6 (Wave 4.6 rolling context activation).
export const TokenUsageSource = Schema.Literals(["planner", "executor"] as const);
export type TokenUsageSource = typeof TokenUsageSource.Type;

export const TokenUsageEvent = Schema.Struct({
  type: Schema.Literal("token_usage"),
  ts: Schema.Number,
  turn: Schema.Number,
  source: TokenUsageSource,
  promptTokens: Schema.Number,
  completionTokens: Schema.Number,
  totalTokens: Schema.Number,
});
export type TokenUsageEvent = typeof TokenUsageEvent.Type;

export const TaskTokenomicsEvent = Schema.Struct({
  type: Schema.Literal("task_tokenomics"),
  ts: Schema.Number,
  totalPromptTokens: Schema.Number,
  totalCompletionTokens: Schema.Number,
  totalTokens: Schema.Number,
  peakPromptTokens: Schema.Number,
  turnCount: Schema.Number,
  plannerTokens: Schema.Number,
  executorTokens: Schema.Number,
});
export type TaskTokenomicsEvent = typeof TaskTokenomicsEvent.Type;

export const TraceEventSchema = Schema.Union([
  AgentMessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  StatusMarkerEvent,
  StreamTerminatedEvent,
  TokenUsageEvent,
  TaskTokenomicsEvent,
]);
export type TraceEvent = typeof TraceEventSchema.Type;

export interface TraceRecorder {
  readonly filePath: string;
  readonly append: (event: TraceEvent) => Effect.Effect<void, TraceWriteError>;
}

const openTraceRecorder = Effect.fn("TraceRecorder.open")(function* (filePath: string) {
  yield* Effect.annotateCurrentSpan({ filePath });

  const directory = path.dirname(filePath);
  const openStream = Effect.try({
    try: () => {
      fs.mkdirSync(directory, { recursive: true });
      return fs.createWriteStream(filePath, { flags: "w", encoding: "utf8" });
    },
    catch: (cause) =>
      new TraceWriteError({
        filePath,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });

  // acquireRelease ties the stream's lifetime to the surrounding scope. The
  // finalizer waits for `end`'s callback so the file is flushed before the
  // scope resolves — otherwise post-scope reads (in tests + replay) would
  // race the OS buffer.
  const stream = yield* Effect.acquireRelease(openStream, (current) =>
    Effect.callback<void>((resume) => {
      current.end(() => resume(Effect.void));
    }),
  );

  const append = Effect.fn("TraceRecorder.append")(function* (event: TraceEvent) {
    yield* Effect.annotateCurrentSpan({ type: event.type });
    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          const line = `${JSON.stringify(event)}\n`;
          // Resolve inside the write callback so the promise settles AFTER
          // flush; resolving pre-callback raced the callback on
          // high-water-mark-cleared writes and would miss late errors.
          stream.write(line, (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      catch: (cause) =>
        new TraceWriteError({
          filePath,
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  });

  return { filePath, append } as const;
});

/**
 * TraceRecorderFactory — scoped factory that produces per-run TraceRecorder
 * handles. Each call to `open` creates a fresh ndjson file wired to the
 * surrounding scope's lifecycle (file flushes + closes when the scope closes).
 */
export class TraceRecorderFactory extends ServiceMap.Service<
  TraceRecorderFactory,
  {
    readonly open: (
      filePath: string,
    ) => Effect.Effect<TraceRecorder, TraceWriteError, import("effect").Scope.Scope>;
  }
>()("@evals/TraceRecorderFactory") {
  static layer = Layer.succeed(TraceRecorderFactory, {
    open: openTraceRecorder,
  });
}

export const buildTracePath = (baseDir: string, runnerName: string, runId: string): string => {
  const safeRunner = runnerName.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const safeRun = runId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return path.join(baseDir, `${safeRunner}__${safeRun}.ndjson`);
};
