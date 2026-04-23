import { EvalTask, KeyNode } from "../src/task";

export const calibration5ThreeStepSearch = new EvalTask({
  id: "calibration-5-three-step-search",
  prompt:
    "Use DuckDuckGo to search for the term 'typescript', then open the first organic search result and confirm the destination page loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://duckduckgo\\.com/?$",
      domAssertion: "input[name='q']",
    }),
    new KeyNode({
      urlPattern: "^https://duckduckgo\\.com/(\\?q=typescript|.*[?&]q=typescript)",
      domAssertion: "[data-testid='result']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https?://(?!(?:www\\.)?duckduckgo\\.com)[^/]+/",
      domAssertion: "body",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https?://(?!(?:www\\.)?duckduckgo\\.com)[^/]+/",
    domAssertion: "typescript",
  },
});
