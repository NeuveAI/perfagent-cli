# Review: R5b-T1 — dotenv + schema flatten + non-mock smoke probe

## Verdict: APPROVE

### Findings

- [INFO] No CRITICAL or MAJOR issues. All nine adversarial scenarios verified independently.

#### Verification log (executed by reviewer, not trusted from diary)

1. **Typecheck (`pnpm exec tsgo --noEmit -p packages/evals/tsconfig.json`):** zero errors, exit 0.
2. **Live smoke probe (`pnpm --filter @neuve/evals test gemini-live-smoke`):** 1/1 passed, 1.73s wall, hits live `gemini-3-flash-preview`, asserts `Thought` instance.
3. **No-key skip (`env GOOGLE_GENERATIVE_AI_API_KEY="" pnpm --filter @neuve/evals test gemini-live-smoke`):** 1/1 SKIPPED in 213ms, no failure — engineers without the key still get green CI as required.
4. **Schema-flatten correctness (probe `/tmp/probe-flatten-review.mjs` over the actual `inlineJsonSchemaRefs` walker against `Schema.toJsonSchemaDocument(AgentTurn)`):**
   - `$defs` stripped from output ✓ (verified `grep '\$defs|\$ref'` on flattened JSON returns zero matches).
   - `additionalProperties: false`, `required`, `enum`, `type` all preserved on each leaf branch ✓.
   - Nested `$ref` (def → ref → def) inlines correctly ✓ (synthetic probe with `Outer.inner → Inner` returns fully resolved leaf).
5. **Cross-check coverage (`grep -rn "Schema.toJsonSchemaDocument" packages/`):** exactly two call sites — `gemini-react-loop.ts` (Google) and `local-agent/tool-loop.ts` (Ollama, tolerates `$ref`). The other Google-bound `generateObject` callers (`plan-decomposer.ts`, `llm-judge.ts`) use Zod, not Effect Schema, so the `$ref` regression cannot reach them. Engineer's "one Google-bound call site" claim verified.
6. **Smoke test integrity:** zero `MockLanguageModel*` imports; imports the production `AGENT_TURN_RESPONSE_SCHEMA` constant directly; `Effect.timeout("30 seconds")` plus vitest `{ timeout: 35_000 }`; asserts `assert.instanceOf(envelope, Thought)` plus elapsed-time bound. Regression guard hits the production code path.
7. **`Effect.tapError` placement (`gemini-react-loop.ts:269-278`):** correctly attached after `Effect.tryPromise` so logs fire on the failure channel before propagating; payload includes `sessionId`, `round`, `modelId`, `cause`. Re-fail semantics intact.
8. **Effect-TS rules:**
   - No `catchAll`/`mapError`; the only `null` match is a legitimate `value !== null` runtime guard at `gemini-react-loop.ts:112` (pre-existing).
   - `Effect.fn("GeminiReactLoop.run")` retained on the public entry; `GeminiReactCallError` is `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`.
   - No new explicit return-type annotations; no new `try`/`catch` blocks.
   - Single `as JSONSchema7` cast at `gemini-react-loop.ts:98` is the documented spec-bridge between `draft-2020-12` (Effect) and `JSONSchema7` (AI SDK) — engineer collapsed the prior double-cast IIFE to a single cast.
9. **Repo hygiene:** `git status --short` shows exactly the expected diff (modifications to `wave-r5-ab.eval.ts` + `gemini-react-loop.ts`, untracked `gemini-live-smoke.test.ts` + `r5b-2026-04-26.md`, plus the 10 pre-existing Q9 probe artifacts). No stray `probe-*.ts`/`probe-*.mjs` in `packages/evals/` or repo root. The 20 valid `gemma-react__*.ndjson` traces under `packages/evals/evals/traces/wave-r5-ab/` are intact (`ls | grep gemma-react | wc -l` = 20). Full evals suite: 17 files / 172 tests / all pass / 2.06s.

#### Pre-existing lint claim verified
`pnpm --filter @neuve/evals lint` fails with `Failed to load config: vite.config.mjs … defineConfig() from "oxlint"`. Same failure on `pnpm --filter @neuve/shared lint`. Error is in `oxlint@1.55.0`'s JS config loader, not in T1's diff. Not a regression introduced by this work.

### Suggestions (non-blocking)

- `gemini-react-loop.ts:74-93` — `inlineJsonSchemaRefs` will stack-overflow on a self-referential `$defs` entry (verified: a synthetic `Tree → items: $ref Tree` definition crashes with "Maximum call stack size exceeded"). Current AgentTurn has no recursive types so this is latent, not active. Worth adding a `seenRefs` guard the next time someone touches this walker — or migrating to Effect's own ref-flattener if/when one ships.
- Same walker silently substitutes `undefined` (and JSON-stringifies to a missing key) when `definitions[refName]` is absent. Effect's `Schema.toJsonSchemaDocument` always emits matching `$defs`, so this is unreachable in practice — but a defensive `throw new Error("missing definition: " + refName)` would surface a typo or schema-bug loudly instead of producing an under-specified schema Google would reject with a less actionable message.
- `gemini-live-smoke.test.ts:89` — `void AgentTurn;` reads as a leftover. The `AgentTurn` import isn't used elsewhere in the test (the schema constant `AGENT_TURN_RESPONSE_SCHEMA` is what the test exercises). Either drop the import or document why the side-effect import is required.
- The `as JSONSchema7` cast at `gemini-react-loop.ts:98` lost its rationale comment when the IIFE was rewritten. The `inlineJsonSchemaRefs` block above documents the `$ref`/`$defs` problem, but a one-line reminder that the cast bridges Effect's `draft-2020-12` output to AI SDK's `draft-07` parameter type would save the next reader a `git blame`.

---

**Reviewer attestation:** Ran `pnpm exec tsgo --noEmit -p packages/evals/tsconfig.json`, `pnpm --filter @neuve/evals test gemini-live-smoke` (with key + with empty key), `pnpm --filter @neuve/evals test` (full suite), `pnpm --filter @neuve/evals lint`, `pnpm --filter @neuve/shared lint`, and inspected ALL nine adversarial scenarios per the seed checklist. No Critical, no Major. APPROVE.
