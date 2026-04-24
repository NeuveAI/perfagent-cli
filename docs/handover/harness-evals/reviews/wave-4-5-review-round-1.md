# Review: Wave 4.5 — Baseline vs current regression eval (Round 1)

## Verdict: APPROVE

Wave 4.5 was explicitly a measurement wave with a fallback path flagged in the seed ("`EVAL_RUNNER=mock` as the fallback and explicitly document the limitation"). The engineer honored that fallback, declared it loudly at the top of both diary and report, captured a truthful mock-invariance finding, and produced a reusable revert procedure + static-diff projection + overfitting audit. Every factual claim I spot-checked was correct (within a trivial byte-count typo noted below). No runtime code mutated. No destructive git. Main tree clean, throwaway branches deleted. Scope hygiene clean. APPROVE.

### Verification executed

- `git branch -a` → `main` only; `baseline-b1` and `baseline-b2` absent. Pass.
- `git status` → `nothing to commit, working tree clean`. Main is ahead of origin by 70 commits (pre-existing, expected), not related to this wave.
- `git log --oneline -10` → top 3 commits are `aaad0015`, `b12f01f2`, `6fcb7e4e` — all `docs(harness-evals):`. No reverts leaked onto main from this wave. (Unrelated older `Revert ...` commits exist further back in history; none correspond to Wave 4.5.)
- `git show {6fcb7e4e,b12f01f2,aaad0015} --stat` → all three touch only `docs/handover/harness-evals/baselines/` or `docs/handover/harness-evals/diary/`. Zero runtime paths. Pass.
- `wc -c wave-4-5-{current,baseline-b1,baseline-b2}.json` → all three are **349598 bytes** (engineer's diary and commit message say 349597 — off by one, see Minor below). All three identical size.
- `diff` on the three JSONs: only differences are `createdAt` timestamps and a lone `endTime`-style numeric; no other substantive content differs.
- `diff <(jq '.suites[].evals[] | {id, scenario, scores, averageScore}' current.json) <(jq ... b1.json)` → empty. Same for b2.json. Score byte-identity confirmed.
- Commit-existence scan of all 21 claimed shas (`c49ccf91 7464d55f b2169cb3 9409b367 80967963 e6d12d3d 84babdfe 3cd19556 91aea83f 575d126a 1b75e23f c8eaff83 d37eef61 e1f23a12 b4815640 c1614c66 de0e9fba b14e5ed4 e87a8442 61b08a96 1f76cf5d`) → all 21 resolve, subjects match diary verbatim. 6+4+7+2+2 = 21. Pass.
- `git show 3cd19556 --stat` → `packages/shared/src/prompts.ts | 16 ++++++++--------, 1 file changed, 8 insertions(+), 8 deletions(-)`. `git show 3cd19556 -- packages/shared/src/prompts.ts` shows a new `<abort_channel>` XML block being added to `buildExecutionSystemPrompt`. Confirmed: the `docs(shared):` prefix is misleading, runtime prompt text IS modified. Engineer's F2 finding is correct.
- Overfitting grep (`volvo|bmw|netflix|mdn|bbc|github|wikipedia|example\.com|python` case-insensitive) on `packages/shared/src/prompts.ts` → zero hits.
- Same grep on `packages/supervisor/src/planner-prompt.ts` → zero hits. File exists at the claimed path.
- CSS-selector grep (`nth-child|data-|aria-label=|onclick|#nav-|:nth-of-type`) on `packages/shared/src/prompts.ts` → zero hits.
- `PlanDecomposer\.of|PlanDecomposer\.make` search across `packages/evals` → two hits: `packages/evals/tests/gemma-runner.test.ts:136` and `packages/evals/tests/real-runner.test.ts:138`. Exactly matches engineer's claim that 2 files × {2,3} tests = 5 fail under B1 where `PlanDecomposer` is removed.
- `pnpm --filter @neuve/evals test` on main → `9 test files / 81 tests passed`. Matches engineer's "81/81 on main" claim verbatim.

### Findings

#### Scope hygiene — all green

- [INFO] The three Wave 4.5 commits (`6fcb7e4e`, `b12f01f2`, `aaad0015`) are all docs-only and touch exclusively `docs/handover/harness-evals/baselines/` and `docs/handover/harness-evals/diary/`. No supervisor, browser, evals, shared, or CLI runtime paths. Zero tolerance requirement met.

#### Git hygiene — all green

- [INFO] `baseline-b1` and `baseline-b2` throwaway branches are deleted; engineer's "State after wave" claim is accurate. No destructive git on main. Reverts did not leak.

#### JSON invariance claim — supported but with a byte-count typo

- [MINOR] Engineer's diary and the `6fcb7e4e` commit message state "349597 bytes each". Actual file size on disk is 349598 bytes. Off-by-one (likely a `wc -c` newline or copy error during the report draft). Does not affect any conclusion — the three JSONs are still byte-identical in size AND in the `scores` sub-tree — but the numeric claim in the artifact is literally false. Consider correcting in a follow-up or noting here.
- [INFO] Score byte-identity is the primary invariance claim and it is rigorously true: the full `jq '.suites[].evals[] | {id, scenario, scores, averageScore}'` projection diffs empty across all three JSONs. The only files differences are run timestamps.

#### Revert list correctness — all green

- [INFO] All 21 B1 commits and both B2 commits exist, match the diary's subject lines, and correspond exactly to Waves 1.A (6) + 1.B (4) + 2.A (7) + 2.B (2) + 2.C (2) = 21. No non-Wave commits sneaked in. No Wave commits missed.
- [INFO] B2's 2 commits (`1b75e23f`, `c8eaff83`) are exactly the Wave 2.B pair (prompt rewrite + golden-file tests). Correct.
- [INFO] Exclusion decisions (docs commits, Wave 0, Wave 3, Wave 4, `65c4f3c6` vite-plus fix) are sound. Wave 3 being excluded is especially important — reverting Wave 3 would break the measurement apparatus itself.

#### F2 — `docs(shared):` prefix hides runtime change

- [INFO] Verified independently. `3cd19556` is authored with a `docs(shared):` prefix but its diff adds 5 new lines of agent-visible prompt text (the `<abort_channel>` block describing abort semantics). The engineer's F2 catch is valid and the manual inclusion in the B1 revert set is correct. This is a real anti-pattern for any future automated revert script that filters on commit subject — good lesson to have surfaced.

#### Static-diff analysis quality — adequate for a measurement-wave with no runtime numbers

- [INFO] Each of the 5 wave-blocks in Part 2 of the report ties its predicted scorer movement to a specific code-level mechanism:
  - Wave 1.A: "executor synthesizes an empty plan and agent freestyles — reproducing the original Wave 0 Volvo failure mode" → step-coverage/furthest-key-node ↓ on multi-step tasks, trivial tasks unchanged. Mechanism clear.
  - Wave 1.B: premature `RUN_COMPLETED` terminates the stream → step-coverage/final-state ↓, overlaps with 1.A effect (explicitly noted). Mechanism clear.
  - Wave 2.A: without `click`/`fill` tools, Gemma-class 4B has to compose `evaluate_script` JS and typically fails in 2–3 attempts → tool-call-validity ↓ sharply for Gemma, mildly for frontier. Mechanism clear and consistent with the plan's 4B-capability thesis (plan.md:30-31).
  - Wave 2.B: old prompt's "primary route" bias overrides decomposer's multi-step plan on a 4B model, milder on frontier. Mechanism clear, direction-appropriate.
  - Wave 2.C: without SOM overlays the agent must use raw CSS/aria selectors; on multimodal runners (Gemma 3n E4B with vision) the impact is strong, on text-only is zero. Mechanism clear.
- The summary matrices at report:247 and report:259 are the load-bearing artifact from Part 2. They are internally consistent: no prediction would move a per-task score opposite to its task-group mates, which is congruent with the Part 3 overfitting-guard finding. **Not flagged.**

#### Overfitting guardrail — green

- [INFO] Independently verified: no literal site names (`volvo`, `bmw`, `wikipedia`, `github`, `mdn`, `python`, `example.com`) in `packages/shared/src/prompts.ts` or `packages/supervisor/src/planner-prompt.ts` on main. No nth-child, no data-* selectors, no onclick patterns. Engineer's Part 3 grep is correct and the "prompts teach frameworks, not heuristics" guardrail is upheld by the current code.

#### Test-suite sanity — verified

- [INFO] Main: 81/81 pass. `PlanDecomposer.of` references confirmed in `gemma-runner.test.ts:136` and `real-runner.test.ts:138`. B1's predicted 5-test breakage is mechanistically correct: those two files construct a scripted `PlanDecomposer` layer using `PlanDecomposer.of({...})`, and Wave 1.A is where that service is introduced. Recording this in F1 (not fixing) is the correct call for a measurement-only wave.

#### Report structure and honesty — green

- [INFO] The TL;DR leads with "scores are byte-identical across all three branches because the mock runner's output is a function of `(task, scenario)` only", which is the honest framing. Does not overclaim. The "Narrative" block at report:29 explicitly says "the prompt rewrite and the plan-decomposer leave the measured score untouched because the runner doesn't exercise them" — this is the right thing to tell a future reader instead of the misleading "Δ=0 therefore no impact".
- [INFO] The "Reproduce" section at report:352 gives concrete bash: prerequisites, the 21 revert shas in LIFO order, environment variables, output paths. A future provisioned-box operator can run this directly. Complete.
- [INFO] The "Limitations and known caveats" section at report:334 lists 5 limitations, starting with mock invariance as the core constraint. Appropriately defensive.

### Suggestions (non-blocking)

- The byte-count typo (349597 vs 349598) could be corrected in a short follow-up commit if anyone references those numbers downstream. Low priority.
- Part 2's directional prediction matrices use `−−`/`−`/`0`/`+` which is readable but lacks a way to compare predicted magnitudes across different scorers on the same task. If a future real-runner sweep lands, consider upgrading those cells to predicted Δ-ranges (e.g. `−0.15 to −0.30`) so the eventual measured-vs-predicted comparison is calibratable. Optional.
- F2's lesson ("conventional-commit subject prefix is unreliable for auto-revert scripts") would benefit from being hoisted to the plan.md's "Reference material" or a guardrails note so Wave 6+ baseline automation picks it up. Optional and out-of-scope for this wave.

### Note on APPROVE rationale despite "no measured numbers"

Per the reviewer seed: "APPROVE should acknowledge the 'measured numbers pending on provisioned env' limitation as acceptable given the original measurement constraint. Don't REQUEST_CHANGES just because numerical deltas weren't produced — that's environment-bound."

The engineer chose the mock-runner fallback explicitly because (a) no provisioned ACP/Playwright unattended backend exists in this environment, (b) Wave 4 already hit the same wall and punted with a placeholder JSON, and (c) the 10-minute bash-command timeout is incompatible with a 60-run real-browser sweep. The diary's runner-choice rationale (diary:120-142) is defensible and cites the exact seed guidance that blesses this fallback. The regression report compensates for the flat numerical table with a code-reading static-diff projection that I verified against the actual reverted commits — the predictions are grounded in mechanisms that are present in the diffs I spot-checked. The overfitting audit and the F2 docs-prefix finding are both real substantive contributions that improve the harness-evals handover.

APPROVE.
