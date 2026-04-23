import type { KeyNode } from "../task";

export const keyNodeMatches = (reached: KeyNode, expected: KeyNode): boolean => {
  if (reached.domAssertion !== expected.domAssertion) return false;
  if (reached.urlPattern === expected.urlPattern) return true;
  const urlRegex = new RegExp(expected.urlPattern);
  return urlRegex.test(reached.urlPattern);
};
