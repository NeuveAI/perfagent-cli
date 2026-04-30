# Wave R10 — Gemini Pro 3 teacher-viability probe baseline

_Generated 2026-04-30T17:07:15.667Z from `evals/traces/wave-r10-pro-preview` (60/60 traces present)._

**Runners:**
- `gemma-react` — production runtime; Gemma 4 E4B owns plan + execute via the ReAct loop.
- `gemini-react` — **Gemini Pro 3 (`gemini-3-pro-preview`, server-resolved to `gemini-3.1-pro-preview`)** driving the same ReAct loop. **R10 lift over R9's `gemini-3-flash-preview`.**
- `gemma-oracle-plan` — ablation; Gemini Flash 3 decomposes upfront, Gemma executes via ReAct (planner unchanged from R9).

**SKU verification**: Direct `generateContent` curl against `gemini-3-pro-preview` returned 200 with `modelVersion: "gemini-3.1-pro-preview"` in the response payload. Pro 3 emits a `thoughtSignature` and ~140 reasoning tokens per round transparently — relevant for token accounting on the gemini-react lane.

**Sweep command**: `PERF_AGENT_GEMINI_REACT_MODEL=gemini-3-pro-preview EVAL_TRACE_DIR=evals/traces/wave-r10-pro-preview pnpm --filter @neuve/evals eval:wave-r5-ab`. No source-side flip — env-var override only, per the R10 plan locked entry point.

**Teacher delta (gate-relevant, gemini-react − gemma-react)**:

| Metric | gemma-react | gemini-react (Pro 3) | Δ | Gate |
|---|---|---|---|---|
| Mean step-coverage | 0.307 | 0.473 | **+0.166** | ≥ +0.10 → **CLEARED** |
| Mean furthest-key-node | 0.375 | 0.486 | +0.111 | — |

**Per-task win/tie/loss (step-coverage, gemini-pro vs gemma)**: 8 wins / 11 ties / 1 loss (`hard-volvo-ex90-configurator` only).

## Aggregate scoreboard

| Runner | Tasks | Pass | Fail | Incomplete | Mean step-coverage | Mean final-state | Mean tool-validity | Mean furthest-key-node | Mean total tokens | Mean peak prompt | Mean turns | Mean PLAN_UPDATEs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma-react | 20 | 5 | 2 | 13 | 0.307 | 0.150 | 0.000 | 0.375 | 81140 | 12703 | 9.7 | 0.0 |
| gemini-react | 20 | 7 | 13 | 0 | 0.473 | 0.100 | 0.000 | 0.486 | 227063 | 31036 | 9.8 | 0.0 |
| gemma-oracle-plan | 20 | 0 | 0 | 20 | 0.258 | 0.000 | 0.000 | 0.292 | 77160 | 12726 | 9.4 | 0.0 |

## Per-task summary

Cells: `<status>  cov=<step-coverage>  pu=<plan-update-count>  turns=<turn-count>`.
Status legend: `OK` = RUN_COMPLETED:passed, `FAIL` = RUN_COMPLETED:failed, `INCOMPLETE` = stream ended without RUN_COMPLETED.

| Task | gemma-react | gemini-react | gemma-oracle-plan |
|---|---|---|---|
| calibration-1-single-nav-python-docs | OK  cov=1.00  pu=0  turns=4 | OK  cov=1.00  pu=0  turns=2 | INCOMPLETE  cov=1.00  pu=0  turns=4 |
| calibration-2-single-nav-news | OK  cov=1.00  pu=0  turns=11 | FAIL  cov=1.00  pu=0  turns=15 | INCOMPLETE  cov=1.00  pu=0  turns=8 |
| calibration-3-two-step-docs | OK  cov=0.50  pu=0  turns=8 | OK  cov=0.50  pu=0  turns=11 | INCOMPLETE  cov=0.50  pu=0  turns=15 |
| calibration-4-two-step-ecom | FAIL  cov=0.00  pu=0  turns=8 | FAIL  cov=0.00  pu=0  turns=4 | INCOMPLETE  cov=0.00  pu=0  turns=8 |
| calibration-5-three-step-search | INCOMPLETE  cov=0.33  pu=0  turns=15 | FAIL  cov=0.33  pu=0  turns=6 | INCOMPLETE  cov=0.33  pu=0  turns=7 |
| hard-volvo-ex90-configurator | INCOMPLETE  cov=0.17  pu=0  turns=9 | FAIL  cov=0.00  pu=0  turns=3 | INCOMPLETE  cov=0.00  pu=0  turns=8 |
| journey-1-car-configurator-bmw | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=14 |
| journey-2-ecom-checkout | INCOMPLETE  cov=0.00  pu=0  turns=5 | FAIL  cov=0.40  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 |
| journey-3-flight-search | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=3 |
| journey-4-account-signup | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.20  pu=0  turns=7 | INCOMPLETE  cov=0.00  pu=0  turns=15 |
| journey-5-insurance-quote | INCOMPLETE  cov=0.00  pu=0  turns=7 | FAIL  cov=0.25  pu=0  turns=8 | INCOMPLETE  cov=0.00  pu=0  turns=7 |
| journey-6-media-streaming | INCOMPLETE  cov=0.80  pu=0  turns=6 | OK  cov=1.00  pu=0  turns=13 | INCOMPLETE  cov=0.00  pu=0  turns=15 |
| journey-7-dashboard-filter | FAIL  cov=0.25  pu=0  turns=10 | FAIL  cov=0.75  pu=0  turns=15 | INCOMPLETE  cov=0.25  pu=0  turns=15 |
| journey-8-help-center | INCOMPLETE  cov=0.25  pu=0  turns=15 | FAIL  cov=1.00  pu=0  turns=15 | INCOMPLETE  cov=0.25  pu=0  turns=10 |
| journey-9-form-wizard | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.20  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=8 |
| journey-10-marketplace-filter | INCOMPLETE  cov=0.17  pu=0  turns=6 | FAIL  cov=0.17  pu=0  turns=3 | INCOMPLETE  cov=0.17  pu=0  turns=6 |
| moderate-1-github-explore-topics | INCOMPLETE  cov=0.33  pu=0  turns=15 | OK  cov=0.33  pu=0  turns=7 | INCOMPLETE  cov=0.33  pu=0  turns=15 |
| moderate-2-mdn-web-api-detail | OK  cov=0.33  pu=0  turns=7 | OK  cov=0.33  pu=0  turns=15 | INCOMPLETE  cov=0.33  pu=0  turns=6 |
| trivial-1-example-homepage | INCOMPLETE  cov=0.00  pu=0  turns=4 | OK  cov=1.00  pu=0  turns=6 | INCOMPLETE  cov=0.00  pu=0  turns=6 |
| trivial-2-wikipedia-main-page | OK  cov=1.00  pu=0  turns=4 | OK  cov=1.00  pu=0  turns=5 | INCOMPLETE  cov=1.00  pu=0  turns=4 |

## Flagged regressions (Δ ≥ 0.2)

### gemma-react vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-2-single-nav-news | finalState | 1.000 | 0.000 | -1.000 | left-better |
| hard-volvo-ex90-configurator | furthestKeyNode | 0.667 | 0.000 | -0.667 | left-better |
| journey-2-ecom-checkout | stepCoverage | 0.000 | 0.400 | 0.400 | right-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.400 | 0.400 | right-better |
| journey-4-account-signup | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| journey-5-insurance-quote | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-5-insurance-quote | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-7-dashboard-filter | stepCoverage | 0.250 | 0.750 | 0.500 | right-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | stepCoverage | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-2-mdn-web-api-detail | finalState | 1.000 | 0.000 | -1.000 | left-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 1.000 | 0.333 | -0.667 | left-better |
| trivial-1-example-homepage | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |

### gemma-react vs gemma-oracle-plan

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | finalState | 1.000 | 0.000 | -1.000 | left-better |
| calibration-2-single-nav-news | finalState | 1.000 | 0.000 | -1.000 | left-better |
| hard-volvo-ex90-configurator | furthestKeyNode | 0.667 | 0.000 | -0.667 | left-better |
| journey-6-media-streaming | stepCoverage | 0.800 | 0.000 | -0.800 | left-better |
| journey-6-media-streaming | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| moderate-2-mdn-web-api-detail | finalState | 1.000 | 0.000 | -1.000 | left-better |

### gemma-oracle-plan vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | finalState | 0.000 | 1.000 | 1.000 | right-better |
| journey-2-ecom-checkout | stepCoverage | 0.000 | 0.400 | 0.400 | right-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.400 | 0.400 | right-better |
| journey-4-account-signup | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| journey-5-insurance-quote | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-5-insurance-quote | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-6-media-streaming | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-6-media-streaming | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-7-dashboard-filter | stepCoverage | 0.250 | 0.750 | 0.500 | right-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | stepCoverage | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 1.000 | 0.333 | -0.667 | left-better |
| trivial-1-example-homepage | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |

## R8/R9 invariants — gemma-react production path

| Invariant | R9 baseline | R10 sweep | Verdict |
|---|---|---|---|
| Empty-content tasks (R8 gate ≤ 0/20) | 0/20 | 0/20 | ✅ holds |
| Schema-invalid tasks (R9 gate ≤ 2/20) | 2/20 | **5/20** | ⚠️ regression-shaped, needs reviewer triangulation |

R10 schema-invalid affected tasks: `hard-volvo-ex90-configurator`, `journey-5-insurance-quote`, `journey-6-media-streaming`, `journey-10-marketplace-filter`, `trivial-1-example-homepage`. R9 baseline had `hard-volvo-ex90-configurator` and `journey-9-form-wizard`. `hard-volvo` overlaps; the other four R10 cases are new.

The R10 schema-invalid count is 5/20 (vs R9's 2/20). Two cuts on this:
1. **Single sweep run** — R7 phase-7 documented step-coverage variance of 0.07 between two zero-code-change runs, and R9 itself only ran the gemma lane once. We don't have multi-sample variance for schema-invalid count in the post-R9 codebase.
2. **No HEAD code change between R9 close-out and R10 sweep** — branch is `gemma-harness-lora` at `522fdab3` (R10 plan commit) on top of `d4bb8979` (R9 close-out). Local-agent rebuilt clean before sweep.

If schema-invalid count is genuinely run-to-run noisy in the 2-7 range (pre-R9 noise floor), R10's 5/20 is in-band. If R9's 2/20 was a real fix and R10's 5/20 is a regression, the gemma baseline (0.307 step-cov) is artificially depressed by ~3 extra aborts at turn 2-3 — making the "true" gemma baseline closer to R9's 0.372, and the teacher delta closer to **+0.10** (right at the gate, not safely above it).

Reviewer should triangulate this: re-run gemma lane only and observe the schema-invalid count distribution.

## Comparison vs R9 bridge-coerce baseline

R9 baseline lives at `docs/handover/harness-evals/baselines/wave-r9-bridge-coerce.md` (gemma-react only, 20/60 traces). Direct R9 ↔ R10 deltas on the gemma-react lane:

| Metric | R9 gemma-react | R10 gemma-react | Δ |
|---|---|---|---|
| Tasks PASS | 8 | 5 | -3 |
| Tasks FAIL | 2 | 2 | 0 |
| Tasks INCOMPLETE | 10 | 13 | +3 |
| Mean step-coverage | 0.372 | 0.307 | -0.065 |
| Mean final-state | 0.200 | 0.150 | -0.050 |
| Mean furthest-key-node | 0.425 | 0.375 | -0.050 |
| Mean total tokens | 68,848 | 81,140 | +12,292 |
| Mean turns | 9.8 | 9.7 | -0.1 |

The gemma drop is concentrated in the schema-invalid task set (3 PASS migrating to INCOMPLETE) and is consistent with the +3 schema-invalid count above.

## Cost (gemini-react Pro 3 lane only — gemma + oracle-plan are local Ollama / Flash 3)

- 20 tasks × mean 227,062 total executor tokens = 4,541,252 tokens consumed against `gemini-3-pro-preview`.
- Pro 3 emits implicit reasoning (`thoughtsTokenCount`) billed as output. Without published `gemini-3-pro-preview` rate (preview SKU), conservative estimate using `gemini-2.5-pro` rates ($1.25/Mtok input, $10/Mtok output) at a 70:30 input:output split: **~$17–$25** for the full sweep.
- Plan budgeted $30–60. Actual is comfortably under.

## Aggregate scoreboard

| Runner | Tasks | Pass | Fail | Incomplete | Mean step-coverage | Mean final-state | Mean tool-validity | Mean furthest-key-node | Mean total tokens | Mean peak prompt | Mean turns | Mean PLAN_UPDATEs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma-react | 20 | 5 | 2 | 13 | 0.307 | 0.150 | 0.000 | 0.375 | 81140 | 12703 | 9.7 | 0.0 |
| gemini-react (Pro 3) | 20 | 7 | 13 | 0 | 0.473 | 0.100 | 0.000 | 0.486 | 227063 | 31036 | 9.8 | 0.0 |
| gemma-oracle-plan | 20 | 0 | 0 | 20 | 0.258 | 0.000 | 0.000 | 0.292 | 77160 | 12726 | 9.4 | 0.0 |

Notes on the headline numbers:
- **gemini-react step-cov 0.473 > gemma 0.307**: +0.166, gate cleared.
- **gemini-react finalState 0.100 < gemma 0.150**: Pro 3 reaches more KeyNodes en route but terminates with `RUN_COMPLETED:failed` more often than Gemma (13 FAIL vs 2 FAIL). Pro 3 is "premature-completing" — it commits to RUN_COMPLETED before satisfying the final-state assertion. Distillation training data from Pro 3 will inherit this behavior unless the teacher-data export filter excludes premature-completion traces.
- **gemma-oracle-plan all 20 INCOMPLETE**: ablation lane is uniformly stream-terminated rather than RUN_COMPLETED. Behavior matches R5 ablation pattern (Gemini decomposes, Gemma can't follow the static plan past the first step). Not the gating signal for R10.

## Per-task win/tie/loss (gemini-pro vs gemma, step-coverage)

| Outcome | Tasks | Δ |
|---|---|---|
| **Pro WINS by ≥0.20** | journey-2-ecom-checkout (+0.40), journey-4-account-signup (+0.20), journey-5-insurance-quote (+0.25), journey-6-media-streaming (+0.20), journey-7-dashboard-filter (+0.50), journey-8-help-center (+0.75), journey-9-form-wizard (+0.20), trivial-1-example-homepage (+1.00) | 8 tasks |
| **Tie** | calibration-1, calibration-2, calibration-3, calibration-4, calibration-5, journey-1, journey-3, journey-10, moderate-1, moderate-2, trivial-2 | 11 tasks |
| **Pro LOSES by ≥0.20** | (none) | 0 tasks |
| Pro loses by < 0.20 | hard-volvo-ex90-configurator (-0.17) | 1 task |

**Pattern**: Pro 3's wins concentrate on the journey-* tasks — exactly the medium-hard agentic browsing flows we want to distill. Pro ties Gemma on the calibration/trivial tasks where Gemma is already at ceiling or floor. Pro loses only on `hard-volvo-ex90-configurator` (exotic configurator interactions), and loses by less than the regression-flag threshold.

This is the right shape for distillation: the teacher decisively beats the student on the bridge tasks (where there's headroom to teach), not just the easy tasks (where there's no signal).

## Gate verdict

| Gate (R10 plan §Wave gates) | Status |
|---|---|
| 1. Probe sweep numbers exist | ✅ 60/60 traces written |
| 2. Teacher delta determined | ✅ +0.166 step-coverage, per-task breakdown above |
| 3. Pro clears +0.10 gate → ship + open distillation | ✅ +0.166 ≥ +0.10 |
| 4. R8/R9 fixes intact | ✅ empty-content 0/20; ⚠️ schema-invalid 5/20 (vs ≤ 2/20 expected) |

3 of 4 gates clear unconditionally. Gate 4 needs reviewer triangulation on the schema-invalid count — see "R8/R9 invariants" section above.

## Recommendation

**Ship Path A (T3 source-flip to `gemini-3-pro-preview`)** with one caveat: confirm the schema-invalid 5/20 is run-to-run noise, not a regression, before counting the +0.166 delta as "decisive." If the schema-invalid count is regressive, the de-noised teacher delta is closer to the gate threshold and the recommendation should be re-examined.

The win pattern is unambiguously the right shape for distillation. The cost is comfortably under budget. The SKU is reachable and the env-var override path holds without source changes.

Reviewer (T2) should specifically audit:
1. Whether 5/20 schema-invalid is run-to-run noise (re-run gemma lane, observe distribution)
2. Whether Pro 3's premature-completion pattern (13 FAIL on gemini-react) will pollute distillation training data
3. Whether the +0.10 gate is defensible given R7 phase-7's documented 0.07 wider-than-delta variance

---

## Resolution (post-variance-check, post-Path-A)

This baseline was written immediately after the T1 sweep, before reviewer T2's variance characterization. The "Gate verdict" + "Recommendation" sections above capture the engineer's state at that point and are kept as-is for historical accuracy. **Outcome below supersedes the conditional language for any reader looking for the final R10 verdict.**

**Schema-invalid drift is task-stochastic noise, not regression.** Reviewer ran a gemma-only revisit sweep (zero code changes, freshly-built local-agent dist):

| Run | Schema-invalid | Step-cov | Empty-content |
|---|---|---|---|
| R9 baseline (`d4bb8979`) | 2/20 | 0.372 | 0/20 |
| R10 sweep (this report, `522fdab3`) | 5/20 | 0.307 | 0/20 |
| R10 revisit (zero-code-change re-run) | 4/20 | 0.321 | 0/20 |

Affected tasks differ across runs (R9: hard-volvo + journey-9; R10: trivial-1 + journey-{5,6,10} + hard-volvo; revisit: calibration-5 + journey-{3,4} + trivial-1). Only `trivial-1` overlapped between sweep and revisit. Task-stochastic by construction. R7 phase-7 documented 0.07 step-cov noise between zero-code-change runs; the 0.065 spread here (0.372→0.307) sits inside that band.

**Teacher delta robust across interpretations**:

| Comparison anchor | Pro 0.473 vs gemma | Verdict |
|---|---|---|
| R10 sweep gemma 0.307 | +0.166 | clears +0.10 by margin |
| R10 revisit gemma 0.321 | +0.152 | clears |
| R9 baseline gemma 0.372 (highest gemma observation) | **+0.101** | **at gate, still cleared** |
| 3-run mean gemma 0.333 | +0.140 | clears |

Worst-case +0.101 still clears. Direction-of-effect preserved on all interpretations because Pro's 8 wins are by ≥0.20 each — outside gemma's noise envelope.

**R9 gate widening — followup, not blocker**: the "≤2/20 schema-invalid" gate was anchored on a single R9 sample; the 2-5/20 band established here is the actual gemma-react reality. R9 gate should be relaxed to "≤5/20" or treated as a distribution in future waves. Captured in `project_baseline_eval_strategy.md`.

**Pro 3 stopping-criterion problem is two-shaped** (carry-forward to distillation wave): premature completion (13/20 RUN_COMPLETED:failed) AND over-execution past success (calibration-2, moderate-2). Distillation training data filter must require `RUN_COMPLETED:passed AND finalState == 1.0 AND step-coverage == 1.0`, NOT just `passed`. Status-only filter passes over-execution and fails premature; only the full conjunction isolates clean teacher trajectories. See `docs/handover/teacher-viability/diary/r10-2026-04-30.md` "Closure notes for the distillation wave" for full detail.

**Path A landed** at commit `1f02f39d` (`feat(evals): adopt gemini-3-pro-preview as gemini-react default`). Source-flip verified by smoke + 5-task partial sweep (per-task step-cov matched T1 sweep within the 0.07 noise band; direction-of-effect preserved on all 5 tasks). `PLAN_DECOMPOSER_MODEL_ID` and `JUDGE_DEFAULT_MODEL` deliberately left on Flash 3.

**Final R10 status**: INVESTIGATIVE-VERIFIED ship. Distillation pipeline unblocked.

---

Generated by `pnpm wave-r5-ab:report` from trace ndjson at run-time. Re-run after each sweep. Resolution section above is hand-authored and post-dates the auto-generated body.
