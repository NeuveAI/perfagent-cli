import { EvalTask, KeyNode } from "../src/task";

export const journey6MediaStreaming = new EvalTask({
  id: "journey-6-media-streaming",
  prompt:
    "On archive.org's public moving-image library, open the video browse entry point, drill into a specific collection or sub-topic, open a single title's details page, and surface a related or alternate-format link from that title page. No login required.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://archive\\.org/details/(movies|tv)/?$",
      domAssertion: "main[role='main'], #maincontent",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://archive\\.org/details/[a-zA-Z0-9._-]+/?$",
      domAssertion: "a[href^='/details/']",
    }),
    new KeyNode({
      urlPattern: "^https://archive\\.org/details/[a-zA-Z0-9._-]+/?$",
      domAssertion: "h1, [itemprop='name']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://archive\\.org/details/[a-zA-Z0-9._-]+/?$",
      domAssertion: "[href*='/details/'][href*='format'], a[href*='/download/']",
    }),
    new KeyNode({
      urlPattern: "^https://archive\\.org/details/[a-zA-Z0-9._-]+/?$",
      domAssertion: "main[role='main'], #maincontent",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://archive\\.org/details/[a-zA-Z0-9._-]+/?$",
    domAssertion: "archive.org",
  },
});
