import { EvalTask, KeyNode } from "../src/task";

export const calibration3TwoStepDocs = new EvalTask({
  id: "calibration-3-two-step-docs",
  prompt:
    "Starting at the MDN Web Docs landing page, navigate to the JavaScript language documentation.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://developer\\.mozilla\\.org/(en-US/?)?$",
      domAssertion: "a[href*='/docs/Web/JavaScript']",
    }),
    new KeyNode({
      urlPattern: "^https://developer\\.mozilla\\.org/en-US/docs/Web/JavaScript/?$",
      domAssertion: "h1:has-text('JavaScript')",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://developer\\.mozilla\\.org/en-US/docs/Web/JavaScript/?$",
    domAssertion: "JavaScript",
  },
});
