#!/usr/bin/env node
// Probe 2: Reproduce the round-4 empty-content failure on calibration-2-single-nav-news.
// Trace `gemma-react__calibration-2-single-nav-news.ndjson` shows:
//   turn 1 promptEval=8086
//   turn 2 promptEval=8176 (after THOUGHT envelope appended)
//   turn 3 promptEval=8512 (after navigate observation: 103 chars)
//   turn 4 promptEval=8591 (after observe.snapshot ACTION envelope appended)
//   turn 5 promptEval=23826 (after the 45 KB snapshot observation) → EMPTY CONTENT
//
// This probe rebuilds the conversation up through turn 4 (the failing call's
// input) and asks Ollama to emit the next envelope. We vary three knobs across
// modes so we can attribute the empty-content trigger:
//   - mode="full":     format=AgentTurnLoose + tools (production shape)
//   - mode="no-tools": format=AgentTurnLoose, tools omitted
//   - mode="no-format":format omitted, tools kept
//   - mode="bare":     no format, no tools (just messages)
//
// Each mode runs REPS times (default 5). Captures contentLength, doneReason,
// promptEvalCount, evalCount, elapsed, chunk count.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/chat";
const MODEL = process.env.MODEL ?? "gemma4:e4b";
const REPS = Number(process.env.REPS ?? "3");
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

// Conversation reconstructed from gemma-react__calibration-2-single-nav-news.ndjson.
// We reconstruct each round's assistant envelope (canonical-shorthand JSON,
// matching what Gemma emits under AgentTurnLoose grammar) and the user
// observation following each tool result.
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

const buildBody = (mode) => {
  const body = {
    model: MODEL,
    messages,
    stream: true,
    options: {
      num_ctx: 131_072,
      temperature: 0.1,
    },
  };
  if (mode === "full" || mode === "no-format") body.tools = tools;
  if (mode === "full" || mode === "no-tools") body.format = format;
  return body;
};

const totalUserContentBytes = messages.reduce((sum, m) => sum + m.content.length, 0);
console.log(`Probe 2: calibration-2 round-4 reproduction`);
console.log(`  total message bytes:       ${totalUserContentBytes}`);
console.log(`  bbc snapshot bytes:        ${bbcSnapshot.length}`);
console.log(`  REPS per mode:             ${REPS}`);
console.log(`  MODES:                     ${MODES.join(", ")}`);

const runOnce = async (mode, iteration) => {
  const body = buildBody(mode);
  const t0 = Date.now();
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      mode,
      iteration,
      ok: false,
      status: response.status,
      body: text.slice(0, 500),
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
  let totalDurationNs;
  let chunkCount = 0;

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
      chunkCount += 1;
      const message = chunk.message;
      if (message?.content) content += message.content;
      if (message?.tool_calls) toolCallCount += message.tool_calls.length;
      if (chunk.done) {
        doneReason = chunk.done_reason;
        promptEvalCount = chunk.prompt_eval_count;
        evalCount = chunk.eval_count;
        totalDurationNs = chunk.total_duration;
      }
    }
  }

  return {
    mode,
    iteration,
    ok: true,
    elapsedMs: Date.now() - t0,
    contentLength: content.length,
    contentPreview: content.slice(0, 240),
    toolCallCount,
    doneReason,
    promptEvalCount,
    evalCount,
    totalDurationNs,
    chunkCount,
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
          `contentLength=${result.contentLength} doneReason=${result.doneReason} ` +
          `promptEval=${result.promptEvalCount} eval=${result.evalCount} ` +
          `toolCalls=${result.toolCallCount}`,
      );
      if (result.contentLength > 0) {
        console.log(`    preview=${JSON.stringify(result.contentPreview.slice(0, 150))}`);
      } else {
        console.log(`    [EMPTY CONTENT REPRODUCED] doneReason=${result.doneReason}`);
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
    doneReasons: modeResults.map((r) => r.doneReason),
    promptEvalCounts: modeResults.map((r) => r.promptEvalCount),
    evalCounts: modeResults.map((r) => r.evalCount),
    elapsedMs: modeResults.map((r) => r.elapsedMs),
  };
}

console.log(`\n========== Summary ==========`);
console.log(JSON.stringify(summary, null, 2));

await fs.writeFile(
  path.join(__dirname, "probe-2-results.json"),
  JSON.stringify({ summary, results: allResults }, null, 2),
);
console.log(`\nWrote probe-2-results.json`);
