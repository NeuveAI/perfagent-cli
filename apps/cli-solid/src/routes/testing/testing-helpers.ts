import { Option, DateTime, Predicate } from "effect";
import type { ExecutionEvent, AnalysisStep } from "@neuve/shared/models";
import { formatToolCall } from "../../utils/format-tool-call";
import type { FormattedToolCall } from "../../utils/format-tool-call";
import {
  TESTING_TOOL_TEXT_CHAR_LIMIT,
  TESTING_RESULT_PREVIEW_MAX_CHARS,
  TESTING_ARG_PREVIEW_MAX_CHARS,
  MAX_VISIBLE_TOOL_CALLS,
} from "../../constants";

const APPROX_CHARS_PER_TOKEN = 4;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

export interface ToolCallDisplay {
  readonly tool: FormattedToolCall;
  readonly isRunning: boolean;
  readonly resultTokens: number | undefined;
  readonly rawInput: unknown;
  readonly resultText: string | undefined;
  readonly resultIsError: boolean;
  readonly progressBytes: number | undefined;
}

export const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
};

export const formatStreamingBytes = (bytes: number): string => {
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  if (bytes >= BYTES_PER_KB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${bytes} B`;
};

export const truncateSingleLine = (text: string, maxChars: number): string => {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) return singleLine;
  return `${singleLine.slice(0, Math.max(1, maxChars - 1))}\u2026`;
};

export const parseRawInput = (rawInput: unknown): Record<string, unknown> => {
  if (typeof rawInput === "string") {
    try {
      const parsed: unknown = JSON.parse(rawInput);
      if (Predicate.isObject(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (Predicate.isObject(rawInput)) return rawInput as Record<string, unknown>;
  return {};
};

export const getActionObject = (
  input: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const action = input["action"];
  if (Predicate.isObject(action)) return action as Record<string, unknown>;
  return undefined;
};

export const formatCommandPreview = (rawInput: unknown): string => {
  const input = parseRawInput(rawInput);
  const action = getActionObject(input);
  if (action && typeof action["command"] === "string") return action["command"];
  if (typeof input["command"] === "string") return input["command"];
  return "";
};

const ARGS_SKIP_KEYS = new Set(["command", "includeSnapshot"]);

const ARGS_PRIMARY_KEYS_BY_COMMAND: Record<string, readonly string[]> = {
  navigate: ["url", "direction"],
  click: ["uid"],
  type: ["text"],
  fill: ["uid", "value"],
  press_key: ["key"],
  hover: ["uid"],
  drag: ["fromUid", "toUid"],
  upload_file: ["uid", "filePath"],
  handle_dialog: ["accept"],
  wait_for: ["text"],
  resize: ["width", "height"],
  new_tab: ["url"],
  screenshot: ["uid", "fullPage"],
  snapshot: ["verbose"],
  evaluate: ["function"],
  network: ["reqid", "resourceTypes"],
  console: ["msgid", "types"],
  analyze: ["insightSetId", "insightName"],
  start: ["reload", "autoStop"],
  emulate: ["cpuThrottling", "network"],
};

const formatScalarValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return "";
};

export const formatArgsPreview = (rawInput: unknown, command: string): string => {
  const input = parseRawInput(rawInput);
  const source = getActionObject(input) ?? input;
  const primaryKeys = ARGS_PRIMARY_KEYS_BY_COMMAND[command] ?? [];
  const parts: string[] = [];

  for (const key of primaryKeys) {
    if (!(key in source)) continue;
    const formatted = formatScalarValue(source[key]);
    if (!formatted) continue;
    if (primaryKeys.length === 1) {
      parts.push(formatted);
    } else {
      parts.push(`${key}=${formatted}`);
    }
  }

  if (parts.length === 0) {
    for (const [key, value] of Object.entries(source)) {
      if (ARGS_SKIP_KEYS.has(key)) continue;
      const formatted = formatScalarValue(value);
      if (!formatted) continue;
      parts.push(`${key}=${formatted}`);
      if (parts.length >= 2) break;
    }
  }

  return truncateSingleLine(parts.join(" "), TESTING_ARG_PREVIEW_MAX_CHARS);
};

export const formatResultPreview = (result: string): string =>
  truncateSingleLine(result, TESTING_RESULT_PREVIEW_MAX_CHARS);

export const truncateLabel = (text: string): string => {
  if (text.length <= TESTING_TOOL_TEXT_CHAR_LIMIT) return text;
  return `${text.slice(0, Math.max(1, TESTING_TOOL_TEXT_CHAR_LIMIT - 1))}\u2026`;
};

export const collectToolCalls = (
  events: readonly ExecutionEvent[],
  fromIndex: number,
  toIndex: number = events.length,
): ToolCallDisplay[] => {
  const calls: ToolCallDisplay[] = [];

  for (let index = fromIndex; index < toIndex; index++) {
    const event = events[index];
    if (event._tag === "ToolCall") {
      calls.push({
        tool: formatToolCall(event.toolName, event.input),
        isRunning: false,
        resultTokens: undefined,
        rawInput: event.input,
        resultText: undefined,
        resultIsError: false,
        progressBytes: undefined,
      });
    }
    if (event._tag === "ToolProgress" && calls.length > 0) {
      const lastCall = calls[calls.length - 1];
      calls[calls.length - 1] = {
        ...lastCall,
        resultTokens: Math.round(event.outputSize / APPROX_CHARS_PER_TOKEN),
        progressBytes: event.outputSize,
      };
    }
    if (event._tag === "ToolResult" && calls.length > 0) {
      const lastCall = calls[calls.length - 1];
      calls[calls.length - 1] = {
        ...lastCall,
        resultTokens: Math.round(event.result.length / APPROX_CHARS_PER_TOKEN),
        resultText: event.result,
        resultIsError: event.isError,
      };
    }
  }

  return calls;
};

export const markLastCallRunning = (
  calls: ToolCallDisplay[],
  events: readonly ExecutionEvent[],
): ToolCallDisplay[] => {
  if (calls.length === 0) return calls;
  const lastEvent = events.at(-1);
  const isLastDone = lastEvent?._tag === "ToolResult";
  const result = [...calls];
  result[result.length - 1] = {
    ...result[result.length - 1],
    isRunning: !isLastDone,
  };
  return result;
};

export const getActiveStepToolCalls = (events: readonly ExecutionEvent[]): ToolCallDisplay[] => {
  let lastStepStartIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]._tag === "StepStarted") {
      lastStepStartIndex = index;
      break;
    }
  }
  if (lastStepStartIndex === -1) return [];
  const calls = collectToolCalls(events, lastStepStartIndex + 1);
  const marked = markLastCallRunning(calls, events);
  return marked.slice(-MAX_VISIBLE_TOOL_CALLS);
};

export const getPlanningToolCalls = (events: readonly ExecutionEvent[]): ToolCallDisplay[] => {
  const calls = collectToolCalls(events, 0);
  const marked = markLastCallRunning(calls, events);
  return marked.slice(-MAX_VISIBLE_TOOL_CALLS);
};

export const getStepElapsedMs = (step: AnalysisStep): number | undefined => {
  if (Option.isNone(step.startedAt)) return undefined;
  const endMs = Option.isSome(step.endedAt)
    ? DateTime.toEpochMillis(step.endedAt.value)
    : Date.now();
  return endMs - DateTime.toEpochMillis(step.startedAt.value);
};
