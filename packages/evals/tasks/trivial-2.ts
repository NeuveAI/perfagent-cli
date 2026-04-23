import { EvalTask, KeyNode } from "../src/task";

export const trivial2 = new EvalTask({
  id: "trivial-2-wikipedia-main-page",
  prompt: "Navigate to wikipedia.org and confirm the main page loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.wikipedia\\.org/?$",
      domAssertion: "[aria-label='Wikipedia']",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.wikipedia\\.org/?$",
    domAssertion: "Wikipedia",
  },
});
