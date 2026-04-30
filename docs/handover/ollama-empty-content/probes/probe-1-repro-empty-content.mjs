#!/usr/bin/env node
// Probe 1: Reproduce the round-1 empty-content failure on journey-9-form-wizard
// against production Ollama. We replicate the exact request shape `tool-loop.ts`
// sends at the failing turn:
//   - system prompt: buildLocalAgentSystemPrompt() (4071 chars)
//   - user prompt:   the journey-9-form-wizard task instruction
//   - assistant:     ACTION envelope navigate https://www.turbotax.com/
//   - user:          observation: navigation success
// Then chat with format=AgentTurnLoose JSON Schema, num_ctx=131072, temp=0.1.
// Repeat REPS times to test deterministic-vs-stochastic.
//
// Captures: response chunks, content length, done_reason, prompt_eval_count,
// eval_count, total_duration. Saves per-run output and a summary.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/chat";
const MODEL = process.env.MODEL ?? "gemma4:e4b";
const REPS = Number(process.env.REPS ?? "5");

const systemPrompt = await fs.readFile(path.join(__dirname, "system-prompt.txt"), "utf-8");
const tools = JSON.parse(
  await fs.readFile(
    path.join(__dirname, "..", "..", "q9-tool-call-gap", "probes", "browser-mcp-tools.json"),
    "utf-8",
  ),
);
const format = JSON.parse(
  await fs.readFile(path.join(__dirname, "agent-turn-loose-format.json"), "utf-8"),
);

// Production developer-request body the supervisor injects for journey-9. The
// actual eval `prompt` field is mirrored here; the surrounding <environment>,
// <plan>, etc. blocks are omitted because the local-agent's `agent.ts` only
// receives the user instruction text via `extractPromptText` — the supervisor
// composes the rest via `buildExecutionPrompt` and passes it as the user
// content. We reproduce that composed user content for fidelity.
const userInstruction =
  "On the TurboTax marketing site, start the guided product selection wizard, " +
  "answer the initial questions using plausible responses, and continue through " +
  "at least three consecutive wizard steps until a recommendation or review " +
  "screen is shown. Do not submit any payment information.";

// At round 1 of the failing trace, the conversation history was:
//   1. system
//   2. user (task)
//   3. assistant (ACTION navigate)
//   4. user observation: navigation success
// Round 1 = the second model call. (Round 0 produced the navigate action.)
// Reproducing the assistant envelope exactly as the model emitted it on
// round 0 — synthesized as canonical-shorthand because the trace converts
// envelopes back to tool_calls. The schema validates either canonical
// {args:{command:...}} or shorthand {args:{action:{command:...}}} variants;
// the trajectory observed in passing runs uses canonical, so we mirror that.
const assistantRound0 = JSON.stringify({
  _tag: "ACTION",
  stepId: "1",
  toolName: "interact",
  args: { command: "navigate", url: "https://www.turbotax.com/" },
});

const observationRound0 =
  "<observation>Successfully navigated to https://www.turbotax.com/.\n## Pages\n1: https://turbotax.intuit.com/ [selected]</observation>";

const messages = [
  { role: "system", content: systemPrompt },
  { role: "user", content: userInstruction },
  { role: "assistant", content: assistantRound0 },
  { role: "user", content: observationRound0 },
];

const requestBody = {
  model: MODEL,
  messages,
  stream: true,
  options: {
    num_ctx: 131_072,
    temperature: 0.1,
  },
  tools,
  format,
};

await fs.writeFile(
  path.join(__dirname, "probe-1-request-body.json"),
  JSON.stringify(requestBody, null, 2),
);

const requestBytes = JSON.stringify(requestBody).length;
console.log(`Probe 1: empty-content reproduction (REPS=${REPS})`);
console.log(`  request body bytes:        ${requestBytes}`);
console.log(`  system prompt chars:       ${systemPrompt.length}`);
console.log(`  tools count:               ${tools.length}`);
console.log(`  tools bytes (compact):     ${JSON.stringify(tools).length}`);
console.log(`  format bytes (compact):    ${JSON.stringify(format).length}`);

const runOnce = async (iteration) => {
  const t0 = Date.now();
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      iteration,
      ok: false,
      status: response.status,
      body: body.slice(0, 500),
      elapsedMs: Date.now() - t0,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolCallCount = 0;
  let doneReason;
  let promptEvalCount;
  let evalCount;
  let totalDuration;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const chunk = JSON.parse(line);
      chunks.push(chunk);
      const message = chunk.message;
      if (message?.content) content += message.content;
      if (message?.tool_calls) toolCallCount += message.tool_calls.length;
      if (chunk.done) {
        doneReason = chunk.done_reason;
        promptEvalCount = chunk.prompt_eval_count;
        evalCount = chunk.eval_count;
        totalDuration = chunk.total_duration;
      }
    }
  }
  if (buffer.trim().length > 0) {
    const chunk = JSON.parse(buffer.trim());
    chunks.push(chunk);
  }

  return {
    iteration,
    ok: true,
    elapsedMs: Date.now() - t0,
    contentLength: content.length,
    contentPreview: content.slice(0, 400),
    toolCallCount,
    doneReason,
    promptEvalCount,
    evalCount,
    totalDurationNs: totalDuration,
    chunkCount: chunks.length,
  };
};

const results = [];
for (let i = 0; i < REPS; i++) {
  console.log(`\n=== run ${i + 1}/${REPS} ===`);
  const result = await runOnce(i);
  results.push(result);
  if (result.ok) {
    console.log(`  ok=true elapsed=${result.elapsedMs}ms`);
    console.log(`  contentLength=${result.contentLength} doneReason=${result.doneReason}`);
    console.log(`  promptEval=${result.promptEvalCount} eval=${result.evalCount}`);
    console.log(`  toolCalls=${result.toolCallCount} chunks=${result.chunkCount}`);
    console.log(`  preview=${JSON.stringify(result.contentPreview.slice(0, 120))}`);
  } else {
    console.log(`  ok=false status=${result.status} body=${result.body}`);
  }
}

const emptyCount = results.filter((r) => r.ok && r.contentLength === 0).length;
const summary = {
  reps: REPS,
  emptyCount,
  emptyRate: emptyCount / REPS,
  contentLengths: results.map((r) => r.contentLength),
  doneReasons: results.map((r) => r.doneReason),
  promptEvalCounts: results.map((r) => r.promptEvalCount),
  evalCounts: results.map((r) => r.evalCount),
  elapsedMs: results.map((r) => r.elapsedMs),
};

console.log(`\n=== Summary ===`);
console.log(JSON.stringify(summary, null, 2));

await fs.writeFile(
  path.join(__dirname, "probe-1-results.json"),
  JSON.stringify({ summary, results }, null, 2),
);
console.log(`\nWrote probe-1-results.json`);
