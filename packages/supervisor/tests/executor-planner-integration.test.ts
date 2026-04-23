import { describe, it, expect } from "vitest";
import { Cause, Effect, Layer, Option, Stream } from "effect";
import { ChangesFor } from "@neuve/shared/models";
import { Agent } from "@neuve/agent";
import { Executor, ExecutionError } from "../src/executor";
import { PlanDecomposer } from "../src/plan-decomposer";
import { DecomposeError } from "../src/errors";
import { Git, GitRepoRoot } from "../src/git/git";

const agentNeverCalledLayer = Layer.succeed(
  Agent,
  Agent.of({
    stream: () => Stream.die("Agent.stream should not be called when plan decomposition fails"),
    createSession: () => Effect.die("createSession not used in this test"),
    setConfigOption: () => Effect.die("setConfigOption not used in this test"),
    fetchConfigOptions: () => Effect.die("fetchConfigOptions not used in this test"),
  }),
);

const failingDecomposerLayer = Layer.succeed(
  PlanDecomposer,
  PlanDecomposer.of({
    decompose: (_prompt, mode) =>
      new DecomposeError({
        mode,
        cause: "synthetic planner failure",
      }).asEffect(),
  }),
);

const makeGitStub = () =>
  Layer.succeed(
    Git,
    Git.of({
      withRepoRoot:
        (_cwd: string) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(Effect.provideService(GitRepoRoot, "/tmp/stub-repo")),
      getMainBranch: Effect.succeed("main"),
      getCurrentBranch: Effect.succeed("feature/test-branch"),
      isInsideWorkTree: () => Effect.succeed(true),
      getFileStats: () => Effect.succeed([]),
      getChangedFiles: () => Effect.succeed([]),
      getDiffPreview: () => Effect.succeed(""),
      getRecentCommits: () => Effect.succeed([]),
      getCommitSummary: () => Effect.succeed(Option.none()),
      getState: Effect.succeed({
        isGitRepo: true,
        currentBranch: "feature/test-branch",
        mainBranch: "main",
        hasUnstagedChanges: false,
        hasUncommittedChanges: false,
        hasBranchChanges: false,
        changedFiles: [],
        workingTreeFileStats: [],
        fingerprint: Option.none(),
        savedFingerprint: Option.none(),
      }),
      computeFingerprint: () => Effect.succeed(Option.none()),
      saveTestedFingerprint: () => Effect.void,
    }),
  );

const buildExecutorTestLayer = () =>
  Layer.provideMerge(
    Executor.layer,
    Layer.mergeAll(agentNeverCalledLayer, makeGitStub(), failingDecomposerLayer),
  );

describe("Executor ↔ PlanDecomposer propagation", () => {
  it("wraps DecomposeError into ExecutionError.reason without schema-constructor throw", async () => {
    const program = Effect.gen(function* () {
      const executor = yield* Executor;
      return yield* executor
        .execute({
          changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
          instruction: "reach the order form and report web vitals",
          isHeadless: true,
          cookieBrowserKeys: [],
          plannerMode: "frontier",
        })
        .pipe(Stream.runDrain);
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(Effect.provide(buildExecutorTestLayer())),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(ExecutionError);
        expect(failure.value._tag).toBe("ExecutionError");
        expect(failure.value.reason._tag).toBe("DecomposeError");
        expect(failure.value.reason.mode).toBe("frontier");
        expect(failure.value.message).toContain("synthetic planner failure");
      }
    }
  });

  it("constructs ExecutionError directly from a DecomposeError instance", () => {
    const decomposeError = new DecomposeError({
      mode: "frontier",
      cause: "bad json",
    });
    const executionError = new ExecutionError({ reason: decomposeError });
    expect(executionError._tag).toBe("ExecutionError");
    expect(executionError.reason._tag).toBe("DecomposeError");
    expect(executionError.reason.mode).toBe("frontier");
    expect(executionError.message).toContain("bad json");
  });

  it("leaves the synthetic empty plan untouched when plannerMode is 'none'", async () => {
    const neverCalledDecomposer = Layer.succeed(
      PlanDecomposer,
      PlanDecomposer.of({
        decompose: () =>
          Effect.die("PlanDecomposer.decompose must not be called when plannerMode=none"),
      }),
    );

    const agentEmptyStreamLayer = Layer.succeed(
      Agent,
      Agent.of({
        stream: () => Stream.empty,
        createSession: () => Effect.die("createSession not used"),
        setConfigOption: () => Effect.die("setConfigOption not used"),
        fetchConfigOptions: () => Effect.die("fetchConfigOptions not used"),
      }),
    );

    const testLayer = Layer.provideMerge(
      Executor.layer,
      Layer.mergeAll(agentEmptyStreamLayer, makeGitStub(), neverCalledDecomposer),
    );

    const program = Effect.gen(function* () {
      const executor = yield* Executor;
      return yield* executor
        .execute({
          changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
          instruction: "analyze the homepage",
          isHeadless: true,
          cookieBrowserKeys: [],
          plannerMode: "none",
        })
        .pipe(Stream.runDrain);
    });

    const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(testLayer)));
    expect(exit._tag).toBe("Success");
  });
});
