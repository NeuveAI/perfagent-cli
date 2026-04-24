import * as crypto from "node:crypto";
import * as path from "node:path";
import { Effect, Layer, Schema, ServiceMap } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { EvalTask } from "../task";
import { TraceEventSchema, type TraceEvent } from "../runners/trace-recorder";
import { containsSensitiveData, isTraceSuccessful, redactSensitiveKeys } from "./filters";
import {
  ExportOptions,
  ExportSummary,
  TrainingMessage,
  TrainingSample,
  TrainingSampleMetadata,
  TrainingToolCall,
  type ExportGranularity,
} from "./types";

export class TraceReadError extends Schema.ErrorClass<TraceReadError>("TraceReadError")({
  _tag: Schema.tag("TraceReadError"),
  filePath: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to read trace ${this.filePath}: ${this.cause}`;
}

export class MalformedTraceError extends Schema.ErrorClass<MalformedTraceError>(
  "MalformedTraceError",
)({
  _tag: Schema.tag("MalformedTraceError"),
  filePath: Schema.String,
  lineNumber: Schema.Number,
  cause: Schema.String,
}) {
  message = `Malformed trace line at ${this.filePath}:${this.lineNumber}: ${this.cause}`;
}

export class TraceTaskResolutionError extends Schema.ErrorClass<TraceTaskResolutionError>(
  "TraceTaskResolutionError",
)({
  _tag: Schema.tag("TraceTaskResolutionError"),
  filePath: Schema.String,
  taskId: Schema.String,
}) {
  message = `No matching EvalTask for trace ${this.filePath} (parsed taskId=${this.taskId}); cannot reconstruct user prompt`;
}

const decodeTraceEvent = Schema.decodeUnknownEffect(TraceEventSchema);
const jsonParseEffect = (line: string, filePath: string, lineNumber: number) =>
  Effect.try({
    try: (): unknown => JSON.parse(line),
    catch: (cause) =>
      new MalformedTraceError({
        filePath,
        lineNumber,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const parseTraceFileWith = (fileSystem: FileSystem.FileSystem) =>
  Effect.fn("TeacherDataExporter.parseTraceFile")(function* (filePath: string) {
    const contents = yield* fileSystem.readFileString(filePath).pipe(
      Effect.catchTag("PlatformError", (platformError) =>
        new TraceReadError({
          filePath,
          cause: platformError.message,
        }).asEffect(),
      ),
    );
    const rawLines = contents.split("\n");
    const events: TraceEvent[] = [];
    for (let index = 0; index < rawLines.length; index += 1) {
      const line = rawLines[index];
      if (line.length === 0) continue;
      const parsed = yield* jsonParseEffect(line, filePath, index + 1);
      const event = yield* decodeTraceEvent(parsed).pipe(
        Effect.catchTag("SchemaError", (schemaError) =>
          new MalformedTraceError({
            filePath,
            lineNumber: index + 1,
            cause: schemaError.message,
          }).asEffect(),
        ),
      );
      events.push(event);
    }
    return events;
  });

// Filename shape from `buildTracePath`: `${runnerName}__${runId}.ndjson`.
// Both runner and runId are sanitized via `.replace(/[^a-zA-Z0-9_.-]/g, "-")`
// before being joined, so the only reserved separator is the double
// underscore between them. Split on that.
const TRACE_FILENAME_PATTERN = /^(?<runner>[^_].*?)__(?<taskId>.+)$/;

export const parseTraceFilename = (
  filename: string,
): { readonly runner: string; readonly taskId: string } | undefined => {
  const base = path.basename(filename, ".ndjson");
  const match = TRACE_FILENAME_PATTERN.exec(base);
  if (match === null || match.groups === undefined) return undefined;
  return { runner: match.groups["runner"], taskId: match.groups["taskId"] };
};

const countTurns = (events: ReadonlyArray<TraceEvent>): number => {
  let highest = 0;
  for (const event of events) {
    if (event.type === "agent_message" && event.turn > highest) {
      highest = event.turn;
    }
    if (event.type === "tool_call" && event.turn > highest) {
      highest = event.turn;
    }
  }
  return highest;
};

interface MessageAccumulator {
  readonly messages: TrainingMessage[];
  currentAssistantText: string;
  currentAssistantToolCalls: TrainingToolCall[];
  currentAssistantTurn: number | undefined;
}

const flushAssistant = (acc: MessageAccumulator): void => {
  if (
    acc.currentAssistantText.length === 0 &&
    acc.currentAssistantToolCalls.length === 0 &&
    acc.currentAssistantTurn === undefined
  ) {
    return;
  }
  acc.messages.push(
    new TrainingMessage({
      role: "assistant",
      content: acc.currentAssistantText,
      toolCalls:
        acc.currentAssistantToolCalls.length > 0
          ? acc.currentAssistantToolCalls.slice()
          : undefined,
    }),
  );
  acc.currentAssistantText = "";
  acc.currentAssistantToolCalls = [];
  acc.currentAssistantTurn = undefined;
};

const pushAssistantToolCall = (
  acc: MessageAccumulator,
  turn: number,
  toolCall: TrainingToolCall,
): void => {
  if (acc.currentAssistantTurn !== undefined && acc.currentAssistantTurn !== turn) {
    flushAssistant(acc);
  }
  acc.currentAssistantTurn = turn;
  acc.currentAssistantToolCalls.push(toolCall);
};

const pushAssistantText = (acc: MessageAccumulator, turn: number, content: string): void => {
  if (acc.currentAssistantTurn !== undefined && acc.currentAssistantTurn !== turn) {
    flushAssistant(acc);
  }
  acc.currentAssistantTurn = turn;
  acc.currentAssistantText =
    acc.currentAssistantText.length === 0 ? content : `${acc.currentAssistantText}\n${content}`;
};

const redactArgumentsToString = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return "{}";
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return JSON.stringify(redactSensitiveKeys(parsed));
    } catch {
      return JSON.stringify(redactSensitiveKeys(value));
    }
  }
  return JSON.stringify(redactSensitiveKeys(value ?? {}));
};

const redactResultToString = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return JSON.stringify(redactSensitiveKeys(parsed));
      } catch {
        return value;
      }
    }
    return value;
  }
  return JSON.stringify(redactSensitiveKeys(value ?? ""));
};

const eventsToMessages = (
  events: ReadonlyArray<TraceEvent>,
  systemPrompt: string,
  userPrompt: string,
): ReadonlyArray<TrainingMessage> => {
  const acc: MessageAccumulator = {
    messages: [
      new TrainingMessage({ role: "system", content: systemPrompt }),
      new TrainingMessage({ role: "user", content: userPrompt }),
    ],
    currentAssistantText: "",
    currentAssistantToolCalls: [],
    currentAssistantTurn: undefined,
  };

  for (const event of events) {
    if (event.type === "agent_message") {
      if (event.content.length === 0) continue;
      pushAssistantText(acc, event.turn, event.content);
      continue;
    }
    if (event.type === "tool_call") {
      pushAssistantToolCall(
        acc,
        event.turn,
        new TrainingToolCall({
          id: event.id,
          name: event.name,
          arguments: redactArgumentsToString(event.args),
        }),
      );
      continue;
    }
    if (event.type === "tool_result") {
      flushAssistant(acc);
      acc.messages.push(
        new TrainingMessage({
          role: "tool",
          content: redactResultToString(event.result),
          toolCallId: event.id,
        }),
      );
      continue;
    }
    if (event.type === "status_marker") {
      const markerLine = `${event.marker} ${JSON.stringify(event.payload ?? null)}`;
      pushAssistantText(acc, acc.currentAssistantTurn ?? 0, markerLine);
      continue;
    }
    // stream_terminated is a harness-level signal, not a learnable action.
    // Skip — the teacher did not emit it.
  }
  flushAssistant(acc);
  return acc.messages;
};

const splitMessagesPerTurn = (
  messages: ReadonlyArray<TrainingMessage>,
): ReadonlyArray<ReadonlyArray<TrainingMessage>> => {
  const samples: TrainingMessage[][] = [];
  const context: TrainingMessage[] = [];
  for (const message of messages) {
    if (message.role === "system" || message.role === "user") {
      context.push(message);
      continue;
    }
    if (message.role === "assistant") {
      samples.push([...context, message]);
      context.push(message);
      continue;
    }
    context.push(message);
  }
  return samples;
};

const hashMessages = (messages: ReadonlyArray<TrainingMessage>): string => {
  const canonical = messages.map((message) => ({
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls?.map((call) => ({
      name: call.name,
      arguments: call.arguments,
    })),
    toolCallId: message.toolCallId,
  }));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

const buildSample = (
  events: ReadonlyArray<TraceEvent>,
  messages: ReadonlyArray<TrainingMessage>,
  metadata: {
    readonly sourceTrace: string;
    readonly taskId: string;
    readonly runnerName: string;
    readonly teacherModel: string;
  },
): TrainingSample => {
  const toolCallCount = events.filter((event) => event.type === "tool_call").length;
  return new TrainingSample({
    messages,
    metadata: new TrainingSampleMetadata({
      sourceTrace: metadata.sourceTrace,
      taskId: metadata.taskId,
      runnerName: metadata.runnerName,
      teacherModel: metadata.teacherModel,
      turnCount: countTurns(events),
      toolCallCount,
      contentHash: hashMessages(messages),
    }),
  });
};

export interface ExportInput {
  readonly tracePaths: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<EvalTask>;
  readonly options: ExportOptions;
}

export interface ExportResult {
  readonly samples: ReadonlyArray<TrainingSample>;
  readonly summary: ExportSummary;
}

/**
 * TeacherDataExporter — transforms captured trace ndjson into
 * TrainingSample[] ready for JSONL serialization.
 *
 * Pipeline per trace file:
 *   1. Parse ndjson → TraceEvent[] (schema-validated).
 *   2. Filter: skip anything that didn't end on RUN_COMPLETED status=passed.
 *   3. Resolve trace → EvalTask via filename → taskId lookup so we can embed
 *      the user prompt in the sample (traces don't store the prompt
 *      themselves).
 *   4. Redact: strip api_key/token/password/secret/authorization values
 *      everywhere using filters.redactSensitiveKeys.
 *   5. Serialize: map events to OpenAI-style chat messages (system, user,
 *      assistant-with-tool-calls, tool-result, ...). Matches what
 *      @neuve/local-agent already constructs, so there's zero format shim
 *      between teacher capture and Gemma training.
 *   6. Deduplicate: if two traces produce messages with the same
 *      sha256(canonical-JSON) hash, keep one.
 *   7. Optionally split per-turn (one sample per assistant turn) if the
 *      options.granularity is "per-turn"; default "per-trajectory".
 */
export class TeacherDataExporter extends ServiceMap.Service<
  TeacherDataExporter,
  {
    readonly export: (
      input: ExportInput,
    ) => Effect.Effect<
      ExportResult,
      TraceReadError | MalformedTraceError | TraceTaskResolutionError
    >;
  }
>()("@evals/TeacherDataExporter") {
  static make = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const parseTraceFile = parseTraceFileWith(fileSystem);

    const runExport = Effect.fn("TeacherDataExporter.export")(function* (input: ExportInput) {
      const tasksById = new Map<string, EvalTask>();
      for (const task of input.tasks) {
        tasksById.set(task.id, task);
      }

      const granularity: ExportGranularity = input.options.granularity ?? "per-trajectory";
      yield* Effect.annotateCurrentSpan({
        traceCount: input.tracePaths.length,
        taskCount: input.tasks.length,
        granularity,
      });

      const samples: TrainingSample[] = [];
      const seenHashes = new Set<string>();
      let tracesScanned = 0;
      let tracesAccepted = 0;
      let tracesRejected = 0;
      let duplicatesSkipped = 0;

      for (const tracePath of input.tracePaths) {
        tracesScanned += 1;
        const events = yield* parseTraceFile(tracePath);
        if (!isTraceSuccessful(events)) {
          tracesRejected += 1;
          yield* Effect.logDebug("Trace rejected (not successful)", { tracePath });
          continue;
        }
        const parsedName = parseTraceFilename(tracePath);
        if (parsedName === undefined) {
          tracesRejected += 1;
          yield* Effect.logWarning("Trace rejected (unparseable filename)", { tracePath });
          continue;
        }
        const task = tasksById.get(parsedName.taskId);
        if (task === undefined) {
          return yield* new TraceTaskResolutionError({
            filePath: tracePath,
            taskId: parsedName.taskId,
          });
        }

        const hasSensitive = containsSensitiveData(events);
        if (hasSensitive) {
          yield* Effect.logInfo("Trace contains redactable keys; redaction will run", {
            tracePath,
          });
        }

        const messages = eventsToMessages(events, input.options.systemPrompt, task.prompt);

        const candidateMessageSets: ReadonlyArray<ReadonlyArray<TrainingMessage>> =
          granularity === "per-turn" ? splitMessagesPerTurn(messages) : [messages];

        let acceptedFromThisTrace = 0;
        for (const messageSet of candidateMessageSets) {
          const sample = buildSample(events, messageSet, {
            sourceTrace: path.basename(tracePath),
            taskId: task.id,
            runnerName: parsedName.runner,
            teacherModel: input.options.teacherModel,
          });
          if (seenHashes.has(sample.metadata.contentHash)) {
            duplicatesSkipped += 1;
            continue;
          }
          seenHashes.add(sample.metadata.contentHash);
          samples.push(sample);
          acceptedFromThisTrace += 1;
        }

        if (acceptedFromThisTrace > 0) {
          tracesAccepted += 1;
        } else {
          tracesRejected += 1;
        }
      }

      yield* Effect.logInfo("Teacher-data export complete", {
        tracesScanned,
        tracesAccepted,
        tracesRejected,
        samplesWritten: samples.length,
        duplicatesSkipped,
      });

      return {
        samples,
        summary: new ExportSummary({
          tracesScanned,
          tracesAccepted,
          tracesRejected,
          samplesWritten: samples.length,
          duplicatesSkipped,
          outputPath: "",
        }),
      } satisfies ExportResult;
    });

    return { export: runExport } as const;
  });

  static layer = Layer.effect(this)(this.make);

  /**
   * layerFromFs — loader layer that does NOT provide FileSystem. Callers
   * supply it (NodeServices.layer in production; an in-memory fake wired via
   * FileSystem.layerNoop + overrides in tests) via `Layer.provide`.
   * Matches the Online-Mind2WebLoader split so the production code path and
   * the test code path run the same `make` — only the FileSystem transport
   * changes, avoiding the no-test-only-injection-seams trap.
   */
  static layerFromFs = Layer.effect(this)(this.make);
}

export const teacherDataExporterLayer = Layer.provide(
  TeacherDataExporter.layer,
  NodeServices.layer,
);
