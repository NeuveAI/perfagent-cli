import { Config, Effect, Option, Schema } from "effect";
import { evalite } from "evalite";
import { finalState } from "../src/scorers/final-state";
import { furthestKeyNode } from "../src/scorers/furthest-key-node";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import { makeGemmaRunner, type GemmaRunnerOptions } from "../src/runners/gemma";
import type { EvalRunner } from "../src/runners/types";
import { ExecutedTrace, EvalTask } from "../src/task";
import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90";
import { journey1CarConfiguratorBmw } from "../tasks/journey-1-car-configurator-bmw";

// Wave R3 ReAct replay validation. Per PRD §R3 DoD line 252:
// a multi-step car-configurator trajectory replayed through Gemma + the
// integrated R1+R2+R3 ReAct loop should produce ≥4 sub-goals via PLAN_UPDATE
// envelopes and not emit a premature RUN_COMPLETED. This eval narrows the
// scope to one task so the replay is observable per-turn.
//
// Originally targeted `hard-volvo-ex90-configurator` (PRD wording named Volvo
// directly). T5 run #2 confirmed volvocars.com returns "Access Denied" to
// headless Chromium across `/`, `/build/ex90`, and `/buy` — anti-bot wall
// blocked Gemma from making any progress, producing 0 PLAN_UPDATEs as a
// site-blocking artifact rather than a pipeline finding. The wire was
// verified operational (0 SDK validation errors after the extNotification
// switch) and the reducer pipeline ran correctly. See
// `docs/handover/react-migration/diary/r3-2026-04-25.md` §T5 run #2.
//
// Lead pivot: re-target the eval at `journey-1-car-configurator-bmw`. BMW
// already has a ready-made task definition with 6 KeyNodes and an
// anti-bot-tolerant homepage. Volvo is preserved in `SKIPPED_TASKS` for
// future flip-and-rerun once we have cookie-injection / authenticated-
// profile infra (per lead's brief). To run Volvo locally,
// move it from SKIPPED_TASKS into the main `tasks` array.
//   pnpm --filter @neuve/evals exec evalite run ./evals/wave-r3-react-replay.eval.ts
const tasks: ReadonlyArray<EvalTask> = [journey1CarConfiguratorBmw];

// Skipped: re-introduce when cookie-injection / authenticated-profile infra
// lands (R5+). See `docs/handover/react-migration/diary/r3-2026-04-25.md`
// §T5 Volvo run #2 for the Access-Denied trace details.
const SKIPPED_TASKS: ReadonlyArray<{ readonly task: EvalTask; readonly skipReason: string }> = [
  {
    task: hardVolvoEx90,
    skipReason: "volvocars.com returns Access Denied to headless Chromium",
  },
];
void SKIPPED_TASKS;

const stringWithSchemaDefault = <T, E>(
  envName: string,
  codec: Schema.Codec<T, E>,
  defaultRawValue: string,
): Config.Config<T> => {
  const decode = Schema.decodeUnknownEffect(codec);
  return Config.string(envName).pipe(
    Config.withDefault(defaultRawValue),
    Config.mapOrFail((raw) =>
      decode(raw).pipe(
        Effect.catchTag("SchemaError", (schemaError) =>
          Effect.fail(new Config.ConfigError(schemaError)),
        ),
      ),
    ),
  );
};

const TRACE_DIR_CONFIG = Config.string("EVAL_TRACE_DIR").pipe(Config.withDefault("evals/traces"));
const BASE_URL_CONFIG = Config.option(Config.string("EVAL_BASE_URL"));
const HEADED_CONFIG = stringWithSchemaDefault("EVAL_HEADED", Config.Boolean, "false");
const GEMMA_MODEL_CONFIG = Config.string("EVAL_GEMMA_MODEL").pipe(Config.withDefault("gemma4:e4b"));
const GEMMA_BASE_URL_CONFIG = Config.string("EVAL_OLLAMA_URL").pipe(
  Config.withDefault("http://localhost:11434/v1/"),
);
const GEMMA_PLANNER_CONFIG = stringWithSchemaDefault(
  "EVAL_GEMMA_PLANNER",
  Schema.Literals(["oracle-plan", "template", "none"] as const),
  "template",
);

const resolveEvalConfig = Effect.gen(function* () {
  const traceDir = yield* TRACE_DIR_CONFIG;
  const baseUrlOption = yield* BASE_URL_CONFIG;
  const headed = yield* HEADED_CONFIG;
  const gemmaModel = yield* GEMMA_MODEL_CONFIG;
  const gemmaBaseUrl = yield* GEMMA_BASE_URL_CONFIG;
  const gemmaPlanner = yield* GEMMA_PLANNER_CONFIG;
  return {
    gemmaOptions: {
      model: gemmaModel,
      baseUrl: gemmaBaseUrl,
      plannerMode: gemmaPlanner,
      traceDir,
      evalBaseUrl: Option.getOrUndefined(baseUrlOption),
      isHeadless: !headed,
    } satisfies GemmaRunnerOptions,
  } as const;
}).pipe(Effect.withSpan("resolveEvalConfig"));

const evalConfig = Effect.runSync(resolveEvalConfig);

interface RealCaseInput {
  readonly task: EvalTask;
}

const buildRealCases = (): Array<{ input: RealCaseInput; expected: EvalTask }> =>
  tasks.map((task) => ({ input: { task }, expected: task }));

const scorers = [
  {
    name: "step-coverage",
    description: "Fraction of expected KeyNodes reached",
    scorer: ({ output, expected }: { output: ExecutedTrace; expected: EvalTask | undefined }) => {
      if (!expected) return 0;
      return stepCoverage(output.reachedKeyNodes, expected.keyNodes);
    },
  },
  {
    name: "final-state",
    description: "Final URL+DOM matches expected final state",
    scorer: ({ output, expected }: { output: ExecutedTrace; expected: EvalTask | undefined }) => {
      if (!expected) return 0;
      return finalState(output.finalUrl, output.finalDom, expected.expectedFinalState) ? 1 : 0;
    },
  },
  {
    name: "tool-call-validity",
    description: "Ratio of well-formed tool calls",
    scorer: ({ output }: { output: ExecutedTrace }) => toolCallValidity(output.toolCalls),
  },
  {
    name: "furthest-key-node",
    description: "Deepest expected KeyNode reached, normalized to [0,1]",
    scorer: ({ output, expected }: { output: ExecutedTrace; expected: EvalTask | undefined }) => {
      if (!expected || expected.keyNodes.length === 0) return 0;
      const furthest = furthestKeyNode(output.reachedKeyNodes, expected.keyNodes);
      if (furthest < 0) return 0;
      return (furthest + 1) / expected.keyNodes.length;
    },
  },
];

const registerRunnerSuite = (runner: EvalRunner, suiteLabel: string): void => {
  evalite<RealCaseInput, ExecutedTrace, EvalTask>(`${suiteLabel} (${runner.name})`, {
    data: () => buildRealCases(),
    task: async (input) => Effect.runPromise(runner.run(input.task)),
    scorers,
    columns: ({ input, output }) => {
      const tokenomics = output.tokenomics;
      return [
        { label: "task", value: input.task.id },
        { label: "reached", value: String(output.reachedKeyNodes.length) },
        { label: "tools", value: String(output.toolCalls.length) },
        { label: "final", value: output.finalUrl.length > 0 ? "ok" : "-" },
        { label: "total_tokens", value: String(tokenomics.totalTokens) },
        { label: "peak_prompt", value: String(tokenomics.peakPromptTokens) },
      ];
    },
  });
};

const runner: EvalRunner = makeGemmaRunner(evalConfig.gemmaOptions);
registerRunnerSuite(runner, "wave-r3 react replay");
