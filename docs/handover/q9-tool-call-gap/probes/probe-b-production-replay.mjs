#!/usr/bin/env node
// Probe B: Replay exact production request (local system prompt + real browser-mcp tools
// + calibration-3 user message) against Ollama. Proves whether tools reach Gemma correctly
// when the full production context is assembled outside the local-agent process.

import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const tools = JSON.parse(
  await fs.readFile(new URL("./browser-mcp-tools.json", import.meta.url), "utf-8"),
);

// Mirrors buildLocalAgentSystemPrompt() in packages/shared/src/prompts.ts
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

// calibration-3 task prompt (the one Gemma hallucinated "no browsing capability" on)
const userPrompt = "Start by navigating to the MDN Web Docs page for JavaScript.";

const requestBody = {
  model: "gemma4:e4b",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  tools,
  stream: false,
  temperature: 0.1,
  num_ctx: 32768,
};

await fs.writeFile(
  new URL("./probe-b-request-body.json", import.meta.url),
  JSON.stringify(requestBody, null, 2),
);

console.log(`request: ${tools.length} tools, system=${systemPrompt.length} chars, user="${userPrompt}"`);

const response = await fetch("http://localhost:11434/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(requestBody),
});

const body = await response.json();
await fs.writeFile(
  new URL("./probe-b-response.json", import.meta.url),
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
console.log(`reasoning.length: ${message?.reasoning?.length ?? 0}`);
if (message?.content) {
  console.log(`content preview:\n  ${message.content.slice(0, 400)}`);
}
if (message?.reasoning) {
  console.log(`reasoning preview:\n  ${message.reasoning.slice(0, 400)}`);
}
console.log(`---`);
console.log(hasToolCalls ? "VERDICT: Gemma emitted tool calls ✓" : "VERDICT: Gemma emitted NO tool calls ✗");
