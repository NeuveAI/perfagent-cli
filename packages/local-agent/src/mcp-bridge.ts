import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { OllamaToolDefinition } from "./ollama-client.js";
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
  readonly listTools: () => OllamaToolDefinition[];
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
  const variants = [...(schema.oneOf ?? []), ...(schema.anyOf ?? []), ...(schema.allOf ?? [])];
  if (variants.length === 0) return false;
  return variants.every((variant) => {
    return Boolean(variant.properties && "command" in variant.properties);
  });
};

export const detectWrapperKey = (inputSchema: unknown): string | undefined => {
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

// Gemma 4's tool-call template cannot template JSON-Schema `oneOf` discriminated
// unions. When the raw MCP schema for a compound tool (e.g. `interact`, `observe`,
// `trace`) is handed to Ollama unchanged, Gemma reasons about the call but emits
// the arguments as `message.content` instead of `message.tool_calls` — the
// executor sees an empty tool_calls array and bails at turn 1 (the 2026-04-24
// baseline's 25% floor / `turnCount=1` / `toolCallCount=0` signature). See
// `docs/handover/q9-tool-call-gap/diagnosis.md`.
//
// `flattenOneOf` recognises the specific shape the compound tools use — a single
// wrapper property whose schema is `{ oneOf: [{ properties: { command: { const: "..." } } }, ...] }`
// — and rewrites it into a single flat object schema:
//   - the discriminator (`command`) becomes `{ type: "string", enum: [...] }` (required)
//   - every per-variant property is hoisted to the top level as optional
//   - descriptions from distinct variants are merged with " / "
//   - on prop-name collisions (e.g. `text` appearing as string in one variant and
//     array in another), the first-seen variant wins — the MCP server validates
//     at call time and ignores unknown fields.
//
// The wrapper property itself is dropped from the OpenAI schema. Call-time
// re-wrap happens in `callTool` via the independent `detectWrapperKey` path,
// which still inspects the ORIGINAL schema so the auto-wrap keeps working.
//
// Schemas that don't match the discriminated-union shape (the 5 flat tools, or
// `oneOf`/`anyOf` at nested positions like `select.option`) are returned
// unchanged.
export const flattenOneOf = (inputSchema: unknown): Record<string, unknown> => {
  if (!isObject(inputSchema)) {
    return { type: "object", properties: {} };
  }
  const properties = inputSchema["properties"];
  if (!isObject(properties)) return inputSchema;
  const keys = Object.keys(properties);
  if (keys.length !== 1) return inputSchema;
  const wrapperKey = keys[0];
  if (!wrapperKey) return inputSchema;
  const wrapperSchema = properties[wrapperKey];
  if (!isObject(wrapperSchema)) return inputSchema;
  const variants = wrapperSchema["oneOf"];
  if (!Array.isArray(variants) || variants.length === 0) {
    return inputSchema;
  }
  // Every variant must be an object schema with a `command: { const: "..." }` discriminator.
  for (const variant of variants) {
    if (!isObject(variant)) return inputSchema;
    const variantProperties = variant["properties"];
    if (!isObject(variantProperties)) return inputSchema;
    const commandSchema = variantProperties["command"];
    if (!isObject(commandSchema)) return inputSchema;
    if (typeof commandSchema["const"] !== "string") return inputSchema;
  }

  const commandValues: string[] = [];
  const hoistedProperties: Record<string, Record<string, unknown>> = {};
  const descriptionsByProperty = new Map<string, string[]>();

  for (const variant of variants) {
    const variantProperties = (variant as Record<string, unknown>)["properties"] as Record<
      string,
      Record<string, unknown>
    >;
    for (const [propertyName, propertySchema] of Object.entries(variantProperties)) {
      if (propertyName === "command") {
        const constValue = propertySchema["const"];
        if (typeof constValue === "string" && !commandValues.includes(constValue)) {
          commandValues.push(constValue);
        }
        continue;
      }
      if (!(propertyName in hoistedProperties)) {
        const clonedSchema: Record<string, unknown> = { ...propertySchema };
        delete clonedSchema["description"];
        hoistedProperties[propertyName] = clonedSchema;
      }
      const description = propertySchema["description"];
      if (typeof description === "string" && description.length > 0) {
        const existing = descriptionsByProperty.get(propertyName) ?? [];
        if (!existing.includes(description)) existing.push(description);
        descriptionsByProperty.set(propertyName, existing);
      }
    }
  }

  for (const [propertyName, descriptions] of descriptionsByProperty) {
    const schema = hoistedProperties[propertyName];
    if (schema) schema["description"] = descriptions.join(" / ");
  }

  const flattenedProperties: Record<string, unknown> = {
    command: {
      type: "string",
      enum: commandValues,
    },
    ...hoistedProperties,
  };

  const flattened: Record<string, unknown> = {
    type: "object",
    properties: flattenedProperties,
    required: ["command"],
  };
  const schemaDialect = inputSchema["$schema"];
  if (typeof schemaDialect === "string") {
    flattened["$schema"] = schemaDialect;
  }
  const inputDescription = inputSchema["description"];
  if (typeof inputDescription === "string") {
    flattened["description"] = inputDescription;
  }
  return flattened;
};

export const createMcpBridge = async (
  servers: Record<string, McpServerConfig>,
): Promise<McpBridge> => {
  const clients: Array<{ client: Client; transport: StdioClientTransport }> = [];
  const toolToClient = new Map<string, Client>();
  const wrapperKeyByTool = new Map<string, string>();
  const ollamaTools: OllamaToolDefinition[] = [];

  for (const [name, config] of Object.entries(servers)) {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? ({ ...process.env, ...config.env } as Record<string, string>) : undefined,
    });

    const client = new Client({ name: `local-agent-${name}`, version: "0.1.0" });
    await client.connect(transport);
    clients.push({ client, transport });

    const { tools } = await client.listTools();

    for (const tool of tools) {
      toolToClient.set(tool.name, client);
      // Wrapper detection must run on the ORIGINAL schema: `flattenOneOf`
      // drops the wrapper property from the OpenAI-facing schema, but the
      // MCP server still expects args nested under it at call time.
      const wrapperKey = detectWrapperKey(tool.inputSchema);
      if (wrapperKey) {
        wrapperKeyByTool.set(tool.name, wrapperKey);
        log("detected tool wrapper key", { tool: tool.name, wrapperKey });
      }
      const flattenedParameters = flattenOneOf(tool.inputSchema);
      ollamaTools.push({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: flattenedParameters,
        },
      });
    }
  }

  const listTools = (): OllamaToolDefinition[] => ollamaTools;

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

  return { listTools, callTool, close } as const;
};
