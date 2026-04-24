import { assert, describe, it } from "vite-plus/test";
import { ConfigProvider, Effect, Layer } from "effect";
import { JudgeConfigError, LlmJudge } from "../src/scorers/llm-judge";

/**
 * JUDGE_ENABLED=false / empty-API-key handling.
 *
 * We inject an empty ConfigProvider so `Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY")`
 * surfaces a ConfigError at layer-build time (normal behavior when the env
 * var is unset). The eval entry catches this and marks the judge scorer
 * disabled; this test pins that behavior so a future regression that
 * "helpfully" defaults the API key to something (e.g. blank string) is
 * caught loudly.
 */
const emptyConfigProvider = ConfigProvider.fromUnknown({});
const emptyConfigProviderLayer = ConfigProvider.layerAdd(emptyConfigProvider, {
  asPrimary: true,
});

describe("LlmJudge disabled-path (no API key)", () => {
  it("LlmJudge.layer fails at build time when GOOGLE_GENERATIVE_AI_API_KEY is unset", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        yield* LlmJudge;
        return "should-not-reach";
      })
        .pipe(Effect.provide(LlmJudge.layer.pipe(Layer.provide(emptyConfigProviderLayer))))
        .pipe(Effect.exit),
    );
    assert.isFalse(exit._tag === "Success");
  });

  it("explicit JudgeConfigError surfaces a structured failure with remediation text", async () => {
    const error = new JudgeConfigError({ reason: "GOOGLE_GENERATIVE_AI_API_KEY is empty" });
    assert.include(error.message, "GOOGLE_GENERATIVE_AI_API_KEY");
    assert.include(error.message, ".env.local");
    assert.include(error.message, "EVAL_JUDGE_ENABLED=false");
  });
});
