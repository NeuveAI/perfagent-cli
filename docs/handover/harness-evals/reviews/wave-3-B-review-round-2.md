# Review: Wave 3.B — Eval task set expansion to 20 (Round 2)

## Verdict: APPROVE

### Verification executed

- `git log --oneline` → 3 Wave 3.B commits on main (`dd8e7266`, `5ab597d3`, `8502f510`), all authored after 3.A's commits landed — wave separation is clean.
- `git show --stat dd8e7266 5ab597d3 8502f510` → only files under `packages/evals/tasks/`, `packages/evals/evals/smoke.eval.ts`, `packages/evals/tests/tasks.test.ts`. No `src/`, no `package.json`, no `pnpm-lock.yaml`, no test files other than `tasks.test.ts`, no formatter-drift files.
- `git status --porcelain` → working tree is clean of 3.B artifacts (only untracked diary/review docs remain).
- `pnpm --filter @neuve/evals test` → **4 files, 48/48 pass**.
- `pnpm --filter @neuve/evals typecheck` → PASS.
- `pnpm --filter @neuve/evals eval` → runs to completion; scored results table populates for all 20 tasks × 3 mock scenarios.
- `curl -sI https://archive.org/details/movies` → HTTP/2 200; `/details/tv` → 200; `/details/classic_tv` → 200 (archive.org public access confirmed).
- Negative-lookahead regex validated via Node: `^https?://(?!(?:www\.)?duckduckgo\.com)[^/]+/` correctly rejects `duckduckgo.com` / `www.duckduckgo.com` URLs and matches `typescriptlang.org` / `example.com`. All 5 unit cases pass.
- Grep `click|hamburger|nth-child|#[a-z-]+` against all 15 new fixtures → only hits are in `domAssertion` fields (`#maincontent` inside journey-6), zero hits inside `prompt:` strings. Overfitting guardrail holds.

### Findings

#### Critical — RESOLVED

- **[RESOLVED]** Round 1 Critical: journey-6 Netflix auth-gate → `journey-6-media-streaming.ts` now targets `archive.org/details/(movies|tv)` browse entry and `/details/<id>` title pages. All URLs returned 200 on curl. Prompt explicitly states "No login required." Flow remains a 5-key-node journey (browse → collection title → title page → related/alternate format → title view) — shape preserved, credentials not needed.

- **[RESOLVED]** Round 1 Critical: scope leak into `packages/evals/src/scorers/final-state.ts` → not in any 3.B commit. Belongs to a separate ambient-formatter concern unrelated to this wave.

- **[RESOLVED]** Round 1 Critical: Wave 3.A runner-switching logic entangled in `smoke.eval.ts` → `git show 8502f510 -- packages/evals/evals/smoke.eval.ts` shows only import additions and task-array extension. The runner-switching block was committed under Wave 3.A (`4956c76b`) and already on main before 3.B's commit, so the two waves are cleanly partitioned.

#### Major — RESOLVED

- **[RESOLVED]** `package.json` + `pnpm-lock.yaml` not in any 3.B commit.
- **[RESOLVED]** `tests/mock-runner.test.ts` + `tests/scorers.test.ts` whitespace edits not in any 3.B commit.
- **[RESOLVED]** Diary count mismatches (13→11, 45→48, 4→0 typecheck) — per the team-lead instruction, engineer updated the diary in a separate Wave 3.B doc edit. Round-2 tree shows correct counts (tests: 48; typecheck: green).
- **[RESOLVED]** calibration-5 third keyNode urlPattern now `^https?://(?!(?:www\.)?duckduckgo\.com)[^/]+/` — verified against 5 test URLs. DuckDuckGo (both `duckduckgo.com` and `www.duckduckgo.com`) correctly excluded. External typescript destination correctly matched.
- **[RESOLVED]** calibration-5 `expectedFinalState.urlPattern` uses the same negative lookahead — agent now has to actually leave DDG for the final state to match.

#### Minor — RESOLVED

- **[RESOLVED]** MDN concentration → calibration-1 swapped to `docs.python.org/3`. Site list now spans 14 distinct domains across 20 fixtures (Wikipedia, example.com, github.com, MDN, volvocars.com, python.org, BBC, REI, DuckDuckGo, BMW, Target, Google Flights, Figma, Progressive, archive.org, OWID, Stripe docs, TurboTax, Etsy, plus MDN retained on moderate-2 + calibration-3).
- **[RESOLVED]** journey-1 BMW: three consecutive configurator key-nodes now have distinct `domAssertion` values (`trim`/`model line`, `data-section='interior'`, `data-section='exterior'`) so the DOM discriminates the steps even if the SPA URL does not change. Better.
- **[RESOLVED]** journey-7 OWID: hashed `TimelineComponent` class replaced with `input[type='range']` + aria-label predicates. Stable across site refreshes.

#### New findings (Round 2)

None. Scope is clean, functionality holds, overfitting guardrail holds, accessibility confirmed for the previously-failed fixture.

#### Info

- **[INFO]** calibration-5's first keyNode (`^https://duckduckgo\.com/?$`) and the search-results keyNode (`^https://duckduckgo\.com/(\?q=typescript|.*[?&]q=typescript)`) still allow `duckduckgo.com` itself — which is correct because steps 1 and 2 are meant to be on DDG. Only steps 3 and final-state require leaving DDG. Logic consistent.

- **[INFO]** journey-6 archive.org's middle keyNode (`domAssertion: "a[href^='/details/']"`) matches a relative-URL pattern common to archive.org collection/detail pages — the scorer will see this inside the HTML, which is the right signal. Not a concern; noting so a future edit doesn't "simplify" it away.

- **[INFO]** All 15 fixtures still decode via `new EvalTask({...})` Schema.Class; `tests/tasks.test.ts` exercises decoding + the 5 structural invariants (calibration count, journey key-node range, per-journey required perfCapture, perfBudget ≥50% coverage, total=20). Test run 48/48.

- **[INFO]** Across 15 new prompts re-read in round 2, no site-specific navigation heuristics, no click sequences, no DOM recipes. Engineer preserved the overfitting discipline through the revision cycle — not a regression surface.

### Suggestions (non-blocking, carry to future waves)

- When Wave 3.A's real runner is wired against a live agent, capture one full ndjson trace per fixture and commit a small sample set under `evals/traces/samples/` so the scorers' assertions can be exercised against realistic data without running the full harness every time.
- Consider adding a brief `// target signal:` one-liner inside each fixture describing which failure mode it is designed to catch. Would accelerate Wave 4.5 regression-report triage.

### Summary

All three Round 1 Critical blockers and all five Round 1 Major blockers are resolved via the three partitioned commits. Scope is clean; each 3.B commit touches only `tasks/`, `evals/smoke.eval.ts`, or `tests/tasks.test.ts`. Overfitting guardrail continues to hold. Public-accessibility guarantee for journey-6 is restored via archive.org. calibration-5's previously-trivial regexes now properly constrain what "opened an organic result" means. Verification commands all succeed: 48/48 tests, typecheck green, evalite mock run produces a scored 20×3 table.

Wave 3.B is ready to merge.
