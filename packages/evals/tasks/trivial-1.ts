import { EvalTask, KeyNode } from "../src/task";

export const trivial1 = new EvalTask({
  id: "trivial-1-example-homepage",
  prompt: "Go to example.com and report the page title.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://example\\.com/?$",
      domAssertion: "h1:has-text('Example Domain')",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://example\\.com/?$",
    domAssertion: "Example Domain",
  },
});
