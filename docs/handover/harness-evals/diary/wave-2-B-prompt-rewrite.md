# Wave 2.B — System prompt rewrite for 4B

Date: 2026-04-23
Owner: `prompt-rewrite-eng` (team `harness-evals`)
Task: #6 — blocks Wave 3 (#8).

## Design rationale — why the essay had to go

`buildExecutionSystemPrompt()` was ~163 lines of essay-style prose (stripped of list-item overhead it expanded to ~290 lines in the rendered prompt). It was written for frontier models (Claude / GPT-4 class) that can follow discursive, multi-paragraph guidance.

Gemma 3n E4B (4B effective params) is the production target. 4B models have smaller attention budgets and dilute signal across long contexts. The symptoms are documented in the Wave 0.A diary: multi-step journeys collapse to a single `RUN_COMPLETED` because the directive to run N steps was buried in a paragraph three sections in.

The fix is structural, not cosmetic:

1. **Short and directive.** Cut every essay, narrative, and motivation paragraph. Keep only "what to do" and "what to emit."
2. **State re-injection per turn.** Static prompt teaches protocol. Per-turn prompt re-injects `<current_sub_goal>`, `<plan>`, `<observed_state>`, `<available_actions>`. A 4B model can't hold "where am I in the plan" across a long system prompt; re-injection beats memory.
3. **Flat, discoverable tool catalog.** One line per tool, interaction tools first (primary surface for journey execution), `evaluate_script` last and marked `LAST RESORT`.
4. **Peripheral-position rule from `.specs/prompt-optimization.md` preserved.** Identity at the top, rules at the bottom. Status-marker protocol sits right after identity so it's in the top attention window.
5. **Aggressive prose pruning.** Dropped the `<recognize_rationalizations>`, `<run_completion>` checklist, `<code_testing>`, `<profiling_workflow>`, `<snapshot_workflow>`, `<stability_and_recovery>`, and `<failure_reporting>` essays. Their content is either redundant (covered by `<rules>`), superseded (covered by pre-planner from Wave 1.A), or moved to per-turn prompt material (covered by `<current_sub_goal>` populating the active step's instruction).

What remains in the system prompt:

- `<identity>` — 4 lines (was 1 line, expanded slightly because 4B benefits from explicit "do not stop early" framing)
- `<protocol>` — 14 lines (status-marker reference + abort channel, unchanged contract)
- `<tool_catalog>` — 19 lines (18 tools + wrapper; flat, one line each)
- `<failure_categories>` — 7 lines (the 5 categories from Wave 1.B: `budget-violation`, `regression`, `resource-blocker`, `memory-leak`, `abort`)
- `<failure_domains>` — 3 lines
- `<rules>` — 10 lines (measurement-first, step-marker discipline, abort gate, always snapshot, one-tool-per-turn)

## Line-count comparison

| Surface | Old | New |
|---|---|---|
| `buildExecutionSystemPrompt()` non-blank lines | 163 | **59** |
| Rendered prompt bytes | 13,117 | 3,809 |
| Sections | 14 | 6 |

## Invariants preserved (verified by tests)

| Invariant | Source | New-prompt location |
|---|---|---|
| `STEP_START` exact marker | Wave 1.B parser (`parseMarker` in `models.ts`) | `<protocol>` |
| `STEP_DONE` exact marker | same | `<protocol>` |
| `ASSERTION_FAILED` exact marker | same | `<protocol>` |
| `RUN_COMPLETED` exact marker (pipe-delimited with status field) | same | `<protocol>` |
| `category=` / `domain=` tokens | `parseAssertionTokens` in `models.ts` | `<protocol>` + `<failure_categories>` + `<failure_domains>` |
| `abort_reason=<reason>` (Wave 1.B abort channel) | `parseAssertionTokens` + `ExecutedPerfPlan.finalizeTextBlock` | `<protocol>` (explicit two-line abort pattern) + `<failure_categories>` (abort entry) + `<rules>` (gate reminder) |
| 5 failure categories from Wave 1.B | diary `wave-1-B-adherence-gate.md` | `<failure_categories>` (all 5 listed with one-line definitions) |
| Wave 2.A interaction tools | task #5 seed | `<tool_catalog>` top (`click`, `fill`, `hover`, `select`, `wait_for`) |
| Chrome-devtools-mcp tool set (13 tools) | existing surface | `<tool_catalog>` remainder |
| `evaluate_script` as last-resort | `.specs/prompt-optimization.md` guidance | `<tool_catalog>` annotation + `<rules>` ("Prefer click/fill/hover/select/wait_for over evaluate_script") |
| `buildWatchAssessmentPrompt` signature + return shape | `watch.ts:129` call site | unchanged — no edits to that function |
| `buildLocalAgentSystemPrompt` unchanged | local-agent (ACP) | unchanged — separate prompt, outside 2.B scope |

## Per-turn state blocks (`buildExecutionPrompt`)

Three new optional fields on `ExecutionPromptOptions`:

- `perfPlan?: PerfPlan` — when supplied, emits a `<plan>` block listing every step as `- [status] step-id — title`, and auto-derives `<current_sub_goal>` from the first `active` (or, if none, first `pending`) step.
- `currentSubGoal?: string` — explicit override for `<current_sub_goal>` content (takes precedence over plan-derived value). Used when the supervisor has sub-goal context the plan doesn't carry.
- `observedState?: string` — wraps arbitrary page/state context into `<observed_state>`. Executor will populate this from snapshot + trace state on later waves; function accepts it now so Wave 3 doesn't need a second schema change.

All three blocks are optional — `buildExecutionPrompt(makeDefaultOptions())` emits the same shape as before for every call site that doesn't opt in. `executor.ts:171` does not supply any of them today, so runtime behavior is byte-identical to pre-wave-2.B for the initial prompt. Per-turn re-injection is a follow-up wire-up task (Wave 3 scope).

## Golden-file tests

`packages/shared/tests/prompts.test.ts` rewritten (old file deleted and replaced — old assertions pinned essay-style phrases that no longer exist). 48 tests in three describe blocks:

| Describe | # tests | Coverage |
|---|---|---|
| `buildExecutionSystemPrompt — shape & invariants` | 13 | 80-line cap, every status marker, every failure category, every tool name, XML section wrapping, section ordering, custom server-name substitution, output stability (pin-style snapshot across two invocations) |
| `buildExecutionPrompt — per-turn state blocks` | 23 | XML tag wrapping, instruction passthrough, changed files / commits / diff, environment + branch, `<plan>` population, `<current_sub_goal>` derivation + override, `<observed_state>` presence/absence, saved flow + learnings + dev-server hints, truncation, all four scope strategies |
| `buildLocalAgentSystemPrompt` + `buildWatchAssessmentPrompt` | 12 | Preserved verbatim from old file — these prompts are outside 2.B scope and their invariants (local-agent 4 KB cap, analyze-insight mandates, classifier single-word response) are regression-locked |

Output-stability test (`golden snapshot — output is stable across invocations`) asserts `buildExecutionSystemPrompt()` is deterministic — any accidental reintroduction of `Date.now()` / `Math.random()` / unstable iteration order in the system prompt would fail this check.

## DoD evidence

1. **`buildExecutionSystemPrompt()` emits ≤80 lines.** → 59 non-blank lines (test `emits at most 80 non-blank lines`).
2. **Existing status-marker parsing tests pass.** → `packages/shared/tests/dynamic-steps.test.ts` — 20/20 passing unchanged. The prompt rewrite changes what the prompt *teaches* the agent to emit; it does not touch `parseMarker` / `parseAssertionTokens` in `models.ts`.
3. **Wave 1.B abort-channel tests pass.** → `packages/supervisor/tests/executor-adherence-gate.test.ts` — 5/5 passing. Abort-channel contract (`ASSERTION_FAILED|...|category=abort; abort_reason=...` immediately before `RUN_COMPLETED`) is preserved verbatim in the new prompt's `<protocol>` block.
4. **New golden-file tests pass.** → 48/48 in `packages/shared/tests/prompts.test.ts`.
5. **`pnpm --filter @neuve/shared test` green.** → 118/118 (10 test files).
6. **`pnpm --filter @neuve/shared typecheck` green.** → confirmed.
7. **`pnpm --filter @neuve/supervisor test` green.** → 87/87 (no regressions from Wave 1.B).
8. **Typecheck across downstream packages:** `@neuve/supervisor` typecheck fails, but exclusively in `packages/browser/src/tools/live.ts` and `packages/browser/src/mcp/tools/interactions.ts` — those are uncommitted in-progress Wave 2.A / 2.C files outside my scope. No errors in `packages/shared/`, `packages/supervisor/`, or any consumer of `buildExecutionSystemPrompt` / `buildExecutionPrompt`. `apps/cli` (`@neuve/perf-agent-cli`) and `apps/cli-solid` inherit the browser-package errors transitively but all 2.B-touched surfaces are green.
9. **`pnpm exec vp fmt --check`** on the two modified files — clean after one oxfmt pass.
10. **Manual sanity read.** Printed the new 59-line prompt to the terminal and confirmed: one directive per line, no essays, interaction tools at top of catalog, `evaluate_script` at bottom marked `LAST RESORT`, abort-channel contract front and center in `<protocol>`.

## What I deliberately did NOT do

- **Did not touch `packages/shared/src/models.ts`.** `parseMarker` and `parseAssertionTokens` are Wave 1.B's contract — my new prompt emits formats they already accept.
- **Did not touch `packages/supervisor/`.** The per-turn `<current_sub_goal>` / `<plan>` / `<observed_state>` wire-up in `executor.ts:171` is a Wave 3 task — my `buildExecutionPrompt` additions are additive (optional fields) and the call site keeps working unchanged.
- **Did not touch `packages/browser/`.** Wave 2.A/2.C territory. The interaction tool names (`click`, `fill`, `hover`, `select`, `wait_for`) are referenced in the catalog but I did not wire them; Wave 2.A owns the tool implementations and the chrome-devtools-mcp registration.
- **Did not touch `buildWatchAssessmentPrompt` or `buildLocalAgentSystemPrompt`.** Outside 2.B scope per the task seed.

## Handover notes for Wave 3

Wave 3 is responsible for wiring `buildExecutionPrompt`'s new optional fields into the per-turn loop:

1. **`executor.ts:171`** currently builds the prompt once before the agent stream starts. For per-turn state re-injection, Wave 3 will need to construct a new prompt per agent turn using the live `ExecutedPerfPlan` state.
2. **`perfPlan` field** — pass the live `state.plan` from the executor's `mapAccumEffect` reducer.
3. **`observedState` field** — populate from the latest snapshot + trace summary. Format is free-form text; keep it terse (under ~20 lines) to preserve 4B attention budget.
4. **`currentSubGoal` field** — use this only when the supervisor has richer sub-goal context than the plan's active step (e.g., "retry with emulation" vs the plan's base step). Otherwise leave undefined and let `buildExecutionPrompt` auto-derive from the plan's active step.
5. **Eval-wired measurement** — once Wave 3.C dual-runs Claude vs Gemma against the 5 Wave 0.B tasks, the `baseline → prompt-rewrite` delta will be visible as a `step-coverage` / `furthest-key-node` score delta. The task seed explicitly defers the numerical threshold to once the baseline is captured.

## Commit breakdown (pending reviewer APPROVE)

Three granular commits, no Co-Authored-By footer:

1. `feat(shared): rewrite buildExecutionSystemPrompt for 4B (<=80 lines, XML state blocks)` — replaces the 163-line essay with the 59-line directive prompt. Preserves every parsable invariant.
2. `feat(shared): add optional perfPlan / currentSubGoal / observedState to buildExecutionPrompt` — per-turn XML state block population; optional, additive, no behavior change at existing call sites.
3. `test(shared): replace prompts.test.ts with golden-file tests for new shape + invariants` — 48 tests covering 80-line cap, all markers, all failure categories, all tool names, per-turn block wiring, section ordering.

## Deviations from the seed spec

- **Protocol block uses pipe-delimited markers (`STEP_START|<step-id>|<short-title>`), not the seed's space-delimited form (`STEP_START id=<step_id> title=<short>`).** The seed prompt's example used `id=X title=Y` syntax. The existing `parseMarker` in `packages/shared/src/models.ts:747-786` only understands `MARKER|field1|field2`, so teaching the agent the space-delimited form would break every existing parse. Kept the pipe-delimited form — functionally identical from a 4B perspective (both are highly structured), and preserves the Wave 1.B parser contract exactly.
- **Merged `<failure_domains>` into its own block** rather than inlining the domain tokens into `<failure_categories>`. One extra section, +3 lines, but clarifies the distinction between "what kind of failure" (category) vs "what subsystem" (domain) — the two vocabularies have different cardinalities and lifespans in the eval schema.
- **Kept the `browserMcpServerName?: string` parameter on `buildExecutionSystemPrompt`.** Seed said "flat tool catalog" but did not address parameter surface. Executor calls `buildExecutionSystemPrompt()` with no args today; changing the signature would require an executor edit outside my scope. Kept it backwards-compatible.
