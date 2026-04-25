// R2-T1 verification probe: send a >5K-token prompt through the new
// `OllamaClient.chat` (native /api/chat + num_ctx=131072 + stream:true)
// and assert `prompt_eval_count` exceeds 4096. This mirrors Probe D
// variant 3 from `docs/handover/q9-tool-call-gap/probes/probe-d-context-truncation.mjs`
// against the new client API.
//
// Run: node docs/handover/react-migration/probes/r2-t1-num-ctx.mjs

import { Effect } from "effect";
import { createOllamaClient } from "../../../../packages/local-agent/src/ollama-client.ts";

const PROMPT_PARAGRAPH =
  "The browser performance trace recorded by Chrome DevTools is a JSON " +
  "document describing every event the renderer process emitted across " +
  "the navigation. Each event carries a phase, a category, a timestamp, " +
  "and an optional argument bag. The aggregator walks the trace, groups " +
  "events into insights such as LCPBreakdown and CLSCulprits, and emits " +
  "Core Web Vitals plus per-insight metadata. ";

const PADDING_LINES = 200; // ~5500 tokens of repeated paragraph
const padding = Array.from({ length: PADDING_LINES }, () => PROMPT_PARAGRAPH).join("\n");

const probe = Effect.gen(function* () {
  const client = createOllamaClient();
  console.log(`[probe] model=${client.model} baseUrl=${client.baseUrl}`);

  const result = yield* client.chat({
    messages: [
      { role: "system", content: "You are a performance analysis agent." },
      {
        role: "user",
        content:
          padding +
          "\n\nIn one sentence, summarize the role of LCPBreakdown in this analysis.",
      },
    ],
  });

  const promptEvalCount = result.usage?.promptEvalCount ?? 0;
  console.log(`[probe] promptEvalCount=${promptEvalCount}`);
  console.log(`[probe] evalCount=${result.usage?.evalCount ?? 0}`);
  console.log(`[probe] doneReason=${result.doneReason ?? "(none)"}`);
  console.log(`[probe] contentLength=${result.content.length}`);

  if (promptEvalCount <= 4096) {
    throw new Error(
      `FAIL: promptEvalCount=${promptEvalCount} did not exceed 4096; num_ctx fix not honoured`,
    );
  }
  console.log("[probe] PASS — num_ctx fix observed end-to-end");
});

Effect.runPromise(probe).catch((cause) => {
  console.error(cause);
  process.exit(1);
});
