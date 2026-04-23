import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const journey2EcomCheckout = new EvalTask({
  id: "journey-2-ecom-checkout",
  prompt:
    "On target.com, browse from the homepage into a product category, open a product detail page, add the item to the cart, view the cart, and begin the checkout process. Capture web vitals for each significant page.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.target\\.com/?$",
      domAssertion: "header[role='banner']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.target\\.com/c/",
      domAssertion: "h1",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.target\\.com/p/",
      domAssertion: "button[data-test*='addToCart' i], button:has-text('Add to cart')",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.target\\.com/cart/?",
      domAssertion: "main h1, [data-test='cart']",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.target\\.com/(co-cart|checkout)",
      domAssertion: "form, [data-test*='checkout' i]",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.target\\.com/(co-cart|checkout)",
    domAssertion: "checkout",
  },
  perfBudget: new PerfBudget({
    lcpMs: 2500,
    clsScore: 0.1,
    inpMs: 200,
  }),
});
