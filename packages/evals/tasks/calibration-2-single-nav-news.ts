import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const calibration2SingleNavNews = new EvalTask({
  id: "calibration-2-single-nav-news",
  prompt: "Visit the BBC News homepage and verify the top story is visible on the landing page.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.bbc\\.com/news/?$",
      domAssertion: "main[role='main'] h2",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.bbc\\.com/news/?$",
    domAssertion: "News",
  },
  perfBudget: new PerfBudget({
    lcpMs: 2500,
    clsScore: 0.1,
  }),
});
