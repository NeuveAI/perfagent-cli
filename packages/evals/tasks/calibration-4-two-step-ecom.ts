import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const calibration4TwoStepEcom = new EvalTask({
  id: "calibration-4-two-step-ecom",
  prompt: "Go to rei.com and open one of the product category pages advertised on the homepage.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.rei\\.com/?$",
      domAssertion: "a[href*='/c/']",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.rei\\.com/c/[a-z0-9-]+/?",
      domAssertion: "h1",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.rei\\.com/c/[a-z0-9-]+/?",
    domAssertion: "REI",
  },
  perfBudget: new PerfBudget({
    lcpMs: 3000,
    clsScore: 0.1,
  }),
});
