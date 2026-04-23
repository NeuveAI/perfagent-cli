import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const journey9FormWizard = new EvalTask({
  id: "journey-9-form-wizard",
  prompt:
    "On the TurboTax marketing site, start the guided product selection wizard, answer the initial questions using plausible responses, and continue through at least three consecutive wizard steps until a recommendation or review screen is shown. Do not submit any payment information.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://turbotax\\.intuit\\.com/?$",
      domAssertion: "a[href*='product-selector'], a:has-text('Get started')",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://turbotax\\.intuit\\.com/[a-z0-9/-]*(product|personal|wizard)",
      domAssertion: "form, [role='radiogroup']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://turbotax\\.intuit\\.com/[a-z0-9/-]*(product|personal|wizard)",
      domAssertion: "[role='radiogroup'], fieldset",
    }),
    new KeyNode({
      urlPattern: "^https://turbotax\\.intuit\\.com/[a-z0-9/-]*(product|personal|wizard)",
      domAssertion: "button[type='submit'], button:has-text('Continue')",
    }),
    new KeyNode({
      urlPattern: "^https://turbotax\\.intuit\\.com/[a-z0-9/-]*(recommendation|review|summary)",
      domAssertion: "h1, h2",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://turbotax\\.intuit\\.com/[a-z0-9/-]*(recommendation|review|summary)",
    domAssertion: "recommendation",
  },
  perfBudget: new PerfBudget({
    lcpMs: 3000,
    clsScore: 0.1,
  }),
});
