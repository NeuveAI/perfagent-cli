import type { KeyNode } from "../task";
import { keyNodeMatches } from "./key-node-matches";

const UNREACHED_INDEX = -1;

export const furthestKeyNode = (
  reached: ReadonlyArray<KeyNode>,
  expected: ReadonlyArray<KeyNode>,
): number => {
  let furthest = UNREACHED_INDEX;
  for (let index = 0; index < expected.length; index += 1) {
    const expectedNode = expected[index];
    if (expectedNode === undefined) continue;
    const wasReached = reached.some((reachedNode) => keyNodeMatches(reachedNode, expectedNode));
    if (wasReached) furthest = index;
  }
  return furthest;
};
