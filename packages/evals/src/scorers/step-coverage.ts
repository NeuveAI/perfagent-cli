import type { KeyNode } from "../task";
import { keyNodeMatches } from "./key-node-matches";

export const stepCoverage = (
  reached: ReadonlyArray<KeyNode>,
  expected: ReadonlyArray<KeyNode>,
): number => {
  if (expected.length === 0) return 1;
  const hitCount = expected.filter((expectedNode) =>
    reached.some((reachedNode) => keyNodeMatches(reachedNode, expectedNode)),
  ).length;
  return hitCount / expected.length;
};
