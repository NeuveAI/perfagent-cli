# Review: Post-Compact 2 — Frontier planner decode fix (Round 1)

## Verdict: REQUEST_CHANGES

Strong rewrite of the frontier path with a correct root-cause analysis and a well-justified design choice (API-level structured output over ad-hoc regex munging). BUT two blocking concerns:

1. The new `PlannerAgent` layer is built eagerly from inside `PlanDecomposer.layer`, which now makes `GOOGLE_GENERATIVE_AI_API_KEY` a hard dependency for **every** CLI path — including `--planner template` and `--planner none`. The engineer's own error message advertises `--planner template` as the no-API-key escape hatch. That escape hatch is broken by this patch.
2. The test fixtures, the `scripts/verify-volvo-plan.ts` harness, and the diary's re-verification section are all scoped around the single Apr-24 Volvo-EX90 user prompt. That's prompt-overfitting per memory `feedback_avoid_prompt_overfitting.md`: "prompts teach reasoning frameworks, not site-specific nav heuristics." The project already ships a 20-task calibration/journey/moderate/hard eval suite (`packages/evals/tasks/`) for real coverage; one user-submitted crash prompt shouldn't drive test fixtures or a one-off verification script. Regression coverage should preserve the *failure shape* (JSON preamble, fenced JSON, trailing commentary) without anchoring on a specific brand or model.

One critical, four major, two minor, one suggestion.

## Verification executed

| Command | Outcome |
|---|---|
| `git status && git diff --stat` | Scope matches diary exactly: 7 modified files, 1 new script, 1 new diary. No stray edits. ✅ |
| `pnpm --filter @neuve/supervisor typecheck` | clean (exit 0) ✅ |
| `pnpm --filter @neuve/supervisor test` (run 1) | 93 passed / 93 in 12 files ✅ |
| `pnpm --filter @neuve/supervisor test` (run 2, determinism) | 93 passed / 93 in 12 files ✅ |
| `pnpm --filter @neuve/evals test` | 120 passed / 120 in 12 files ✅ |
| `pnpm --filter @neuve/supervisor check` | fails on **7** pre-existing drift files (executor.ts, report-storage.ts, reporter.ts, executor-adherence-gate.test.ts, insight-enricher.test.ts, report-storage.test.ts, legacy-report-task61.json). `git diff --name-only -- <those files>` returns empty — none touched by this patch. Engineer's claim verified. ✅ |
| `vp fmt --check` on engineer's 6 files | all pass ✅ |
| Grep for `extractJsonObject` / `stripMarkdownFence` | zero remaining references anywhere — cleanly removed ✅ |
| Grep for `catchAll` / `mapError` in `plan-decomposer.ts`, `errors.ts` | zero — Effect rules obeyed ✅ |
| Independent probe: resolve `PlanDecomposer.layer` under an empty `ConfigProvider` | **FAILS with `PlannerConfigError` at layer build, template mode never entered** ❌ (see CRITICAL-1) |

I wrote a 15-line probe at `packages/supervisor/scripts/probe-eager-planner.ts` that provides `PlanDecomposer.layer` with an empty `ConfigProvider` and runs `yield* PlanDecomposer`. It reproduced the eager failure on first try. The probe has been deleted — the engineer's tree is untouched.

## Findings

### [CRITICAL-1] `PlanDecomposer.layer` fails to build for `--planner template` / `--planner none` when `GOOGLE_GENERATIVE_AI_API_KEY` is unset

**Files:** `packages/supervisor/src/plan-decomposer.ts:283,356`; `packages/supervisor/src/errors.ts:37`.

**Problem.** `PlanDecomposer.make` unconditionally does `const plannerAgent = yield* PlannerAgent` (line 283). `PlanDecomposer.layer` unconditionally pipes in `PlannerAgent.layer` (line 356). `PlannerAgent.make` (lines 253–268) eagerly reads `Config.option(Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY"))` and returns `new PlannerConfigError(...)` via `yield*` if the key is absent or empty. Effect layer construction therefore aborts at the first `yield* PlanDecomposer` in the Executor (`packages/supervisor/src/executor.ts:119`) before `decompose()` is ever called.

**Consumers of the broken layer (all now require the API key even to start):**

- `packages/supervisor/src/executor.ts:119` — every `runHeadless`, every TUI screen that does `yield* Executor` (see `apps/cli/src/utils/run-test.ts:46`, `apps/cli/src/data/execution-atom.ts:44`).
- `packages/typescript-sdk/src/layers.ts:8` → `layerSdk` → `layerCli` (`apps/cli/src/layers.ts:18`) → the whole CLI runtime atom in `apps/cli/src/data/runtime.ts:15` builds it on demand.
- `packages/evals/src/runners/gemma.ts:56` — gemma runner (`--planner local` / Gemma eval) also eager-fails.
- `packages/evals/src/runners/real.ts:339` — same.

**Reproduction.** Under `env -u GOOGLE_GENERATIVE_AI_API_KEY`:

```ts
Effect.runPromise(
  Effect.gen(function* () { yield* PlanDecomposer; })
    .pipe(Effect.provide(PlanDecomposer.layer.pipe(Layer.provide(
      ConfigProvider.layerAdd(ConfigProvider.fromUnknown({}), { asPrimary: true }),
    )))),
);
```

Output (verbatim):

```
[FAIL] Eager failure: PlannerConfigError
[FAIL] reason: "GOOGLE_GENERATIVE_AI_API_KEY is unset"
[FAIL] message: "Frontier planner not configured: GOOGLE_GENERATIVE_AI_API_KEY is unset. Set GOOGLE_GENERATIVE_AI_API_KEY in your shell (…), or rerun with --planner template to skip the Gemini planner."
```

The error message literally advertises a fallback that is broken by the same patch that introduces the error.

**Why it matters.**

1. Users without the key can no longer launch the TUI at all (default `plannerMode` atom in `apps/cli/src/data/runtime.ts:9` is `"frontier"`, but even `--planner template` on the CLI cannot proceed because layer construction fails before mode is consulted).
2. `--planner none` — which by contract bypasses the decomposer entirely — also fails, because `Executor.make` yields `PlanDecomposer` regardless of runtime mode.
3. The Gemma runner is a Gemma-only eval: it has no business requiring a Gemini API key. Pre-fix it did not.
4. Test #10 (`PlannerAgent.layer` with no API key → `PlannerConfigError`) asserts the symptom in isolation but the sibling test — `PlanDecomposer` resolved in template mode without the key — is missing. If it existed it would have surfaced this on the first run.

**Suggested fix shape.**

Make the API-key read lazy (inside `planFrontier`), not eager (inside `make`). E.g. PlannerAgent's `make` returns an object with `planFrontier` that on first call does the `Config.redacted` read, constructs the provider, and caches the model (or returns the `PlannerConfigError` if unset). Template-mode and `none` callers never touch `planFrontier`, so the key never gets checked for them. PlanDecomposer continues to yield PlannerAgent unconditionally, but PlannerAgent's construction becomes cheap and always succeeds.

Alternative: split PlanDecomposer into a strict-frontier variant and a template-only variant and have the CLI pick the layer based on `plannerMode`. More invasive and less symmetric — prefer the lazy-check fix above.

Blocks merge.

### [MAJOR-1] Test coverage missed the CLI-level regression

**File:** `packages/supervisor/tests/plan-decomposer.test.ts:347`.

Test #10 only exercises `PlannerAgent.layer` in isolation; it does not probe `PlanDecomposer.layer` (the layer the CLI actually wires up) under an empty `ConfigProvider`. Adding:

```ts
it.effect("PlanDecomposer.layer resolves without GOOGLE_GENERATIVE_AI_API_KEY (so template mode works)", () =>
  Effect.gen(function* () {
    yield* PlanDecomposer;
    // ...and run a template decompose to prove it can produce steps without the key
  }).pipe(Effect.provide(PlanDecomposer.layer.pipe(Layer.provide(emptyConfigProviderLayer))))
);
```

…is the sibling test that would have caught CRITICAL-1. Under the pattern "check sibling code" (`feedback_no_test_only_injection_seams.md`), the coverage is incomplete for a fix that specifically changes layer construction semantics. Please add this test as part of the fix for CRITICAL-1 so we regress-lock it.

Blocks merge.

### [MAJOR-2] Delete `packages/supervisor/scripts/verify-volvo-plan.ts` — overfit manual harness

**File:** `packages/supervisor/scripts/verify-volvo-plan.ts` (new, entire file).

Per memory `feedback_avoid_prompt_overfitting.md`, prompts should teach *reasoning frameworks*, not site-specific nav heuristics. This script hard-codes the Apr-24 Volvo EX90 crash prompt and asserts `steps.length >= 2`. It:

1. Duplicates coverage already owned by `packages/evals/` — the evals suite exists precisely to exercise decompose-and-execute end-to-end against a balanced 20-task catalog (`packages/evals/tasks/{trivial,calibration,moderate,hard,journey}-*.ts`). A hand-rolled harness that encodes one prompt adds no coverage the evals suite doesn't already give, and drifts independently of it.
2. Reaches UP AND INTO another package's dotenv (`path.join(moduleDir, "..", "..", "evals", ".env.local")`) to steal the evals-package API key. That's a cross-package env-reading layering violation — from question #13 of the antagonistic checklist — and it only exists because this script should not live in `packages/supervisor/` in the first place.
3. The live-Gemini verification the diary cites (7 steps produced, finishReason `stop`) is exactly the kind of check the evals suite (or a subset-scoped call like `pnpm --filter @neuve/evals eval:wave-4-5`) performs. Regression tests with `MockLanguageModelV4` already prove the decode contract in CI.

**Action.** Delete the file. If a quick manual smoke is still desired, invoke an existing eval task by id against the real planner — e.g. a calibration task — rather than ship a bespoke script. The diary should be updated accordingly (see MAJOR-4).

Blocks merge.

### [MAJOR-3] Genericize the overfit test fixtures in `plan-decomposer.test.ts`

**File:** `packages/supervisor/tests/plan-decomposer.test.ts`.

The `VOLVO_PROMPT` module constant (line 14-15) and `volvoPlan` fixture (lines 82-117) thread Volvo/EX90 specifics through half the test file, including tests that are purely about the decode contract and have nothing to do with car configurators:

- Line 14–15: `VOLVO_PROMPT` — used as the input in tests #1 (template Volvo), #3 (frontier Volvo), #7 (network error), #8 (preamble regression), #9 (trailing commentary), plus `splitByConnectives` tests #12.
- Line 82–117: `volvoPlan` — `FrontierPlan` fixture with `/build`, Volvo nav structure, EX90 card. Used by tests #1–#3 and as the mock response for every non-raw-text test.

This overfits the decode-contract test suite to one site shape. If Volvo renames "Build your Volvo" or the brand pivots, these tests rot for reasons unrelated to the frontier planner.

**Action.** Two options, either is acceptable:

1. **Prefer:** source prompts and expected decompositions from 2–3 of the pre-existing `packages/evals/tasks/` fixtures — e.g. `calibration-4-two-step-ecom.ts` for multi-step nav, `trivial-1.ts` for the bare-URL template case, `moderate-1.ts` for the frontier-with-route-hint case. That gives the test suite shared fixtures with the evals suite and kills the Volvo anchor.
2. **Or:** replace `VOLVO_PROMPT` with a neutral synthetic prompt that exercises the same connective-split + multi-step structure (e.g. "navigate to example.com, open the catalog menu, select any item, proceed to checkout, and capture web vitals") and `volvoPlan` with a neutral 6-step plan. Keep test intent.

**Keep:** test #8's `reachedPreambleResponse` (the Apr-24 regression) is genuinely valuable — it asserts that a real-world failure shape gets a typed `DecomposeError` instead of a `SyntaxError` crash. Do NOT delete the test. But **edit the string** to drop Volvo/EX90 nouns: `"Reached the conclusion that the user wants to navigate to the target site and configure a product. Here is the plan: …"` preserves the "unquoted `Reached` identifier at column 0" failure shape without anchoring to one brand. Same logic for the multi-block case.

Blocks merge.

### [MAJOR-4] Diary re-verification section is overfit evidence

**File:** `docs/handover/harness-evals/diary/post-compact-2-planner-decode-fix.md` lines 156–183.

The "Re-verification against the exact failing prompt" section runs `verify-volvo-plan.ts` (to be deleted per MAJOR-2) against the Apr-24 Volvo prompt and pastes a 7-row table of Volvo-specific steps as evidence that the fix works. Per memory `feedback_avoid_prompt_overfitting.md`, this treats the Volvo prompt as the acceptance criterion.

**Action.** Rewrite the section to either (a) remove it entirely — the CI-level `MockLanguageModelV4` tests plus a live-eval subset run cover the decode contract more rigorously than any single-prompt smoke, or (b) replace the Volvo table with a manual invocation of one of the 20 pre-existing eval tasks — pick a calibration task (simple, deterministic) and paste its successful decomposition. The engineer's crash-reproduction section (lines 15–58) is fine — it references the user's prompt as the *bug report*, which is appropriate. The problem is using the same prompt as the *acceptance test*.

Blocks merge.

### [MINOR-1] New env var `PERF_AGENT_PLANNER_MODEL` is undocumented and unvalidated

**File:** `packages/supervisor/src/plan-decomposer.ts:262-263`.

```ts
const modelIdOption = yield* Config.option(Config.string("PERF_AGENT_PLANNER_MODEL"));
const modelId = Option.isSome(modelIdOption) ? modelIdOption.value : PLAN_DECOMPOSER_MODEL_ID;
```

Three small issues:

1. The diary lists model-tag bumps but does not mention the new env-var surface. Please mention it so downstream docs (the CLI README, the `.env.example` if any) get updated.
2. No schema validation on the value — a typo like `gemini-3-flas-preview` flows unchanged into `provider(modelId)` and only surfaces as an opaque AI SDK error at `generateObject` call time. Consider `Schema.Literals([...])` or at least a prefix check so typos fail at layer build.
3. Naming asymmetry: the gemma runner uses `PERF_AGENT_LOCAL_MODEL` for its model override. Using `PERF_AGENT_PLANNER_MODEL` here is fine (planner ≠ local-model) but an inline comment tying the two names together would help future maintainers.

Not blocking, but please address with CRITICAL-1's fix.

### [MINOR-2] pnpm-lock transitive change: MCP SDK now consumes `zod-to-json-schema` against `zod@3.25.76` instead of `zod@4.3.6`

**File:** `pnpm-lock.yaml` (snapshot diff around line 7412).

Adding direct `zod@^4.3.6` to the supervisor package caused pnpm to re-resolve the MCP SDK's `zod-to-json-schema@3.25.1` snapshot against `zod@3.25.76` (downgraded from `zod@4.3.6`). The MCP SDK itself still depends on `zod@4.3.6` as a direct dep, so at runtime it will be converting zod-v4 schemas through a zod-v3-linked `zod-to-json-schema`. In practice this library only reads the zod schema's internal IR, so it is usually forgiving, but (a) the diary does not mention this transitive shift and (b) it is the kind of cross-version bleed that shows up as a mysterious "schema undefined" at the MCP boundary months later. Suggest either (a) pinning `zod-to-json-schema` to the v4-compatible build in a resolution, or (b) running one MCP-proxied tool call end-to-end as a smoke and adding a short note to the diary.

Not blocking on its own.

### [SUGGESTION] Default planner mode UX when no API key is present

**File:** `apps/cli/src/data/runtime.ts:9`.

Once CRITICAL-1 is fixed, the TUI can start without a key, but the default planner is still `"frontier"`. A user without a key will hit a runtime `PlannerCallError` on first decompose instead of a helpful "falling back to template" behavior. Consider detecting the key at TUI bootup and setting the default `plannerModeAtom` to `"template"` with a one-line notice. Cosmetic, not blocking.

## Sibling-code check

- **Pre-fix helpers (`extractJsonObject`, `stripMarkdownFence`)**: zero remaining references repo-wide. Cleanly excised.
- **Pre-fix ACP planner path (`PlannerAgent.layerFromAgent`, `PlannerAgent.layerFromGemini`)**: gone; no dangling call sites.
- **Template decomposition path (`buildTemplateSteps`, `splitByConnectives`, `makeEmptyStep`)**: bytewise identical behavior; no regression to the template planner other than CRITICAL-1's blocking-boot issue.
- **`PerfPlanDraft` / `PerfPlan` construction**: same `new PerfPlan(...)` pattern pre- and post-fix. `fileStats: []` / `targetUrls: []` / `perfBudget: Option.none()` unchanged.
- **`decompose` with `mode === "none"`**: explicitly `Effect.die(...)` — consistent with prior behavior that only `Executor` calls `decompose`, never with `"none"`. Left alone.
- **Zod ↔ Effect Schema boundary**: Zod (`FrontierPlan`/`FrontierStep`) is confined to the AI SDK call; the `decompose()` return type is `PerfPlan` (Effect Schema Class). No Zod leakage into the domain. OK.
- **Effect-rule discipline in new code**: `ServiceMap.Service` + `make:` + `static layer` ✅. `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)` for both new errors ✅. `Effect.fn("SpanName")(function* (…) { ... })` with `Effect.annotateCurrentSpan` on entry ✅. `Effect.catchTag` not `catchAll`/`mapError` ✅. No `null`, no `as` casts, `satisfies` used instead ✅.
- **Model tag `gemini-3-flash-preview`**: matches `JUDGE_DEFAULT_MODEL` in `packages/evals/src/scorers/llm-judge.ts:21`; consistent across the codebase.
- **Test fixtures**: #8 (preamble), #5 (fenced), #9 (trailing commentary), #6 (malformed), #7 (429 thrown) — realistic shapes, mocked through `MockLanguageModelV4`. No live Gemini calls in the test suite (verified — grep for `createGoogleGenerativeAI` in tests returns zero). No token burn in CI.
- **`verify-volvo-plan.ts`**: correctly in `scripts/`, not `tests/`. Not wired to CI. Cross-package env read (`../../evals/.env.local`) is an architectural smell for a shipped module but acceptable for a one-off manual smoke — please leave a `// manual-only` comment block or uppercase warning in the header so it doesn't later get promoted into a test suite.

## Antagonistic-question responses

1. **Schema safety (Zod ↔ Effect)**: Zod `FrontierStep` maps to Effect `AnalysisStep` via `frontierStepsToAnalysisSteps`; field names and optionality align (`routeHint` optional on both sides). No leakage.
2. **Effect-Zod interop**: clean, boundary held.
3. **Error discipline**: both errors are `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`. `message` derived from instance fields. ✅
4. **`catchTag` not `catchAll`**: verified, zero hits.
5. **Template-mode parity**: same helpers, same output shape.
6. **Dead helpers**: removed.
7. **Key-missing behavior**: late-fails **at layer build of `PlanDecomposer.layer`** (CRITICAL-1), not at decompose call. Wrong level.
8. **`gemini-3-flash-preview`**: matches `JUDGE_DEFAULT_MODEL`; fine.
9. **`PLAN_DECOMPOSER_TEMPERATURE`**: plain constant, no env var — no pattern violation. But `PERF_AGENT_PLANNER_MODEL` is a new env var (MINOR-1).
10. **Test fixtures**: realistic, no synthetic lock-in. Preamble uses the actual "Reached…" string from the crash.
11. **`verify-volvo-plan.ts` location**: correct `scripts/`, not CI-wired.
12. **Lockfile**: three direct adds (`@ai-sdk/google`, `ai`, `zod`) + one `dotenv` devDep; plus the transitive `zod-to-json-schema` re-resolution flagged in MINOR-2.
13. **Dotenv loading**: only the manual smoke script; never in library/runtime code. Minor smell, not blocking.
14. **Live Gemini bill**: zero — tests all mock.

## Summary

| Severity | Count | Items |
|---|---|---|
| Critical | 1 | CRITICAL-1 eager layer build blocks template/none modes |
| Major | 4 | MAJOR-1 missing sibling test; MAJOR-2 delete overfit `verify-volvo-plan.ts`; MAJOR-3 genericize Volvo fixtures in tests; MAJOR-4 rewrite diary re-verification |
| Minor | 2 | MINOR-1 undocumented `PERF_AGENT_PLANNER_MODEL`; MINOR-2 zod-to-json-schema cross-version drift |
| Suggestion | 1 | default planner mode UX |

**Anti-overfit note.** MAJOR-2/3/4 together enforce the rule that one user-submitted crash prompt (Volvo EX90) should not become a test fixture, a ship-gate script, or a diary acceptance criterion. Regression coverage should preserve *failure shapes* (JSON preamble, fenced JSON, trailing commentary) independent of brand/site, and manual live smoke checks should piggy-back on the already-curated 20-task eval suite. Delete the script, genericize the test fixtures (keep the preamble *shape* but drop Volvo/EX90 nouns), and rewrite the diary's acceptance section to reference an eval task or the mocked CI tests.

Fix CRITICAL-1 (lazy API-key read), add the MAJOR-1 regression test, resolve MAJOR-2/3/4 overfit cleanup, then MINOR-1/2 as polish. One round should be enough.
