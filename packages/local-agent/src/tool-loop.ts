import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { OllamaClient } from "./ollama-client.js";
import type { McpBridge } from "./mcp-bridge.js";

import { log } from "./log.js";

const MAX_TOOL_ROUNDS = 15;

export interface ToolLoopOptions {
  sessionId: string;
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  ollamaClient: OllamaClient;
  mcpBridge: McpBridge;
  connection: AgentSideConnection;
  signal: AbortSignal;
}

const tryParseJson = (raw: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const repairAndParseJson = (raw: string): Record<string, unknown> => {
  const direct = tryParseJson(raw);
  if (direct) return direct;

  const trimmed = raw.trim();
  const withoutTrailing = trimmed.replace(/,\s*([}\]])/g, "$1");
  const repaired = tryParseJson(withoutTrailing);
  if (repaired) return repaired;

  const singleToDouble = withoutTrailing.replace(/'/g, '"');
  const repairedSingle = tryParseJson(singleToDouble);
  if (repairedSingle) return repairedSingle;

  return {};
};

export const runToolLoop = async (options: ToolLoopOptions): Promise<void> => {
  const { sessionId, messages, tools, ollamaClient, mcpBridge, connection, signal } = options;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) return;

    log("calling ollama", { round, messageCount: messages.length, toolCount: tools.length });
    const completion = await ollamaClient.complete({ messages, tools, signal });
    const choice = completion.choices[0];
    if (!choice) {
      log("ollama returned no choices");
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "[Local agent: Ollama returned no choices]" },
        },
      });
      return;
    }
    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls;
    log("ollama responded", {
      round,
      finishReason: choice.finish_reason,
      hasToolCalls: Boolean(toolCalls?.length),
      toolCallCount: toolCalls?.length ?? 0,
      contentPreview: (assistantMessage.content ?? "").slice(0, 200),
    });

    messages.push(assistantMessage);

    if (!toolCalls || toolCalls.length === 0) {
      const text =
        assistantMessage.content && assistantMessage.content.length > 0
          ? assistantMessage.content
          : `[Local agent: model returned empty response at round ${round} with finish_reason="${choice.finish_reason}". The model may not support tool calling or the system prompt may need adjustment.]`;
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
      return;
    }

    for (const toolCall of toolCalls) {
      if (signal.aborted) return;

      const functionName = toolCall.function.name;
      const rawArgs = toolCall.function.arguments;
      const args = repairAndParseJson(rawArgs);

      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: toolCall.id,
          title: `${functionName}(${Object.keys(args).join(", ")})`,
          kind: "read",
          status: "pending",
          rawInput: args,
        },
      });

      const result = await mcpBridge.callTool(functionName, args);

      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.id,
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: result } }],
          rawOutput: { text: result },
        },
      });

      messages.push({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    if (assistantMessage.content) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: assistantMessage.content },
        },
      });
    }
  }

  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: `\n\n[Reached maximum tool call rounds (${MAX_TOOL_ROUNDS}). Stopping.]`,
      },
    },
  });
};
