# Review: Post-Compact 2 — Frontier planner decode fix (Round 2)

## Verdict: APPROVE

All 7 round-1 findings are resolved. The lazy-memoized `Effect.cached(loadModel)` pattern correctly decouples layer build from key presence, the sibling regression tests lock in the CLI-level behavior that the round-1 test missed, and the anti-overfit cleanup is thorough — only the Volvo references I expect to see (pre-existing Wave 1.B trace replay in `executor-adherence-gate.test.ts`, plus the round-1 bug-report section of the diary that legitimately names the user's crash prompt) remain in `packages/supervisor/`. One new MINOR-3 noted below — not blocking.

## Verification executed

| Command | Outcome |
|---|---|
| `git status && git diff --stat` | Scope matches round-2 claims exactly: 7 modified files, `scripts/` directory gone, `verify-volvo-plan.ts` deleted, no stray edits. ✅ |
| `env -u GOOGLE_GENERATIVE_AI_API_KEY pnpm --filter @neuve/supervisor typecheck` | clean (exit 0) ✅ |
| `env -u GOOGLE_GENERATIVE_AI_API_KEY pnpm --filter @neuve/supervisor test` (run 1) | 95 passed / 95 in 12 files ✅ |
| `env -u GOOGLE_GENERATIVE_AI_API_KEY pnpm --filter @neuve/supervisor test` (run 2) | 95 passed / 95 in 12 files ✅ |
| `env -u GOOGLE_GENERATIVE_AI_API_KEY pnpm --filter @neuve/evals test` (run 1) | 120 passed / 120 in 12 files ✅ |
| `env -u GOOGLE_GENERATIVE_AI_API_KEY pnpm --filter @neuve/evals test` (run 2) | 120 passed / 120 in 12 files ✅ |
| `pnpm --filter @neuve/supervisor check` | fails on exactly the **7** pre-existing drift files enumerated in round 1 (no new additions, no additions removed). Engineer's claim verified. ✅ |
| `vp fmt --check` on engineer's 5 touched files | all pass ✅ |
| **Eager-layer probe re-run** (same 15-line script, dropped in `packages/supervisor/` then deleted): resolve `PlanDecomposer.layer` under empty `ConfigProvider` | `[OK] PlanDecomposer resolved without API key` ✅ — CRITICAL-1 resolved |
| Grep `volvo\|ex90\|volvocars` in `packages/supervisor/` | hits only `executor-adherence-gate.test.ts` (pre-existing Wave 1.B, out-of-scope per lead) + one inline comment in `plan-decomposer.test.ts:15` explaining why fixtures were *changed* (metadata, not test content) ✅ |
| Grep `catchAll \| mapError \| Effect.Service \| Context.Tag` in `plan-decomposer.ts`, `errors.ts` | zero hits ✅ |
| Grep `createGoogleGenerativeAI` in `packages/supervisor/tests/` | zero — no live Gemini in CI ✅ |
| Check `Schema.isStartsWith` and `Cause.hasDies` are real Effect exports | Confirmed at `effect@4.0.0-beta.35/dist/Schema.d.ts:3755` and `Cause.d.ts:899` ✅ |

## Round-1 findings: disposition

### [CRITICAL-1] → RESOLVED

`plan-decomposer.ts:267-306` restructures `PlannerAgent.make` around `Effect.cached(loadModel)`:

- `loadModel` (lines 268-300) is a self-contained Effect that does the `Config.option(Config.redacted(...))` read and returns `PlannerConfigError` via `yield*` if the key is absent or empty.
- `yield* Effect.cached(loadModel)` at line 304 returns an `Effect<LanguageModel, PlannerConfigError>` that memoizes both success and failure on first evaluation.
- `PlannerAgent.make` now always succeeds at layer build; `getModel` (the cached effect) is stored, not forced.
- `planFrontier` (lines 211-236) yields `getModel` on entry — this is where the key check actually fires, lazily on the first frontier call.
- `PlanDecomposer.decomposeFrontier` (lines 326-343) now catches both `PlannerCallError` **and** `PlannerConfigError`, wrapping both into `DecomposeError` so Executor's error signature is unchanged.

Re-running my round-1 probe (`Effect.runPromise(Effect.provide(PlanDecomposer.layer, emptyConfigProviderLayer))`) now prints `[OK] PlanDecomposer resolved without API key`. Round-1 reproduction reversed.

### [MAJOR-1] → RESOLVED

`plan-decomposer.test.ts:353-422` adds the `PlanDecomposer no-API-key path (CRITICAL-1 regression)` describe block with three sibling tests:

1. **#10 template mode resolves** (lines 366-375): `yield* PlanDecomposer; decompose("...", "template", ...)` under empty `ConfigProvider`, asserts ≥1 step returned — proves layer builds and template path works without key.
2. **#11 mode=none dies-by-design** (lines 377-395): same layer, `mode=none`, asserts `Cause.hasDies` is true — confirms the layer built successfully (no `PlannerConfigError` at build) and the failure is the deliberate `Effect.die` from `decompose(mode=none)`, not a config failure.
3. **#12 frontier mode surfaces typed DecomposeError** (lines 397-415): asserts `failure.value._tag === "DecomposeError"` AND `failure.value.cause` contains both `"GOOGLE_GENERATIVE_AI_API_KEY"` and `"--planner template"` — locks in the actionable error message contract.

This is exactly the "test the CLI's wired layer under empty config" pattern I asked for. Would have caught round-1's CRITICAL-1 on the first run.

### [MAJOR-2] → RESOLVED

- `packages/supervisor/scripts/verify-volvo-plan.ts` — gone (`ls packages/supervisor/scripts` returns `No such file or directory`).
- `packages/supervisor/scripts/` directory — gone (was empty after deletion).
- `dotenv` devDep — gone from `package.json` and lockfile (spot-checked the diff).
- No cross-package dotenv read remains anywhere in `packages/supervisor/`.

### [MAJOR-3] → RESOLVED

- `VOLVO_PROMPT` → 3 neutral prompts: `CATALOG_CHECKOUT_PROMPT`, `DOCS_SEARCH_PROMPT`, `FORM_WIZARD_PROMPT`, all on `example.com` (lines 20-25). Different tests use different prompts, so a single-site UX change cannot rot the whole suite.
- `volvoPlan` → `catalogCheckoutPlan` (lines 92-127) with fully neutral titles (`Open landing page`, `Open catalog menu`, `Choose a featured item`, `Add to cart`, `Proceed to checkout`, `Capture web vitals`).
- **Apr-24 preamble regression (#8, lines 288-322)** — retained, content neutralized: `"Reached the following plan for the user's request:\n\n" + JSON.stringify(steps)`. This still reproduces the **original bug mode** — the raw string has "Reached" as an unquoted identifier at column 0, which is what made the pre-fix `JSON.parse` throw `Unexpected identifier "Reached"`. The failure shape (JSON-preamble-parse) is preserved; only the Volvo/EX90 nouns are dropped. Correct call.
- **"Reached prose" regression (#5, wait — that's the fence test at line 195; #8 is the real regression at line 230)** — `reachedPreambleResponse` at line 231 is Case-1 pure-prose from the diary ("Reached the conclusion that the user wants to perform a multi-step browser journey. Here is the plan:\n- Step 1: Navigate\n- Step 2: Open menu"). No braces anywhere, `generateObject`'s parser fails, `PlannerCallError` → `DecomposeError`. Original failure shape preserved.
- **`splitByConnectives`** (lines 424-438) — rewritten: test #14 now exercises the connective-splitting *semantics* directly ("open example.com, then click the login button and then fill the form. Next, submit the form" — covers `, then`, `and then`, sentence-boundary) with an assertion on ≥3 clauses, not piggy-backing on a specific site prompt that happens to contain connectives.

### [MAJOR-4] → RESOLVED

Diary changes (`docs/handover/harness-evals/diary/post-compact-2-planner-decode-fix.md`):

- The round-1 "Re-verification against the exact failing prompt" section with the Volvo 7-row acceptance table — **removed**. Verified by grepping "Decoded plan:" and "PASS" tokens in the file — zero hits.
- New `### Configuration surface` table at line 107-112 documenting both `GOOGLE_GENERATIVE_AI_API_KEY` and `PERF_AGENT_PLANNER_MODEL`, covering default, role, validation.
- New `### Deleted in Round 2` subsection (line 194-196) records the file removal.
- New `## Round 2 patches` section (lines 203-254) walks through each round-1 finding's resolution.
- New `## Anti-overfit note` section (line 256-258) calls out the "bug report vs acceptance test" distinction explicitly.
- Crash-reproduction section (lines 15-58) — retained as the *bug report*, which is the correct use of the user's prompt.

### [MINOR-1] → RESOLVED

`plan-decomposer.ts:204-205` introduces `PlannerModelIdSchema = Schema.String.check(Schema.isStartsWith("gemini-"))` and `decodePlannerModelId = Schema.decodeUnknownEffect(PlannerModelIdSchema)`. Line 285-291 runs the decoded id with `Effect.catchTag("SchemaError", …)` wrapping the failure into `PlannerConfigError` with a message that cites the required prefix. Verified `Schema.isStartsWith` is a real Effect export (`effect@4.0.0-beta.35/dist/Schema.d.ts:3755`). Naming rationale and documentation landed in the Configuration surface table. Rejecting `Schema.Literals` for maintenance burden is a reasonable call.

Caveat acknowledged: prefix-only validation means `gemini-3-flas-preview` typos still pass — documented in the diary (line 244). Pragmatic tradeoff.

### [MINOR-2] → RESOLVED (as tolerance)

Diary line 248-250 accepts the `zod-to-json-schema@3.25.1(zod@3.25.76)` transitive drift with a monitoring-note rationale. No schema-boundary failures observed in the supervisor or evals test suites after round 2. Option C from round 1 — acknowledged, not blocking.

### [SUGGESTION] → DEFERRED (acceptable)

Diary line 252-254 defers the bootup key-detection + default-to-template switch to a separate `/debug-agent` follow-up task. Appropriate — that change touches UI atoms and belongs to a dedicated UX pass, not this correctness fix.

## New finding

### [MINOR-3] Diary TL;DR still references the deleted Volvo re-verification

**File:** `docs/handover/harness-evals/diary/post-compact-2-planner-decode-fix.md:13`.

The TL;DR closing line reads:

> Re-verified end-to-end against the exact failing prompt using real `gemini-3-flash-preview`: 7 well-formed steps produced.

The detailed section that sourced this claim was deleted in round 2 per MAJOR-4, but the summary sentence referencing it was missed. It is the *only* remaining Volvo-prompt-as-acceptance-evidence trace in the diary. Either:

1. Delete the sentence; the `## Round 2 patches` section + the 95/95 test result already serve as acceptance, or
2. Replace with "Regression coverage is owned by the MockLanguageModelV4 tests (#8 preamble, #5 fenced, #9 trailing, #10–#12 no-key CLI regression) plus the Wave 4.5 eval suite baseline."

Not blocking — the substance of the anti-overfit cleanup is intact.

## Sibling-code spot checks

- **`Effect.cached` behavior**: memoizes both success and failure; if first call fails (no key), subsequent `planFrontier` calls replay the same `PlannerConfigError`. Correct for a single CLI session. A user who sets the env var mid-session and presses "r to retry" in the TUI would still hit the cached error — but this is independent of the cache: `Config.redacted` reads `process.env` which doesn't update if the user edits the outer shell. Session restart required. Worth nothing as a UX note, *not* a regression — pre-fix behavior was identical.
- **Error discipline**: both catches at `decomposeFrontier` (lines 330-335) are `Effect.catchTag("SpecificError", …)`. No `catchAll`, no `mapError`. ✅
- **Cache scoping**: `getModel` is scoped to the service instance, so if a test creates a new `PlannerAgent.layer` it gets a fresh cache. Tests don't accidentally leak a failed cache across independent runs. ✅
- **`Schema.decodeUnknownEffect` vs `Schema.decode`**: the engineer uses `decodeUnknownEffect` — appropriate since the input is a `string` coming from Config, which is `unknown`-typed at the decoder boundary even though we know at runtime it's a string. Correct choice.
- **Dependency surface**: lockfile diff is 5 lines smaller than round 1 (no `dotenv` block); still adds `@ai-sdk/google`, `ai`, `zod` at supervisor importer; same transitive `zod-to-json-schema` drift as documented in MINOR-2.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| Major | 0 |
| Minor | 1 (new MINOR-3 — stale TL;DR sentence) |
| Suggestion | 0 |

All 7 round-1 findings resolved. No new blocking findings. Verdict: **APPROVE**. MINOR-3 is a one-line polish the engineer can address at commit time or leave as a known-diary-clean-up; it does not gate merge.
