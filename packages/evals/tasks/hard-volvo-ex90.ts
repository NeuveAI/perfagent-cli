import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const hardVolvoEx90 = new EvalTask({
  id: "hard-volvo-ex90-configurator",
  prompt:
    "Go to volvocars.com, navigate to the build page under the 'Buy' > 'Build your Volvo' menu, " +
    "build a new EX90 in any spec, proceed all the way to the order request form, and report back " +
    "the web vitals for each key page along the way.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.volvocars\\.com/[a-z-]+/?$",
      domAssertion: "nav button:has-text('Buy')",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.volvocars\\.com/[a-z-]+/?$",
      domAssertion: "a:has-text('Build your Volvo')",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.volvocars\\.com/[a-z-]+/(build|shop)/?",
      domAssertion: "a[href*='ex90']:has-text('EX90')",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.volvocars\\.com/[a-z-]+/[a-z/-]*ex90/?",
      domAssertion: "a:has-text('Build')",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.volvocars\\.com/[a-z-]+/[a-z/-]*ex90/configurator",
      domAssertion: "[data-testid='configurator-continue']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.volvocars\\.com/[a-z-]+/[a-z/-]*order-request",
      domAssertion: "form[aria-label*='order']",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.volvocars\\.com/[a-z-]+/[a-z/-]*order-request",
    domAssertion: "order",
  },
  perfBudget: new PerfBudget({
    lcpMs: 3000,
    clsScore: 0.1,
    inpMs: 200,
  }),
});
