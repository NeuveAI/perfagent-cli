import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const journey5InsuranceQuote = new EvalTask({
  id: "journey-5-insurance-quote",
  prompt:
    "On progressive.com, start a new auto insurance quote, enter a valid ZIP code, answer any basic eligibility questions required to proceed, and continue through the flow until an initial coverage or results screen is reached. Report web vitals for each step.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.progressive\\.com/?$",
      domAssertion: "a[href*='quote'], button:has-text('Quote')",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://(www|autoinsurance1)\\.progressive\\.com/[a-z/-]*(quote|auto)",
      domAssertion: "input[name*='zip' i], input[placeholder*='ZIP' i]",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://(www|autoinsurance1)\\.progressive\\.com/[a-z/-]*(quote|auto)",
      domAssertion: "form",
    }),
    new KeyNode({
      urlPattern:
        "^https://(www|autoinsurance1)\\.progressive\\.com/[a-z/-]*(coverage|results|rates)",
      domAssertion: "h1, h2",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern:
      "^https://(www|autoinsurance1)\\.progressive\\.com/[a-z/-]*(coverage|results|rates)",
    domAssertion: "coverage",
  },
  perfBudget: new PerfBudget({
    lcpMs: 3000,
    clsScore: 0.1,
  }),
});
