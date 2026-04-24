import * as path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Config, ConfigProvider, Effect, Exit, Option, Schema } from "effect";
import { evalite } from "evalite";
import { OnlineMind2WebLoader } from "../src/adapters/online-mind2web-loader";
import { finalState } from "../src/scorers/final-state";
import { furthestKeyNode } from "../src/scorers/furthest-key-node";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import { judgeCompletion } from "../src/scorers/llm-judge-completion";
import { JudgeConfigError, LlmJudge, type JudgeInput } from "../src/scorers/llm-judge";
import { summarizeTrajectory } from "../src/runners/trajectory-summary";
import { runMock } from "../src/runners/mock";
import { makeRealRunner, type RealRunnerOptions } from "../src/runners/real";
import { makeGemmaRunner, type GemmaRunnerOptions } from "../src/runners/gemma";
import { makeDualRunner } from "../src/runners/dual";
import type { EvalRunner } from "../src/runners/types";
import { ExecutedTrace, EvalTask } from "../src/task";

// Load `.env.local` *before* reading any Config. dotenv writes to process.env
// only — Effect's ConfigProvider.fromEnv picks values up from there on its
// first read. This file is gitignored; see `.env.example` for the shape.
// Path is relative to this module so `pnpm --filter @neuve/evals eval:mind2web`
// picks up the package-local env regardless of the CLI's cwd.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(moduleDir, "..", ".env.local"), quiet: true });

// HACK: Config.withDefault swallows schema-validation errors for OneOf/AnyOf
// trees (see smoke.eval.ts for full explanation). We re-use the same pattern
// here rather than duplicating it — keeping the helper in sync if smoke.eval
// evolves is the team-lead's call.
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
  Schema.Literals(["frontier", "template", "none"] as const),
  "frontier",
);

const TRACE_DIR_CONFIG = Config.string("EVAL_TRACE_DIR").pipe(Config.withDefault("evals/traces"));
const BASE_URL_CONFIG = Config.option(Config.string("EVAL_BASE_URL"));
const HEADED_CONFIG = stringWithSchemaDefault("EVAL_HEADED", Config.Boolean, "false");

const GEMMA_MODEL_CONFIG = Config.string("EVAL_GEMMA_MODEL").pipe(Config.withDefault("gemma4:e4b"));
const GEMMA_BASE_URL_CONFIG = Config.string("EVAL_OLLAMA_URL").pipe(
  Config.withDefault("http://localhost:11434/v1/"),
);
const GEMMA_PLANNER_CONFIG = stringWithSchemaDefault(
  "EVAL_GEMMA_PLANNER",
  Schema.Literals(["frontier", "template", "none"] as const),
  "template",
);

const nonNegativeIntFromString = (
  envName: string,
  defaultRawValue: string,
): Config.Config<number> =>
  Config.string(envName)
    .pipe(Config.withDefault(defaultRawValue))
    .pipe(
      Config.mapOrFail((raw) => {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== raw.trim()) {
          return Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `${envName}: expected non-negative integer, got "${raw}"`,
              }),
            ),
          );
        }
        return Effect.succeed(parsed);
      }),
    );

const positiveIntFromString = (envName: string, defaultRawValue: string): Config.Config<number> =>
  Config.string(envName)
    .pipe(Config.withDefault(defaultRawValue))
    .pipe(
      Config.mapOrFail((raw) => {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
          return Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `${envName}: expected positive integer, got "${raw}"`,
              }),
            ),
          );
        }
        return Effect.succeed(parsed);
      }),
    );

const MIND2WEB_MAX_NODES_CONFIG = positiveIntFromString("EVAL_MIND2WEB_MAX_NODES", "5");
// `EVAL_MIND2WEB_LIMIT=0` is a supported value — it skips the suite cleanly
// with a warning, useful for CI smoke-checks that want to verify the module
// loads + config validates without paying the wall-clock for a run.
const MIND2WEB_LIMIT_CONFIG = nonNegativeIntFromString("EVAL_MIND2WEB_LIMIT", "30");

const MIND2WEB_DATA_DIR_CONFIG = Config.string("EVAL_MIND2WEB_DATA_DIR").pipe(
  Config.withDefault("packages/evals/data/online-mind2web"),
);
const MIND2WEB_REFRESH_CONFIG = stringWithSchemaDefault(
  "EVAL_MIND2WEB_REFRESH",
  Config.Boolean,
  "false",
);

const JUDGE_ENABLED_CONFIG = stringWithSchemaDefault("EVAL_JUDGE_ENABLED", Config.Boolean, "true");

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
  const maxKeyNodes = yield* MIND2WEB_MAX_NODES_CONFIG;
  const limit = yield* MIND2WEB_LIMIT_CONFIG;
  const dataDir = yield* MIND2WEB_DATA_DIR_CONFIG;
  const refresh = yield* MIND2WEB_REFRESH_CONFIG;
  const judgeEnabled = yield* JUDGE_ENABLED_CONFIG;
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
    mind2web: {
      maxKeyNodes,
      // limit===0 is carried through to loadSubset as a natural "take 0"
      // slice-count. The suite-registration site below short-circuits the
      // actual evalite registration with a clear log message; the loader
      // still runs so the cache + manifest stay up to date.
      limit,
      dataDir,
      refresh,
    },
    judgeEnabled,
  } as const;
}).pipe(Effect.withSpan("resolveOnlineMind2WebConfig"));

const evalConfig = Effect.runSync(resolveEvalConfig);

// `EVAL_MIND2WEB_LIMIT=0` short-circuits the dataset load entirely — there's
// no point downloading 300 tasks only to slice them to []. The suite
// registration below emits a clear skip warning, and the module load stays
// fast (no HF roundtrip) for CI smoke-checks that just want to verify
// config validation.
const tasks: ReadonlyArray<EvalTask> =
  evalConfig.mind2web.limit === 0
    ? []
    : await (async () => {
        const loadSubsetEffect = Effect.gen(function* () {
          const loader = yield* OnlineMind2WebLoader;
          return yield* loader.loadSubset(evalConfig.mind2web);
        }).pipe(Effect.provide(OnlineMind2WebLoader.layer));
        // Top-level await resolves the dataset before any evalite suite
        // registers. If the cache is empty AND the HuggingFace download
        // fails (gated dataset, no HUGGINGFACE_TOKEN, or network down), the
        // failure surfaces here with the Mind2WebDownloadError's remediation
        // message — evalite prints it and exits non-zero.
        const subset = await Effect.runPromise(loadSubsetEffect);
        return subset.tasks;
      })();

// Judge probe: try to build the LlmJudge layer once. If the API key is
// absent (JudgeConfigError) OR the operator set EVAL_JUDGE_ENABLED=false,
// every judge-backed scorer returns a NaN-filtered 0 with a clear log line.
// All other errors propagate — a misconfigured judge is a setup problem,
// not a per-task failure.
const judgeLayer = evalConfig.judgeEnabled ? LlmJudge.layer : undefined;
const judgeProbe = judgeLayer
  ? await Effect.runPromise(
      Effect.gen(function* () {
        yield* LlmJudge;
        return true;
      }).pipe(Effect.provide(judgeLayer), Effect.exit),
    )
  : Exit.fail(new JudgeConfigError({ reason: "EVAL_JUDGE_ENABLED=false" }));

const judgeAvailable = Exit.isSuccess(judgeProbe);
if (!judgeAvailable) {
  const reason = Exit.isFailure(judgeProbe) ? String(judgeProbe.cause) : "unknown";
  console.warn(
    `[online-mind2web.eval] LLM-as-judge scorer disabled: ${reason}. Set GOOGLE_GENERATIVE_AI_API_KEY in packages/evals/.env.local (and EVAL_JUDGE_ENABLED=true) to enable it.`,
  );
}

// Cache the judge layer when it's usable. When undefined, the judge scorer
// short-circuits to 0 without calling into Effect — no placeholder layer to
// smuggle past the type system, no hidden "noop judge" branch in scope.
const activeJudgeLayer = judgeAvailable ? judgeLayer : undefined;

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
  {
    name: "llm-judge-completion",
    description:
      "WebJudge-style LLM-as-judge completion verdict (Gemini 3 Flash). 1 = high-confidence completed, 0 = high-confidence not completed.",
    scorer: async ({
      input,
      output,
    }: {
      input: { task: EvalTask };
      output: ExecutedTrace;
    }): Promise<number> => {
      if (activeJudgeLayer === undefined) return 0;
      const judgeInput: JudgeInput = {
        taskDescription: input.task.prompt,
        finalUrl: output.finalUrl,
        agentTrajectorySummary: summarizeTrajectory(output),
      };
      const exit = await Effect.runPromise(
        judgeCompletion(judgeInput).pipe(Effect.provide(activeJudgeLayer), Effect.exit),
      );
      if (Exit.isSuccess(exit)) return exit.value.score;
      console.warn(
        `[online-mind2web.eval] llm-judge-completion scorer failed for task ${input.task.id}: ${String(exit.cause)}`,
      );
      return 0;
    },
  },
];

interface RealCaseInput {
  readonly task: EvalTask;
}

const buildRealCases = (): Array<{ input: RealCaseInput; expected: EvalTask }> =>
  tasks.map((task) => ({ input: { task }, expected: task }));

const registerRunnerSuite = (runner: EvalRunner, suiteLabel: string): void => {
  evalite<RealCaseInput, ExecutedTrace, EvalTask>(`${suiteLabel} (${runner.name})`, {
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
};

if (tasks.length === 0) {
  console.warn(
    `[online-mind2web.eval] Skipping suite registration: 0 tasks after filtering (limit=${evalConfig.mind2web.limit}, maxKeyNodes=${evalConfig.mind2web.maxKeyNodes}). Raise EVAL_MIND2WEB_LIMIT above 0 to run.`,
  );
} else if (evalConfig.runner === "real") {
  const runner: EvalRunner = makeRealRunner("real", evalConfig.realOptions);
  registerRunnerSuite(runner, "online-mind2web");
} else if (evalConfig.runner === "gemma") {
  const runner: EvalRunner = makeGemmaRunner(evalConfig.gemmaOptions);
  registerRunnerSuite(runner, "online-mind2web");
} else if (evalConfig.runner === "dual") {
  const primary: EvalRunner = makeRealRunner("real", evalConfig.realOptions);
  const secondary: EvalRunner = makeGemmaRunner(evalConfig.gemmaOptions);
  const dual = makeDualRunner(primary, secondary);
  registerRunnerSuite(dual.primary, `online-mind2web [primary ${dual.name}]`);
  registerRunnerSuite(dual.secondary, `online-mind2web [secondary ${dual.name}]`);
} else {
  evalite<{ task: EvalTask; scenario: "success" }, ExecutedTrace, EvalTask>(
    "online-mind2web (mock)",
    {
      data: () =>
        tasks.map((task) => ({ input: { task, scenario: "success" as const }, expected: task })),
      task: async (input) => runMock(input.task, input.scenario),
      scorers,
      columns: ({ input, output }) => [
        { label: "task", value: input.task.id },
        { label: "reached", value: String(output.reachedKeyNodes.length) },
        { label: "tools", value: String(output.toolCalls.length) },
      ],
    },
  );
}
