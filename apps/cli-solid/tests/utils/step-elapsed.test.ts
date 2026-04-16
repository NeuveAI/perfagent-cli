import { describe, test, expect } from "bun:test";
import { DateTime, Option, Schema } from "effect";
import { getStepElapsedMs, getTotalElapsedMs } from "../../src/utils/step-elapsed";
import { AnalysisStep } from "@neuve/shared/models";

const makeStep = (overrides: {
  startedAt?: Date;
  endedAt?: Date;
}): AnalysisStep =>
  new AnalysisStep({
    id: Schema.decodeSync(Schema.String.pipe(Schema.brand("StepId")))("step-1"),
    title: "Test step",
    instruction: "Do something",
    expectedOutcome: "Something happens",
    routeHint: Option.none(),
    status: "passed",
    summary: Option.none(),
    startedAt: overrides.startedAt
      ? Option.some(DateTime.makeUnsafe(overrides.startedAt.toISOString()))
      : Option.none(),
    endedAt: overrides.endedAt
      ? Option.some(DateTime.makeUnsafe(overrides.endedAt.toISOString()))
      : Option.none(),
  });

describe("getStepElapsedMs", () => {
  test("returns undefined when startedAt is None", () => {
    const step = makeStep({});
    expect(getStepElapsedMs(step)).toBeUndefined();
  });

  test("returns undefined when endedAt is None", () => {
    const step = makeStep({ startedAt: new Date("2025-01-01T00:00:00Z") });
    expect(getStepElapsedMs(step)).toBeUndefined();
  });

  test("returns elapsed ms when both timestamps exist", () => {
    const step = makeStep({
      startedAt: new Date("2025-01-01T00:00:00.000Z"),
      endedAt: new Date("2025-01-01T00:00:05.000Z"),
    });
    expect(getStepElapsedMs(step)).toBe(5000);
  });

  test("returns 0 when start and end are the same", () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const step = makeStep({ startedAt: now, endedAt: now });
    expect(getStepElapsedMs(step)).toBe(0);
  });
});

describe("getTotalElapsedMs", () => {
  test("returns 0 for empty steps array", () => {
    expect(getTotalElapsedMs([])).toBe(0);
  });

  test("returns 0 when no steps have timestamps", () => {
    const steps = [makeStep({}), makeStep({})];
    expect(getTotalElapsedMs(steps)).toBe(0);
  });

  test("sums elapsed ms across steps", () => {
    const steps = [
      makeStep({
        startedAt: new Date("2025-01-01T00:00:00.000Z"),
        endedAt: new Date("2025-01-01T00:00:03.000Z"),
      }),
      makeStep({
        startedAt: new Date("2025-01-01T00:00:05.000Z"),
        endedAt: new Date("2025-01-01T00:00:07.000Z"),
      }),
    ];
    expect(getTotalElapsedMs(steps)).toBe(5000);
  });

  test("skips steps without timestamps", () => {
    const steps = [
      makeStep({
        startedAt: new Date("2025-01-01T00:00:00.000Z"),
        endedAt: new Date("2025-01-01T00:00:10.000Z"),
      }),
      makeStep({}),
    ];
    expect(getTotalElapsedMs(steps)).toBe(10000);
  });
});
