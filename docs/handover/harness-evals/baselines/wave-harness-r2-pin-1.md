# Wave R5 A:B Regression Report

_Generated 2026-05-01T23:55:14.463Z from `evals/traces/wave-harness-r2-pin-1` (60/80 traces present)._

**Runners:**
- `gemma-react` — production runtime; Gemma 4 E4B owns plan + execute via the ReAct loop.
- `gemini-react` — frontier baseline; Gemini Pro 3 (R10 teacher) driving the same ReAct loop.
- `gemma-oracle-plan` — ablation; Gemini decomposes upfront, Gemma executes via ReAct.
- `browsing-gemma-react` — R11 distilled LoRA on Gemma 4 E4B base; served by `llama-server --lora` (Path B runtime fork per locked decision #9).

## Aggregate scoreboard

| Runner | Tasks | Pass | Fail | Incomplete | Mean step-coverage | Mean final-state | Mean tool-validity | Mean furthest-key-node | Mean total tokens | Mean peak prompt | Mean turns | Mean PLAN_UPDATEs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma-react | 20 | 6 | 4 | 10 | 0.271 | 0.150 | 0.000 | 0.304 | 64662 | 11331 | 9.7 | 0.0 |
| gemini-react | 20 | 6 | 14 | 0 | 0.505 | 0.150 | 0.000 | 0.505 | 247089 | 30515 | 10.2 | 0.0 |
| gemma-oracle-plan | 20 | 0 | 0 | 20 | 0.279 | 0.000 | 0.035 | 0.346 | 74580 | 13172 | 9.9 | 0.0 |

## Per-task summary

Cells: `<status>  cov=<step-coverage>  pu=<plan-update-count>  turns=<turn-count>`.
Status legend: `OK` = RUN_COMPLETED:passed, `FAIL` = RUN_COMPLETED:failed, `INCOMPLETE` = stream ended without RUN_COMPLETED.

| Task | gemma-react | gemini-react | gemma-oracle-plan | browsing-gemma-react |
|---|---|---|---|---|
| calibration-1-single-nav-python-docs | OK  cov=1.00  pu=0  turns=4 | OK  cov=1.00  pu=0  turns=3 | INCOMPLETE  cov=1.00  pu=0  turns=4 | — |
| calibration-2-single-nav-news | OK  cov=1.00  pu=0  turns=8 | OK  cov=1.00  pu=0  turns=6 | INCOMPLETE  cov=1.00  pu=0  turns=10 | — |
| calibration-3-two-step-docs | OK  cov=0.50  pu=0  turns=8 | OK  cov=0.50  pu=0  turns=15 | INCOMPLETE  cov=0.50  pu=0  turns=10 | — |
| calibration-4-two-step-ecom | FAIL  cov=0.00  pu=0  turns=9 | FAIL  cov=0.00  pu=0  turns=4 | INCOMPLETE  cov=0.00  pu=0  turns=9 | — |
| calibration-5-three-step-search | FAIL  cov=0.33  pu=0  turns=9 | FAIL  cov=0.67  pu=0  turns=8 | INCOMPLETE  cov=0.33  pu=0  turns=7 | — |
| hard-volvo-ex90-configurator | FAIL  cov=0.00  pu=0  turns=9 | FAIL  cov=0.00  pu=0  turns=4 | INCOMPLETE  cov=0.00  pu=0  turns=5 | — |
| journey-1-car-configurator-bmw | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 | — |
| journey-2-ecom-checkout | INCOMPLETE  cov=0.00  pu=0  turns=5 | FAIL  cov=0.40  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=5 | — |
| journey-3-flight-search | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 | — |
| journey-4-account-signup | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=1.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 | — |
| journey-5-insurance-quote | FAIL  cov=0.25  pu=0  turns=12 | FAIL  cov=0.25  pu=0  turns=7 | INCOMPLETE  cov=0.25  pu=0  turns=14 | — |
| journey-6-media-streaming | INCOMPLETE  cov=0.00  pu=0  turns=6 | FAIL  cov=1.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=6 | — |
| journey-7-dashboard-filter | INCOMPLETE  cov=0.25  pu=0  turns=15 | FAIL  cov=0.25  pu=0  turns=15 | INCOMPLETE  cov=0.25  pu=0  turns=15 | — |
| journey-8-help-center | INCOMPLETE  cov=0.25  pu=0  turns=15 | FAIL  cov=1.00  pu=0  turns=15 | INCOMPLETE  cov=0.25  pu=0  turns=15 | — |
| journey-9-form-wizard | INCOMPLETE  cov=0.00  pu=0  turns=7 | FAIL  cov=0.20  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=7 | — |
| journey-10-marketplace-filter | INCOMPLETE  cov=0.17  pu=0  turns=8 | FAIL  cov=0.17  pu=0  turns=4 | INCOMPLETE  cov=0.33  pu=0  turns=14 | — |
| moderate-1-github-explore-topics | INCOMPLETE  cov=0.33  pu=0  turns=15 | OK  cov=0.33  pu=0  turns=13 | INCOMPLETE  cov=0.33  pu=0  turns=14 | — |
| moderate-2-mdn-web-api-detail | OK  cov=0.33  pu=0  turns=8 | OK  cov=0.33  pu=0  turns=7 | INCOMPLETE  cov=0.33  pu=0  turns=8 | — |
| trivial-1-example-homepage | OK  cov=0.00  pu=0  turns=6 | OK  cov=1.00  pu=0  turns=5 | INCOMPLETE  cov=0.00  pu=0  turns=6 | — |
| trivial-2-wikipedia-main-page | OK  cov=1.00  pu=0  turns=4 | FAIL  cov=1.00  pu=0  turns=7 | INCOMPLETE  cov=1.00  pu=0  turns=4 | — |

## Flagged regressions (Δ ≥ 0.2)

### gemma-react vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-5-three-step-search | stepCoverage | 0.333 | 0.667 | 0.333 | right-better |
| calibration-5-three-step-search | furthestKeyNode | 0.333 | 0.667 | 0.333 | right-better |
| journey-2-ecom-checkout | stepCoverage | 0.000 | 0.400 | 0.400 | right-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.400 | 0.400 | right-better |
| journey-4-account-signup | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-6-media-streaming | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-6-media-streaming | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
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
| journey-10-marketplace-filter | furthestKeyNode | 0.167 | 1.000 | 0.833 | right-better |
| journey-2-ecom-checkout | toolCallValidity | 0.000 | 0.700 | 0.700 | right-better |
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
| journey-2-ecom-checkout | toolCallValidity | 0.700 | 0.000 | -0.700 | left-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.400 | 0.400 | right-better |
| journey-4-account-signup | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-6-media-streaming | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-6-media-streaming | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-8-help-center | stepCoverage | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 1.000 | 0.333 | -0.667 | left-better |
| trivial-1-example-homepage | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |

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
| journey-5-insurance-quote | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-5-insurance-quote | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| journey-7-dashboard-filter | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| journey-8-help-center | stepCoverage | 0.250 | 0.000 | -0.250 | left-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 0.000 | -0.250 | left-better |
| moderate-1-github-explore-topics | stepCoverage | 0.333 | 0.000 | -0.333 | left-better |
| moderate-1-github-explore-topics | furthestKeyNode | 0.333 | 0.000 | -0.333 | left-better |
| moderate-2-mdn-web-api-detail | stepCoverage | 0.333 | 0.000 | -0.333 | left-better |
| moderate-2-mdn-web-api-detail | finalState | 1.000 | 0.000 | -1.000 | left-better |
| moderate-2-mdn-web-api-detail | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
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
| journey-4-account-signup | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-5-insurance-quote | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-5-insurance-quote | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-6-media-streaming | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| journey-6-media-streaming | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| journey-7-dashboard-filter | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-8-help-center | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
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
