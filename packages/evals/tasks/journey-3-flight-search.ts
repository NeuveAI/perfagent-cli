import { EvalTask, KeyNode, PerfBudget } from "../src/task";

export const journey3FlightSearch = new EvalTask({
  id: "journey-3-flight-search",
  prompt:
    "Using Google Flights, search for a round-trip flight between two major cities of your choice, view the flight results, select an outbound option, and reach the passenger details step. Report web vitals at each major screen.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.google\\.com/travel/flights/?",
      domAssertion: "input[aria-label*='Where from' i], input[placeholder*='Where from' i]",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.google\\.com/travel/flights/search",
      domAssertion: "[role='list'] [role='listitem']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.google\\.com/travel/flights/(booking|search)",
      domAssertion: "[aria-label*='Return' i], [data-flt-ve*='return']",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.google\\.com/travel/flights/booking",
      domAssertion: "form, input[type='text']",
      perfCapture: "required",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.google\\.com/travel/flights/booking",
    domAssertion: "passenger",
  },
  perfBudget: new PerfBudget({
    lcpMs: 2500,
    inpMs: 200,
  }),
});
