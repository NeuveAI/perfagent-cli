import { describe, expect, it } from "vite-plus/test";
import {
  REACT_BUDGET_ABORT_TOKENS,
  REACT_BUDGET_WARN_TOKENS,
} from "../src/constants";
import { evaluateBudget } from "../src/budget-monitor";
import { ReactRunState, ReducerSignal } from "../src/react-reducer";

const baseState = (): ReactRunState =>
  new ReactRunState({
    planUpdateCount: 0,
    consecutiveAssertionFailures: {},
    lastTurnTag: undefined,
    budgetExceeded: false,
  });

const stateAlreadyExceeded = (): ReactRunState =>
  new ReactRunState({
    planUpdateCount: 0,
    consecutiveAssertionFailures: {},
    lastTurnTag: undefined,
    budgetExceeded: true,
  });

describe("evaluateBudget", () => {
  it("returns no signals and no abort below the warn threshold", () => {
    const result = evaluateBudget(REACT_BUDGET_WARN_TOKENS - 1, baseState());
    expect(result.signals).toEqual([]);
    expect(result.shouldAbort).toBe(false);
    expect(result.runState.budgetExceeded).toBe(false);
  });

  it("emits a warn signal exactly at the warn threshold (inclusive)", () => {
    const result = evaluateBudget(REACT_BUDGET_WARN_TOKENS, baseState());
    expect(result.signals).toEqual([
      ReducerSignal.BudgetExceeded({
        level: "warn",
        promptTokens: REACT_BUDGET_WARN_TOKENS,
        threshold: REACT_BUDGET_WARN_TOKENS,
      }),
    ]);
    expect(result.shouldAbort).toBe(false);
    expect(result.runState.budgetExceeded).toBe(true);
  });

  it("emits a warn signal between warn and abort thresholds", () => {
    const tokens = Math.floor((REACT_BUDGET_WARN_TOKENS + REACT_BUDGET_ABORT_TOKENS) / 2);
    const result = evaluateBudget(tokens, baseState());
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    if (signal._tag !== "BudgetExceeded") throw new Error("expected BudgetExceeded signal");
    expect(signal.level).toBe("warn");
    expect(signal.promptTokens).toBe(tokens);
    expect(result.shouldAbort).toBe(false);
    expect(result.runState.budgetExceeded).toBe(true);
  });

  it("does NOT re-emit a warn signal once budgetExceeded is true (warn-once guard)", () => {
    const tokens = REACT_BUDGET_WARN_TOKENS + 100;
    const result = evaluateBudget(tokens, stateAlreadyExceeded());
    expect(result.signals).toEqual([]);
    expect(result.shouldAbort).toBe(false);
    expect(result.runState.budgetExceeded).toBe(true);
  });

  it("emits an abort signal exactly at the abort threshold (inclusive)", () => {
    const result = evaluateBudget(REACT_BUDGET_ABORT_TOKENS, baseState());
    expect(result.signals).toEqual([
      ReducerSignal.BudgetExceeded({
        level: "abort",
        promptTokens: REACT_BUDGET_ABORT_TOKENS,
        threshold: REACT_BUDGET_ABORT_TOKENS,
      }),
    ]);
    expect(result.shouldAbort).toBe(true);
    expect(result.runState.budgetExceeded).toBe(true);
  });

  it("emits an abort signal above the abort threshold even when already warned", () => {
    const tokens = REACT_BUDGET_ABORT_TOKENS + 5_000;
    const result = evaluateBudget(tokens, stateAlreadyExceeded());
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    if (signal._tag !== "BudgetExceeded") throw new Error("expected BudgetExceeded signal");
    expect(signal.level).toBe("abort");
    expect(signal.promptTokens).toBe(tokens);
    expect(result.shouldAbort).toBe(true);
  });

  it("returns the same runState reference (structural identity) when no signal fires", () => {
    const state = baseState();
    const result = evaluateBudget(0, state);
    expect(result.runState).toBe(state);
  });

  it("flips budgetExceeded to true on the warn crossing", () => {
    const result = evaluateBudget(REACT_BUDGET_WARN_TOKENS + 1, baseState());
    expect(result.runState.budgetExceeded).toBe(true);
  });

  it("preserves planUpdateCount and consecutiveAssertionFailures across the budget transition", () => {
    const start = new ReactRunState({
      planUpdateCount: 3,
      consecutiveAssertionFailures: { "step-01": 1 },
      lastTurnTag: "ACTION",
      budgetExceeded: false,
    });
    const result = evaluateBudget(REACT_BUDGET_WARN_TOKENS, start);
    expect(result.runState.planUpdateCount).toBe(3);
    expect(result.runState.consecutiveAssertionFailures).toEqual({ "step-01": 1 });
    expect(result.runState.lastTurnTag).toBe("ACTION");
    expect(result.runState.budgetExceeded).toBe(true);
  });
});
