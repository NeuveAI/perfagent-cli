import * as path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Effect } from "effect";
import { LlmJudge, type JudgeInput } from "../src/scorers/llm-judge";
import { judgeCompletion } from "../src/scorers/llm-judge-completion";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(moduleDir, "..", ".env.local"), quiet: true });

// Three synthetic trajectories spanning the obvious verdicts: a clean
// completion, a stopped-at-landing-page partial, and a malformed-tools
// garbage run. The judge should rate them ~1.0, ~0.0, ~0.0 respectively.
// Used as a one-shot wiring smoke against the real Gemini 3 Flash preview
// endpoint — NOT for score comparison across runs (the model is
// nondeterministic at T=0.1).
const fixtures: ReadonlyArray<{ readonly label: string; readonly input: JudgeInput }> = [
  {
    label: "clean completion (volvo ex90 configurator)",
    input: {
      taskDescription:
        "Navigate volvocars.com → buy → build my Volvo → configure the EX90 → reach the order request form.",
      finalUrl: "https://www.volvocars.com/en-us/build/ex90/order",
      agentTrajectorySummary: [
        "Key nodes reached (4): https://www.volvocars.com/ → https://www.volvocars.com/en-us/buy → https://www.volvocars.com/en-us/build → https://www.volvocars.com/en-us/build/ex90/order",
        "",
        "Tool calls issued (6):",
        "  1. → browse(url=https://www.volvocars.com/)",
        "  2. → click(ref=Buy)",
        "  3. → click(ref=Build your Volvo)",
        "  4. → click(ref=EX90)",
        "  5. → click(ref=Continue to order)",
        "  6. → performance_start_trace(label=order-form)",
        "",
        "Final URL: https://www.volvocars.com/en-us/build/ex90/order",
        "Final summary: EX90 order request form rendered; web vitals captured.",
      ].join("\n"),
    },
  },
  {
    label: "stopped at landing page",
    input: {
      taskDescription:
        "Navigate volvocars.com → buy → build my Volvo → configure the EX90 → reach the order request form.",
      finalUrl: "https://www.volvocars.com/",
      agentTrajectorySummary: [
        "Key nodes reached (1): https://www.volvocars.com/",
        "",
        "Tool calls issued (1):",
        "  1. → browse(url=https://www.volvocars.com/)",
        "",
        "Final URL: https://www.volvocars.com/",
        "Final summary: homepage rendered",
      ].join("\n"),
    },
  },
  {
    label: "malformed tools, no progress",
    input: {
      taskDescription: "Go to github.com, open Explore, and land on the Topics page.",
      finalUrl: "",
      agentTrajectorySummary: [
        "Key nodes reached: none.",
        "",
        "Tool calls issued (3):",
        "  1. → click() [malformed]",
        "  2. → click() [malformed]",
        "  3. → click() [malformed]",
        "",
        "Final URL: <none>",
        "Final summary: <none>",
      ].join("\n"),
    },
  },
];

const run = Effect.gen(function* () {
  const results: Array<{
    label: string;
    completed: boolean;
    confidence: number;
    score: number;
    reasoning: string;
  }> = [];
  for (const fixture of fixtures) {
    const verdict = yield* judgeCompletion(fixture.input);
    results.push({ label: fixture.label, ...verdict });
  }
  return results;
}).pipe(Effect.provide(LlmJudge.layer));

const results = await Effect.runPromise(run);

console.log(JSON.stringify(results, null, 2));
