#!/usr/bin/env node
// Probe 3: LM Studio backend comparison.
// Same conversation as probe 2 (calibration-2 round-4 reproduction) but
// against LM Studio's OpenAI-compatible /v1/chat/completions endpoint.
//
// LM Studio's structured-output equivalent of Ollama's `format` is the
// OpenAI `response_format: { type: "json_schema", json_schema: ... }` block.
// We send the SAME AgentTurnLoose JSON Schema wrapped in that envelope.
//
// Backends are selected at LM Studio model-load time. This script sends
// requests; you must load the model under the desired runtime via
// `lms load google/gemma-4-e4b --gpu max --context-length 131072 -y` (GGUF
// uses llama.cpp by default) and document the runtime in `RUNTIME_LABEL`.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LMSTUDIO_URL = process.env.LMSTUDIO_URL ?? "http://localhost:1234/v1/chat/completions";
const MODEL = process.env.LMSTUDIO_MODEL ?? "google/gemma-4-e4b";
const REPS = Number(process.env.REPS ?? "5");
const RUNTIME_LABEL = process.env.RUNTIME_LABEL ?? "llama.cpp";
const MODES = (process.env.MODES ?? "full,no-tools,no-format,bare").split(",");

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
const bbcSnapshot = await fs.readFile(
  path.join(__dirname, "calibration-2-bbc-snapshot.txt"),
  "utf-8",
);

const userInstruction =
  "Visit the BBC News homepage and verify the top story is visible on the landing page.";

const round0Thought = JSON.stringify({
  _tag: "THOUGHT",
  stepId: "1",
  thought:
    "The user wants me to visit the BBC News homepage and verify the top story is visible. I must start by navigating to the BBC News URL and then observing the page to check for the top story's visibility.",
});
const round0ThoughtObs = "<observation>(THOUGHT recorded for 1 — proceed with the next ACTION or status envelope.)</observation>";
const round1Action = JSON.stringify({
  _tag: "ACTION",
  stepId: "1",
  toolName: "interact",
  args: { command: "navigate", url: "https://www.bbc.co.uk/news" },
});
const round1Obs = "<observation>Successfully navigated to https://www.bbc.co.uk/news.\n## Pages\n1: https://www.bbc.co.uk/news [selected]</observation>";
const round2Thought = JSON.stringify({
  _tag: "THOUGHT",
  stepId: "1",
  thought:
    "I have successfully navigated to the BBC News homepage. Now I need to observe the page content to verify if the top story is visible, which requires a snapshot.",
});
const round2ThoughtObs = "<observation>(THOUGHT recorded for 1 — proceed with the next ACTION or status envelope.)</observation>";
const round3Action = JSON.stringify({
  _tag: "ACTION",
  stepId: "1",
  toolName: "observe",
  args: { command: "snapshot" },
});
const round3Obs = `<observation>${bbcSnapshot}</observation>`;

const messages = [
  { role: "system", content: systemPrompt },
  { role: "user", content: userInstruction },
  { role: "assistant", content: round0Thought },
  { role: "user", content: round0ThoughtObs },
  { role: "assistant", content: round1Action },
  { role: "user", content: round1Obs },
  { role: "assistant", content: round2Thought },
  { role: "user", content: round2ThoughtObs },
  { role: "assistant", content: round3Action },
  { role: "user", content: round3Obs },
];

// LM Studio's /v1 OpenAI-compatible API requires that JSON-schema response_format
// have a non-null root `type`. Our AgentTurnLoose root uses `anyOf` with no
// top-level `type`. Wrap it in an object with a `type: "object"` schema is
// invalid for our union; instead, pass the schema as-is — LM Studio's
// llama.cpp runtime accepts top-level anyOf.
const responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "AgentTurnLoose",
    strict: true,
    schema: format,
  },
};

const buildBody = (mode) => {
  const body = {
    model: MODEL,
    messages,
    stream: false,
    temperature: 0.1,
  };
  if (mode === "full" || mode === "no-format") body.tools = tools;
  if (mode === "full" || mode === "no-tools") body.response_format = responseFormat;
  return body;
};

console.log(`Probe 3: LM Studio comparison (runtime=${RUNTIME_LABEL})`);
console.log(`  REPS per mode:             ${REPS}`);
console.log(`  MODES:                     ${MODES.join(", ")}`);
console.log(`  total message bytes:       ${messages.reduce((s, m) => s + m.content.length, 0)}`);

const runOnce = async (mode, iteration) => {
  const body = buildBody(mode);
  const t0 = Date.now();
  const response = await fetch(LMSTUDIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  if (!response.ok) {
    const text = await response.text();
    return { mode, iteration, ok: false, status: response.status, body: text.slice(0, 500), elapsedMs: elapsed };
  }
  const json = await response.json();
  const choice = json.choices?.[0];
  const content = choice?.message?.content ?? "";
  const toolCalls = choice?.message?.tool_calls ?? [];
  return {
    mode,
    iteration,
    ok: true,
    elapsedMs: elapsed,
    contentLength: content.length,
    contentPreview: content.slice(0, 240),
    toolCallCount: toolCalls.length,
    finishReason: choice?.finish_reason,
    promptTokens: json.usage?.prompt_tokens,
    completionTokens: json.usage?.completion_tokens,
  };
};

const allResults = [];
for (const mode of MODES) {
  console.log(`\n========== mode: ${mode} ==========`);
  for (let i = 0; i < REPS; i++) {
    const result = await runOnce(mode, i);
    allResults.push(result);
    if (result.ok) {
      console.log(
        `  rep ${i + 1}/${REPS} elapsed=${result.elapsedMs}ms ` +
          `contentLength=${result.contentLength} finishReason=${result.finishReason} ` +
          `prompt=${result.promptTokens} completion=${result.completionTokens} ` +
          `toolCalls=${result.toolCallCount}`,
      );
      if (result.contentLength > 0) {
        console.log(`    preview=${JSON.stringify(result.contentPreview.slice(0, 150))}`);
      } else {
        console.log(`    [EMPTY CONTENT REPRODUCED]`);
      }
    } else {
      console.log(`  rep ${i + 1}/${REPS} FAILED status=${result.status} body=${result.body}`);
    }
  }
}

const summary = {};
for (const mode of MODES) {
  const modeResults = allResults.filter((r) => r.mode === mode && r.ok);
  const empty = modeResults.filter((r) => r.contentLength === 0).length;
  summary[mode] = {
    reps: modeResults.length,
    emptyCount: empty,
    emptyRate: empty / Math.max(modeResults.length, 1),
    contentLengths: modeResults.map((r) => r.contentLength),
    finishReasons: modeResults.map((r) => r.finishReason),
    promptTokens: modeResults.map((r) => r.promptTokens),
    completionTokens: modeResults.map((r) => r.completionTokens),
    elapsedMs: modeResults.map((r) => r.elapsedMs),
  };
}

console.log(`\n========== Summary (${RUNTIME_LABEL}) ==========`);
console.log(JSON.stringify(summary, null, 2));

const outFile = `probe-3-lmstudio-${RUNTIME_LABEL.replace(/\W+/g, "_")}-results.json`;
await fs.writeFile(
  path.join(__dirname, outFile),
  JSON.stringify({ runtime: RUNTIME_LABEL, summary, results: allResults }, null, 2),
);
console.log(`\nWrote ${outFile}`);
