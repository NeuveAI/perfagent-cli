import { Config, Effect, Layer, Redacted, Schema, ServiceMap } from "effect";
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

export class JudgeConfigError extends Schema.ErrorClass<JudgeConfigError>("JudgeConfigError")({
  _tag: Schema.tag("JudgeConfigError"),
  reason: Schema.String,
}) {
  message = `LLM judge is not configured: ${this.reason}. Set GOOGLE_GENERATIVE_AI_API_KEY in the evals package's .env.local, or set EVAL_JUDGE_ENABLED=false to skip judging.`;
}

export class JudgeCallError extends Schema.ErrorClass<JudgeCallError>("JudgeCallError")({
  _tag: Schema.tag("JudgeCallError"),
  cause: Schema.String,
}) {
  message = `LLM judge call failed: ${this.cause}`;
}

export const JUDGE_DEFAULT_MODEL = "gemini-3-flash-preview";
export const JUDGE_DEFAULT_TEMPERATURE = 0.1;

const JudgeOutputSchema = z.object({
  completed: z
    .boolean()
    .describe("True iff the agent reached the user's stated end-state, false otherwise."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Judge confidence in the completion verdict, on a [0, 1] scale."),
  reasoning: z
    .string()
    .describe(
      "One- or two-sentence explanation of the verdict, citing concrete trajectory evidence.",
    ),
});

export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export interface JudgeInput {
  readonly taskDescription: string;
  readonly finalUrl: string;
  readonly agentTrajectorySummary: string;
  readonly screenshotDataUrl?: string;
}

/**
 * buildJudgePrompt — WebJudge-style framing (Liu et al., Online-Mind2Web 2504.01382
 * §4.2 "LLM-as-Judge"). The judge reasons about completion from the user goal
 * + the agent's observable trajectory — no site-specific checklists baked in.
 * Keep this prompt generic: the moment we hardcode "if volvo.com then …" we
 * are overfitting the eval harness to the same bias we are trying to catch
 * in the agent.
 */
export const buildJudgeSystemPrompt = (): string =>
  [
    "You are an impartial judge grading autonomous web agents on task completion.",
    "",
    "You will receive:",
    "- The user's goal (a single English task description).",
    "- A terse trajectory of the agent's actions (step markers + tool calls + final status).",
    "- The final URL the agent landed on.",
    "",
    "Your job: decide whether the agent actually completed the user's goal.",
    "",
    "Rules:",
    "- A task is complete iff the agent reached the expected end-state described by the user. Loading the landing page of the target site is NOT completion for a multi-step task.",
    "- If the user's goal implies N distinct navigational or form-submission steps, the agent must have executed all N. A truncated trajectory that stops after step 1 is NOT complete, even if step 1 succeeded.",
    "- Ignore minor deviations in path or phrasing. Focus on whether the end-state was reached.",
    "- If the trajectory is ambiguous, lean toward 'not complete' and express low confidence rather than guessing.",
    "- Reason from the trajectory evidence alone. Do not assume knowledge of the site beyond what the trajectory reveals.",
    "",
    "Return a structured verdict: completed (boolean), confidence ([0, 1]), reasoning (one or two sentences citing trajectory evidence).",
  ].join("\n");

export const buildJudgeUserPrompt = (input: JudgeInput): string =>
  [
    "<user_goal>",
    input.taskDescription,
    "</user_goal>",
    "",
    "<agent_trajectory>",
    input.agentTrajectorySummary,
    "</agent_trajectory>",
    "",
    "<final_url>",
    input.finalUrl.length > 0 ? input.finalUrl : "<no url recorded>",
    "</final_url>",
  ].join("\n");

export interface LlmJudgeOptions {
  readonly model?: string;
  readonly temperature?: number;
}

/**
 * LlmJudge — Gemini-3-Flash-preview-backed judge for task-completion scoring
 * on the Online-Mind2Web subset. Wraps `generateObject` from the AI SDK with
 * a fixed Zod schema (`completed`, `confidence`, `reasoning`) and a
 * WebJudge-style system prompt.
 *
 * Wiring:
 *   - Production `static layer` builds the `@ai-sdk/google` provider from a
 *     `Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY")` read. Missing key →
 *     `JudgeConfigError` at layer build time; callers can catch + treat as
 *     "judge disabled".
 *   - `static layerFromModel(model, options)` bypasses the provider
 *     construction entirely and takes a pre-built `LanguageModel`. Tests pass
 *     `MockLanguageModelV4` from `ai/test`. Production code never uses this.
 *
 * This split keeps the production code path and test code path identical
 * past the model boundary (both go through `generateObject`), so we are not
 * testing a different `judge()` implementation than ships.
 */
export class LlmJudge extends ServiceMap.Service<LlmJudge>()("@evals/LlmJudge", {
  make: Effect.gen(function* () {
    const apiKeyRedacted = yield* Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY");
    const modelIdOption = yield* Config.option(Config.string("EVAL_JUDGE_MODEL"));
    const modelId = modelIdOption._tag === "Some" ? modelIdOption.value : JUDGE_DEFAULT_MODEL;
    const apiKey = Redacted.value(apiKeyRedacted);
    if (apiKey.length === 0) {
      return yield* new JudgeConfigError({ reason: "GOOGLE_GENERATIVE_AI_API_KEY is empty" });
    }
    const provider = createGoogleGenerativeAI({ apiKey });
    const model = provider(modelId) satisfies LanguageModel;
    yield* Effect.logInfo("LlmJudge ready", { modelId });
    return makeJudgeService(model, JUDGE_DEFAULT_TEMPERATURE);
  }),
}) {
  static layer = Layer.effect(this)(this.make);

  /**
   * layerFromModel — test-oriented layer that takes a pre-constructed
   * LanguageModel. Production never calls this; it exists to let tests
   * substitute `MockLanguageModelV4` without re-implementing the service's
   * judge() method. The same `makeJudgeService` runs in both paths so test
   * coverage reflects production behavior.
   */
  static layerFromModel = (model: LanguageModel, options: LlmJudgeOptions = {}) =>
    Layer.succeed(this, makeJudgeService(model, options.temperature ?? JUDGE_DEFAULT_TEMPERATURE));
}

const makeJudgeService = (model: LanguageModel, temperature: number) => {
  const judge = Effect.fn("LlmJudge.judge")(function* (input: JudgeInput) {
    yield* Effect.annotateCurrentSpan({
      finalUrlLength: input.finalUrl.length,
      trajectoryChars: input.agentTrajectorySummary.length,
    });
    const result = yield* Effect.tryPromise({
      try: () =>
        generateObject({
          model,
          schema: JudgeOutputSchema,
          schemaName: "WebAgentCompletionVerdict",
          schemaDescription: "A structured task-completion verdict for an autonomous web agent",
          temperature,
          system: buildJudgeSystemPrompt(),
          prompt: buildJudgeUserPrompt(input),
        }),
      catch: (cause) =>
        new JudgeCallError({
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    return result.object satisfies JudgeOutput;
  });
  return { judge } as const;
};
