import type { ExecutedTrace, ToolCall } from "../task";

const MAX_TRAJECTORY_CHARS = 2048;
const MAX_TOOL_NAME_CHARS = 40;
const MAX_ARG_VALUE_CHARS = 120;
const REDACTED_KEY_PATTERN = /api[_-]?key|token|password|secret|authorization/i;
const TRUNCATION_SUFFIX = "…[truncated]";

const summarizeArgs = (call: ToolCall): string => {
  const entries = Object.entries(call.arguments)
    .filter(([key]) => !REDACTED_KEY_PATTERN.test(key))
    .slice(0, 4);
  if (entries.length === 0) return "";
  const parts = entries.map(([key, value]) => {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    const safe =
      rendered.length > MAX_ARG_VALUE_CHARS
        ? `${rendered.slice(0, MAX_ARG_VALUE_CHARS)}${TRUNCATION_SUFFIX}`
        : rendered;
    return `${key}=${safe}`;
  });
  return parts.join(", ");
};

const summarizeToolCall = (call: ToolCall, index: number): string => {
  const name =
    call.name.length > MAX_TOOL_NAME_CHARS
      ? `${call.name.slice(0, MAX_TOOL_NAME_CHARS)}${TRUNCATION_SUFFIX}`
      : call.name;
  const wellFormedFlag = call.wellFormed ? "" : " [malformed]";
  const args = summarizeArgs(call);
  return `  ${index + 1}. → ${name}(${args})${wellFormedFlag}`;
};

const summarizeKeyNodes = (trace: ExecutedTrace): string => {
  if (trace.reachedKeyNodes.length === 0) {
    return "Key nodes reached: none.";
  }
  const urls = trace.reachedKeyNodes.map((node) => node.urlPattern).join(" → ");
  return `Key nodes reached (${trace.reachedKeyNodes.length}): ${urls}`;
};

/**
 * summarizeTrajectory — pure ExecutedTrace → terse text for the LLM-as-judge.
 *
 * Kept short (capped ~2KB) and mechanical: the judge doesn't need full JSON
 * tool arguments or response bodies, just the shape of "what the agent did"
 * and "where it stopped". Longer-form context (per-turn reasoning, screenshots)
 * is deferred to a future Wave 5+ upgrade if judge accuracy demands it —
 * today we optimize for signal-per-token against a 1M-context judge.
 *
 * Redaction: argument keys matching `api_key|token|password|secret|authorization`
 * (case-insensitive) are dropped — the judge doesn't need them and they should
 * never leak into downstream trace files or distillation samples.
 */
export const summarizeTrajectory = (trace: ExecutedTrace): string => {
  const lines: string[] = [];
  lines.push(summarizeKeyNodes(trace));
  lines.push("");
  lines.push(`Tool calls issued (${trace.toolCalls.length}):`);
  if (trace.toolCalls.length === 0) {
    lines.push("  (no tool calls were issued)");
  } else {
    for (let index = 0; index < trace.toolCalls.length; index += 1) {
      lines.push(summarizeToolCall(trace.toolCalls[index], index));
    }
  }
  lines.push("");
  lines.push(`Final URL: ${trace.finalUrl.length > 0 ? trace.finalUrl : "<none>"}`);
  lines.push(`Final summary: ${trace.finalDom.length > 0 ? trace.finalDom : "<none>"}`);
  const combined = lines.join("\n");
  if (combined.length <= MAX_TRAJECTORY_CHARS) return combined;
  return `${combined.slice(0, MAX_TRAJECTORY_CHARS)}${TRUNCATION_SUFFIX}`;
};
