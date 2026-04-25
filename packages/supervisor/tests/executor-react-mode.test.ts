import { describe, it, expect } from "vitest";
import { Effect, Layer, Logger, Option, Stream } from "effect";
import {
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpAgentTurnUpdate,
  AcpSessionUpdate,
  AcpToolCallUpdate,
  AcpUsageUpdate,
  AnalysisStep,
  ChangesFor,
  ExecutedPerfPlan,
  StepId,
} from "@neuve/shared/models";
import {
  REACT_BUDGET_ABORT_TOKENS,
  REACT_BUDGET_WARN_TOKENS,
} from "../src/constants";
import {
  Action,
  AssertionFailed,
  PlanUpdate as PlanUpdateTurn,
  RunCompleted as RunCompletedTurn,
  StepDone,
  Thought,
} from "@neuve/shared/react-envelope";
import { TokenUsageBus } from "@neuve/shared/token-usage-bus";
import { Agent } from "@neuve/agent";
import { Executor } from "../src/executor";
import { Git, GitRepoRoot } from "../src/git/git";

const makeStep = (id: string, title: string): AnalysisStep =>
  new AnalysisStep({
    id: StepId.makeUnsafe(id),
    title,
    instruction: title,
    expectedOutcome: "",
    routeHint: Option.none(),
    status: "pending",
    summary: Option.none(),
    startedAt: Option.none(),
    endedAt: Option.none(),
  });

const wrapAgentTurn = (turn: AgentTurnInstance): AcpSessionUpdate =>
  new AcpAgentTurnUpdate({
    sessionUpdate: "agent_turn",
    agentTurn: turn,
  });

type AgentTurnInstance =
  | Thought
  | Action
  | PlanUpdateTurn
  | StepDone
  | AssertionFailed
  | RunCompletedTurn;

const messageChunk = (text: string): AcpSessionUpdate =>
  new AcpAgentMessageChunk({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });

const thoughtChunk = (text: string): AcpSessionUpdate =>
  new AcpAgentThoughtChunk({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text },
  });

interface ToolCallUpdateOptions {
  readonly toolCallId: string;
  readonly title: string;
  readonly status: "pending" | "in_progress" | "completed" | "failed";
  readonly rawOutput?: unknown;
}

const toolCallUpdate = (options: ToolCallUpdateOptions): AcpSessionUpdate =>
  new AcpToolCallUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: options.toolCallId,
    title: options.title,
    status: options.status,
    rawOutput: options.rawOutput,
  });

const gitStubLayer = Layer.succeed(
  Git,
  Git.of({
    withRepoRoot:
      (_cwd: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(GitRepoRoot, "/tmp/stub-repo")),
    getMainBranch: Effect.succeed("main"),
    getCurrentBranch: Effect.succeed("feature/test"),
    isInsideWorkTree: () => Effect.succeed(true),
    getFileStats: () => Effect.succeed([]),
    getChangedFiles: () => Effect.succeed([]),
    getDiffPreview: () => Effect.succeed(""),
    getRecentCommits: () => Effect.succeed([]),
    getCommitSummary: () => Effect.succeed(Option.none()),
    getState: Effect.succeed({
      isGitRepo: true,
      currentBranch: "feature/test",
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

const scriptedAgentLayer = (updates: readonly AcpSessionUpdate[]) =>
  Layer.succeed(
    Agent,
    Agent.of({
      stream: () => Stream.fromIterable(updates),
      createSession: () => Effect.die("createSession not used in this test"),
      setConfigOption: () => Effect.die("setConfigOption not used in this test"),
      fetchConfigOptions: () => Effect.die("fetchConfigOptions not used in this test"),
    }),
  );

const buildLayer = (updates: readonly AcpSessionUpdate[]) =>
  Layer.provideMerge(
    Executor.layer,
    Layer.mergeAll(scriptedAgentLayer(updates), gitStubLayer, TokenUsageBus.layerNoop),
  );

const runExecutor = (
  updates: readonly AcpSessionUpdate[],
  initialSteps: readonly AnalysisStep[],
) =>
  Effect.gen(function* () {
    const executor = yield* Executor;
    const stream = executor.execute({
      changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
      instruction: "test instruction",
      isHeadless: true,
      cookieBrowserKeys: [],
      initialSteps,
    });
    return yield* stream.pipe(Stream.runCollect);
  }).pipe(Effect.provide(buildLayer(updates)));

const lastPlanOf = (plans: readonly ExecutedPerfPlan[]): ExecutedPerfPlan => {
  if (plans.length === 0) throw new Error("expected at least one emitted plan");
  return plans[plans.length - 1];
};

describe("Executor — react-mode wire (agent_turn → reducer)", () => {
  it("dispatches a happy-path THOUGHT → ACTION → STEP_DONE → RUN_COMPLETED sequence into ExecutedPerfPlan", async () => {
    const steps = [makeStep("step-01", "Navigate")];
    const updates: AcpSessionUpdate[] = [
      wrapAgentTurn(
        new Thought({ stepId: "step-01", thought: "I will navigate to the homepage." }),
      ),
      wrapAgentTurn(
        new Action({
          stepId: "step-01",
          toolName: "interact",
          args: { command: "navigate", url: "https://example.com" },
        }),
      ),
      wrapAgentTurn(new StepDone({ stepId: "step-01", summary: "Landed on homepage" })),
      wrapAgentTurn(new RunCompletedTurn({ status: "passed", summary: "all steps complete" })),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const final = lastPlanOf(emitted);

    expect(final.hasRunFinished).toBe(true);
    const runFinished = final.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("passed");
    }
    expect(final.events.some((event) => event._tag === "AgentThinking")).toBe(true);
    expect(final.events.some((event) => event._tag === "ToolCall")).toBe(true);
    expect(final.events.some((event) => event._tag === "StepCompleted")).toBe(true);
  });

  it("rejects passed RUN_COMPLETED following an unresolved ASSERTION_FAILED via the adherence gate", async () => {
    const steps = [makeStep("step-01", "Navigate"), makeStep("step-02", "Click")];
    const updates: AcpSessionUpdate[] = [
      wrapAgentTurn(new StepDone({ stepId: "step-01", summary: "ok" })),
      wrapAgentTurn(
        new AssertionFailed({
          stepId: "step-02",
          category: "regression",
          domain: "perf",
          reason: "LCP poor",
          evidence: "lcp=4500ms",
        }),
      ),
      wrapAgentTurn(new RunCompletedTurn({ status: "passed", summary: "claim pass" })),
    ];

    const warnings: { message: string; level: string }[] = [];
    const capturingLogger = Logger.make((options) => {
      warnings.push({
        level: String(options.logLevel),
        message: Array.isArray(options.message)
          ? options.message.map((part) => String(part)).join(" ")
          : String(options.message),
      });
    });
    const logCapture = Logger.layer([capturingLogger]);

    const emitted = await Effect.runPromise(
      runExecutor(updates, steps).pipe(Effect.provide(logCapture)),
    );
    const final = lastPlanOf(emitted);

    expect(final.hasRunFinished).toBe(false);
    expect(
      warnings.some(
        (entry) => entry.level === "Warn" && entry.message.includes("premature-run-completed"),
      ),
    ).toBe(true);
    expect(
      warnings.some(
        (entry) =>
          entry.level === "Warn" && entry.message.includes("react-premature-run-completed"),
      ),
    ).toBe(true);
  });

  it("applies PLAN_UPDATE insert through the reducer and surfaces the new step in plan.steps", async () => {
    const initialSteps = [makeStep("step-01", "Navigate")];
    const newStepPayload = {
      id: "step-02",
      title: "Click Buy",
      instruction: "Click Buy menu",
      expectedOutcome: "menu visible",
      routeHint: null,
      status: "pending",
      summary: null,
      startedAt: null,
      endedAt: null,
    };
    const updates: AcpSessionUpdate[] = [
      wrapAgentTurn(
        new PlanUpdateTurn({
          stepId: "step-02",
          action: "insert",
          payload: newStepPayload,
        }),
      ),
      wrapAgentTurn(new StepDone({ stepId: "step-01", summary: "navigated" })),
      wrapAgentTurn(new StepDone({ stepId: "step-02", summary: "clicked" })),
      wrapAgentTurn(new RunCompletedTurn({ status: "passed", summary: "done" })),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, initialSteps));
    const final = lastPlanOf(emitted);

    expect(final.steps).toHaveLength(2);
    // applyPlanUpdate inserts BEFORE matching stepId; if stepId not found, appends at end.
    // Initial plan has [step-01]; PLAN_UPDATE.insert with stepId="step-02" doesn't match → append.
    expect(final.steps.map((step) => step.id)).toEqual(["step-01", "step-02"]);
    expect(final.events.some((event) => event._tag === "PlanUpdate")).toBe(true);
  });

  it("logs PlanUpdateCapExceeded when a 6th PLAN_UPDATE arrives, leaves plan unchanged for the rejected one", async () => {
    const initialSteps = [makeStep("step-01", "Navigate")];
    const buildPayload = (id: string) => ({
      id,
      title: `Step ${id}`,
      instruction: `Instruction ${id}`,
      expectedOutcome: "",
      routeHint: null,
      status: "pending",
      summary: null,
      startedAt: null,
      endedAt: null,
    });

    const updates: AcpSessionUpdate[] = [];
    for (let index = 1; index <= 6; index++) {
      updates.push(
        wrapAgentTurn(
          new PlanUpdateTurn({
            stepId: `step-${index + 1}`,
            action: "insert",
            payload: buildPayload(`step-${index + 1}`),
          }),
        ),
      );
    }
    updates.push(
      wrapAgentTurn(new RunCompletedTurn({ status: "failed", summary: "stopped early" })),
    );

    const warnings: { message: string; level: string }[] = [];
    const capturingLogger = Logger.make((options) => {
      warnings.push({
        level: String(options.logLevel),
        message: Array.isArray(options.message)
          ? options.message.map((part) => String(part)).join(" ")
          : String(options.message),
      });
    });
    const logCapture = Logger.layer([capturingLogger]);

    const emitted = await Effect.runPromise(
      runExecutor(updates, initialSteps).pipe(Effect.provide(logCapture)),
    );
    const final = lastPlanOf(emitted);

    expect(final.steps.length).toBe(6);
    expect(
      warnings.some(
        (entry) =>
          entry.level === "Warn" && entry.message.includes("react-plan-update-cap-exceeded"),
      ),
    ).toBe(true);
  });

  it("R3 gate accepts passed RUN_COMPLETED when StepFailed is outside the 3-event window", async () => {
    const steps = [
      makeStep("step-01", "Land"),
      makeStep("step-02", "Click"),
      makeStep("step-03", "Verify"),
      makeStep("step-04", "Confirm"),
      makeStep("step-05", "Submit"),
    ];

    const updates: AcpSessionUpdate[] = [
      wrapAgentTurn(new StepDone({ stepId: "step-01", summary: "landed" })),
      wrapAgentTurn(
        new AssertionFailed({
          stepId: "step-02",
          category: "regression",
          domain: "perf",
          reason: "old failure",
          evidence: "ev",
        }),
      ),
      wrapAgentTurn(new StepDone({ stepId: "step-03", summary: "verified" })),
      wrapAgentTurn(new StepDone({ stepId: "step-04", summary: "confirmed" })),
      wrapAgentTurn(new StepDone({ stepId: "step-05", summary: "submitted" })),
      wrapAgentTurn(new RunCompletedTurn({ status: "passed", summary: "complete" })),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const final = lastPlanOf(emitted);

    expect(final.hasRunFinished).toBe(true);
    const runFinished = final.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("passed");
    }
    expect(final.steps.find((step) => step.id === "step-02")?.status).toBe("failed");
  });

  it("preserves local-agent abort messages that arrive AFTER an agent_turn turn cycle (per-envelope skip rule)", async () => {
    // Real flow: each agent_turn is immediately followed by exactly one display
    // update for the same envelope. Local-agent abort paths (empty content,
    // MAX_TOOL_ROUNDS, parse failure, doom-loop) emit an `agent_message_chunk`
    // WITHOUT a preceding agent_turn — that update must NOT be skipped.
    const steps = [makeStep("step-01", "Navigate")];
    const abortMessage = "[Reached maximum tool call rounds (15). Stopping.]";
    const updates: AcpSessionUpdate[] = [
      wrapAgentTurn(new Thought({ stepId: "step-01", thought: "I will navigate now." })),
      thoughtChunk("I will navigate now."),
      messageChunk(abortMessage),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const final = lastPlanOf(emitted);

    const thinking = final.events.find((event) => event._tag === "AgentThinking");
    expect(thinking?._tag).toBe("AgentThinking");
    if (thinking?._tag === "AgentThinking") {
      expect(thinking.text).toBe("I will navigate now.");
    }

    const messageWithAbort = final.events.find(
      (event) =>
        event._tag === "AgentText" &&
        event.text.includes("Reached maximum tool call rounds"),
    );
    expect(messageWithAbort?._tag).toBe("AgentText");
  });

  it("agent_turn → tool_call_update (no intervening display update) — tool_call_update flows through addEvent and adds ToolResult", async () => {
    // Production flow always interposes a `tool_call` display update between
    // an ACTION agent_turn and the eventual `tool_call_update` (the MCP
    // result). If a future refactor moved tool_call_update to fire
    // immediately after agent_turn (no intervening display), the per-envelope
    // skip flag would still be true — and the tool RESULT would be lost.
    // This test pins the per-envelope flag's reset behavior on
    // `tool_call_update`: it is NOT in the skipped set, so even when the flag
    // is true it falls through to addEvent, which adds the canonical
    // ToolResult event.
    const steps = [makeStep("step-01", "Navigate")];
    const callId = "tool-call-react-edge";
    const updates: AcpSessionUpdate[] = [
      wrapAgentTurn(
        new Action({
          stepId: "step-01",
          toolName: "interact",
          args: { command: "navigate", url: "https://example.com" },
        }),
      ),
      toolCallUpdate({
        toolCallId: callId,
        title: "interact",
        status: "completed",
        rawOutput: { ok: true, page: "homepage" },
      }),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const final = lastPlanOf(emitted);

    const toolCall = final.events.find((event) => event._tag === "ToolCall");
    expect(toolCall?._tag).toBe("ToolCall");
    const toolResult = final.events.find((event) => event._tag === "ToolResult");
    expect(toolResult?._tag).toBe("ToolResult");
    if (toolResult?._tag === "ToolResult") {
      expect(toolResult.toolName).toBe("interact");
      expect(toolResult.isError).toBe(false);
    }
  });

  it("back-to-back agent_turns with no intervening update — per-envelope skip resets cleanly", async () => {
    // Two consecutive agent_turn updates (no display update in between) MUST
    // both be processed by the reducer. The per-envelope skip flag should be
    // set true after the first, then reset back to true after the second
    // (each agent_turn re-arms it for its own subsequent display update). If
    // the flag were sticky-set or counter-incremented incorrectly, the
    // second envelope's events would be skipped.
    const steps = [makeStep("step-01", "Navigate"), makeStep("step-02", "Click")];
    const updates: AcpSessionUpdate[] = [
      wrapAgentTurn(new Thought({ stepId: "step-01", thought: "First step thinking." })),
      wrapAgentTurn(new Thought({ stepId: "step-02", thought: "Second step thinking." })),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const final = lastPlanOf(emitted);

    const agentThinkingEvents = final.events.filter(
      (event) => event._tag === "AgentThinking",
    );
    expect(agentThinkingEvents).toHaveLength(2);
    if (
      agentThinkingEvents[0]._tag === "AgentThinking" &&
      agentThinkingEvents[1]._tag === "AgentThinking"
    ) {
      expect(agentThinkingEvents[0].text).toBe("First step thinking.");
      expect(agentThinkingEvents[1].text).toBe("Second step thinking.");
    }
  });

  it("budget warn — logs once when prompt tokens cross 96K, does not abort", async () => {
    const steps = [makeStep("step-01", "Navigate")];
    const usage = (promptTokens: number): AcpSessionUpdate =>
      new AcpUsageUpdate({
        sessionUpdate: "usage_update",
        size: 131_072,
        used: promptTokens,
        _meta: {
          promptTokens,
          completionTokens: 100,
          totalTokens: promptTokens + 100,
        },
      });
    const updates: AcpSessionUpdate[] = [
      // First call crosses warn → warn fires
      usage(REACT_BUDGET_WARN_TOKENS + 1),
      // Second call still above warn but warn-once guard suppresses it
      usage(REACT_BUDGET_WARN_TOKENS + 5_000),
      // Third call back below threshold (no-op)
      usage(REACT_BUDGET_WARN_TOKENS - 1_000),
      wrapAgentTurn(new StepDone({ stepId: "step-01", summary: "ok" })),
      wrapAgentTurn(new RunCompletedTurn({ status: "passed", summary: "done" })),
    ];

    const warnings: { message: string; level: string }[] = [];
    const capturingLogger = Logger.make((options) => {
      warnings.push({
        level: String(options.logLevel),
        message: Array.isArray(options.message)
          ? options.message.map((part) => String(part)).join(" ")
          : String(options.message),
      });
    });
    const logCapture = Logger.layer([capturingLogger]);

    const emitted = await Effect.runPromise(
      runExecutor(updates, steps).pipe(Effect.provide(logCapture)),
    );
    const final = lastPlanOf(emitted);

    const budgetWarnings = warnings.filter(
      (entry) => entry.level === "Warn" && entry.message.includes("react-budget-exceeded"),
    );
    expect(budgetWarnings).toHaveLength(1);
    expect(final.hasRunFinished).toBe(true);
    const runFinished = final.events.find((event) => event._tag === "RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("passed");
      expect(runFinished.abort).toBeUndefined();
    }
  });

  it("budget abort — synthesizes a context-budget-exceeded RunFinished when prompt tokens cross 120K", async () => {
    const steps = [makeStep("step-01", "Navigate")];
    const usageBeyondAbort = new AcpUsageUpdate({
      sessionUpdate: "usage_update",
      size: 131_072,
      used: REACT_BUDGET_ABORT_TOKENS + 5_000,
      _meta: {
        promptTokens: REACT_BUDGET_ABORT_TOKENS + 5_000,
        completionTokens: 200,
        totalTokens: REACT_BUDGET_ABORT_TOKENS + 5_200,
      },
    });
    // After abort RunFinished is appended, the executor's takeUntil should
    // halt the stream — anything after this is ignored.
    const updates: AcpSessionUpdate[] = [
      usageBeyondAbort,
      wrapAgentTurn(new RunCompletedTurn({ status: "passed", summary: "should-not-arrive" })),
    ];

    const warnings: { message: string; level: string }[] = [];
    const capturingLogger = Logger.make((options) => {
      warnings.push({
        level: String(options.logLevel),
        message: Array.isArray(options.message)
          ? options.message.map((part) => String(part)).join(" ")
          : String(options.message),
      });
    });
    const logCapture = Logger.layer([capturingLogger]);

    const emitted = await Effect.runPromise(
      runExecutor(updates, steps).pipe(Effect.provide(logCapture)),
    );
    const final = lastPlanOf(emitted);

    expect(final.hasRunFinished).toBe(true);
    const runFinished = final.events.find((event) => event._tag === "RunFinished");
    expect(runFinished?._tag).toBe("RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.status).toBe("failed");
      expect(runFinished.abort).toBeDefined();
      expect(runFinished.abort?.reason).toBe("context-budget-exceeded");
      expect(runFinished.summary).toContain(String(REACT_BUDGET_ABORT_TOKENS + 5_000));
    }

    const budgetWarnings = warnings.filter(
      (entry) => entry.level === "Warn" && entry.message.includes("react-budget-exceeded"),
    );
    expect(budgetWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it("budget abort — flows through the adherence gate (abort RunFinished is accepted, not rejected)", async () => {
    // Per executor.ts:183 — gate accepts any RunFinished with abort.reason set.
    // The synthesized budget-exceeded RunFinished must satisfy this rule so the
    // run doesn't get filtered out by the premature-completed guard.
    const steps = [
      makeStep("step-01", "Navigate"),
      makeStep("step-02", "Click"),
      makeStep("step-03", "Verify"),
    ];
    const updates: AcpSessionUpdate[] = [
      // A StepFailed near the end — without abort.reason, the R3 gate would
      // reject a passed RUN_COMPLETED. The budget abort must NOT be filtered.
      wrapAgentTurn(
        new AssertionFailed({
          stepId: "step-02",
          category: "regression",
          domain: "perf",
          reason: "perf regression",
          evidence: "lcp=4500ms",
        }),
      ),
      new AcpUsageUpdate({
        sessionUpdate: "usage_update",
        _meta: {
          promptTokens: REACT_BUDGET_ABORT_TOKENS + 100,
          completionTokens: 100,
          totalTokens: REACT_BUDGET_ABORT_TOKENS + 200,
        },
      }),
    ];

    const emitted = await Effect.runPromise(runExecutor(updates, steps));
    const final = lastPlanOf(emitted);

    expect(final.hasRunFinished).toBe(true);
    const runFinished = final.events.find((event) => event._tag === "RunFinished");
    if (runFinished?._tag === "RunFinished") {
      expect(runFinished.abort?.reason).toBe("context-budget-exceeded");
    }
  });

  it("legacy mode (no agent_turn updates) keeps the existing addEvent path intact", async () => {
    const initialSteps = [makeStep("step-01", "Navigate")];
    const updates: AcpSessionUpdate[] = [];
    expect(updates.length).toBe(0);

    const emitted = await Effect.runPromise(
      runExecutor(
        [
          messageChunk("STEP_START|step-01|Navigate\nSTEP_DONE|step-01|done\n"),
          thoughtChunk("."),
          messageChunk("RUN_COMPLETED|passed|legacy success\n"),
          thoughtChunk("."),
        ],
        initialSteps,
      ),
    );
    const final = lastPlanOf(emitted);

    expect(final.hasRunFinished).toBe(true);
    expect(final.steps[0].status).toBe("passed");
  });
});
