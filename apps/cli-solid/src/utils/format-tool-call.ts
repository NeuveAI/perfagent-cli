import { Match, Predicate } from "effect";
import { TESTING_TOOL_TEXT_CHAR_LIMIT } from "../constants";

export interface FormattedToolCall {
  readonly name: string;
  readonly args: string;
  readonly multilineArgs?: string;
}

interface ToolInput {
  url?: string;
  code?: string;
  mode?: string;
  type?: string;
  method?: string;
  fullPage?: boolean;
  headed?: boolean;
  waitUntil?: string;
  resourceType?: string;
  clear?: boolean;
}

const parseInput = (raw: unknown): ToolInput => {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Predicate.isObject(parsed)) return parsed as ToolInput;
    } catch {
      return {};
    }
  }
  if (Predicate.isObject(raw)) return raw as ToolInput;
  return {};
};

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

const truncateText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}\u2026`;
};

const normalizeName = (toolName: string): string => {
  const match = toolName.match(/^mcp__.+__(.+)$/);
  return match ? match[1] : toolName;
};

export const formatToolCall = (toolName: string, rawInput: unknown): FormattedToolCall => {
  const name = normalizeName(toolName);
  const raw = typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput ?? {});
  const input = parseInput(rawInput);

  const args: string = Match.value(name).pipe(
    Match.when("open", () => (input.url ? `"${input.url}"` : "")),
    Match.when("screenshot", () => {
      const mode = input.mode ?? "screenshot";
      return mode === "screenshot" ? "" : mode;
    }),
    Match.when("playwright", () => {
      const code = input.code ?? raw;
      return truncateText(collapseWhitespace(code), TESTING_TOOL_TEXT_CHAR_LIMIT);
    }),
    Match.when("console_logs", () => (input.type ? `type: "${input.type}"` : "")),
    Match.when("network_requests", () => {
      const parts: string[] = [];
      if (input.method) parts.push(input.method);
      if (input.url) parts.push(`"${input.url}"`);
      return parts.join(", ");
    }),
    Match.when("performance_metrics", () => ""),
    Match.when("close", () => ""),
    Match.orElse(() => summarizeInput(input)),
  );

  const trimmedCode = (input.code ?? raw).trim();
  const multilineArgs =
    name === "playwright" && trimmedCode.includes("\n") ? trimmedCode : undefined;

  return { name, args, multilineArgs };
};

const summarizeInput = (input: ToolInput): string => {
  const values = Object.values(input).filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (values.length === 0) return "";
  return truncateText(collapseWhitespace(values.join(", ")), TESTING_TOOL_TEXT_CHAR_LIMIT);
};
