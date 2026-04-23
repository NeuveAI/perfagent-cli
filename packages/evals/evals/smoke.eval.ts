import { Config, Effect, Option, Schema } from "effect";
import { evalite } from "evalite";
import { finalState } from "../src/scorers/final-state";
import { furthestKeyNode } from "../src/scorers/furthest-key-node";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import { MockScenario, runMock } from "../src/runners/mock";
import { makeRealRunner, type RealRunnerOptions } from "../src/runners/real";
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

const RUNNER_CONFIG = Config.schema(Schema.Literals(["mock", "real"] as const), "EVAL_RUNNER").pipe(
  Config.withDefault("mock" as const),
);

const BACKEND_CONFIG = Config.schema(
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
  "EVAL_BACKEND",
).pipe(Config.withDefault("claude" as const));

const PLANNER_CONFIG = Config.schema(
  Schema.Literals(["frontier", "template", "none"] as const),
  "EVAL_PLANNER",
).pipe(Config.withDefault("frontier" as const));

const TRACE_DIR_CONFIG = Config.string("EVAL_TRACE_DIR").pipe(Config.withDefault("evals/traces"));

const BASE_URL_CONFIG = Config.option(Config.string("EVAL_BASE_URL"));

const HEADED_CONFIG = Config.boolean("EVAL_HEADED").pipe(Config.withDefault(false));

const resolveEvalConfig = Effect.gen(function* () {
  const runner = yield* RUNNER_CONFIG;
  const backend = yield* BACKEND_CONFIG;
  const planner = yield* PLANNER_CONFIG;
  const traceDir = yield* TRACE_DIR_CONFIG;
  const baseUrlOption = yield* BASE_URL_CONFIG;
  const headed = yield* HEADED_CONFIG;
  return {
    runner,
    realOptions: {
      agentBackend: backend,
      plannerMode: planner,
      traceDir,
      baseUrl: Option.getOrUndefined(baseUrlOption),
      isHeadless: !headed,
    } satisfies RealRunnerOptions,
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

if (evalConfig.runner === "real") {
  const runner: EvalRunner = makeRealRunner("real", evalConfig.realOptions);

  evalite<RealCaseInput, ExecutedTrace, EvalTask>(`real-runner smoke (${runner.name})`, {
    data: () => buildRealCases(),
    task: async (input) => Effect.runPromise(runner.run(input.task)),
    scorers,
    columns: ({ input, output }) => [
      { label: "task", value: input.task.id },
      { label: "reached", value: String(output.reachedKeyNodes.length) },
      { label: "tools", value: String(output.toolCalls.length) },
      { label: "final", value: output.finalUrl.length > 0 ? "ok" : "-" },
    ],
  });
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
