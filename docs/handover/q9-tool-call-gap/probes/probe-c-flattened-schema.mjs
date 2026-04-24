#!/usr/bin/env node
// Probe C: Same as B but with `interact` schema flattened (no oneOf).
// Isolates whether oneOf discriminated unions are the reason Gemma emits to content instead
// of tool_calls.

import * as fs from "node:fs/promises";

const flatInteract = {
  type: "function",
  function: {
    name: "interact",
    description:
      "Perform a user interaction or navigation in the browser. Provide `command` and the fields relevant to that command.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["navigate", "click", "fill", "hover", "select", "wait_for"],
          description: "Which interaction to perform",
        },
        url: { type: "string", description: "Target URL for navigate" },
        direction: {
          type: "string",
          enum: ["url", "back", "forward", "reload"],
          description: "Navigation direction (navigate only)",
        },
        uid: { type: "string", description: "Element UID from a prior snapshot" },
        text: { type: "string", description: "Text to type (fill only)" },
        option: { type: "string", description: "Option to pick (select only)" },
        timeout: { type: "integer", description: "Timeout in ms" },
      },
      required: ["command"],
    },
  },
};

const systemPrompt = [
  "You are a performance analysis agent backed by Chrome DevTools.",
  "",
  "You MUST use the provided tools. Never describe plans, steps, or intentions in prose — always call a tool.",
  "",
  "Workflow:",
  '1. Use `interact` to navigate to URLs (command: "navigate") and perform user interactions (click, type, fill).',
  "",
  "Rules:",
  '- Always start by calling `interact` with command="navigate" to reach the target URL.',
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
  tools: [flatInteract],
  stream: false,
  temperature: 0.1,
  num_ctx: 32768,
};

await fs.writeFile(
  new URL("./probe-c-request-body.json", import.meta.url),
  JSON.stringify(requestBody, null, 2),
);

console.log(`request: 1 flat tool, user="${userPrompt}"`);

const response = await fetch("http://localhost:11434/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(requestBody),
});

const body = await response.json();
await fs.writeFile(
  new URL("./probe-c-response.json", import.meta.url),
  JSON.stringify(body, null, 2),
);

const choice = body.choices?.[0];
const message = choice?.message;
const toolCalls = message?.tool_calls;
const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

console.log(`HTTP ${response.status}  finish_reason: ${choice?.finish_reason}`);
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
console.log(hasToolCalls ? "VERDICT: Gemma tool-called a FLATTENED schema ✓ (oneOf was the bug)" : "VERDICT: still emitted to content ✗ (bug is not oneOf)");
