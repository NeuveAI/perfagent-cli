import * as path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Config, Effect, Option, Schema } from "effect";
import { evalite } from "evalite";
import { finalState } from "../src/scorers/final-state";
import { furthestKeyNode } from "../src/scorers/furthest-key-node";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import {
  makeGemmaRunner,
  GEMMA_REACT_RUNNER_NAME,
  type GemmaRunnerOptions,
} from "../src/runners/gemma";
import {
  makeGemmaOraclePlanRunner,
  GEMMA_ORACLE_PLAN_RUNNER_NAME,
} from "../src/runners/gemma-oracle-plan";
import { makeGeminiRunner } from "../src/runners/gemini";
import { GEMINI_REACT_RUNNER_NAME } from "../src/runners/gemini-react-constants";
import type { EvalRunner } from "../src/runners/types";
import { ExecutedTrace, EvalTask } from "../src/task";
import { calibration1SingleNavPythonDocs } from "../tasks/calibration-1-single-nav-python-docs";
import { calibration2SingleNavNews } from "../tasks/calibration-2-single-nav-news";
import { calibration3TwoStepDocs } from "../tasks/calibration-3-two-step-docs";
import { calibration4TwoStepEcom } from "../tasks/calibration-4-two-step-ecom";
import { calibration5ThreeStepSearch } from "../tasks/calibration-5-three-step-search";
import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90";
import { journey1CarConfiguratorBmw } from "../tasks/journey-1-car-configurator-bmw";
import { journey2EcomCheckout } from "../tasks/journey-2-ecom-checkout";
import { journey3FlightSearch } from "../tasks/journey-3-flight-search";
import { journey4AccountSignup } from "../tasks/journey-4-account-signup";
import { journey5InsuranceQuote } from "../tasks/journey-5-insurance-quote";
import { journey6MediaStreaming } from "../tasks/journey-6-media-streaming";
import { journey7DashboardFilter } from "../tasks/journey-7-dashboard-filter";
import { journey8HelpCenter } from "../tasks/journey-8-help-center";
import { journey9FormWizard } from "../tasks/journey-9-form-wizard";
import { journey10MarketplaceFilter } from "../tasks/journey-10-marketplace-filter";
import { moderate1 } from "../tasks/moderate-1";
import { moderate2 } from "../tasks/moderate-2";
import { trivial1 } from "../tasks/trivial-1";
import { trivial2 } from "../tasks/trivial-2";

// Load `.env.local` *before* reading any Config. dotenv writes to process.env
// only — Effect's ConfigProvider.fromEnv picks values up from there on its
// first read. Mirrors `online-mind2web.eval.ts` so the gemini-react and
// gemma-oracle-plan suites can resolve `GOOGLE_GENERATIVE_AI_API_KEY` from
// the gitignored env file documented in the prerequisites comment below.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(moduleDir, "..", ".env.local"), quiet: true });

// Wave R5 final A:B regression sweep — the headline deliverable per
// `docs/research/gemma-react-browsing/architecture-prd.md` §R5 line 279
// and §6.3 (Phase R5 exit: full 20-task run for all three runners).
//
// Suites:
//   - `gemma-react`        — production runtime (Gemma owns plan + execute).
//   - `gemini-react`       — frontier baseline (Gemini Flash 3 ReAct).
//   - `gemma-oracle-plan`  — ablation (Gemini decomposes upfront, Gemma
//                             executes via ReAct).
//
// Trace files land in `evals/traces/wave-r5-ab/` and are post-processed by
// `pnpm wave-r5-ab:aggregate` into a comparison table at
// `docs/handover/harness-evals/baselines/wave-r5-ab.md`.
//
// Per `project_baseline_eval_strategy.md`, evals are directional — manual
// runs override eval numbers when they disagree. The 20-task sweep
// surfaces broad regression signals; per-task investigation lives in the
// trace ndjson + supervisor logs.
//
// Live execution requires:
//   - Ollama running with `gemma4:e4b` loaded (`ollama pull gemma4:e4b`)
//   - GOOGLE_GENERATIVE_AI_API_KEY in `packages/evals/.env.local`
//   - apps/cli/dist/browser-mcp.js built (`pnpm --filter perf-agent-cli build`)
//
// Concurrency is implicitly 1 per `project_baseline_eval_strategy.md` —
// browser-mcp tools serialize at the chrome-devtools-mcp level, so running
// runners in parallel would contend for the headless Chromium instance.

const TWENTY_TASKS: ReadonlyArray<EvalTask> = [
  calibration1SingleNavPythonDocs,
  calibration2SingleNavNews,
  calibration3TwoStepDocs,
  calibration4TwoStepEcom,
  calibration5ThreeStepSearch,
  hardVolvoEx90,
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
  moderate1,
  moderate2,
  trivial1,
  trivial2,
];

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

const TRACE_DIR_CONFIG = Config.string("EVAL_TRACE_DIR").pipe(
  Config.withDefault("evals/traces/wave-r5-ab"),
);
const BASE_URL_CONFIG = Config.option(Config.string("EVAL_BASE_URL"));
const HEADED_CONFIG = stringWithSchemaDefault("EVAL_HEADED", Config.Boolean, "false");
const GEMMA_MODEL_CONFIG = Config.string("EVAL_GEMMA_MODEL").pipe(
  Config.withDefault("gemma4:e4b"),
);
const GEMMA_BASE_URL_CONFIG = Config.string("EVAL_OLLAMA_URL").pipe(
  Config.withDefault("http://localhost:11434/v1/"),
);
// Skip filters: comma-separated runner names ("gemma-react,gemini-react").
// Useful for partial reruns when a single runner crashes mid-sweep — the
// surviving traces stay on disk, so re-running ONLY the broken runner
// avoids re-paying API and wall-clock for the others. Default empty
// (run all three).
const SKIP_RUNNERS_CONFIG = Config.string("EVAL_R5_SKIP_RUNNERS").pipe(
  Config.withDefault(""),
);

const resolveEvalConfig = Effect.gen(function* () {
  const traceDir = yield* TRACE_DIR_CONFIG;
  const baseUrlOption = yield* BASE_URL_CONFIG;
  const headed = yield* HEADED_CONFIG;
  const gemmaModel = yield* GEMMA_MODEL_CONFIG;
  const gemmaBaseUrl = yield* GEMMA_BASE_URL_CONFIG;
  const skipRunnersRaw = yield* SKIP_RUNNERS_CONFIG;
  const skipRunners = new Set(
    skipRunnersRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  const evalBaseUrl = Option.getOrUndefined(baseUrlOption);
  const isHeadless = !headed;
  const baseGemmaOptions: GemmaRunnerOptions = {
    model: gemmaModel,
    baseUrl: gemmaBaseUrl,
    traceDir,
    evalBaseUrl,
    isHeadless,
  };
  return { baseGemmaOptions, traceDir, evalBaseUrl, isHeadless, skipRunners } as const;
}).pipe(Effect.withSpan("resolveWaveR5AbConfig"));

const evalConfig = Effect.runSync(resolveEvalConfig);

interface SweepCaseInput {
  readonly task: EvalTask;
}

const buildCases = (): Array<{ readonly input: SweepCaseInput; readonly expected: EvalTask }> =>
  TWENTY_TASKS.map((task) => ({ input: { task }, expected: task }));

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

const registerSuite = (runner: EvalRunner, suiteLabel: string): void => {
  if (evalConfig.skipRunners.has(runner.name)) {
    return;
  }
  evalite<SweepCaseInput, ExecutedTrace, EvalTask>(`${suiteLabel} (${runner.name})`, {
    data: () => buildCases(),
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

// Three suites — order is alphabetical by runner.name so the evalite
// scoreboard groups the production runner first, then the frontier
// baseline, then the ablation. The aggregator script doesn't care about
// suite order; trace filenames carry the runner name.
const gemmaReactRunner: EvalRunner = makeGemmaRunner({
  ...evalConfig.baseGemmaOptions,
  plannerMode: "gemma-react",
  runnerName: GEMMA_REACT_RUNNER_NAME,
});
registerSuite(gemmaReactRunner, "wave-r5 a:b sweep");

const geminiReactRunner: EvalRunner = makeGeminiRunner({
  traceDir: evalConfig.baseGemmaOptions.traceDir,
  evalBaseUrl: evalConfig.evalBaseUrl,
  isHeadless: evalConfig.isHeadless,
  plannerMode: "gemma-react",
  runnerName: GEMINI_REACT_RUNNER_NAME,
});
registerSuite(geminiReactRunner, "wave-r5 a:b sweep");

const gemmaOraclePlanRunner: EvalRunner = makeGemmaOraclePlanRunner({
  ...evalConfig.baseGemmaOptions,
});
// gemma-oracle-plan locks runnerName internally, so the constant here is
// for the registry skip-filter only.
void GEMMA_ORACLE_PLAN_RUNNER_NAME;
registerSuite(gemmaOraclePlanRunner, "wave-r5 a:b sweep");
