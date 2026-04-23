import { EvalTask, KeyNode } from "../src/task";

export const moderate2 = new EvalTask({
  id: "moderate-2-mdn-web-api-detail",
  prompt:
    "From developer.mozilla.org open the References > Web APIs section and load the Fetch API page.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://developer\\.mozilla\\.org/en-US/?$",
      domAssertion: "a[href*='/docs/Web/API']",
    }),
    new KeyNode({
      urlPattern: "^https://developer\\.mozilla\\.org/en-US/docs/Web/API/?$",
      domAssertion: "a[href*='/docs/Web/API/Fetch_API']",
    }),
    new KeyNode({
      urlPattern: "^https://developer\\.mozilla\\.org/en-US/docs/Web/API/Fetch_API/?$",
      domAssertion: "h1:has-text('Fetch API')",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://developer\\.mozilla\\.org/en-US/docs/Web/API/Fetch_API/?$",
    domAssertion: "Fetch API",
  },
});
