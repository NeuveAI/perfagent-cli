#!/usr/bin/env node
// Probe B (post-Q9-fix): Replay the same production request as probe-b but
// route the chrome-devtools-mcp tool schemas through the mcp-bridge's
// `flattenOneOf` helper first. This is the end-to-end verification for the
// Q9 fix — it exercises the same transformation that ships in
// `packages/local-agent/src/mcp-bridge.ts` and proves that Gemma 4 emits
// `message.tool_calls` (not `message.content`) once the oneOf unions are
// flattened.
//
// The probe spawns `apps/cli/dist/browser-mcp.js` directly (same as
// `list-tools.mjs`) and applies the flatten helper inline. Keeping the
// helper inline — rather than importing from the package — lets this probe
// run via plain `node` without a TS runtime. The logic mirrors
// `flattenOneOf` in mcp-bridge.ts exactly; the unit test at
// `packages/local-agent/tests/flatten-one-of.test.ts` is the authoritative
// contract.

import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execPath } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const isObject = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const flattenOneOf = (inputSchema) => {
  if (!isObject(inputSchema)) return { type: "object", properties: {} };
  const properties = inputSchema.properties;
  if (!isObject(properties)) return inputSchema;
  const keys = Object.keys(properties);
  if (keys.length !== 1) return inputSchema;
  const wrapperKey = keys[0];
  if (!wrapperKey) return inputSchema;
  const wrapperSchema = properties[wrapperKey];
  if (!isObject(wrapperSchema)) return inputSchema;
  const variants = wrapperSchema.oneOf;
  if (!Array.isArray(variants) || variants.length === 0) return inputSchema;
  for (const variant of variants) {
    if (!isObject(variant)) return inputSchema;
    if (!isObject(variant.properties)) return inputSchema;
    const commandSchema = variant.properties.command;
    if (!isObject(commandSchema)) return inputSchema;
    if (typeof commandSchema.const !== "string") return inputSchema;
  }

  const commandValues = [];
  const hoistedProperties = {};
  const descriptionsByProperty = new Map();

  for (const variant of variants) {
    const variantProperties = variant.properties;
    for (const [propertyName, propertySchema] of Object.entries(variantProperties)) {
      if (propertyName === "command") {
        const constValue = propertySchema.const;
        if (typeof constValue === "string" && !commandValues.includes(constValue)) {
          commandValues.push(constValue);
        }
        continue;
      }
      if (!(propertyName in hoistedProperties)) {
        const cloned = { ...propertySchema };
        delete cloned.description;
        hoistedProperties[propertyName] = cloned;
      }
      const description = propertySchema.description;
      if (typeof description === "string" && description.length > 0) {
        const existing = descriptionsByProperty.get(propertyName) ?? [];
        if (!existing.includes(description)) existing.push(description);
        descriptionsByProperty.set(propertyName, existing);
      }
    }
  }

  for (const [propertyName, descriptions] of descriptionsByProperty) {
    if (hoistedProperties[propertyName]) {
      hoistedProperties[propertyName].description = descriptions.join(" / ");
    }
  }

  const flattened = {
    type: "object",
    properties: {
      command: { type: "string", enum: commandValues },
      ...hoistedProperties,
    },
    required: ["command"],
  };
  if (typeof inputSchema.$schema === "string") flattened.$schema = inputSchema.$schema;
  if (typeof inputSchema.description === "string") flattened.description = inputSchema.description;
  return flattened;
};

const browserMcpBinPath = fileURLToPath(
  new URL("../../../../apps/cli/dist/browser-mcp.js", import.meta.url),
);

const transport = new StdioClientTransport({
  command: execPath,
  args: [browserMcpBinPath],
});

const client = new Client({ name: "probe-b-post-fix", version: "0.1.0" });
await client.connect(transport);

const { tools: rawTools } = await client.listTools();

const openAiTools = rawTools.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description ?? "",
    parameters: flattenOneOf(tool.inputSchema ?? { type: "object", properties: {} }),
  },
}));

// Sanity-check the flatten worked on the 3 compound tools.
for (const name of ["interact", "observe", "trace"]) {
  const tool = openAiTools.find((t) => t.function.name === name);
  if (!tool) continue;
  const stringified = JSON.stringify(tool.function.parameters);
  if (stringified.includes('"oneOf"')) {
    console.error(`FATAL: flatten helper left oneOf in \`${name}\` — fix regressed`);
    process.exit(2);
  }
}

// Mirrors buildLocalAgentSystemPrompt() in packages/shared/src/prompts.ts
// and probe-b-production-replay.mjs.
const systemPrompt = [
  "You are a performance analysis agent backed by Chrome DevTools.",
  "",
  "You MUST use the provided tools. Never describe plans, steps, or intentions in prose — always call a tool.",
  "",
  "Workflow:",
  '1. Use `interact` to navigate to URLs (command: "navigate") and perform user interactions (click, type, fill).',
  "2. Use `observe` to read page state (snapshot for element UIDs, screenshot for visuals, console/network for logs).",
  '3. Use `trace` to profile performance: "start" begins a trace, "stop" returns Core Web Vitals + insight IDs, "analyze" drills into a specific insight.',
  "",
  "Core Web Vitals targets:",
  "- LCP < 2500 ms",
  "- FCP < 1800 ms",
  "- CLS < 0.1",
  "- INP < 200 ms",
  "- TTFB < 800 ms",
  "",
  "Rules:",
  '- Always start by calling `interact` with command="navigate" to reach the target URL.',
  '- Before interacting with elements, call `observe` with command="snapshot" to get element UIDs.',
  '- For cold-load performance: call `trace` with command="start", reload=true, autoStop=true. This records, auto-stops, and returns CWV + insights in one call.',
  '- For interaction profiling (INP): call `trace` with command="start", reload=false, autoStop=false; perform interactions via `interact`; then call `trace` with command="stop".',
  '- YOU MUST call `trace` with command="analyze" for EACH insight name returned in the trace response before you stop. Do not produce a final report until every insight has been analyzed. Every insight listed — LCPBreakdown, CLSCulprits, RenderBlocking, NetworkDependencyTree, DocumentLatency, and any others — requires its own analyze call. Skipping any insight means the report is incomplete.',
  "  Analyze call shape:",
  '    { "action": { "command": "analyze", "insightSetId": "NAVIGATION_0", "insightName": "LCPBreakdown" } }',
  '    { "action": { "command": "analyze", "insightSetId": "NAVIGATION_0", "insightName": "RenderBlocking" } }',
  "- Report findings concisely after tools return data. Do not narrate what you are about to do.",
  "",
  "Call tools. Do not narrate.",
].join("\n");

const userPrompt = "Start by navigating to the MDN Web Docs page for JavaScript.";

const requestBody = {
  model: "gemma4:e4b",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  tools: openAiTools,
  stream: false,
  temperature: 0.1,
  num_ctx: 32768,
};

await fs.writeFile(
  new URL("./probe-b-post-fix-request-body.json", import.meta.url),
  JSON.stringify(requestBody, null, 2),
);

console.log(
  `request: ${openAiTools.length} tools (oneOf flattened), system=${systemPrompt.length} chars, user="${userPrompt}"`,
);

const response = await fetch("http://localhost:11434/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(requestBody),
});

const body = await response.json();
await fs.writeFile(
  new URL("./probe-b-post-fix-response.json", import.meta.url),
  JSON.stringify(body, null, 2),
);

const choice = body.choices?.[0];
const message = choice?.message;
const toolCalls = message?.tool_calls;
const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

console.log(`---`);
console.log(`HTTP ${response.status}`);
console.log(`finish_reason: ${choice?.finish_reason}`);
console.log(`tool_calls count: ${toolCalls?.length ?? 0}`);
if (hasToolCalls) {
  for (const tc of toolCalls) {
    console.log(`  → ${tc.function?.name}(${tc.function?.arguments})`);
  }
}
console.log(`content.length: ${message?.content?.length ?? 0}`);
if (message?.content) {
  console.log(`content preview:\n  ${message.content.slice(0, 400)}`);
}
console.log(`---`);
console.log(
  hasToolCalls
    ? "VERDICT: Gemma emitted tool calls ✓ (Q9 flatten fix works end-to-end)"
    : "VERDICT: Gemma emitted NO tool calls ✗ (fix did not land or Ollama/model changed)",
);

await client.close();
await transport.close();

if (!hasToolCalls) process.exit(1);
