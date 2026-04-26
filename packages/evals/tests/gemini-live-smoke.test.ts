import * as path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Effect } from "effect";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { assert, describe, it } from "vite-plus/test";
import { Thought, parseAgentTurn } from "@neuve/shared/react-envelope";
import { AGENT_TURN_RESPONSE_SCHEMA } from "../src/runners/gemini-react-loop";
import { GEMINI_REACT_DEFAULT_MODEL_ID } from "../src/runners/gemini-react-constants";

// Load `.env.local` *before* the test reads `process.env`. Mirrors
// `online-mind2web.eval.ts` and `wave-r5-ab.eval.ts`. Path is relative to
// this module so `pnpm --filter @neuve/evals test` picks up the
// package-local env regardless of cwd.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(moduleDir, "..", ".env.local"), quiet: true });

// Regression guard for the R5 strike documented in
// `feedback_no_test_only_injection_seams.md`. The wave-r5 ReAct migration
// shipped with `AGENT_TURN_RESPONSE_SCHEMA` emitting `$ref`/`$defs` —
// `MockLanguageModelV4` accepted it, but Google's responseSchema is an
// OpenAPI 3.0 subset that rejects `$ref`, so every live gemini-react eval
// failed in <2s with "No object generated". This test exercises the exact
// schema constant the production loop ships and asserts a single live
// envelope round-trips through Gemini → AI SDK → `parseAgentTurn`.
//
// Skips gracefully when `GOOGLE_GENERATIVE_AI_API_KEY` is absent so
// engineers without the key still get green CI; credentialed sweeps
// fail-fast on schema regressions.

const apiKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
const apiKeyPresent = typeof apiKey === "string" && apiKey.trim().length > 0;

describe("gemini-react live smoke", () => {
  it.skipIf(!apiKeyPresent)(
    "emits a valid AgentTurn envelope from gemini-3-flash-preview",
    { timeout: 35_000 },
    () =>
      Effect.gen(function* () {
        const provider = createGoogleGenerativeAI({ apiKey });
        const model = provider(GEMINI_REACT_DEFAULT_MODEL_ID);

        const start = Date.now();
        const result = yield* Effect.tryPromise({
          try: () =>
            generateObject({
              model,
              schema: AGENT_TURN_RESPONSE_SCHEMA,
              schemaName: "AgentTurn",
              schemaDescription:
                "One ReAct envelope: THOUGHT, ACTION, PLAN_UPDATE, STEP_DONE, ASSERTION_FAILED, or RUN_COMPLETED.",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a ReAct agent. Emit exactly one AgentTurn JSON envelope per turn.",
                },
                {
                  role: "user",
                  content:
                    "Navigate to https://wikipedia.org. Emit a THOUGHT envelope first.",
                },
              ],
            }),
          catch: (cause) =>
            new Error(
              `gemini-3-flash-preview live call failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
        }).pipe(Effect.timeout("30 seconds"));
        const elapsedMs = Date.now() - start;

        const envelope = yield* parseAgentTurn(result.object);

        assert.instanceOf(
          envelope,
          Thought,
          `expected THOUGHT envelope from prompt that requests one; got ${envelope._tag}`,
        );
        assert.isBelow(
          elapsedMs,
          30_000,
          `live call should finish under 30s; took ${elapsedMs}ms`,
        );
      }).pipe(Effect.runPromise),
  );
});
