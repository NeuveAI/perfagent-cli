#!/usr/bin/env node
// Probe B helper: spawn browser-mcp via MCP stdio and list its tools
// Usage: node list-tools.mjs > tools.json

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { execPath } from "node:process";

const browserMcpBinPath = fileURLToPath(
  new URL("../../../../apps/cli/dist/browser-mcp.js", import.meta.url),
);

const transport = new StdioClientTransport({
  command: execPath,
  args: [browserMcpBinPath],
});

const client = new Client({ name: "probe-list-tools", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();

const openAiTools = tools.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
  },
}));

console.log(JSON.stringify(openAiTools, null, 2));

await client.close();
await transport.close();
