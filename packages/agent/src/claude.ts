import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AssistantModelMessage, JSONValue, ToolModelMessage } from "ai";
import { CLAUDE_MAX_TURNS } from "./constants.js";
import type { AgentConfig } from "./types.js";
import { isRecord } from "./utils/is-record.js";

export const claudeAgent: AgentConfig = {
  name: "claude",
  envKeys: ["ANTHROPIC_API_KEY"],
  run: async function* (options) {
    const abortController = new AbortController();
    if (options.signal) {
      options.signal.addEventListener("abort", () => abortController.abort(options.signal?.reason));
    }

    for await (const event of query({
      prompt: options.prompt,
      options: {
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
        model: "claude-opus-4-6",
        effort: "max",
        maxTurns: CLAUDE_MAX_TURNS,
        cwd: options.cwd,
        allowDangerouslySkipPermissions: true,
        permissionMode: "bypassPermissions",
        abortController,
        ...(options.sessionId ? { resume: options.sessionId } : {}),
        ...(options.env ? { env: options.env } : {}),
      },
    })) {
      options.onLog?.({ stream: "stdout", data: JSON.stringify(event), timestamp: Date.now() });

      if (event.type === "assistant") {
        const parts = convertAssistantContent(event.message.content);
        if (parts.length > 0) yield { role: "assistant" as const, content: parts };
      }

      if (event.type === "user" && Array.isArray(event.message.content)) {
        const parts = convertToolResults(event.message.content);
        if (parts.length > 0) yield { role: "tool" as const, content: parts };
      }
    }
  },
};

const stringField = (record: Record<string, unknown>, key: string, fallback: string): string => {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
};

const convertAssistantContent = (content: unknown[]): AssistantModelMessage["content"] => {
  const parts: AssistantModelMessage["content"] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;

    if (block.type === "text" && typeof block.text === "string") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      parts.push({ type: "reasoning", text: block.thinking });
    } else if (block.type === "tool_use") {
      parts.push({
        type: "tool-call",
        toolCallId: stringField(block, "id", "unknown"),
        toolName: stringField(block, "name", "unknown"),
        input: block.input ?? {},
      });
    }
  }
  return parts;
};

const convertToolResults = (content: unknown[]): ToolModelMessage["content"] => {
  const parts: ToolModelMessage["content"] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type !== "tool_result" && block.type !== "tool_error") continue;

    const toolCallId = stringField(block, "tool_use_id", "unknown");
    const toolName = stringField(block, "name", "unknown");

    if (block.type === "tool_result") {
      parts.push({
        type: "tool-result",
        toolCallId,
        toolName,
        output: block.is_error === true
          ? { type: "error-text", value: String(block.content ?? "") }
          : { type: "json", value: (block.content ?? {}) as JSONValue },
      });
    } else {
      parts.push({
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "error-text", value: String(block.error ?? "") },
      });
    }
  }
  return parts;
};
