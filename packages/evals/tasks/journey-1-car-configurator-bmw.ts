import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const journey1CarConfiguratorBmw = new EvalTask({
  id: "journey-1-car-configurator-bmw",
  prompt:
    "Visit bmw.com, configure a new BMW by picking any available model, choosing a trim, then selecting an interior and an exterior option, and proceed until the configurator summary screen is reached. Report web vitals along the way.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.bmw\\.com/[a-z-]+/?$",
      domAssertion: "main",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.bmw\\.com/[a-z-]+/[a-z/-]*(build|configure|models)",
      domAssertion: "a[href*='build'], a[href*='configure']",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.bmw\\.com/[a-z-]+/[a-z/-]*configurator",
      domAssertion: "[aria-label*='trim' i], [aria-label*='model line' i], button:has-text('Trim')",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.bmw\\.com/[a-z-]+/[a-z/-]*configurator",
      domAssertion:
        "[data-section='interior'], [aria-controls*='interior' i], h2:has-text('Interior')",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.bmw\\.com/[a-z-]+/[a-z/-]*configurator",
      domAssertion:
        "[data-section='exterior'], [aria-controls*='exterior' i], h2:has-text('Exterior')",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.bmw\\.com/[a-z-]+/[a-z/-]*(summary|your-configuration)",
      domAssertion: "h1, [data-testid*='summary']",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.bmw\\.com/[a-z-]+/[a-z/-]*(summary|your-configuration)",
    domAssertion: "summary",
  },
  perfBudget: new PerfBudget({
    lcpMs: 3000,
    clsScore: 0.1,
    inpMs: 200,
  }),
});
