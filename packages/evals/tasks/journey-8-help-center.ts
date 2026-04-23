import { EvalTask, KeyNode } from "../src/task";

export const journey8HelpCenter = new EvalTask({
  id: "journey-8-help-center",
  prompt:
    "On the Stripe documentation site, starting from the docs landing page, navigate into a specific product topic, open an article covering API usage, and scroll until an inline code example is visible.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://(docs\\.stripe\\.com|stripe\\.com/docs)/?",
      domAssertion: "nav, aside",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://(docs\\.stripe\\.com|stripe\\.com/docs)/[a-z0-9/-]+",
      domAssertion: "main h1, article h1",
    }),
    new KeyNode({
      urlPattern: "^https://(docs\\.stripe\\.com|stripe\\.com/docs)/[a-z0-9/-]+",
      domAssertion: "article, main",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://(docs\\.stripe\\.com|stripe\\.com/docs)/[a-z0-9/-]+",
      domAssertion: "pre code, [data-testid*='code']",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://(docs\\.stripe\\.com|stripe\\.com/docs)/[a-z0-9/-]+",
    domAssertion: "code",
  },
});
