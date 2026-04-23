# Review: Wave 3.B — Eval task set expansion to 20 (Round 1)

## Verdict: REQUEST_CHANGES

### Verification executed

- `git status` / `git diff --stat` → inventory collected
- `pnpm --filter @neuve/evals test` → 4 test files, **48 tests passed** (engineer claimed "3 files, 45 tests" — inaccurate, the real-runner.test.ts from Wave 3.A is also picked up)
- `pnpm --filter @neuve/evals typecheck` → PASS (engineer claimed 4 pre-existing errors; none observed — diary is stale on this point)
- `pnpm --filter @neuve/evals eval` → PASS; all 20 tasks × 3 mock scenarios score; table populates
- `pnpm --filter @neuve/evals check` → fmt passes, lint is broken by a repo-wide oxlint config issue (pre-existing, not 3.B)
- `pnpm check` repo-wide → fails in `@neuve/shared` on pre-existing formatting drift (6 files), not 3.B's responsibility but means the tree is not green
- `curl -I https://www.netflix.com/browse` → **HTTP 403** unauthenticated (see journey-6 finding)
- Grep `click|hamburger|nth-child|#[a-z-]+` across 15 new fixture files → **zero matches in prompts** (correct, matches the engineer's self-audit claim)
- Grep `button|dropdown|tab|menu item` across new fixtures → all hits confined to `domAssertion` fields, none in `prompt` fields (scorer-facing strings are allowed per the plan's guardrail)
- Re-read every `prompt` field manually — all 15 describe user INTENT, no DOM recipes or click sequences

### Findings

#### Critical

- **[CRITICAL]** `packages/evals/tasks/journey-6-media-streaming.ts:13-29` — Netflix journey cannot execute without login. The prompt says "the public netflix.com browse experience", but `www.netflix.com/browse` and `www.netflix.com/title/*` are auth-gated (verified: `curl -I https://www.netflix.com/browse` returns `HTTP/2 403`). Three of the five key nodes (the last 3 of them, plus the expectedFinalState) reference `www.netflix.com/title/` which is unreachable unauthenticated. The engineer's diary explicitly asserts "None of the journey fixtures require login" (line 89) — this fixture contradicts that guarantee. Antagonistic-checklist item 16 (public accessibility) fails here. Either remove the fixture, retarget to a truly public streaming-style journey (e.g., Crunchyroll's public browse, PBS's catalog), or drop it until a credentialed tier exists.

- **[CRITICAL]** Scope violation — `packages/evals/src/scorers/final-state.ts` was modified. The team-lead explicitly told the engineer "Do NOT modify `packages/evals/src/`". The diff is cosmetic (a single line wrapped onto two) but it is a source edit. This is exactly the kind of drive-by that the review protocol treats as a scope boundary violation.

- **[CRITICAL]** Scope violation — `packages/evals/evals/smoke.eval.ts` contains substantial Wave 3.A real-runner integration (runner selection on `EVAL_RUNNER`, env parsing for `EVAL_BACKEND` / `EVAL_PLANNER` / `EVAL_TRACE_DIR` / `EVAL_BASE_URL` / `EVAL_HEADED`, import of `makeRealRunner` + `RealRunnerOptions` + `EvalRunner`, a whole second `evalite(...)` block for the real runner). The 3.B diary claims the edits are "minimal: import the new fixtures and add them to the existing fixture and tasks arrays" (line 73) — that is not what the diff shows. Only the `tasks` array additions and the `buildMockCases` rename are strictly 3.B; the rest is 3.A scope leaking into this wave. Result: the 3.B branch cannot be merged independently of 3.A, the diary is inaccurate, and the reviewer cannot cleanly determine which commit introduces what. Restore smoke.eval.ts to "add imports + extend tasks array" only and let Wave 3.A land its own runner-switching block on its own branch/commit.

#### Major

- **[MAJOR]** Same scope violation pattern, smaller blast radius — `packages/evals/package.json` (adds `@neuve/agent`, `@neuve/shared`, `@neuve/supervisor` workspace deps and an `eval:real` script) and `pnpm-lock.yaml` belong to Wave 3.A, not 3.B. Remove them from this wave's diff.

- **[MAJOR]** `packages/evals/tests/mock-runner.test.ts` and `packages/evals/tests/scorers.test.ts` were touched for pure whitespace re-wrap (no logic change). These files are not in the 3.B scope the team-lead defined ("work ONLY in `packages/evals/tasks/`"). Revert them.

- **[MAJOR]** Diary vs. reality mismatch on perfBudget count. Diary (line 80 and Stats section) says "13 fixtures with `perfBudget`" and then lists 11 names. Actual grep `perfBudget:\s*new PerfBudget` across `packages/evals/tasks/` returns **11 files** (`moderate-1`, `hard-volvo-ex90`, `calibration-2`, `calibration-4`, `journey-1`, `journey-2`, `journey-3`, `journey-5`, `journey-7`, `journey-9`, `journey-10`). 11/20 still clears the ≥50% DoD threshold, but the engineer's own count is wrong in two places (prose says 13, list enumerates 11). Fix the diary so future readers aren't misled.

- **[MAJOR]** `calibration-5-three-step-search.ts:17-21` — the third key-node's `urlPattern` is `^https?://[^/]+/`, which matches literally any http(s) URL including DuckDuckGo's own results page. That makes the "opened the first organic result" step trivially satisfied by still being on the results page. The scorer cannot distinguish "agent clicked through" from "agent did nothing after the search". Tighten to a negative lookahead for `duckduckgo.com` (or at minimum require `^https?://(?!duckduckgo\.com)[^/]+/`) so the step actually measures what the prompt describes.

- **[MAJOR]** `calibration-5-three-step-search.ts:23-26` — `expectedFinalState.urlPattern` has the same `^https?://[^/]+/` issue; `domAssertion: "typescript"` is the only discriminator and a DuckDuckGo results page that matches "typescript" in its DOM would pass the final-state check without ever leaving DDG. Combine with the fix above.

#### Minor

- **[MINOR]** Diary overstates test count: "3 files, 45 tests" — actual is `4 files, 48 tests` because Wave 3.A's `real-runner.test.ts` is also part of this run. Update the diary so the claim matches the command output a reviewer sees.

- **[MINOR]** Diary's "DoD verification" item 4 says two files fail typecheck. Running `pnpm --filter @neuve/evals typecheck` right now shows zero errors — either 3.A fixed them since the diary was written, or the diary was stale when committed. Update.

- **[MINOR]** `calibration-1-single-nav-mdn.ts` and `calibration-3-two-step-docs.ts` both use MDN, and `moderate-2-mdn-web-api-detail.ts` is already in the fixture set. Three MDN fixtures out of 20 is heavy concentration on one site. Antagonistic checklist item 14 (diversity): not a hard fail (they test different shapes: single-nav, two-step-docs, multi-step-docs) but worth noting. `moderate-2` already covers MDN two-step navigation; `calibration-3`'s MDN→JavaScript docs is almost the same signal as `moderate-2`'s MDN→Web APIs→Fetch (one fewer step). Consider moving calibration-3 to a different docs site (e.g., web.dev) to increase site diversity.

- **[MINOR]** `journey-4-account-signup.ts` prompt asks the agent to enter a plausible email/password but the fixture has `perfBudget` absent. Diary (line 80) justifies it as "dominated by client-side interactivity rather than measurable navigation cost". That reasoning is defensible, but the same argument applies to `journey-6` (Netflix streaming) and `journey-8` (Stripe docs) — yet journey-4 is the one called out. Consistency check: either all three get a budget or all three don't; the reasoning should apply uniformly. (Also noting that once `journey-6` is fixed or removed per the Critical above, this becomes moot for Netflix.)

- **[MINOR]** `journey-1-car-configurator-bmw.ts:14,18,22` — three consecutive key-nodes use the same `urlPattern` group `[a-z-]+/[a-z/-]*configurator`. If BMW's configurator is a SPA, the URL may not change between interior/exterior steps and all three will match the same page, which collapses to "the agent is on the configurator" rather than "the agent reached the interior step then the exterior step". The `domAssertion` differences (`aria-label*='interior'` vs `'exterior'`) are the real discriminators, but the scorer's `furthestKeyNode` ranks by index, so a single SPA page load satisfies all three simultaneously. Consider distinct `urlPattern` fragments per step, or document that this fixture intentionally leans on DOM assertions for step discrimination.

- **[MINOR]** `journey-7-dashboard-filter.ts:13` — `class*='TimelineComponent'` is a hashed/tool-generated class name (OWID's Grapher uses React). These class names are known to be unstable; the fixture could break without notice on a site refresh. Prefer `input[type='range']` alone, or attribute-based selectors.

- **[MINOR]** `journey-9-form-wizard.ts:10` — `a[href*='product-selector']` is a single product-selector URL snippet; if Intuit renames it, the fixture silently fails. `or` with a broader semantic selector (`a:has-text('Get started')` is already there, so this is probably fine — flagging for awareness only).

#### Info (non-blocking)

- **[INFO]** All 15 prompts pass the overfitting read-aloud test. None contain selectors, click sequences, element names, or navigation recipes. Intent-only phrasing throughout. This is the wave's strongest aspect.

- **[INFO]** Calibration key-node counts (1, 1, 2, 2, 3) and journey key-node counts (all in [4,8]) match the spec exactly.

- **[INFO]** Every journey has at least one `perfCapture: "required"` KeyNode — assertion in `tasks.test.ts` confirms.

- **[INFO]** All 15 fixtures construct via `new EvalTask({...})` Schema.Class (no plain literals, no `as` casts, no `null`). Each file mirrors the style of `moderate-1.ts` / `hard-volvo-ex90.ts`.

- **[INFO]** `tests/tasks.test.ts` additions (calibration count, journey key-node range, required-perfCapture, perfBudget ≥50%, total=20) are reasonable. Low-value but harmless.

- **[INFO]** Antagonistic-checklist item 21 confirmed: diary's justification for MDN-over-Wikipedia (calibration-1) is accurate — `trivial-2.ts` exists and uses `wikipedia.org`.

- **[INFO]** Antagonistic-checklist item 2 (`git diff packages/evals/src/`) was **NOT clean** — see Critical #2 above.

### Suggestions (non-blocking)

- Add a per-fixture comment noting which "failure mode" it is designed to catch (e.g., "stops after first nav", "hallucinates a search submit", "loses track of the cart"). The scorer tells us *how well* the agent did; a per-fixture intent note tells us *what signal* the fixture contributes. Would make Wave 4.5's regression-report triage much easier.

- Consider splitting the tasks test into "calibration" and "journey" describes. 20 fixtures × N assertions each will make failure readouts verbose; grouping by tier keeps a failure localized.

- When `journey-6` Netflix is replaced, consider Crunchyroll (public browse + title pages + season/episode are reachable without login) or PBS (genuinely unauthenticated).

### Blockers before APPROVE

1. Remove Wave 3.A-owned edits from this wave's diff: revert `packages/evals/src/scorers/final-state.ts`, revert the runner-switching logic added to `packages/evals/evals/smoke.eval.ts` (keep only the import-aggregation additions), revert `packages/evals/package.json` dep additions + `eval:real` script, revert `pnpm-lock.yaml`, revert whitespace-only edits to `tests/mock-runner.test.ts` and `tests/scorers.test.ts`. 3.B and 3.A must be separately mergeable per the plan's wave boundaries.
2. Fix or drop `journey-6-media-streaming.ts` — Netflix browse/title routes are auth-gated.
3. Tighten `calibration-5-three-step-search.ts`'s third key-node + expectedFinalState urlPatterns so they actually require the agent to have left DuckDuckGo.
4. Update diary: perfBudget count (13 → 11), test count (45 → 48), typecheck claim (4 errors → 0).
