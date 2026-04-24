# Post-Compact 2 — Frontier planner decode fix

Date: 2026-04-24
Owner: `planner-eng` (team `plan-decomposer-fix`)
Task: #1 — blocks reviewer task #2.

## TL;DR

The Wave 1.A frontier planner path (ACP → Gemini CLI → accumulate text chunks → `Schema.fromJsonString`) is fundamentally fragile: the model can emit prose/preamble/thinking tokens that no amount of downstream string-munging will reliably parse. The Apr-24 crash (`Unexpected identifier "Reached"`) is one specific symptom of that class.

Replaced with a direct `@ai-sdk/google` + `generateObject` call routed through the same `FrontierPlanSchema` defined in Zod. Gemini's structured-output mode constrains the model at the API level to return schema-conformant JSON — no fences, no preamble, no chain-of-thought leakage.

Regression coverage via `MockLanguageModelV4` locks in the failure shapes (JSON preamble, fenced JSON, trailing commentary, malformed JSON, network error) as typed `DecomposeError`s past the production code path — no live Gemini billed in CI.

## Crash reproduction

User ran `perf-agent tui` with the prompt:

```
lets go to volvocars.com, navigate to the build page, under the 'buy' > 'build your volvo' menu and build me a new ex90, any spec. Proceed all the way to the order request form and report back the web vitals
```

TUI rendered:

```
Unexpected error
Plan decomposition (frontier) failed: Failed to decode planner response: SyntaxError: JSON Parse error: Unexpected identifier "Reached"
Press r to retry, esc to go back
```

### Root cause

In the pre-fix `plan-decomposer.ts`, the frontier path:

1. Yielded `AcpAgentMessageChunk` events from `plannerAgent.stream(...)`.
2. Concatenated every `chunk.content.text` into a single string via `Stream.runFold`.
3. Ran `stripMarkdownFence` + `extractJsonObject` (first-`{` to last-`}` slice).
4. Handed the result to `Schema.fromJsonString(FrontierPlan)` → `JSON.parse`.

Gemini 3 Flash (or the Gemini CLI ACP bridge) is free to emit any text it wants through `agent_message_chunk`: reasoning traces, preambles, prose-only answers, multiple JSON blocks interleaved with prose. When no `{` exists, `extractJsonObject` returns the raw prose unchanged; when multiple `{…}` blocks exist, it slices from first-`{` to last-`}` and includes the inter-block prose verbatim.

Reproduced both failure shapes with a standalone node harness:

```
Case 1 (pure prose) input:
  "Reached the conclusion that the user wants to navigate to Volvo's build page..."
  → JSON.parse error: Unexpected token 'R', "Reached th"... is not valid JSON

Case 2 (multi-block with prose between) input:
  '{"draft": 1}\nReached a conclusion.\n{"steps": [...]}'
  → extractJsonObject returns the whole span
  → JSON.parse error: Unexpected non-whitespace character after JSON at position 13
```

The V8 engine version in the user's Node reports "Unexpected identifier 'Reached'" for Case 1; older V8s say "Unexpected token 'R'". Same bug.

Yesterday (Apr-23) the same prompt succeeded with `--planner local` / Gemma because Gemma isn't routed through the frontier decoder — it runs as the execution agent, not the planner. The `--planner frontier` path was the single failing link.

## Design choice — Option A (direct AI SDK)

Three candidates:

- **(A) Direct AI SDK with structured output** — call `generateObject` from `@ai-sdk/google` with `gemini-3-flash-preview` and a Zod schema for `FrontierPlanSchema`. Gemini's native `responseMimeType: "application/json"` + `responseSchema` forces the model to emit schema-conformant JSON, end of story.
- **(B) Robust decode** — extend the existing `extractJsonObject` to handle multi-block, thinking-token, and prose-only responses.
- **(C) Regex-extract JSON** — grep for the first plausible object in the stream.

Picked **(A)**. Rationale:

- The `ai` package at `7.0.0-beta.111` and `@ai-sdk/google` at `4.0.0-beta.45` are already in the workspace (evals pulls them in for the Online-Mind2Web judge). The same `generateObject` + `MockLanguageModelV4` pattern from `packages/evals/src/scorers/llm-judge.ts` is the canonical reference in this codebase.
- Gemini's structured-output mode is API-level enforcement: the model token-by-token cannot emit non-JSON. Every class of failure this fix addresses (preamble, fence, multi-block, thinking leak) is physically impossible past the API boundary.
- (B) is whack-a-mole. A fix that works for today's prose-preamble shape will break the next time Gemini decides to emit, e.g., a `<thinking>…</thinking>` block or a different markdown flavor. Memory `feedback_types_over_regex.md` applies: "prefer imported types/schemas from external tools over ad-hoc regex."
- Wave 1.A's "no direct Gemini SDK, no new HTTP client" constraint was a Wave 1.A-era scoping decision. The team-lead's seed prompt for this round explicitly lifts it: "Pick (A) if the SDK supports it, else (B)." The SDK supports it.

The tradeoff for (A): users now need `GOOGLE_GENERATIVE_AI_API_KEY` in their environment for frontier planning. Previously, `gemini auth login` (Gemini CLI OAuth) was sufficient. The `PlannerConfigError` surfaces an actionable error message when the key is missing, and `--planner template` still works as a no-API-key fallback.

## Implementation summary

### Architecture change

Pre-fix (Wave 1.A):

```
PlanDecomposer.decomposeFrontier
  → PlannerAgent.stream(AgentStreamOptions)  [returns Stream<AcpSessionUpdate>]
  → Stream.runFold (concatenate agent_message_chunk texts)
  → stripMarkdownFence + extractJsonObject + Schema.fromJsonString
```

Post-fix:

```
PlanDecomposer.decomposeFrontier
  → PlannerAgent.planFrontier(prompt)  [returns Effect<FrontierPlan>]
  → generateObject({ model, schema: FrontierPlanSchema, system, prompt })
    [AI SDK enforces JSON mode + schema validation at the API boundary]
```

### Files

- **`packages/supervisor/src/plan-decomposer.ts`** — rewrote. `PlannerAgent` now wraps `generateObject` with `FrontierPlanSchema` (a Zod schema). Dropped `stripMarkdownFence`, `extractJsonObject`, `FrontierPlan`-as-Effect-schema, the Stream aggregation. `PlanDecomposer` now just calls `plannerAgent.planFrontier(prompt)` and maps the steps.
- **`packages/supervisor/src/errors.ts`** — added `PlannerConfigError` (missing / empty API key, actionable message directing to env var or `--planner template`) and `PlannerCallError` (network, rate-limit, schema-validation failures from the AI SDK).
- **`packages/supervisor/src/planner-prompt.ts`** — renamed `PLAN_DECOMPOSER_MODEL_CONFIG_ID` → `PLAN_DECOMPOSER_TEMPERATURE` (0.1 to match `llm-judge.ts`). Bumped `PLAN_DECOMPOSER_MODEL_ID` from `gemini-2.5-flash` to `gemini-3-flash-preview` (matches memory `project_target_model_gemma.md` and `JUDGE_DEFAULT_MODEL`). System prompt unchanged — `generateObject` honors `system:` directly.
- **`packages/supervisor/src/index.ts`** — exported `FrontierPlan`, `FrontierStep`, `PlannerAgentOptions`, `PlannerConfigError`, `PlannerCallError`.
- **`packages/supervisor/package.json`** — added `@ai-sdk/google@4.0.0-beta.45`, `ai@7.0.0-beta.111`, `zod@^4.3.6` to `dependencies`. Versions pin to what `packages/evals` already uses so pnpm hoists cleanly. (Round 2: dropped the `dotenv@^17.0.0` devDep — it existed only for the deleted overfit verification script.)
- **`packages/supervisor/tests/plan-decomposer.test.ts`** — rewrote. Tests use `MockLanguageModelV4` from `ai/test` (same pattern as `llm-judge.test.ts`) so the production and test paths both exercise `generateObject` past the same model boundary. 16 tests (Round 2 added the CRITICAL-1 sibling tests and genericized every fixture away from Volvo/EX90 nouns), all passing.

### Configuration surface

| Env var                      | Role                                                              | Default                              | Validation                                 |
| ---------------------------- | ----------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini provider key (read lazily at first frontier decompose)     | unset → `PlannerConfigError` if frontier | non-empty string                          |
| `PERF_AGENT_PLANNER_MODEL`   | Overrides the planner model id (sibling of `PERF_AGENT_LOCAL_MODEL` used by the Gemma runner) | `PLAN_DECOMPOSER_MODEL_ID` (`"gemini-3-flash-preview"`) | `Schema.String.check(Schema.isStartsWith("gemini-"))` — typos like `"gemini-3-flas-preview"` still pass the prefix check but an unrelated id like `"gpt-4"` surfaces as a `PlannerConfigError` at first frontier call. |

### Effect rules observed

- `ServiceMap.Service` with `make:` + `static layer` (no `Effect.Service`, no `Context.Tag`).
- `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)` for `PlannerConfigError` and `PlannerCallError`. `message` derived from instance fields.
- `Effect.catchTag("PlannerCallError", ...)` — never `catchAll` or `mapError`.
- No `null` anywhere; `Option.none()` for absent route hints.
- No `as` casts. Used `satisfies LanguageModel` and `satisfies FrontierPlan` for safety.
- Every effectful function uses `Effect.fn("SpanName")` with a descriptive span name (`PlannerAgent.planFrontier`, `PlanDecomposer.decomposeFrontier`, `PlanDecomposer.decompose`).
- Structured logging via `Effect.logInfo` with contextual data (`stepCount`, `finishReason`, `modelId`).

## Test coverage matrix

`packages/supervisor/tests/plan-decomposer.test.ts` — 16 tests. Fixtures are generic multi-domain prompts (e-commerce catalog checkout, docs search, form wizard) rather than site-anchored; real site-shape coverage is owned by the 20-task eval suite under `packages/evals/tasks/`.

| #   | Test                                                                    | Assertion                                                    |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | template: multi-step journey prompt                                     | ≥2 steps, all `status: "pending"`                            |
| 2   | template: bare URL                                                      | single "Navigate to example.com" step                        |
| 3   | frontier: mocked structured plan → decode                               | ≥4 steps, stable `step-01`/`step-04` IDs, routeHint → `Some` |
| 4   | frontier: short plan happy path (single JSON object)                    | parses to 2 steps                                            |
| 5   | frontier: markdown-fenced JSON (structured-output violation)            | `DecomposeError` — typed, not a crash                        |
| 6   | frontier: malformed JSON                                                | `DecomposeError`                                             |
| 7   | frontier: model throws (network / rate-limit)                           | `DecomposeError` with cause containing "429 rate limit"      |
| 8   | frontier: `"Reached …"` preamble (Apr-24 regression, generic content)   | `DecomposeError` — typed, not a `SyntaxError` crash          |
| 9   | frontier: trailing commentary after JSON                                | `DecomposeError`                                             |
| 10  | `PlanDecomposer.layer` under empty ConfigProvider — template mode works | layer builds, ≥1 step returned                               |
| 11  | `PlanDecomposer.layer` under empty ConfigProvider — `mode=none`         | layer builds; `decompose` dies by design (not config failure) |
| 12  | `PlanDecomposer.layer` under empty ConfigProvider — frontier mode       | `DecomposeError` whose cause cites `GOOGLE_GENERATIVE_AI_API_KEY` + `--planner template` |
| 13  | `PlannerConfigError` message                                            | mentions env var name and `--planner template` escape hatch  |
| 14  | `splitByConnectives` on a connective-rich prompt                        | ≥3 clauses                                                   |
| 15  | `splitByConnectives("")`                                                | `[]`                                                         |
| 16  | frontier: `MockLanguageModelV4` returning full catalog-checkout plan    | decodes to 6 steps in production-identical code path         |

Tests #5, #8, #9 are the **lock-in for the Apr-24 crash class**: Gemini-shape responses that would have crashed the old path now produce a typed `DecomposeError`. No more `Unexpected error` panel — the CLI renders the structured error and offers `r` retry / `esc` back.

Tests #10, #11, #12 lock in the **CRITICAL-1 fix**: the CLI's layer must build without the API key so `--planner template` and `--planner none` paths remain functional, and the key check must fire lazily at the first `planFrontier` call with an actionable error message (not at layer-build time, which would break TUI bootup).

All 16 pass (run twice for determinism):

```
Test Files  12 passed (12)
Tests       95 passed (95)
Duration    1.54s
```

Evals suite also re-ran green (unchanged):

```
Test Files  12 passed (12)
Tests       120 passed (120)
```

## Verification gate

- **`pnpm --filter @neuve/supervisor typecheck`** → clean (exit 0)
- **`pnpm --filter @neuve/supervisor test`** → 95 passed / 95 (12 files) — run twice for determinism, identical
- **`pnpm --filter @neuve/evals test`** → 120 passed / 120 (12 files)
- **Grep `createGoogleGenerativeAI` in supervisor tests** → zero matches (no live Gemini calls, no token burn in CI)
- **Eager-layer probe** (short-lived, deleted after use): `PlanDecomposer.layer` built under an empty `ConfigProvider` — layer resolves, no `PlannerConfigError` at layer build.
- **`pnpm check`** → **fails on pre-existing formatter drift unrelated to this fix**. Same 7 supervisor files + 6 shared files + 2 agent files have pre-existing whitespace drift vs. the current `vp fmt` defaults. Confirmed by cloning `/tmp/perfagent-cli-clean` from HEAD and running `pnpm --filter @neuve/supervisor check` — same failure, same 7 files, no diff vs. HEAD. Same pattern as commit `137feb09 chore(evals): revert pre-existing formatter drift` where the maintainer handled this in the evals package. Additionally, `pnpm --filter @neuve/evals check` fails because oxlint can't load `vite.config.mjs` (config format mismatch introduced in commit `0d70846e chore(build): migrate root vite.config from .ts to .mjs`), a separate pre-existing bug.
- **My files** pass `vp fmt --check` in isolation.

The broken `pnpm check` gate is a pre-existing repo-health issue, not a regression from this fix.

## Files changed

### Modified

- `packages/supervisor/src/plan-decomposer.ts` — full rewrite of the frontier path to use `@ai-sdk/google` + `generateObject`. Dropped ACP stream aggregation and ad-hoc JSON extraction. Added `FrontierPlanSchema` (Zod) alongside domain types. **Round 2**: API-key + model-id reads are lazy + memoized inside `planFrontier` (see Round 2 patches section below).
- `packages/supervisor/src/errors.ts` — added `PlannerConfigError`, `PlannerCallError`.
- `packages/supervisor/src/planner-prompt.ts` — bumped model to `gemini-3-flash-preview`, renamed model-config constant to `PLAN_DECOMPOSER_TEMPERATURE`.
- `packages/supervisor/src/index.ts` — exported the new types and errors.
- `packages/supervisor/package.json` — added AI SDK deps (`@ai-sdk/google`, `ai`, `zod`). **Round 2**: removed `dotenv` devDep (was only used by the deleted overfit verification script).
- `packages/supervisor/tests/plan-decomposer.test.ts` — rewrote tests to use `MockLanguageModelV4`; added regression tests for the Apr-24 crash class (preamble, fence, trailing prose, missing-API-key). **Round 2**: fixtures genericized to neutral multi-domain prompts; CRITICAL-1 sibling tests added (see Round 2 patches section).
- `pnpm-lock.yaml` — regenerated by `pnpm install`. **Round 2**: re-regenerated after dropping `dotenv`.

### New

- `docs/handover/harness-evals/diary/post-compact-2-planner-decode-fix.md` — this file.

### Deleted in Round 2

- `packages/supervisor/scripts/verify-volvo-plan.ts` — overfit manual harness. Directory `packages/supervisor/scripts/` removed (empty).

### Intentionally not modified

- All pre-existing formatter drift in `packages/supervisor/src/{executor,reporter,report-storage}.ts`, `packages/supervisor/tests/{executor-adherence-gate.test,insight-enricher.test,report-storage.test,fixtures/legacy-report-task61.json}` — out of scope for this fix. Same precedent as commit `137feb09`.
- The ACP-based `Agent.layerGemini` / `PlannerAgent.layerFromAgent` / `PlannerAgent.layerFromGemini` — deleted, not reverted. The `Agent` service remains as-is for the execution path (which is NOT what we changed — we only changed the planner). The gemini-cli ACP adapter is still used by users running `--agent gemini` for execution.

## Round 2 patches

Reviewer round 1 flagged 1 critical, 4 major, 2 minor, 1 suggestion (see `docs/handover/harness-evals/reviews/post-compact-2-review-round-1.md`). Round 2 addresses them.

### CRITICAL-1 — API-key read made lazy + memoized

**Root cause.** The round-1 `PlannerAgent.make` eagerly yielded `Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY")` and failed with `PlannerConfigError` at layer-build time when the key was unset. `PlanDecomposer.make` unconditionally yielded `PlannerAgent`, and `PlanDecomposer.layer` unconditionally piped `PlannerAgent.layer` in. Consequence: **every** CLI code path — `--planner template`, `--planner none`, the gemma runner (Gemma-only!), the real runner — failed at layer build before planner mode was ever consulted. The error message literally advertised `--planner template` as a fallback that the same patch broke.

**Fix.** Kept `PlannerAgent` as a single service (no split variants per reviewer guidance) but restructured `make` so it always succeeds:

1. Define a `loadModel` Effect that does the `Config.option(Config.redacted(...))` read + provider construction. The only error in its channel is `PlannerConfigError`; any residual `ConfigError` from `Config.option` (impossible in practice since `Config.string`/`Config.redacted` only fail on `MissingKey` which `Config.option` swallows) is defected via `Effect.catchTag("ConfigError", Effect.die)`.
2. `yield* Effect.cached(loadModel)` at service construction — this is cheap and always succeeds; it returns an `Effect<LanguageModel, PlannerConfigError>` whose first evaluation reads Config + builds the provider and whose subsequent evaluations replay the cached success or failure.
3. `planFrontier` yields the cached effect on entry — fast path after first call; missing-key surfaces as `PlannerConfigError` only when the frontier planner is actually invoked.

The test lock-in (`PlanDecomposer no-API-key path (CRITICAL-1 regression)`) resolves the CLI-level layer under an empty `ConfigProvider` and proves:
- template mode produces ≥1 step
- `mode=none` dies by contract (not a config failure — layer built fine)
- frontier mode surfaces a `DecomposeError` whose cause cites `GOOGLE_GENERATIVE_AI_API_KEY` + `--planner template`

`PlannerConfigError` from `planFrontier` is caught at the `PlanDecomposer.decomposeFrontier` boundary and wrapped into `DecomposeError` (mirroring how `PlannerCallError` was already handled), so the `Executor`'s error channel stays `DecomposeError`-only — no broader signature change needed downstream.

### MAJOR-1 — Sibling regression tests added

`packages/supervisor/tests/plan-decomposer.test.ts` gained three tests in the `PlanDecomposer no-API-key path (CRITICAL-1 regression)` describe block (see test matrix #10-#12). These probe `PlanDecomposer.layer` (the layer the CLI actually wires) under an empty `ConfigProvider`, which was the missing sibling to the prior round-1 test that only probed `PlannerAgent.layer` in isolation.

### MAJOR-2, MAJOR-3, MAJOR-4 — Anti-overfit cleanup

Per memory `feedback_avoid_prompt_overfitting.md`: "Prompts teach reasoning frameworks, NOT site-specific nav heuristics; distillation is where site patterns live."

- **Deleted** `packages/supervisor/scripts/verify-volvo-plan.ts` and the now-empty `packages/supervisor/scripts/` directory. Generic verification belongs to the 20-task eval suite (`packages/evals/evals/`), not a hand-rolled single-prompt smoke in another package.
- **Genericized** the test fixtures:
  - `VOLVO_PROMPT` → three neutral multi-domain prompts: `CATALOG_CHECKOUT_PROMPT` (e-commerce), `DOCS_SEARCH_PROMPT` (docs navigation), `FORM_WIZARD_PROMPT` (multi-step form). Different tests pick different prompts, so a single site's UX change can't rot the whole suite.
  - `volvoPlan` → `catalogCheckoutPlan` with neutral titles (`Open landing page`, `Open catalog menu`, `Choose a featured item`, `Add to cart`, `Proceed to checkout`, `Capture web vitals`) and a single `example.com` URL.
  - The **Apr-24 preamble regression** test (`"Reached …"` shape) is retained but its content is neutralized: `"Reached the conclusion that the user wants to perform a multi-step browser journey. Here is the plan:\n- Step 1: Navigate\n- Step 2: Open menu"`. The JSON-preamble failure shape is preserved without anchoring on Volvo/EX90 nouns — the bug is about JSON parse resilience, not a particular prompt.
  - `splitByConnectives` tests exercise connective-splitting semantics directly (`, then`, `and then`, sentence boundaries) instead of relying on a specific site prompt to happen to contain them.
- **Neutralized** the diary: removed the "Re-verification against the exact failing prompt" section with the Volvo-specific 7-row table. The CI-level `MockLanguageModelV4` tests plus this Round 2 patches section are the acceptance evidence; we don't ship a per-round live Gemini bill.

Pre-existing Volvo scope outside this diff (`packages/evals/tasks/hard-volvo-ex90.ts` as one of 20 intentional tasks; `packages/supervisor/tests/executor-adherence-gate.test.ts` replaying a Volvo failure trace; `packages/evals/src/scorers/llm-judge.ts` comment about not hardcoding "if volvo.com then …") is untouched — those are legitimate design.

### MINOR-1 — `PERF_AGENT_PLANNER_MODEL` documented + validated

- **Validation.** The env var now decodes through `Schema.String.check(Schema.isStartsWith("gemini-"))`. A non-Gemini id (e.g. `gpt-4`) surfaces as a `PlannerConfigError` at first frontier call with a pointer to the required prefix, instead of an opaque AI SDK error at `generateObject` time. Typos within the `gemini-` family (e.g. `gemini-3-flas-preview`) still pass the prefix check and surface as an AI SDK error — schema validation can't cover every possible model string, and the `Schema.Literals([…])` approach locks us to a hand-maintained enum we'd have to bump for every Gemini release. Prefix-check is the pragmatic middle ground.
- **Documentation.** See the new "Configuration surface" table above.
- **Naming rationale.** `PERF_AGENT_PLANNER_MODEL` is the planner-facing sibling of `PERF_AGENT_LOCAL_MODEL` used by the Gemma runner. Both follow `PERF_AGENT_<ROLE>_MODEL`.

### MINOR-2 — `zod-to-json-schema` transitive drift — tolerated with note

Adding direct `zod@^4.3.6` to supervisor caused pnpm to re-resolve MCP SDK's `zod-to-json-schema@3.25.1` against `zod@3.25.76` instead of `zod@4.3.6`. Per the reviewer's option C (acknowledged tolerated): `zod-to-json-schema` reads only the zod schema IR, which is forgiving across zod-v3↔v4 at that surface. MCP SDK itself still depends on `zod@4.3.6` as a direct dep, so runtime zod calls go through v4. Monitoring for "schema undefined" at the MCP boundary; none observed in the supervisor or evals test suites (which exercise MCP tool call paths indirectly via the real runner).

### SUGGESTION — Default planner mode UX — deferred

The default `plannerModeAtom` in `apps/cli/src/data/runtime.ts:9` is still `"frontier"`. After the CRITICAL-1 fix the TUI boots with no key; frontier decompose then surfaces a `DecomposeError` with an actionable message (including the `--planner template` hint). A bootup detection + default-to-template switch would reduce the one-run friction but touches UI atoms the `debug-agent` skill covers better as a focused follow-up. Deferred to a new team task rather than bundled here.

## Anti-overfit note

Per memory `feedback_avoid_prompt_overfitting.md`: one user-submitted crash prompt (Volvo EX90 on Apr-24) was the bug *report*, never the acceptance *test*. Regression coverage locks in the *failure shapes* (JSON preamble, fenced JSON, trailing commentary) with neutral synthetic inputs; real-site coverage lives in the 20-task eval suite which baseline-diff and A:B compare at Wave 4.5 per `project_baseline_eval_strategy`.
