import { describe, it, expect } from "vitest";
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect";
import { AcpAgentMessageChunk, type AcpSessionUpdate, ChangesFor } from "@neuve/shared/models";
import {
  type AcpProviderUnauthenticatedError,
  type AcpProviderUsageLimitError,
  type AcpSessionCreateError,
  type AcpStreamError,
  AcpStreamError as AcpStreamErrorClass,
} from "@neuve/agent";
import { PlanDecomposer, PlannerAgent, splitByConnectives } from "../src/plan-decomposer";

const VOLVO_PROMPT =
  "lets go to volvocars.com, navigate to the build page, under the 'buy' > 'build your volvo' menu and build me a new ex90, any spec. Proceed all the way to the order request form and report back the web vitals";

const decomposeContext = {
  changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
  currentBranch: "main",
  diffPreview: "",
  baseUrl: undefined,
  isHeadless: true,
  cookieBrowserKeys: [],
} as const;

const makeTextChunk = (text: string): AcpAgentMessageChunk =>
  new AcpAgentMessageChunk({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });

type StreamError =
  | AcpStreamError
  | AcpSessionCreateError
  | AcpProviderUnauthenticatedError
  | AcpProviderUsageLimitError;

const mockPlannerAgentLayer = (responseText: string) =>
  Layer.succeed(
    PlannerAgent,
    PlannerAgent.of({
      stream: (): Stream.Stream<AcpSessionUpdate, StreamError> =>
        Stream.make(makeTextChunk(responseText)),
    }),
  );

const failingPlannerAgentLayer = (cause: string) =>
  Layer.succeed(
    PlannerAgent,
    PlannerAgent.of({
      stream: (): Stream.Stream<AcpSessionUpdate, StreamError> =>
        Stream.fail(new AcpStreamErrorClass({ cause })),
    }),
  );

const decomposerLayer = (plannerLayer: Layer.Layer<PlannerAgent>) =>
  Layer.effect(PlanDecomposer)(PlanDecomposer.make).pipe(Layer.provide(plannerLayer));

const runWithLayer = <A, E>(
  effect: Effect.Effect<A, E, PlanDecomposer>,
  layer: Layer.Layer<PlanDecomposer>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(layer)));

const runExitWithLayer = <A, E>(
  effect: Effect.Effect<A, E, PlanDecomposer>,
  layer: Layer.Layer<PlanDecomposer>,
) => Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));

describe("PlanDecomposer template mode", () => {
  it("produces at least 2 steps for the Volvo prompt", async () => {
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(VOLVO_PROMPT, "template", decomposeContext);
      }),
      decomposerLayer(mockPlannerAgentLayer("unused")),
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.every((step) => step.status === "pending")).toBe(true);
  });

  it("produces a single navigation step when the prompt is a bare URL", async () => {
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose("https://example.com", "template", decomposeContext);
      }),
      decomposerLayer(mockPlannerAgentLayer("unused")),
    );
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].title.toLowerCase()).toContain("example.com");
  });
});

describe("PlanDecomposer frontier mode", () => {
  const volvoResponse = JSON.stringify({
    steps: [
      {
        title: "Open landing page",
        instruction: "Navigate to https://www.volvocars.com/",
        expectedOutcome: "Homepage renders",
        routeHint: "/",
      },
      {
        title: "Open Buy menu",
        instruction: "Hover the top-nav Buy menu",
        expectedOutcome: "Buy dropdown visible",
      },
      {
        title: "Click Build your Volvo",
        instruction: "Click the Build your Volvo submenu entry",
        expectedOutcome: "Build picker loads",
        routeHint: "/build",
      },
      {
        title: "Select EX90",
        instruction: "Click the EX90 card",
        expectedOutcome: "EX90 configurator opens",
      },
      {
        title: "Complete configurator",
        instruction: "Advance through each configurator step to the order form",
        expectedOutcome: "Order request form visible",
      },
      {
        title: "Capture web vitals",
        instruction: "Capture web vitals on landing and configurator pages",
        expectedOutcome: "Metrics reported",
      },
    ],
  });

  it("decodes JSON from the planner agent into >=4 steps", async () => {
    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(VOLVO_PROMPT, "frontier", decomposeContext);
      }),
      decomposerLayer(mockPlannerAgentLayer(volvoResponse)),
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.steps[0].id).toBe("step-01");
    expect(plan.steps[3].id).toBe("step-04");
    expect(Option.isSome(plan.steps[0].routeHint)).toBe(true);
  });

  it("tolerates a markdown fence around the JSON payload", async () => {
    const response =
      "```json\n" +
      JSON.stringify({
        steps: [
          {
            title: "Open landing",
            instruction: "Navigate to the site",
            expectedOutcome: "Page loads",
          },
          {
            title: "Capture vitals",
            instruction: "Record CWV",
            expectedOutcome: "Metrics recorded",
          },
        ],
      }) +
      "\n```";

    const plan = await runWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose("some prompt", "frontier", decomposeContext);
      }),
      decomposerLayer(mockPlannerAgentLayer(response)),
    );
    expect(plan.steps.length).toBe(2);
  });

  it("fails with DecomposeError when the planner response is malformed JSON", async () => {
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(VOLVO_PROMPT, "frontier", decomposeContext);
      }),
      decomposerLayer(mockPlannerAgentLayer("definitely not json {{{")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
      }
    }
  });

  it("wraps AcpStreamError as DecomposeError", async () => {
    const exit = await runExitWithLayer(
      Effect.gen(function* () {
        const decomposer = yield* PlanDecomposer;
        return yield* decomposer.decompose(VOLVO_PROMPT, "frontier", decomposeContext);
      }),
      decomposerLayer(failingPlannerAgentLayer("gemini offline")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("DecomposeError");
        expect(failure.value.cause).toContain("gemini offline");
      }
    }
  });
});

describe("splitByConnectives", () => {
  it("splits the Volvo prompt on connective phrases", () => {
    const clauses = splitByConnectives(VOLVO_PROMPT);
    expect(clauses.length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty array for an empty prompt", () => {
    expect(splitByConnectives("")).toEqual([]);
  });
});
