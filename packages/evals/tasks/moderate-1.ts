import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const moderate1 = new EvalTask({
  id: "moderate-1-github-explore-topics",
  prompt: "From github.com navigate into the Explore section and open the Topics page.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://github\\.com/?$",
      domAssertion: "a[href='/explore']",
    }),
    new KeyNode({
      urlPattern: "^https://github\\.com/explore/?$",
      domAssertion: "a[href='/topics']",
    }),
    new KeyNode({
      urlPattern: "^https://github\\.com/topics/?$",
      domAssertion: "h1:has-text('Topics')",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://github\\.com/topics/?$",
    domAssertion: "Topics",
  },
  perfBudget: new PerfBudget({
    lcpMs: 2500,
  }),
});
