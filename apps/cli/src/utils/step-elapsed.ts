import { DateTime, Option } from "effect";
import type { AnalysisStep } from "@neuve/shared/models";

export const getStepElapsedMs = (step: AnalysisStep): number | undefined => {
  if (Option.isNone(step.startedAt) || Option.isNone(step.endedAt)) return undefined;
  return DateTime.toEpochMillis(step.endedAt.value) - DateTime.toEpochMillis(step.startedAt.value);
};

export const getTotalElapsedMs = (steps: readonly AnalysisStep[]): number => {
  let totalMs = 0;
  for (const step of steps) {
    const elapsed = getStepElapsedMs(step);
    if (elapsed !== undefined) totalMs += elapsed;
  }
  return totalMs;
};
