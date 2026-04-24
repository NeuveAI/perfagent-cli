import { assert, describe, it } from "vite-plus/test";
import { TokenUsageEntry } from "@neuve/shared/token-usage-bus";
import { ExecutedTrace } from "../src/task";

const plannerEntry = (promptTokens: number, completionTokens: number, timestamp: number) =>
  new TokenUsageEntry({
    source: "planner",
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    timestamp,
  });

const executorEntry = (promptTokens: number, completionTokens: number, timestamp: number) =>
  new TokenUsageEntry({
    source: "executor",
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    timestamp,
  });

const makeTrace = (tokenUsages: ReadonlyArray<TokenUsageEntry>): ExecutedTrace =>
  new ExecutedTrace({
    reachedKeyNodes: [],
    toolCalls: [],
    finalUrl: "",
    finalDom: "",
    tokenUsages,
  });

describe("ExecutedTrace.tokenomics", () => {
  it("returns all zeros for an empty tokenUsages array", () => {
    const trace = makeTrace([]);
    const tokenomics = trace.tokenomics;
    assert.strictEqual(tokenomics.totalPromptTokens, 0);
    assert.strictEqual(tokenomics.totalCompletionTokens, 0);
    assert.strictEqual(tokenomics.totalTokens, 0);
    assert.strictEqual(tokenomics.peakPromptTokens, 0);
    assert.strictEqual(tokenomics.turnCount, 0);
    assert.strictEqual(tokenomics.plannerTokens, 0);
    assert.strictEqual(tokenomics.executorTokens, 0);
  });

  it("sums totalTokens across all entries and computes prompt/completion splits", () => {
    const trace = makeTrace([
      plannerEntry(100, 50, 1),
      executorEntry(500, 120, 2),
      executorEntry(600, 80, 3),
    ]);
    const tokenomics = trace.tokenomics;

    // 100 + 500 + 600
    assert.strictEqual(tokenomics.totalPromptTokens, 1200);
    // 50 + 120 + 80
    assert.strictEqual(tokenomics.totalCompletionTokens, 250);
    // planner 150 + executor 620 + executor 680 (totalTokens per entry)
    assert.strictEqual(tokenomics.totalTokens, 150 + 620 + 680);
  });

  it("peakPromptTokens is the max of per-entry promptTokens (not the sum)", () => {
    const trace = makeTrace([
      plannerEntry(200, 100, 1),
      executorEntry(4096, 300, 2),
      executorEntry(3200, 250, 3),
      executorEntry(4500, 280, 4),
    ]);
    assert.strictEqual(trace.tokenomics.peakPromptTokens, 4500);
  });

  it("turnCount counts only executor entries, never planner entries", () => {
    const trace = makeTrace([
      plannerEntry(100, 50, 1),
      plannerEntry(150, 70, 2),
      executorEntry(400, 100, 3),
      executorEntry(500, 120, 4),
      executorEntry(600, 80, 5),
    ]);
    // Two planner + three executor entries → turnCount must be 3.
    assert.strictEqual(trace.tokenomics.turnCount, 3);
  });

  it("plannerTokens sums totalTokens over planner entries only", () => {
    const trace = makeTrace([
      plannerEntry(100, 50, 1), // total 150
      plannerEntry(200, 80, 2), // total 280
      executorEntry(400, 100, 3),
      executorEntry(500, 120, 4),
    ]);
    assert.strictEqual(trace.tokenomics.plannerTokens, 150 + 280);
  });

  it("executorTokens sums totalTokens over executor entries only", () => {
    const trace = makeTrace([
      plannerEntry(100, 50, 1),
      executorEntry(400, 100, 2), // total 500
      executorEntry(500, 120, 3), // total 620
      executorEntry(600, 80, 4), // total 680
    ]);
    assert.strictEqual(trace.tokenomics.executorTokens, 500 + 620 + 680);
  });

  it("plannerTokens + executorTokens equals totalTokens when every entry is planner or executor", () => {
    const trace = makeTrace([
      plannerEntry(100, 50, 1),
      plannerEntry(200, 80, 2),
      executorEntry(400, 100, 3),
      executorEntry(500, 120, 4),
      executorEntry(600, 80, 5),
    ]);
    const { plannerTokens, executorTokens, totalTokens } = trace.tokenomics;
    assert.strictEqual(plannerTokens + executorTokens, totalTokens);
  });

  it("handles a realistic baseline trajectory (1 planner + 1 executor, turnCount=1)", () => {
    // Mirrors the shape observed across all 60 baseline trajectories:
    // exactly one planner call (frontier Gemini) and one executor turn
    // (Gemma 4 E4B), then stream_ended. peakPromptTokens pins to 4096.
    const trace = makeTrace([
      plannerEntry(265, 581, 1_700_000_000_000),
      executorEntry(4096, 392, 1_700_000_022_000),
    ]);
    const tokenomics = trace.tokenomics;
    assert.strictEqual(tokenomics.totalPromptTokens, 4361);
    assert.strictEqual(tokenomics.totalCompletionTokens, 973);
    assert.strictEqual(tokenomics.totalTokens, 5334);
    assert.strictEqual(tokenomics.peakPromptTokens, 4096);
    assert.strictEqual(tokenomics.turnCount, 1);
    assert.strictEqual(tokenomics.plannerTokens, 846);
    assert.strictEqual(tokenomics.executorTokens, 4488);
  });

  it("does not depend on insertion order (planner-first vs interleaved produces same totals)", () => {
    const plannerFirst = makeTrace([
      plannerEntry(100, 50, 1),
      executorEntry(400, 100, 2),
      executorEntry(500, 120, 3),
    ]);
    const interleaved = makeTrace([
      executorEntry(400, 100, 2),
      plannerEntry(100, 50, 1),
      executorEntry(500, 120, 3),
    ]);
    // Aggregates must be order-invariant — the analysis script relies on
    // this to reorder by timestamp post-drain if needed.
    assert.strictEqual(plannerFirst.tokenomics.totalTokens, interleaved.tokenomics.totalTokens);
    assert.strictEqual(plannerFirst.tokenomics.plannerTokens, interleaved.tokenomics.plannerTokens);
    assert.strictEqual(
      plannerFirst.tokenomics.executorTokens,
      interleaved.tokenomics.executorTokens,
    );
    assert.strictEqual(plannerFirst.tokenomics.turnCount, interleaved.tokenomics.turnCount);
    assert.strictEqual(
      plannerFirst.tokenomics.peakPromptTokens,
      interleaved.tokenomics.peakPromptTokens,
    );
  });

  it("treats a zero-prompt entry as peakPromptTokens = 0 when it is the only entry", () => {
    const trace = makeTrace([plannerEntry(0, 0, 1)]);
    const tokenomics = trace.tokenomics;
    assert.strictEqual(tokenomics.peakPromptTokens, 0);
    assert.strictEqual(tokenomics.totalTokens, 0);
    assert.strictEqual(tokenomics.turnCount, 0);
  });
});
