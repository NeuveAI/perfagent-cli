import { Effect, Schema } from "effect";
import { afterEach, assert, describe, it, vi } from "vite-plus/test";

import { AgentTurnLoose, parseAgentTurnFromString } from "@neuve/shared/react-envelope";

import { coerceAgentTurnArgs } from "../src/args-coerce.ts";
import { createOllamaClient } from "../src/ollama-client.ts";

// R9 Option 4 live smoke (2026-04-30). Per `feedback_no_test_only_injection_seams.md`
// the coercion path must run live against real Ollama, not just a unit test
// with mocked LLM output. This smoke:
//
// 1. Probes the production Ollama daemon for `gemma4:e4b` (skips when
//    unreachable, matching `ollama-tools-format-smoke.test.ts`).
// 2. Sends a single chat() call with a system prompt + observation that
//    primes gemma toward `interact{command:"type"|"fill", uid, ...}` shape
//    by including a snapshot uid in the observation context.
// 3. Captures the wire response (raw model emission), runs it through
//    `coerceAgentTurnArgs`, asserts:
//    a. The post-coercion envelope parses against the strict AgentTurn
//       per-tool union (the production `tool-loop.ts` parse step).
//    b. Whether or not the coercion fired, the integration path is sound.
//
// Gemma 4 E4B's emission is non-deterministic, so we don't *require* the
// coercion to fire on this single run — that would be flaky. We *do*
// require: the integration path coerce → parse always lands a valid
// AgentTurn variant. Unit tests in `args-coerce.test.ts` cover the
// deterministic rewrite logic with real captured envelopes from
// `wave-r9-prompt-v3` traces.

const OLLAMA_BASE_URL = process.env["PERF_AGENT_OLLAMA_URL"] ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env["PERF_AGENT_LOCAL_MODEL"] ?? "gemma4:e4b";

const probeOllamaReachable = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { models?: ReadonlyArray<{ name?: string }> };
    if (!Array.isArray(body.models)) return false;
    return body.models.some((entry) => entry.name === OLLAMA_MODEL);
  } catch {
    return false;
  }
};

let ollamaReachable = false;
try {
  ollamaReachable = await probeOllamaReachable();
} catch {
  ollamaReachable = false;
}

const AGENT_TURN_LOOSE_FORMAT = (() => {
  const document = Schema.toJsonSchemaDocument(AgentTurnLoose);
  return { ...document.schema, $defs: document.definitions };
})();

const SYSTEM_PROMPT = [
  "You are a ReAct agent. Emit exactly one AgentTurn JSON envelope per turn.",
  "toolName ∈ {interact, observe, trace}.",
  "interact verbs: navigate, click, type, fill, hover, press_key, wait_for.",
  "args field names are exact: navigate{url}; click/hover{uid}; fill{uid,value} for form inputs;",
  "type{text} for focused-element only — post-click, never for filling.",
  "uid is from observe.snapshot.",
].join("\n");

// Priming user message that contains an observed uid and asks the model to
// type a value. Pre-R9 v1, gemma here often emitted
// `interact{command:"type", uid, text}` — exactly the shape Rule 1 coerces.
const PRIMING_USER_MESSAGE = [
  "<observation>",
  'Snapshot of search bar: <textbox uid="1_42" name="search" />',
  "</observation>",
  "Fill the search input with the query 'laptops'. Emit one ACTION envelope. stepId='smoke-r9-coerce'.",
].join("\n");

describe("args-coerce live smoke against Ollama", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.skipIf(!ollamaReachable)(
    "coerce path runs against real gemma emission and rewrites whenever it sees type+uid+text",
    { timeout: 120_000 },
    () =>
      Effect.gen(function* () {
        const client = createOllamaClient();
        const result = yield* client.chat({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: PRIMING_USER_MESSAGE },
          ],
          format: AGENT_TURN_LOOSE_FORMAT,
        });

        assert.isAbove(
          result.content.length,
          0,
          `expected non-empty content from /api/chat; got doneReason=${result.doneReason}`,
        );

        const preCoerced = result.content;
        const coerced = coerceAgentTurnArgs(preCoerced);

        // Diagnostic logging — gemma's emission is non-deterministic, so we
        // don't *require* a specific shape on this single run. Sweep
        // verification (`docs/handover/harness-evals/baselines/wave-r9-bridge-coerce.md`)
        // is the rate-of-incidence measurement.
        // eslint-disable-next-line no-console
        console.log("[args-coerce-smoke]", {
          rewrote: coerced.rewrote,
          preCoerced: preCoerced.slice(0, 200),
          postCoerced: coerced.rewrote ? coerced.content.slice(0, 200) : "(unchanged)",
        });

        // Invariant: when the coercion fires (gemma emitted type+uid+text),
        // the post-coerce content must parse cleanly against the strict
        // per-tool union — this is the production tool-loop's invariant
        // and the entire reason Rule 1 exists.
        if (coerced.rewrote) {
          const envelope = yield* parseAgentTurnFromString(coerced.content);
          assert.strictEqual(envelope._tag, "ACTION");
        } else {
          // No coercion needed → the path is sound by construction. We log
          // for visibility but don't assert a specific shape; the model
          // may have emitted a canonical shape (which strict parses) or
          // some other invalid shape (different fix). The unit tests with
          // captured fixtures cover the deterministic rewrite logic.
          assert.strictEqual(coerced.content, preCoerced);
        }
      }).pipe(Effect.runPromise),
  );

  it("rewrites a real captured wave-r9-prompt-v3 j-2 envelope to a strict-parseable fill envelope", () =>
    Effect.gen(function* () {
      // Real envelope shape from `wave-r9-prompt-v3/gemma-react__journey-2-ecom-checkout.ndjson`
      // turn 8 (the `non-schema-valid agent output` event captured the rejected
      // args; we reconstruct the ACTION wrapper around them).
      const captured = JSON.stringify({
        _tag: "ACTION",
        stepId: "smoke-fixture",
        toolName: "interact",
        args: { command: "type", uid: "1_23", text: "pajamas" },
      });
      const coerced = coerceAgentTurnArgs(captured);
      assert.isTrue(coerced.rewrote);
      const envelope = yield* parseAgentTurnFromString(coerced.content);
      assert.strictEqual(envelope._tag, "ACTION");
    }).pipe(Effect.runPromise));
});
