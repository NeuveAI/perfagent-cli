import type { ExpectedFinalState } from "../task";

export const finalState = (
  finalUrl: string,
  finalDom: string,
  expected: ExpectedFinalState,
): boolean => {
  const urlMatches = finalUrl === expected.urlPattern || new RegExp(expected.urlPattern).test(finalUrl);
  if (!urlMatches) return false;
  return finalDom.includes(expected.domAssertion);
};
