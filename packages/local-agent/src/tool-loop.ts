import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { OllamaClient } from "./ollama-client.js";
import type { McpBridge } from "./mcp-bridge.js";

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

    const completion = await ollamaClient.complete({ messages, tools, signal });
    const choice = completion.choices[0];
    if (!choice) return;

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      if (assistantMessage.content) {
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: assistantMessage.content },
          },
        });
      }
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
