import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const journey10MarketplaceFilter = new EvalTask({
  id: "journey-10-marketplace-filter",
  prompt:
    "On etsy.com, search for handmade ceramics, refine the results by applying at least two available filters (for example a price range and a shipping option), open one of the remaining listings, and continue until the seller's shop page is visible.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.etsy\\.com/?$",
      domAssertion: "input[name='search_query'], input[type='search']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.etsy\\.com/search",
      domAssertion: "[data-listing-id], ol[role='list']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.etsy\\.com/search",
      domAssertion: "[aria-label*='filter' i], button:has-text('Filter')",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.etsy\\.com/search",
      domAssertion: "[data-listing-id], [data-palette-listing-id]",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.etsy\\.com/listing/",
      domAssertion: "h1",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.etsy\\.com/shop/",
      domAssertion: "h1, [data-shop-id]",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.etsy\\.com/shop/",
    domAssertion: "shop",
  },
  perfBudget: new PerfBudget({
    lcpMs: 2500,
    clsScore: 0.1,
    inpMs: 200,
  }),
});
