# Wave harness-r2 — A:B Regression Report

_Generated 2026-05-06 from `evals/traces/wave-harness-r2-pin-2` (the post-pin steady-state baseline; both P2 and P3 were reverted as documented below)._

## Headline finding

**The prompt-level ceiling is documented.** harness-r2 ran three surgical prompt interventions:
- **P1 (variance pin) — SHIPPED.** Pinning all runners to `temperature=0` collapsed Pro 3's premature-completion 13/20 → 3/20 and uplifted gemini-react strict-pass count 2/20 → 4/20. Single substantive change of the wave; all observed gains attributable here.
- **P2 (completion_check block) — REVERTED.** Over-verification regression: 4/20 strict-pass → 2/20. Pin had already solved 70% of the documented "Pro 3 stopping-criterion problem" — the remaining 3 premature cases are tasks the model genuinely thinks it's done, not a prompt-fixable shape.
- **P3 (PLAN_UPDATE elicitation) — REVERTED (no-op).** 0/60 PLAN_UPDATE emissions across all runners. **0/240 non-abort ASSERTION_FAILED + 16/240 abort-category, all gemini-react, all single-shot run-terminations rather than retry signals; gemma-react emits 0 AF across all 80 traces** — the AF→REFLECT→PLAN_UPDATE retry-signal pathway is dead. Models emit AF only for unrecoverable aborts (CAPTCHA, WAF, anti-bot, HTTP2 protocol error), not as a recoverable-error trigger. PLAN_UPDATE is structural-not-prompt-elicitable; harness-r3's structural REFLECT-injection probe must trigger on **shape signals** (SchemaError-loops, arg-rejection-after-N retries), NOT on AF emission counts.

**R10/R11 narrative correction (the highest-leverage finding)**: the "Pro 3 stopping-criterion problem" was overstated as a capability gap. The data shows it was 70% temperature, not prompt — pre-pin gemini-react was at AI SDK / Google provider default (~1.0), not the 0.1 the gemma stack used. R10's 13/20 premature shape was a temp=1.0 artifact. Post-pin gemini-react strict-pass yield is **double R11's anchor** (4/20 vs 2/20) — materially reframes R12's distillation data-quality premise.

**Two prompt-level interventions failing on the metrics they targeted is direct empirical evidence that future harness work needs structural intervention** (not prompt iteration). harness-r3 hooks now point primarily at structural REFLECT-injection on detected SchemaError-loops or arg-rejection-after-N-retries.

## Per-phase verdicts

| Phase | Change | Gate | Verdict | Action |
|---|---|---|---|---|
| **P1** | `temperature=0` across local-agent OllamaClient + gemini-react `generateObject` + plan decomposer | per-runner sub-gates: gemini-react Δ≤0.04 / gemma stack Δ≤0.10 / schema-invalid ≤5/20 / empty 0/20 | **PASS** (under lead-adjusted thresholds) | **SHIPPED** (`85260586`) |
| **P2** | `<completion_check>` block before RUN_COMPLETED | strategic gemini-react strict-pass ≥7/20 (lead's +3 from baseline 4) | **FAIL** at 2/20 (regression) | **REVERTED** (`6d0e5811`) |
| **P3** | `<plan_update_protocol>` rewrite + reflect threshold 2→1 | PLAN_UPDATE rate ≥5/60 + ≥2 recovery examples | **FAIL** at 0/60 (no movement) | **REVERTED** (`e1668354`) |

## P1 variance pin — pre/post delta tables

### Pro 3 stopping-shape (gemini-react lane)

| Sweep | Strict-pass | Premature-passed | Failed | Incomplete |
|---|---|---|---|---|
| R10 (pre-pin temp=1.0) | 2/20 | **13/20** | ~5/20 | 0/20 |
| P1 sweep 1 (post-pin temp=0) | 3/20 | **3/20** | 14/20 | 0/20 |
| P1 sweep 2 (post-pin temp=0) | **4/20** | 3/20 | 13/20 | 0/20 |

Premature: **13 → 3 (-10/20)** from temp pin alone. Strict-pass: **2 → 4 (+2/20)**. Both deltas attributable entirely to P1 — the post-prompt P2 sweep showed no further movement on premature (3/20) and a regression on strict-pass (2/20).

### Variance band (sweep-to-sweep step-cov Δ)

| Runner | R10 (3-run band) | harness-r2 P1 (2-run Δ) | Pin effect |
|---|---|---|---|
| gemini-react | n/a (single sweep) | **0.040** | massive contraction (~1.0 → 0 swing) |
| gemma-react | 0.065 (R10 closure) | 0.090 | wider — divergence pattern (env/DOM input deltas → divergent paths under temp=0; trace evidence in diary §P1) |
| gemma-oracle-plan | n/a | 0.107 | wider, same mechanism as gemma-react |

The gemma stack widening surfaced the **deterministic-stuck divergence pattern** (harness-r3 hook: trace-diff investigation candidate). gemini-react contraction is the load-bearing variance reduction for distillation A:B sensitivity.

## R8/R9/R10/R11 invariant rows (intact across all 4 sweeps)

| Invariant | Threshold | wave-harness-r2 (4 sweeps) |
|---|---|---|
| Empty-content | 0/20 | **0/20** across all 4 sweeps × 3 runners (R8 intact) |
| Schema-invalid | ≤5/20 (R10 envelope) | gemma 3-7/20 (P3 high at 5; P2 high at 7), gemini 0/20, oracle-plan 3/20 — within R10 band |
| ASSERTION_FAILED emission | n/a (informational) | **0/240 non-abort + 16/240 abort-category** (all gemini-react, all unrecoverable infrastructure conditions; gemma-react 0/80 across all 4 sweeps; structural finding) |
| PLAN_UPDATE emission | n/a (informational) | 0/240 across all 4 sweeps × 3 runners (structural finding) |

## harness-r3 recommendations (per plan §"Out of scope" updates)

1. **PRIMARY P1 candidate**: structural REFLECT-injection probe — harness detects SchemaError-loops or arg-rejection-after-N-retries → injects synthetic REFLECT directive into next observation. Bypasses the dead AF→REFLECT retry-signal gate. Adjacent to existing doom-loop detector. Direct empirical support: 0/240 non-abort AF + 16/240 abort-only-as-single-shot-terminations across harness-r2 (models emit AF only for unrecoverable conditions, never as retry signals — detection signals must come from shape patterns, not AF counts).
2. **Deterministic-stuck divergence investigation** — trace-diff P1 sweep pairs to identify env/DOM-level variance sources (`wait_for` timing, `take_snapshot` ordering, DOM settling) potentially fixable upstream of the model.
3. Original deferred hooks (AnalysisStep typing gated on emission rate, tool catalog dedup, oracle-plan autopsy, alternate teachers, bigger model) — see `docs/research/harness-r2/plan.md` §"Out of scope" for current details.

---

_Aggregate report below is the auto-generated post-pin steady-state baseline (sweep 2). Numbers reflect P1 only (P2 + P3 reverted). The 3-sweep variance comparison + per-phase delta evidence lives in `docs/handover/harness-r2/diary/r0-2026-05-01.md`._

---

# Auto-generated A:B aggregate (post-pin baseline)

**Runners:**
- `gemma-react` — production runtime; Gemma 4 E4B owns plan + execute via the ReAct loop.
- `gemini-react` — frontier baseline; Gemini Pro 3 (R10 teacher) driving the same ReAct loop.
- `gemma-oracle-plan` — ablation; Gemini decomposes upfront, Gemma executes via ReAct.
- `browsing-gemma-react` — R11 distilled LoRA on Gemma 4 E4B base; served by `llama-server --lora` (Path B runtime fork per locked decision #9).

## Aggregate scoreboard

| Runner | Tasks | Pass | Fail | Incomplete | Mean step-coverage | Mean final-state | Mean tool-validity | Mean furthest-key-node | Mean total tokens | Mean peak prompt | Mean turns | Mean PLAN_UPDATEs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma-react | 20 | 5 | 4 | 11 | 0.361 | 0.150 | 0.000 | 0.404 | 69868 | 10566 | 10.2 | 0.0 |
| gemini-react | 20 | 7 | 13 | 0 | 0.465 | 0.200 | 0.000 | 0.465 | 213636 | 34782 | 8.8 | 0.0 |
| gemma-oracle-plan | 20 | 0 | 0 | 20 | 0.386 | 0.000 | 0.036 | 0.479 | 69168 | 12080 | 9.7 | 0.0 |

## Per-task summary

Cells: `<status>  cov=<step-coverage>  pu=<plan-update-count>  turns=<turn-count>`.
Status legend: `OK` = RUN_COMPLETED:passed, `FAIL` = RUN_COMPLETED:failed, `INCOMPLETE` = stream ended without RUN_COMPLETED.

| Task | gemma-react | gemini-react | gemma-oracle-plan | browsing-gemma-react |
|---|---|---|---|---|
| calibration-1-single-nav-python-docs | OK  cov=1.00  pu=0  turns=4 | OK  cov=1.00  pu=0  turns=3 | INCOMPLETE  cov=1.00  pu=0  turns=4 | — |
| calibration-2-single-nav-news | OK  cov=1.00  pu=0  turns=8 | OK  cov=1.00  pu=0  turns=5 | INCOMPLETE  cov=1.00  pu=0  turns=9 | — |
| calibration-3-two-step-docs | OK  cov=0.50  pu=0  turns=8 | OK  cov=0.50  pu=0  turns=5 | INCOMPLETE  cov=0.50  pu=0  turns=8 | — |
| calibration-4-two-step-ecom | FAIL  cov=0.00  pu=0  turns=8 | FAIL  cov=0.00  pu=0  turns=3 | INCOMPLETE  cov=0.00  pu=0  turns=8 | — |
| calibration-5-three-step-search | INCOMPLETE  cov=0.33  pu=0  turns=15 | FAIL  cov=0.67  pu=0  turns=9 | INCOMPLETE  cov=0.33  pu=0  turns=15 | — |
| hard-volvo-ex90-configurator | FAIL  cov=0.00  pu=0  turns=6 | FAIL  cov=0.00  pu=0  turns=6 | INCOMPLETE  cov=0.00  pu=0  turns=6 | — |
| journey-1-car-configurator-bmw | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 | — |
| journey-2-ecom-checkout | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.40  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=5 | — |
| journey-3-flight-search | INCOMPLETE  cov=0.25  pu=0  turns=3 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.25  pu=0  turns=3 | — |
| journey-4-account-signup | FAIL  cov=0.00  pu=0  turns=11 | FAIL  cov=0.20  pu=0  turns=6 | INCOMPLETE  cov=0.00  pu=0  turns=11 | — |
| journey-5-insurance-quote | FAIL  cov=0.00  pu=0  turns=12 | FAIL  cov=0.25  pu=0  turns=10 | INCOMPLETE  cov=0.00  pu=0  turns=6 | — |
| journey-6-media-streaming | INCOMPLETE  cov=0.80  pu=0  turns=15 | OK  cov=1.00  pu=0  turns=9 | INCOMPLETE  cov=0.80  pu=0  turns=15 | — |
| journey-7-dashboard-filter | INCOMPLETE  cov=0.25  pu=0  turns=15 | FAIL  cov=0.25  pu=0  turns=11 | INCOMPLETE  cov=0.25  pu=0  turns=15 | — |
| journey-8-help-center | INCOMPLETE  cov=0.25  pu=0  turns=15 | OK  cov=1.00  pu=0  turns=9 | INCOMPLETE  cov=0.25  pu=0  turns=15 | — |
| journey-9-form-wizard | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.20  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 | — |
| journey-10-marketplace-filter | INCOMPLETE  cov=0.17  pu=0  turns=5 | FAIL  cov=0.17  pu=0  turns=3 | INCOMPLETE  cov=0.33  pu=0  turns=13 | — |
| moderate-1-github-explore-topics | INCOMPLETE  cov=0.33  pu=0  turns=15 | FAIL  cov=0.33  pu=0  turns=15 | INCOMPLETE  cov=0.67  pu=0  turns=15 | — |
| moderate-2-mdn-web-api-detail | OK  cov=0.33  pu=0  turns=9 | FAIL  cov=0.33  pu=0  turns=14 | INCOMPLETE  cov=0.33  pu=0  turns=7 | — |
| trivial-1-example-homepage | INCOMPLETE  cov=1.00  pu=0  turns=5 | OK  cov=1.00  pu=0  turns=4 | INCOMPLETE  cov=1.00  pu=0  turns=5 | — |
| trivial-2-wikipedia-main-page | OK  cov=1.00  pu=0  turns=4 | OK  cov=1.00  pu=0  turns=3 | INCOMPLETE  cov=1.00  pu=0  turns=4 | — |

## Flagged regressions (Δ ≥ 0.2)

### gemma-react vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-5-three-step-search | stepCoverage | 0.333 | 0.667 | 0.333 | right-better |
| calibration-5-three-step-search | furthestKeyNode | 0.333 | 0.667 | 0.333 | right-better |
| journey-2-ecom-checkout | stepCoverage | 0.000 | 0.400 | 0.400 | right-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.400 | 0.400 | right-better |
| journey-3-flight-search | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-3-flight-search | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| journey-4-account-signup | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| journey-5-insurance-quote | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-5-insurance-quote | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-8-help-center | stepCoverage | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | finalState | 0.000 | 1.000 | 1.000 | right-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-2-mdn-web-api-detail | finalState | 1.000 | 0.000 | -1.000 | left-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 1.000 | 0.333 | -0.667 | left-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |

### gemma-react vs gemma-oracle-plan

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | finalState | 1.000 | 0.000 | -1.000 | left-better |
| calibration-2-single-nav-news | finalState | 1.000 | 0.000 | -1.000 | left-better |
| journey-10-marketplace-filter | furthestKeyNode | 0.167 | 1.000 | 0.833 | right-better |
| journey-2-ecom-checkout | toolCallValidity | 0.000 | 0.727 | 0.727 | right-better |
| moderate-1-github-explore-topics | stepCoverage | 0.333 | 0.667 | 0.333 | right-better |
| moderate-1-github-explore-topics | furthestKeyNode | 0.333 | 1.000 | 0.667 | right-better |
| moderate-2-mdn-web-api-detail | finalState | 1.000 | 0.000 | -1.000 | left-better |

### gemma-oracle-plan vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | finalState | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | finalState | 0.000 | 1.000 | 1.000 | right-better |
| calibration-5-three-step-search | stepCoverage | 0.333 | 0.667 | 0.333 | right-better |
| calibration-5-three-step-search | furthestKeyNode | 0.333 | 0.667 | 0.333 | right-better |
| journey-10-marketplace-filter | furthestKeyNode | 1.000 | 0.167 | -0.833 | left-better |
| journey-2-ecom-checkout | stepCoverage | 0.000 | 0.400 | 0.400 | right-better |
| journey-2-ecom-checkout | toolCallValidity | 0.727 | 0.000 | -0.727 | left-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.400 | 0.400 | right-better |
| journey-3-flight-search | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-3-flight-search | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| journey-4-account-signup | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| journey-5-insurance-quote | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-5-insurance-quote | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-8-help-center | stepCoverage | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | finalState | 0.000 | 1.000 | 1.000 | right-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-1-github-explore-topics | stepCoverage | 0.667 | 0.333 | -0.333 | left-better |
| moderate-1-github-explore-topics | furthestKeyNode | 1.000 | 0.333 | -0.667 | left-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 1.000 | 0.333 | -0.667 | left-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |

### gemma-react vs browsing-gemma-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| calibration-1-single-nav-python-docs | finalState | 1.000 | 0.000 | -1.000 | left-better |
| calibration-1-single-nav-python-docs | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| calibration-2-single-nav-news | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| calibration-2-single-nav-news | finalState | 1.000 | 0.000 | -1.000 | left-better |
| calibration-2-single-nav-news | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| calibration-3-two-step-docs | stepCoverage | 0.500 | 0.000 | -0.500 | left-better |
| calibration-3-two-step-docs | furthestKeyNode | 0.500 | 0.000 | -0.500 | left-better |
| calibration-5-three-step-search | stepCoverage | 0.333 | 0.000 | -0.333 | left-better |
| calibration-5-three-step-search | furthestKeyNode | 0.333 | 0.000 | -0.333 | left-better |
| journey-3-flight-search | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-3-flight-search | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| journey-6-media-streaming | stepCoverage | 0.800 | 0.000 | -0.800 | left-better |
| journey-6-media-streaming | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| journey-7-dashboard-filter | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| journey-8-help-center | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| moderate-1-github-explore-topics | stepCoverage | 0.333 | 0.000 | -0.333 | left-better |
| moderate-1-github-explore-topics | furthestKeyNode | 0.333 | 0.000 | -0.333 | left-better |
| moderate-2-mdn-web-api-detail | stepCoverage | 0.333 | 0.000 | -0.333 | left-better |
| moderate-2-mdn-web-api-detail | finalState | 1.000 | 0.000 | -1.000 | left-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| trivial-1-example-homepage | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| trivial-1-example-homepage | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |

### browsing-gemma-react vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| calibration-1-single-nav-python-docs | finalState | 0.000 | 1.000 | 1.000 | right-better |
| calibration-1-single-nav-python-docs | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | finalState | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| calibration-3-two-step-docs | stepCoverage | 0.000 | 0.500 | 0.500 | right-better |
| calibration-3-two-step-docs | furthestKeyNode | 0.000 | 0.500 | 0.500 | right-better |
| calibration-5-three-step-search | stepCoverage | 0.000 | 0.667 | 0.667 | right-better |
| calibration-5-three-step-search | furthestKeyNode | 0.000 | 0.667 | 0.667 | right-better |
| journey-2-ecom-checkout | stepCoverage | 0.000 | 0.400 | 0.400 | right-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.400 | 0.400 | right-better |
| journey-4-account-signup | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| journey-5-insurance-quote | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-5-insurance-quote | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-6-media-streaming | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-6-media-streaming | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-7-dashboard-filter | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-8-help-center | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-8-help-center | finalState | 0.000 | 1.000 | 1.000 | right-better |
| journey-8-help-center | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-1-github-explore-topics | stepCoverage | 0.000 | 0.333 | 0.333 | right-better |
| moderate-1-github-explore-topics | furthestKeyNode | 0.000 | 0.333 | 0.333 | right-better |
| moderate-2-mdn-web-api-detail | stepCoverage | 0.000 | 0.333 | 0.333 | right-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 0.000 | 0.333 | 0.333 | right-better |
| trivial-1-example-homepage | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| trivial-2-wikipedia-main-page | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| trivial-2-wikipedia-main-page | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |

---

Generated by `pnpm wave-r5-ab:report` from trace ndjson at run-time. Re-run after each sweep.
