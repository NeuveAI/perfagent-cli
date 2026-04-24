import { assert, describe, it } from "vite-plus/test";
import { Effect } from "effect";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import {
  JUDGE_DEFAULT_MODEL,
  JudgeCallError,
  LlmJudge,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
  type JudgeInput,
} from "../src/scorers/llm-judge";
import { judgeCompletion } from "../src/scorers/llm-judge-completion";

const judgeInput: JudgeInput = {
  taskDescription: "Navigate volvocars.com → buy → build my Volvo → configure the EX90.",
  finalUrl: "https://www.volvocars.com/en-us/buy",
  agentTrajectorySummary: [
    "Key nodes reached (1): https://www.volvocars.com/",
    "",
    "Tool calls issued (1):",
    "  1. → browse(url=https://www.volvocars.com/)",
    "",
    "Final URL: https://www.volvocars.com/",
    "Final summary: homepage rendered",
  ].join("\n"),
};

const dummyResponseBase = {
  finishReason: { unified: "stop", raw: "stop" } as const,
  usage: {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 20, text: 20, reasoning: undefined },
  },
  warnings: [],
};

const buildModelReturning = (object: Record<string, unknown>) =>
  new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-model",
    doGenerate: async (_options: LanguageModelV4CallOptions) => ({
      ...dummyResponseBase,
      content: [{ type: "text" as const, text: JSON.stringify(object) }],
    }),
  });

const buildModelThrowing = (cause: Error) =>
  new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-model",
    doGenerate: async () => {
      throw cause;
    },
  });

describe("LlmJudge (unit)", () => {
  it("returns a parsed JudgeOutput when the model emits valid structured JSON", async () => {
    const model = buildModelReturning({
      completed: true,
      confidence: 0.84,
      reasoning: "Agent navigated to the EX90 configurator and submitted the order form.",
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const judge = yield* LlmJudge;
        return yield* judge.judge(judgeInput);
      }).pipe(Effect.provide(LlmJudge.layerFromModel(model))),
    );
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.confidence, 0.84);
    assert.include(result.reasoning.toLowerCase(), "agent");
  });

  it("includes the user goal + trajectory + final URL in the user prompt", async () => {
    const calls: string[] = [];
    const model = new MockLanguageModelV4({
      provider: "test-provider",
      modelId: "test-model",
      doGenerate: async (options: LanguageModelV4CallOptions) => {
        // Each prompt message has content parts; flatten to text.
        for (const message of options.prompt) {
          if (message.role === "user") {
            const parts: string[] = [];
            for (const part of message.content) {
              if (part.type === "text") parts.push(part.text);
            }
            calls.push(parts.join("\n"));
          }
        }
        return {
          ...dummyResponseBase,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ completed: false, confidence: 0.7, reasoning: "stopped" }),
            },
          ],
        };
      },
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const judge = yield* LlmJudge;
        return yield* judge.judge(judgeInput);
      }).pipe(Effect.provide(LlmJudge.layerFromModel(model))),
    );
    assert.isAbove(calls.length, 0);
    const combined = calls.join("\n");
    assert.include(combined, "<user_goal>");
    assert.include(combined, judgeInput.taskDescription);
    assert.include(combined, "<agent_trajectory>");
    assert.include(combined, "Key nodes reached");
    assert.include(combined, "<final_url>");
    assert.include(combined, judgeInput.finalUrl);
  });

  it("wraps model errors (rate limit, network, etc.) in a structured JudgeCallError", async () => {
    const model = buildModelThrowing(new Error("429 rate limit exceeded"));
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const judge = yield* LlmJudge;
        return yield* judge.judge(judgeInput);
      })
        .pipe(Effect.provide(LlmJudge.layerFromModel(model)))
        .pipe(Effect.flip),
    );
    assert.isTrue(exit instanceof JudgeCallError);
    assert.include(exit.message, "429 rate limit exceeded");
  });
});

describe("LlmJudge prompts (unit)", () => {
  it("system prompt teaches framework, not site-specific heuristics (overfitting guard)", () => {
    const prompt = buildJudgeSystemPrompt();
    assert.include(prompt, "impartial judge");
    assert.include(prompt, "expected end-state");
    assert.include(prompt, "Loading the landing page");
    // Sanity: no hardcoded site names, selectors, URLs, or tool names should
    // leak into the framework-level prompt. This is the same overfitting
    // guard plan.md calls for in the agent's system prompt.
    const forbidden = [
      "volvo",
      "github",
      "amazon",
      "bmw",
      "#nav",
      "[aria-label",
      ".menu",
      "http://",
      "https://",
    ];
    for (const phrase of forbidden) {
      assert.notInclude(prompt.toLowerCase(), phrase.toLowerCase());
    }
  });

  it("user prompt round-trips the input fields verbatim", () => {
    const prompt = buildJudgeUserPrompt(judgeInput);
    assert.include(prompt, judgeInput.taskDescription);
    assert.include(prompt, judgeInput.agentTrajectorySummary);
    assert.include(prompt, judgeInput.finalUrl);
  });

  it("exposes the Gemini 3 Flash preview tag as the default model id", () => {
    assert.strictEqual(JUDGE_DEFAULT_MODEL, "gemini-3-flash-preview");
  });
});

describe("judgeCompletion scorer", () => {
  it("maps completed=true to confidence score", async () => {
    const model = buildModelReturning({
      completed: true,
      confidence: 0.9,
      reasoning: "Completed all planned steps.",
    });
    const result = await Effect.runPromise(
      judgeCompletion(judgeInput).pipe(Effect.provide(LlmJudge.layerFromModel(model))),
    );
    assert.strictEqual(result.score, 0.9);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.confidence, 0.9);
  });

  it("maps completed=false to 1 - confidence (high-confidence failure = low score)", async () => {
    const model = buildModelReturning({
      completed: false,
      confidence: 0.95,
      reasoning: "Stopped after landing page; no navigation performed.",
    });
    const result = await Effect.runPromise(
      judgeCompletion(judgeInput).pipe(Effect.provide(LlmJudge.layerFromModel(model))),
    );
    assert.isAtMost(result.score, 0.05 + 1e-9);
    assert.strictEqual(result.completed, false);
  });

  it("uncertainty surfaces as a mid-range score", async () => {
    const model = buildModelReturning({
      completed: true,
      confidence: 0.5,
      reasoning: "Ambiguous.",
    });
    const result = await Effect.runPromise(
      judgeCompletion(judgeInput).pipe(Effect.provide(LlmJudge.layerFromModel(model))),
    );
    assert.strictEqual(result.score, 0.5);
  });
});
