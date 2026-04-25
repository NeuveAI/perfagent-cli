import { Config, Effect, Option, Schema } from "effect";
import { evalite } from "evalite";
import { finalState } from "../src/scorers/final-state";
import { furthestKeyNode } from "../src/scorers/furthest-key-node";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import { MockScenario, runMock } from "../src/runners/mock";
import { makeRealRunner, type RealRunnerOptions } from "../src/runners/real";
import { makeGemmaRunner, type GemmaRunnerOptions } from "../src/runners/gemma";
import { makeDualRunner } from "../src/runners/dual";
import type { EvalRunner } from "../src/runners/types";
import { ExecutedTrace, EvalTask } from "../src/task";
import { calibration1SingleNavPythonDocs } from "../tasks/calibration-1-single-nav-python-docs";
import { calibration2SingleNavNews } from "../tasks/calibration-2-single-nav-news";
import { calibration3TwoStepDocs } from "../tasks/calibration-3-two-step-docs";
import { calibration4TwoStepEcom } from "../tasks/calibration-4-two-step-ecom";
import { calibration5ThreeStepSearch } from "../tasks/calibration-5-three-step-search";
import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90";
import { journey1CarConfiguratorBmw } from "../tasks/journey-1-car-configurator-bmw";
import { journey10MarketplaceFilter } from "../tasks/journey-10-marketplace-filter";
import { journey2EcomCheckout } from "../tasks/journey-2-ecom-checkout";
import { journey3FlightSearch } from "../tasks/journey-3-flight-search";
import { journey4AccountSignup } from "../tasks/journey-4-account-signup";
import { journey5InsuranceQuote } from "../tasks/journey-5-insurance-quote";
import { journey6MediaStreaming } from "../tasks/journey-6-media-streaming";
import { journey7DashboardFilter } from "../tasks/journey-7-dashboard-filter";
import { journey8HelpCenter } from "../tasks/journey-8-help-center";
import { journey9FormWizard } from "../tasks/journey-9-form-wizard";
import { moderate1 } from "../tasks/moderate-1";
import { moderate2 } from "../tasks/moderate-2";
import { trivial1 } from "../tasks/trivial-1";
import { trivial2 } from "../tasks/trivial-2";

const tasks: ReadonlyArray<EvalTask> = [
  trivial1,
  trivial2,
  moderate1,
  moderate2,
  hardVolvoEx90,
  calibration1SingleNavPythonDocs,
  calibration2SingleNavNews,
  calibration3TwoStepDocs,
  calibration4TwoStepEcom,
  calibration5ThreeStepSearch,
  journey1CarConfiguratorBmw,
  journey2EcomCheckout,
  journey3FlightSearch,
  journey4AccountSignup,
  journey5InsuranceQuote,
  journey6MediaStreaming,
  journey7DashboardFilter,
  journey8HelpCenter,
  journey9FormWizard,
  journey10MarketplaceFilter,
];

// HACK: Config.withDefault on a schema-validated Config silently catches
// schema-validation failures (it classifies the OneOf/AnyOf tree as
// "missing data" and substitutes the default). We layer validation on top of
// Config.string — whose only failure mode is MissingKey, the legitimate
// default-on-absent trigger — and apply the schema decoder in `mapOrFail`
// so validation errors surface as a ConfigError instead of being swallowed.
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

const RUNNER_CONFIG = stringWithSchemaDefault(
  "EVAL_RUNNER",
  Schema.Literals(["mock", "real", "gemma", "dual"] as const),
  "mock",
);

const BACKEND_CONFIG = stringWithSchemaDefault(
  "EVAL_BACKEND",
  Schema.Literals([
    "claude",
    "codex",
    "copilot",
    "gemini",
    "cursor",
    "opencode",
    "droid",
    "pi",
    "local",
  ] as const),
  "claude",
);

const PLANNER_CONFIG = stringWithSchemaDefault(
  "EVAL_PLANNER",
  Schema.Literals(["oracle-plan", "template", "none", "gemma-react"] as const),
  "oracle-plan",
);

const TRACE_DIR_CONFIG = Config.string("EVAL_TRACE_DIR").pipe(Config.withDefault("evals/traces"));

const BASE_URL_CONFIG = Config.option(Config.string("EVAL_BASE_URL"));

// EVAL_HEADED routes through the string+schema pattern too so "notabool"
// surfaces a ConfigError rather than silently falling back to false.
const HEADED_CONFIG = stringWithSchemaDefault("EVAL_HEADED", Config.Boolean, "false");

const GEMMA_MODEL_CONFIG = Config.string("EVAL_GEMMA_MODEL").pipe(Config.withDefault("gemma4:e4b"));

const GEMMA_BASE_URL_CONFIG = Config.string("EVAL_OLLAMA_URL").pipe(
  Config.withDefault("http://localhost:11434/v1/"),
);

const GEMMA_PLANNER_CONFIG = stringWithSchemaDefault(
  "EVAL_GEMMA_PLANNER",
  Schema.Literals(["oracle-plan", "template", "none", "gemma-react"] as const),
  "template",
);

const resolveEvalConfig = Effect.gen(function* () {
  const runner = yield* RUNNER_CONFIG;
  const backend = yield* BACKEND_CONFIG;
  const planner = yield* PLANNER_CONFIG;
  const traceDir = yield* TRACE_DIR_CONFIG;
  const baseUrlOption = yield* BASE_URL_CONFIG;
  const headed = yield* HEADED_CONFIG;
  const gemmaModel = yield* GEMMA_MODEL_CONFIG;
  const gemmaBaseUrl = yield* GEMMA_BASE_URL_CONFIG;
  const gemmaPlanner = yield* GEMMA_PLANNER_CONFIG;
  return {
    runner,
    realOptions: {
      agentBackend: backend,
      plannerMode: planner,
      traceDir,
      baseUrl: Option.getOrUndefined(baseUrlOption),
      isHeadless: !headed,
    } satisfies RealRunnerOptions,
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

interface MockCaseInput {
  readonly task: EvalTask;
  readonly scenario: (typeof MockScenario)[number];
}

interface RealCaseInput {
  readonly task: EvalTask;
}

const buildMockCases = (): Array<{ input: MockCaseInput; expected: EvalTask }> =>
  tasks.flatMap((task) =>
    MockScenario.map((scenario) => ({
      input: { task, scenario },
      expected: task,
    })),
  );

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

if (evalConfig.runner === "real") {
  const runner: EvalRunner = makeRealRunner("real", evalConfig.realOptions);
  registerRunnerSuite(runner, "real-runner smoke");
} else if (evalConfig.runner === "gemma") {
  const runner: EvalRunner = makeGemmaRunner(evalConfig.gemmaOptions);
  registerRunnerSuite(runner, "gemma-runner smoke");
} else if (evalConfig.runner === "dual") {
  const primary: EvalRunner = makeRealRunner("real", evalConfig.realOptions);
  const secondary: EvalRunner = makeGemmaRunner(evalConfig.gemmaOptions);
  const dual = makeDualRunner(primary, secondary);
  registerRunnerSuite(dual.primary, `dual-runner smoke [primary ${dual.name}]`);
  registerRunnerSuite(dual.secondary, `dual-runner smoke [secondary ${dual.name}]`);
} else {
  evalite<MockCaseInput, ExecutedTrace, EvalTask>("mock-runner smoke", {
    data: () => buildMockCases(),
    task: async (input) => runMock(input.task, input.scenario),
    scorers,
    columns: ({ input, output }) => [
      { label: "task", value: input.task.id },
      { label: "scenario", value: input.scenario },
      { label: "reached", value: String(output.reachedKeyNodes.length) },
      { label: "tools", value: String(output.toolCalls.length) },
    ],
  });
}
