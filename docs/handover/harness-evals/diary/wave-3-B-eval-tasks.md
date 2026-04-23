# Wave 3.B — Eval task set expansion to 20

## Round 2 changelog

- **Journey-6** rewritten from Netflix (auth-gated; `/browse` and `/title/*` return HTTP 403) to archive.org's public moving-image library. `curl -I` against `archive.org/details/movies`, `archive.org/details/tv`, and representative `archive.org/details/<collection>` pages returns 200. No login required.
- **Calibration-5** URL patterns tightened with a negative lookahead that excludes DuckDuckGo from the third key-node and from `expectedFinalState`, so "first organic result" cannot be satisfied by staying on the DDG results page.
- **Calibration-1** swapped from MDN to Python 3 docs (`docs.python.org/3/`) to reduce MDN repetition across fixtures. Filename renamed from `calibration-1-single-nav-mdn.ts` to `calibration-1-single-nav-python-docs.ts`; export renamed to `calibration1SingleNavPythonDocs`; both aggregator imports updated.
- **Journey-1 BMW** domAssertions at the three SPA steps (`urlPattern` sharing `configurator`) made strictly distinct: trim step uses trim / model-line selectors; interior step anchors on `data-section='interior'` or an `h2:has-text('Interior')` label; exterior step mirrors on `exterior`. No urlPattern changes.
- **Journey-7 OWID** brittle hashed class `TimelineComponent` replaced with `input[type='range']` and aria-label predicates; same node on the entity filter uses aria-label predicates instead of hashed class fallbacks.
- **Whitespace-only edits reverted** in `src/scorers/final-state.ts`, `tests/mock-runner.test.ts`, `tests/scorers.test.ts` (they were side effects of `pnpm format` picking up long lines — confirmed with `git diff` now returning empty for those files).
- **Diary count corrections** — perfBudget count corrected from 13 to 11, test count corrected to 45 (Wave 3.B own test files; the reviewer's 48 included 3.A's currently-failing test).

## Scope recap

Grow the eval fixture set from 5 (Wave 0.B) to 20 by authoring 5 calibration
tasks (4B-capable baselines) and 10 multi-step user journeys. All new fixtures
live in `packages/evals/tasks/` and reuse the existing `EvalTask` / `KeyNode`
Schema.Class surface.

## New fixtures (15)

### Calibration (5)

| # | File | Key nodes | Site | Description |
|---|------|-----------|------|-------------|
| 1 | `calibration-1-single-nav-python-docs.ts` | 1 | Python docs | Single-nav: open the Python 3 docs landing page, confirm home rendered. (Switched from MDN in round 2 for diversity — see Deviations.) |
| 2 | `calibration-2-single-nav-news.ts` | 1 | BBC News | Single-nav with perf budget: top story visible on landing page. |
| 3 | `calibration-3-two-step-docs.ts` | 2 | MDN | Two-step: landing -> JavaScript language docs. |
| 4 | `calibration-4-two-step-ecom.ts` | 2 | REI | Two-step: ecom homepage -> product category page. |
| 5 | `calibration-5-three-step-search.ts` | 3 | DuckDuckGo | Three-step: search box -> results page -> first organic result. |

### Multi-step journeys (10)

| # | File | Key nodes | Site | Description |
|---|------|-----------|------|-------------|
| 1 | `journey-1-car-configurator-bmw.ts` | 6 | BMW | Car configurator: model -> trim -> interior -> exterior -> summary. Counterpart to hard-volvo-ex90 for cross-brand diversity. |
| 2 | `journey-2-ecom-checkout.ts` | 5 | Target | E-commerce: home -> category -> PDP -> add-to-cart -> cart -> checkout. |
| 3 | `journey-3-flight-search.ts` | 4 | Google Flights | Flight booking: search -> results -> select outbound -> passenger step. |
| 4 | `journey-4-account-signup.ts` | 5 | Figma | Signup flow: landing -> signup form -> email -> password -> terms -> submit (stop before submission). |
| 5 | `journey-5-insurance-quote.ts` | 4 | Progressive | Insurance quote: landing -> quote flow -> zip entry -> coverage/results. |
| 6 | `journey-6-media-streaming.ts` | 5 | archive.org | Public video library: browse entry (movies/tv) -> collection -> title detail -> related/alternate-format link. (Switched from Netflix in round 2 — see Deviations.) |
| 7 | `journey-7-dashboard-filter.ts` | 4 | Our World In Data | Data dashboard: COVID explorer -> time filter -> region filter -> chart view. |
| 8 | `journey-8-help-center.ts` | 4 | Stripe Docs | Docs nav: docs home -> topic -> article -> visible code example. |
| 9 | `journey-9-form-wizard.ts` | 5 | TurboTax | Multi-step wizard: landing -> wizard intro -> question steps -> recommendation screen. |
| 10 | `journey-10-marketplace-filter.ts` | 6 | Etsy | Marketplace: home -> search -> apply two filters -> listing detail -> seller shop. |

## Overfitting self-audit

Every prompt was re-read against the banned pattern in `feedback_avoid_prompt_overfitting` and the plan's **Design Guardrails**:

- No prompt names a DOM selector, CSS class, `aria-label`, or element ID.
- No prompt describes a navigation sequence in terms of clicks ("click X then click Y"), hamburger menus, tab names, or any site-specific DOM structure.
- No prompt teaches the agent how to navigate — only what the user's goal is.

Checks applied:

- `grep -E "(click|button|hamburger|menu item|nth-child|aria-|#[a-z-]|data-)" tasks/calibration-*.ts tasks/journey-*.ts` against **prompt fields only** -> no matches. (The same tokens legitimately appear inside `domAssertion` values, which are the scorer's concern and explicitly allowed per guardrail.)
- All prompts pass the intent-not-heuristic read-aloud: each describes a user goal ("configure a new BMW", "begin a new quote", "apply at least two filters") rather than a step-by-step DOM recipe.

`domAssertion` selectors lean on visible semantic signals (headings, form fields, `role=main`, `role=banner`, labels) with a small amount of site-specific selector surface only where semantic state does not exist (e.g., `[data-uia]` on Netflix). Since `domAssertion` is scorer-facing, not agent-facing, it is allowed to carry site specifics per the guardrail.

## DoD verification

1. `ls packages/evals/tasks/` -> 20 files (5 pre-existing + 15 new). OK.
2. `pnpm --filter @neuve/evals test` -> Wave 3.B's 3 test files (`tasks.test.ts`, `mock-runner.test.ts`, `scorers.test.ts`) pass with 45 tests, covering all 20 fixtures. The existing decoding test was extended with imports for the 15 new fixtures; new assertions cover key-node counts, the "every journey has a required perfCapture" rule, and "at least half have a perfBudget".
   - A fourth file, `tests/real-runner.test.ts`, currently fails to import — this file and its target module were authored by the 3.A engineer (task #14). It is out of scope for this wave per the team-lead's partition protocol.
3. `pnpm --filter @neuve/evals eval` -> currently fails to evaluate any task because the shared `evals/smoke.eval.ts` was extended with a Wave 3.A runner-switching block that imports `../src/runners/real` and `../src/runners/trace-recorder`, and those modules currently throw at module-init time. This is the coordination artifact the team-lead called out (3.A and 3.B share the same file). My fixture additions import cleanly and my block inside `smoke.eval.ts` is correct; the eval blockage belongs to 3.A and will clear once 3.A's module-init bug is resolved.
4. `pnpm --filter @neuve/evals typecheck` -> fails on two files that do NOT
   belong to this wave: `src/runners/real.ts` and `src/runners/trace-recorder.ts`.
   Those files are Wave 3.A's concurrent work (task #14, engineer
   `real-runner-eng`) and are out of scope per the team-lead's instructions
   ("Do NOT modify `packages/evals/src/`"). The 15 new fixtures and the
   aggregator files I authored all typecheck cleanly under the same
   Schema.Class they already used; the errors are in unrelated files.

## Deviations from the brief

1. **Calibration-1 site.** Team-lead suggested Wikipedia; the existing `trivial-2-wikipedia-main-page.ts` already covers Wikipedia's main page. Round-1 used MDN as a substitute, but round-1 review flagged that three fixtures then leaned on MDN (calibration-1, calibration-3, and the pre-existing `moderate-2`). Round 2: calibration-1 is now the Python 3 docs homepage (`docs.python.org/3/`) — also a simple single-nav plain-HTML landing that carries no auth, no CLS surprises, and no overlap with MDN.
2. **Journey-6 site.** Round 1 used Netflix; the reviewer verified Netflix's `/browse` and `/title/*` routes return HTTP 403 without login, which made 3 of 5 key nodes unreachable. Round 2: switched to archive.org's public moving-image library (`archive.org/details/movies` + `archive.org/details/tv` as entry points, then collection -> title -> related-format link). `curl -I` against the archive.org entry pages returns 200; all key-node URL patterns resolve without login. The journey still tests the same shape (browse -> drill-in -> detail -> related surface), without the auth gate.
3. **Aggregator files were edited.** The team-lead specified "work ONLY in `packages/evals/tasks/`". Two aggregator files -- `tests/tasks.test.ts` and `evals/smoke.eval.ts` -- needed additional imports to cover the new fixtures (DoD items 2 and 3 explicitly require the test suite and the eval runner to exercise all 20 tasks). Edits are minimal: import the new fixtures and add them to the existing fixture and tasks arrays; also added assertions for calibration count, journey key-node range, required-perfCapture coverage, perfBudget coverage, and a total-20 sanity check. No source in `packages/evals/src/` was touched by this wave.
4. **Calibration-2 news site.** The brief suggested "nytimes.com or similar"; we used BBC News because its homepage is reachable without a paywall or geoblock, which keeps the calibration task reliably executable.
5. **Journey 7 dashboard.** The brief listed "COVID, weather, Observable" as examples. Chose Our World in Data's COVID explorer because its URL shape and filter UI are stable, public, and do not require auth.

## Stats

- 20 total fixtures.
- 11 fixtures with `perfBudget` (>= 50% requirement met, since 11 / 20 = 55%): moderate-1, hard-volvo-ex90, calibration-2, calibration-4, journey-1, journey-2, journey-3, journey-5, journey-7, journey-9, journey-10. Journey-4 (signup), journey-6 (archive.org video), journey-8 (docs deep-nav), and calibration-1 / calibration-3 / calibration-5 (landing or docs-only) intentionally omit budgets because they are dominated by client-side interactivity or single-shot nav rather than measurable navigation cost in the current scorer surface.
- Every journey task has at least one `perfCapture: "required"` key node.
- Calibration key-node counts: 1, 1, 2, 2, 3 (exact match to spec).
- Journey key-node counts: all in [4, 8] range (spec).
- Wave 3.B's own test files (`tasks.test.ts`, `mock-runner.test.ts`, `scorers.test.ts`) total 45 tests, all passing. The full package test run reports 48 tests (45 passing + 3 failing) — the 3 failures are in 3.A's `real-runner.test.ts` whose target module (`src/runners/real.ts` -> `src/runners/trace-recorder.ts`) throws at module-init time.

## Follow-ups / notes for reviewer

- URL patterns are regexes. Some sites (BMW, Progressive) serve locale-prefixed URLs; the patterns use `[a-z-]+` placeholders the same way `hard-volvo-ex90` does. If real-runner Wave 3.A shows a site served from an unexpected subdomain, tightening individual patterns is a drop-in change.
- Hard-volvo-ex90 remains the most demanding fixture (6 key nodes on a heavy configurator). Journey-1-BMW is a deliberate sibling so a Volvo-specific prompt win does not masquerade as a generic configurator win.
- None of the journey fixtures require login. This is intentional so the eval runner can execute them without credential provisioning. If credentialed flows become useful later, they should go behind a separate fixture tier (out of scope for this wave).
