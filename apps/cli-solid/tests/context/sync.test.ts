import { describe, test, expect } from "bun:test";
import {
  syncReducer,
  binarySearchInsertIndex,
  INITIAL_SYNC_STORE,
  type SyncStoreShape,
  type SyncEvent,
} from "../../src/context/sync-reducer";
import type { PlanId, StepId } from "@neuve/shared/models";

const INITIAL_STORE = INITIAL_SYNC_STORE;

// HACK: branded ID helpers for tests — avoids importing Schema just for test fixtures
const makePlanId = (id: string): PlanId => id as unknown as PlanId;
const makeStepId = (id: string): StepId => id as unknown as StepId;

describe("syncReducer", () => {
  test("RunStarted resets store and sets status to running", () => {
    const event: SyncEvent = {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    };
    const result = syncReducer(INITIAL_STORE, event);
    expect(result.planId).toBe(makePlanId("plan-1"));
    expect(result.status).toBe("running");
    expect(result.startedAt).toBe(1000);
    expect(result.stepOrder).toEqual([]);
  });

  test("StepStarted adds step and sets it as active", () => {
    const state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });

    const result = syncReducer(state, {
      _tag: "StepStarted",
      stepId: makeStepId("step-1"),
      title: "Navigate to homepage",
      timestamp: 1100,
    });

    expect(result.stepOrder).toEqual([makeStepId("step-1")]);
    expect(result.activeStepId).toBe(makeStepId("step-1"));
    expect(result.steps["step-1"]!.title).toBe("Navigate to homepage");
    expect(result.steps["step-1"]!.status).toBe("running");
  });

  test("StepCompleted marks step as passed", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    state = syncReducer(state, {
      _tag: "StepStarted",
      stepId: makeStepId("step-1"),
      title: "Navigate",
      timestamp: 1100,
    });
    const result = syncReducer(state, {
      _tag: "StepCompleted",
      stepId: makeStepId("step-1"),
      timestamp: 1200,
    });

    expect(result.steps["step-1"]!.status).toBe("passed");
    expect(result.steps["step-1"]!.completedAt).toBe(1200);
    expect(result.activeStepId).toBeUndefined();
  });

  test("StepFailed marks step as failed", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    state = syncReducer(state, {
      _tag: "StepStarted",
      stepId: makeStepId("step-1"),
      title: "Analyze",
      timestamp: 1100,
    });
    const result = syncReducer(state, {
      _tag: "StepFailed",
      stepId: makeStepId("step-1"),
      timestamp: 1200,
    });

    expect(result.steps["step-1"]!.status).toBe("failed");
  });

  test("StepSkipped marks step as skipped", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    state = syncReducer(state, {
      _tag: "StepStarted",
      stepId: makeStepId("step-1"),
      title: "Optional step",
      timestamp: 1100,
    });
    const result = syncReducer(state, {
      _tag: "StepSkipped",
      stepId: makeStepId("step-1"),
      timestamp: 1200,
    });

    expect(result.steps["step-1"]!.status).toBe("skipped");
  });

  test("ToolCall adds a tool call to the step", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    state = syncReducer(state, {
      _tag: "StepStarted",
      stepId: makeStepId("step-1"),
      title: "Navigate",
      timestamp: 1100,
    });
    const result = syncReducer(state, {
      _tag: "ToolCall",
      stepId: makeStepId("step-1"),
      toolCallId: "tc-1",
      toolName: "navigate",
      inputPreview: "https://example.com",
      timestamp: 1150,
    });

    expect(result.steps["step-1"]!.toolCalls).toHaveLength(1);
    expect(result.steps["step-1"]!.toolCalls[0]!.toolName).toBe("navigate");
    expect(result.steps["step-1"]!.toolCalls[0]!.status).toBe("running");
  });

  test("ToolResult completes a tool call", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    state = syncReducer(state, {
      _tag: "StepStarted",
      stepId: makeStepId("step-1"),
      title: "Navigate",
      timestamp: 1100,
    });
    state = syncReducer(state, {
      _tag: "ToolCall",
      stepId: makeStepId("step-1"),
      toolCallId: "tc-1",
      toolName: "navigate",
      inputPreview: "https://example.com",
      timestamp: 1150,
    });
    const result = syncReducer(state, {
      _tag: "ToolResult",
      stepId: makeStepId("step-1"),
      toolCallId: "tc-1",
      outputPreview: "Page loaded",
      timestamp: 1200,
    });

    expect(result.steps["step-1"]!.toolCalls[0]!.status).toBe("completed");
    expect(result.steps["step-1"]!.toolCalls[0]!.outputPreview).toBe("Page loaded");
  });

  test("ToolProgress updates tool call output preview", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    state = syncReducer(state, {
      _tag: "StepStarted",
      stepId: makeStepId("step-1"),
      title: "Navigate",
      timestamp: 1100,
    });
    state = syncReducer(state, {
      _tag: "ToolCall",
      stepId: makeStepId("step-1"),
      toolCallId: "tc-1",
      toolName: "navigate",
      inputPreview: "https://example.com",
      timestamp: 1150,
    });
    const result = syncReducer(state, {
      _tag: "ToolProgress",
      stepId: makeStepId("step-1"),
      toolCallId: "tc-1",
      progressText: "Loading... 50%",
      timestamp: 1175,
    });

    expect(result.steps["step-1"]!.toolCalls[0]!.outputPreview).toBe("Loading... 50%");
  });

  test("AgentMessageChunk appends to agent messages", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    state = syncReducer(state, {
      _tag: "AgentMessageChunk",
      content: "Analyzing the page...",
      timestamp: 1100,
    });
    const result = syncReducer(state, {
      _tag: "AgentMessageChunk",
      content: " Found 3 issues.",
      timestamp: 1200,
    });

    expect(result.agentMessages).toHaveLength(2);
    expect(result.agentMessages[0]!.content).toBe("Analyzing the page...");
    expect(result.agentMessages[1]!.content).toBe(" Found 3 issues.");
  });

  test("RunCompleted sets status and elapsed time", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    const result = syncReducer(state, {
      _tag: "RunCompleted",
      timestamp: 5000,
    });

    expect(result.status).toBe("completed");
    expect(result.elapsedMs).toBe(4000);
  });

  test("RunFailed sets status and elapsed time", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    const result = syncReducer(state, {
      _tag: "RunFailed",
      timestamp: 3000,
    });

    expect(result.status).toBe("failed");
    expect(result.elapsedMs).toBe(2000);
  });

  test("RunCancelled sets status", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    const result = syncReducer(state, {
      _tag: "RunCancelled",
      timestamp: 2000,
    });

    expect(result.status).toBe("cancelled");
  });

  test("full lifecycle: multi-step run with tools", () => {
    const events: SyncEvent[] = [
      { _tag: "RunStarted", planId: makePlanId("plan-1"), timestamp: 0 },
      { _tag: "StepStarted", stepId: makeStepId("s1"), title: "Navigate", timestamp: 100 },
      { _tag: "ToolCall", stepId: makeStepId("s1"), toolCallId: "tc1", toolName: "navigate", inputPreview: "https://example.com", timestamp: 110 },
      { _tag: "ToolResult", stepId: makeStepId("s1"), toolCallId: "tc1", outputPreview: "OK", timestamp: 200 },
      { _tag: "StepCompleted", stepId: makeStepId("s1"), timestamp: 210 },
      { _tag: "StepStarted", stepId: makeStepId("s2"), title: "Analyze", timestamp: 300 },
      { _tag: "ToolCall", stepId: makeStepId("s2"), toolCallId: "tc2", toolName: "trace", inputPreview: "perf", timestamp: 310 },
      { _tag: "AgentMessageChunk", content: "Analyzing...", timestamp: 320 },
      { _tag: "ToolResult", stepId: makeStepId("s2"), toolCallId: "tc2", outputPreview: "trace data", timestamp: 400 },
      { _tag: "StepCompleted", stepId: makeStepId("s2"), timestamp: 410 },
      { _tag: "RunCompleted", timestamp: 500 },
    ];

    let state = { ...INITIAL_STORE };
    for (const event of events) {
      state = syncReducer(state, event);
    }

    expect(state.status).toBe("completed");
    expect(state.stepOrder).toEqual([makeStepId("s1"), makeStepId("s2")]);
    expect(state.steps["s1"]!.status).toBe("passed");
    expect(state.steps["s2"]!.status).toBe("passed");
    expect(state.steps["s1"]!.toolCalls).toHaveLength(1);
    expect(state.steps["s2"]!.toolCalls).toHaveLength(1);
    expect(state.agentMessages).toHaveLength(1);
    expect(state.elapsedMs).toBe(500);
  });

  test("ignores events for unknown steps", () => {
    let state = syncReducer(INITIAL_STORE, {
      _tag: "RunStarted",
      planId: makePlanId("plan-1"),
      timestamp: 1000,
    });
    const result = syncReducer(state, {
      _tag: "StepCompleted",
      stepId: makeStepId("nonexistent"),
      timestamp: 1200,
    });

    expect(result).toEqual(state);
  });
});

describe("binarySearchInsertIndex", () => {
  test("finds existing item", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = binarySearchInsertIndex(items, "b", (item) => item.id);
    expect(result).toEqual({ found: true, index: 1 });
  });

  test("returns insert position for missing item", () => {
    const items = [{ id: "a" }, { id: "c" }, { id: "e" }];
    const result = binarySearchInsertIndex(items, "d", (item) => item.id);
    expect(result).toEqual({ found: false, index: 2 });
  });

  test("handles empty array", () => {
    const result = binarySearchInsertIndex([], "a", (item: { id: string }) => item.id);
    expect(result).toEqual({ found: false, index: 0 });
  });

  test("inserts at beginning", () => {
    const items = [{ id: "b" }, { id: "c" }];
    const result = binarySearchInsertIndex(items, "a", (item) => item.id);
    expect(result).toEqual({ found: false, index: 0 });
  });

  test("inserts at end", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const result = binarySearchInsertIndex(items, "c", (item) => item.id);
    expect(result).toEqual({ found: false, index: 2 });
  });
});
