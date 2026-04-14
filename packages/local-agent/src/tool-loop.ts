import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { OllamaClient } from "./ollama-client.js";
import type { McpBridge } from "./mcp-bridge.js";

import { log } from "./log.js";

const MAX_TOOL_ROUNDS = 15;
const DOOM_LOOP_THRESHOLD = 3;

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

interface ToolCallFingerprint {
  toolName: string;
  argsHash: string;
}

export const runToolLoop = async (options: ToolLoopOptions): Promise<void> => {
  const { sessionId, messages, tools, ollamaClient, mcpBridge, connection, signal } = options;

  const recentCalls: ToolCallFingerprint[] = [];
  let lastToolError: string | undefined;

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

      const argsHash = JSON.stringify(args);
      const lastCall = recentCalls[recentCalls.length - 1];
      const matchesLast =
        Boolean(lastCall) && lastCall?.toolName === functionName && lastCall?.argsHash === argsHash;
      if (!matchesLast) {
        recentCalls.length = 0;
      }
      const wouldTripThreshold = matchesLast && recentCalls.length >= DOOM_LOOP_THRESHOLD - 1;
      if (wouldTripThreshold) {
        log("doom loop detected", { tool: functionName, repeats: DOOM_LOOP_THRESHOLD });
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: toolCall.id,
            title: `${functionName}(${Object.keys(args).join(", ")})`,
            kind: "read",
            status: "failed",
            rawInput: args,
          },
        });
        const lastErrorOrUnknown = lastToolError ?? "unknown";
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `[Local agent: detected ${DOOM_LOOP_THRESHOLD} identical consecutive tool calls (${functionName}). Aborting to avoid wasted cycles. Last error: ${lastErrorOrUnknown}. Check the tool description for the expected call shape.]`,
            },
          },
        });
        return;
      }
      recentCalls.push({ toolName: functionName, argsHash });
      if (recentCalls.length > DOOM_LOOP_THRESHOLD) {
        recentCalls.shift();
      }

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

      const { text, isError } = await mcpBridge.callTool(functionName, args);
      if (isError) {
        lastToolError = text;
      }
      const messageText = isError
        ? `${text}\n\nHint: Check the tool's call shape in its description. Wrap your arguments under the wrapper key shown in the example.`
        : text;

      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.id,
          status: isError ? "failed" : "completed",
          content: [{ type: "content", content: { type: "text", text: messageText } }],
          rawOutput: { text: messageText },
        },
      });

      messages.push({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: messageText,
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
