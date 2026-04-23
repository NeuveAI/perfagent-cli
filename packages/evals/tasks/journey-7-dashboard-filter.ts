import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const journey7DashboardFilter = new EvalTask({
  id: "journey-7-dashboard-filter",
  prompt:
    "Go to the Our World in Data COVID-19 explorer, narrow the displayed data by changing the time range to a more recent window and restricting it to a specific country or region, and surface the resulting chart or data view.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://ourworldindata\\.org/(coronavirus|covid)",
      domAssertion: "main, article",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://ourworldindata\\.org/(grapher|explorers)/",
      domAssertion: "input[type='range'], [aria-label*='time' i], [aria-label*='year' i]",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://ourworldindata\\.org/(grapher|explorers)/",
      domAssertion: "input[type='search'], [aria-label*='country' i], [aria-label*='entity' i]",
    }),
    new KeyNode({
      urlPattern: "^https://ourworldindata\\.org/(grapher|explorers)/",
      domAssertion: "svg, canvas",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://ourworldindata\\.org/(grapher|explorers)/",
    domAssertion: "chart",
  },
  perfBudget: new PerfBudget({
    lcpMs: 3000,
    clsScore: 0.1,
  }),
});
