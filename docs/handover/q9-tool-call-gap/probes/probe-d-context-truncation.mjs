#!/usr/bin/env node
// Probe D: does Ollama silently truncate when num_ctx=131072 is set?
// Send a request with a deliberately large conversation history and compare the
// prompt_tokens Ollama reports to our independent token estimate.

import * as fs from "node:fs/promises";

const OLLAMA = "http://localhost:11434/v1/chat/completions";
const MODEL = "gemma4:e4b";

// Build a long conversation. Each "turn" is ~1000 chars (~250 tokens) so 30 turns ~7.5K tokens,
// 100 turns ~25K. We'll exercise three sizes to see where truncation kicks in if any.
const filler = (label, n) => Array.from({ length: n }, (_, i) =>
  `[${label} ${i}] The quick brown fox jumps over the lazy dog. Performance metrics like LCP, CLS, INP are critical web vitals. The Core Web Vitals initiative measures real user experience. Largest Contentful Paint should be under 2500ms. Cumulative Layout Shift below 0.1. Interaction to Next Paint below 200ms. Time to First Byte below 800ms. First Contentful Paint below 1800ms.`,
).join(" ");

const tools = [
  {
    type: "function",
    function: {
      name: "ping",
      description: "echo back",
      parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
    },
  },
];

const sizes = [
  { label: "small", fillerTurns: 5 },     // ~1.2K tokens of filler
  { label: "medium", fillerTurns: 30 },   // ~7.5K tokens
  { label: "large", fillerTurns: 100 },   // ~25K tokens
  { label: "huge", fillerTurns: 300 },    // ~75K tokens
];

// Estimate input tokens (rough: 4 chars per token)
const estimateTokens = (str) => Math.ceil(str.length / 4);

const results = [];

for (const size of sizes) {
  const filler1 = filler(size.label, size.fillerTurns);
  const messages = [
    { role: "system", content: "You are an assistant. Answer briefly." },
    { role: "user", content: `Context dump (ignore): ${filler1}\n\nQuestion: what is 2+2?` },
  ];
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimated = estimateTokens(messages.map((m) => m.content).join(" "));

  console.log(`\n=== ${size.label} (${size.fillerTurns} filler chunks, ${totalChars} chars, est ${estimated} tokens) ===`);

  const t0 = Date.now();
  const response = await fetch(OLLAMA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      stream: false,
      temperature: 0.1,
      num_ctx: 131072,
    }),
  });
  const elapsed = Date.now() - t0;

  if (!response.ok) {
    console.log(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    continue;
  }

  const body = await response.json();
  const usage = body.usage ?? {};
  console.log(`HTTP 200 in ${elapsed}ms`);
  console.log(`  reported prompt_tokens:    ${usage.prompt_tokens}`);
  console.log(`  reported completion_tokens:${usage.completion_tokens}`);
  console.log(`  reported total_tokens:     ${usage.total_tokens}`);
  console.log(`  estimated input tokens:    ${estimated}`);
  console.log(`  reported / estimated:      ${(usage.prompt_tokens / estimated).toFixed(2)}`);
  console.log(`  finish_reason:             ${body.choices?.[0]?.finish_reason}`);
  console.log(`  response preview:          ${(body.choices?.[0]?.message?.content ?? "").slice(0, 100)}`);

  results.push({
    label: size.label,
    chars: totalChars,
    estimatedTokens: estimated,
    reportedPromptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    elapsedMs: elapsed,
  });
}

await fs.writeFile(
  new URL("./probe-d-results.json", import.meta.url),
  JSON.stringify(results, null, 2),
);

console.log(`\n=== Verdict ===`);
const grew = results.length > 1 && results[results.length - 1].reportedPromptTokens > results[0].reportedPromptTokens * 5;
if (grew) {
  console.log("Reported prompt_tokens grows roughly linearly with input size → num_ctx=131072 IS active, no silent truncation. The eval's peakPromptTokens=3900 reflects actual conversation size, not Ollama capping.");
} else {
  console.log("Reported prompt_tokens does NOT grow with input → Ollama is truncating despite num_ctx=131072. This affects R4's budget design.");
}
