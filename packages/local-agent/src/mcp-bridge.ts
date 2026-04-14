import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

import { log } from "./log.js";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface McpToolCallResult {
  readonly text: string;
  readonly isError: boolean;
}

export interface McpBridge {
  readonly listToolsAsOpenAI: () => ChatCompletionTool[];
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
  readonly close: () => Promise<void>;
}

interface JsonSchemaLike {
  readonly type?: string;
  readonly properties?: Record<string, JsonSchemaLike>;
  readonly oneOf?: JsonSchemaLike[];
  readonly anyOf?: JsonSchemaLike[];
  readonly allOf?: JsonSchemaLike[];
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const schemaHasCommandProperty = (schema: JsonSchemaLike | undefined): boolean => {
  if (!schema) return false;
  if (schema.properties && "command" in schema.properties) return true;
  const variants = [
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.allOf ?? []),
  ];
  if (variants.length === 0) return false;
  return variants.every((variant) => {
    return Boolean(variant.properties && "command" in variant.properties);
  });
};

const detectWrapperKey = (inputSchema: unknown): string | undefined => {
  if (!isObject(inputSchema)) return undefined;
  const properties = inputSchema["properties"];
  if (!isObject(properties)) return undefined;
  const keys = Object.keys(properties);
  if (keys.length !== 1) return undefined;
  const wrapperKey = keys[0];
  if (!wrapperKey) return undefined;
  const wrapperSchema = properties[wrapperKey];
  if (!isObject(wrapperSchema)) return undefined;
  return schemaHasCommandProperty(wrapperSchema as JsonSchemaLike) ? wrapperKey : undefined;
};

export const createMcpBridge = async (
  servers: Record<string, McpServerConfig>,
): Promise<McpBridge> => {
  const clients: Array<{ client: Client; transport: StdioClientTransport }> = [];
  const toolToClient = new Map<string, Client>();
  const wrapperKeyByTool = new Map<string, string>();
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
      const wrapperKey = detectWrapperKey(tool.inputSchema);
      if (wrapperKey) {
        wrapperKeyByTool.set(tool.name, wrapperKey);
        log("detected tool wrapper key", { tool: tool.name, wrapperKey });
      }
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

  const callTool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> => {
    log("tool call", { tool: name, args });

    const client = toolToClient.get(name);
    if (!client) {
      const available = [...toolToClient.keys()].join(", ");
      return {
        text: `Unknown tool: ${name}. Available: ${available}`,
        isError: true,
      };
    }

    const wrapperKey = wrapperKeyByTool.get(name);
    let finalArgs = args;
    if (wrapperKey && !(wrapperKey in args) && "command" in args) {
      finalArgs = { [wrapperKey]: args };
      log("auto-wrapped tool args", { tool: name, wrapperKey });
    }

    const result = (await client.callTool({ name, arguments: finalArgs })) as McpToolResult;
    const joinedText = result.content
      .filter((item) => item.type === "text" && item.text)
      .map((item) => item.text)
      .join("\n");

    if (result.isError) {
      const errorText = joinedText || "Unknown tool error";
      log("tool error", { tool: name, errorText });
      return {
        text: `Validation error: ${errorText}`,
        isError: true,
      };
    }

    return { text: joinedText, isError: false };
  };

  const close = async () => {
    for (const { client, transport } of clients) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  };

  return { listToolsAsOpenAI, callTool, close } as const;
};
