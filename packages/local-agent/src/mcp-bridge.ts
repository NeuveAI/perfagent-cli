import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface McpBridge {
  readonly listToolsAsOpenAI: () => ChatCompletionTool[];
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  readonly close: () => Promise<void>;
}

export const createMcpBridge = async (
  servers: Record<string, McpServerConfig>,
): Promise<McpBridge> => {
  const clients: Array<{ client: Client; transport: StdioClientTransport }> = [];
  const toolToClient = new Map<string, Client>();
  const openAiTools: ChatCompletionTool[] = [];

  for (const [name, config] of Object.entries(servers)) {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    });

    const client = new Client({ name: `local-agent-${name}`, version: "0.1.0" });
    await client.connect(transport);
    clients.push({ client, transport });

    const { tools } = await client.listTools();

    for (const tool of tools) {
      toolToClient.set(tool.name, client);
      openAiTools.push({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        },
      });
    }
  }

  const listToolsAsOpenAI = (): ChatCompletionTool[] => openAiTools;

  const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const client = toolToClient.get(name);
    if (!client) {
      return `Error: tool "${name}" not found. Available tools: ${[...toolToClient.keys()].join(", ")}`;
    }

    const result = (await client.callTool({ name, arguments: args })) as McpToolResult;

    if (result.isError) {
      const errorText = result.content
        .filter((item) => item.type === "text" && item.text)
        .map((item) => item.text)
        .join("\n");
      return `Error: ${errorText || "Unknown tool error"}`;
    }

    return result.content
      .filter((item) => item.type === "text" && item.text)
      .map((item) => item.text)
      .join("\n");
  };

  const close = async () => {
    for (const { client, transport } of clients) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  };

  return { listToolsAsOpenAI, callTool, close } as const;
};
