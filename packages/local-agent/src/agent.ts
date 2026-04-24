import type * as acp from "@agentclientprotocol/sdk";
import { createOllamaClient, type OllamaClient } from "./ollama-client.js";
import { createMcpBridge, type McpBridge } from "./mcp-bridge.js";
import { runToolLoop } from "./tool-loop.js";
import { log } from "./log.js";
import { buildLocalAgentSystemPrompt } from "@neuve/shared/prompts";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

interface Session {
  id: string;
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  mcpBridge: McpBridge;
  pendingPrompt: AbortController | undefined;
  systemPrompt: string;
}

export class LocalAgent implements acp.Agent {
  private connection: acp.AgentSideConnection;
  private sessions = new Map<string, Session>();
  private ollamaClient: OllamaClient;

  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection;
    this.ollamaClient = createOllamaClient();
  }

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    log("initialize", { model: this.ollamaClient.model });
    return {
      protocolVersion: 1,
      agentCapabilities: {},
    };
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const mcpServers = (params as Record<string, unknown>)["mcpServers"] as
      | Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
      | undefined;

    log("newSession", {
      sessionId,
      mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
    });

    let mcpBridge: McpBridge;
    let tools: ChatCompletionTool[] = [];

    if (mcpServers && Object.keys(mcpServers).length > 0) {
      try {
        mcpBridge = await createMcpBridge(mcpServers);
        tools = mcpBridge.listToolsAsOpenAI();
        log("mcp bridge connected", { toolCount: tools.length });
      } catch (error) {
        log("mcp bridge failed", { error: String(error) });
        throw error;
      }
    } else {
      mcpBridge = {
        listToolsAsOpenAI: () => [],
        callTool: async () => ({ text: "No MCP servers configured", isError: true }),
        close: async () => {},
      };
    }

    const meta = (params as Record<string, unknown>)["_meta"] as
      | { systemPrompt?: string }
      | undefined;
    const systemPrompt = meta?.systemPrompt ?? buildLocalAgentSystemPrompt();
    log("system prompt resolved", {
      source: meta?.systemPrompt ? "incoming" : "fallback",
      length: systemPrompt.length,
    });

    this.sessions.set(sessionId, {
      id: sessionId,
      messages: [],
      tools,
      mcpBridge,
      pendingPrompt: undefined,
      systemPrompt,
    });

    return { sessionId };
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    return {};
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    session.pendingPrompt?.abort();
    session.pendingPrompt = new AbortController();

    const userText = extractPromptText(params.prompt);
    log("prompt", { sessionId: session.id, userTextLength: userText.length });

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: session.systemPrompt },
      ...session.messages,
      { role: "user", content: userText },
    ];

    await this.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: {
          type: "text",
          text: `Starting local inference with ${this.ollamaClient.model}...`,
        },
      },
    });

    try {
      await runToolLoop({
        sessionId: session.id,
        messages,
        tools: session.tools,
        ollamaClient: this.ollamaClient,
        mcpBridge: session.mcpBridge,
        connection: this.connection,
        signal: session.pendingPrompt.signal,
      });
    } catch (error) {
      if (session.pendingPrompt.signal.aborted) {
        log("prompt cancelled");
        return { stopReason: "cancelled" };
      }
      log("prompt error", { error: String(error) });
      await this.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `\n\n**Error from local agent:** ${error instanceof Error ? error.message : String(error)}`,
          },
        },
      });
      throw error;
    }

    session.messages = messages;
    session.pendingPrompt = undefined;

    return { stopReason: "end_turn" };
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.pendingPrompt?.abort();
  }
}

const extractPromptText = (prompt: unknown): string => {
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" && part !== null && part.type === "text",
      )
      .map((part) => part.text)
      .join("\n");
  }
  return String(prompt);
};
