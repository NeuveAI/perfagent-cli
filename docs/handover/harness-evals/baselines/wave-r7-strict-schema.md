# Wave R5 A:B Regression Report

_Generated 2026-04-27T18:43:41.825Z from `evals/traces/wave-r5-ab` (60/60 traces present)._

**Runners:**
- `gemma-react` — production runtime; Gemma 4 E4B owns plan + execute via the ReAct loop.
- `gemini-react` — frontier baseline; Gemini Flash 3 driving the same ReAct loop.
- `gemma-oracle-plan` — ablation; Gemini decomposes upfront, Gemma executes via ReAct.

## Aggregate scoreboard

| Runner | Tasks | Pass | Fail | Incomplete | Mean step-coverage | Mean final-state | Mean tool-validity | Mean furthest-key-node | Mean total tokens | Mean peak prompt | Mean turns | Mean PLAN_UPDATEs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma-react | 20 | 4 | 2 | 14 | 0.398 | 0.100 | 0.071 | 0.497 | 115075 | 15207 | 9.1 | 0.0 |
| gemini-react | 20 | 8 | 12 | 0 | 0.392 | 0.250 | 0.050 | 0.455 | 207550 | 31812 | 10.1 | 0.0 |
| gemma-oracle-plan | 20 | 0 | 0 | 20 | 0.346 | 0.000 | 0.000 | 0.396 | 85513 | 10927 | 9.6 | 0.0 |

## Per-task summary

Cells: `<status>  cov=<step-coverage>  pu=<plan-update-count>  turns=<turn-count>`.
Status legend: `OK` = RUN_COMPLETED:passed, `FAIL` = RUN_COMPLETED:failed, `INCOMPLETE` = stream ended without RUN_COMPLETED.

| Task | gemma-react | gemini-react | gemma-oracle-plan |
|---|---|---|---|
| calibration-1-single-nav-python-docs | OK  cov=1.00  pu=0  turns=6 | OK  cov=1.00  pu=0  turns=9 | INCOMPLETE  cov=1.00  pu=0  turns=6 |
| calibration-2-single-nav-news | INCOMPLETE  cov=0.00  pu=0  turns=5 | OK  cov=1.00  pu=0  turns=13 | INCOMPLETE  cov=1.00  pu=0  turns=15 |
| calibration-3-two-step-docs | FAIL  cov=0.50  pu=0  turns=15 | FAIL  cov=0.50  pu=0  turns=15 | INCOMPLETE  cov=0.50  pu=0  turns=13 |
| calibration-4-two-step-ecom | FAIL  cov=0.00  pu=0  turns=5 | FAIL  cov=0.00  pu=0  turns=8 | INCOMPLETE  cov=0.00  pu=0  turns=1 |
| calibration-5-three-step-search | INCOMPLETE  cov=0.33  pu=0  turns=15 | FAIL  cov=0.67  pu=0  turns=10 | INCOMPLETE  cov=0.33  pu=0  turns=15 |
| hard-volvo-ex90-configurator | INCOMPLETE  cov=0.17  pu=0  turns=15 | FAIL  cov=0.00  pu=0  turns=6 | INCOMPLETE  cov=0.00  pu=0  turns=2 |
| journey-1-car-configurator-bmw | INCOMPLETE  cov=0.67  pu=0  turns=15 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 |
| journey-2-ecom-checkout | INCOMPLETE  cov=0.20  pu=0  turns=15 | FAIL  cov=0.20  pu=0  turns=11 | INCOMPLETE  cov=0.00  pu=0  turns=15 |
| journey-3-flight-search | INCOMPLETE  cov=0.00  pu=0  turns=15 | FAIL  cov=0.25  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=2 |
| journey-4-account-signup | INCOMPLETE  cov=0.80  pu=0  turns=15 | OK  cov=0.20  pu=0  turns=10 | INCOMPLETE  cov=0.00  pu=0  turns=9 |
| journey-5-insurance-quote | INCOMPLETE  cov=0.50  pu=0  turns=15 | FAIL  cov=0.25  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=2 |
| journey-6-media-streaming | INCOMPLETE  cov=0.80  pu=0  turns=5 | FAIL  cov=0.00  pu=0  turns=15 | INCOMPLETE  cov=0.00  pu=0  turns=15 |
| journey-7-dashboard-filter | INCOMPLETE  cov=0.25  pu=0  turns=8 | OK  cov=0.75  pu=0  turns=7 | INCOMPLETE  cov=0.25  pu=0  turns=15 |
| journey-8-help-center | INCOMPLETE  cov=0.25  pu=0  turns=3 | FAIL  cov=1.00  pu=0  turns=15 | INCOMPLETE  cov=1.00  pu=0  turns=15 |
| journey-9-form-wizard | INCOMPLETE  cov=0.00  pu=0  turns=2 | FAIL  cov=0.20  pu=0  turns=11 | INCOMPLETE  cov=0.00  pu=0  turns=2 |
| journey-10-marketplace-filter | INCOMPLETE  cov=0.17  pu=0  turns=5 | FAIL  cov=0.17  pu=0  turns=6 | INCOMPLETE  cov=0.17  pu=0  turns=15 |
| moderate-1-github-explore-topics | INCOMPLETE  cov=0.00  pu=0  turns=3 | OK  cov=0.33  pu=0  turns=6 | INCOMPLETE  cov=0.33  pu=0  turns=15 |
| moderate-2-mdn-web-api-detail | OK  cov=0.33  pu=0  turns=5 | OK  cov=0.33  pu=0  turns=5 | INCOMPLETE  cov=0.33  pu=0  turns=11 |
| trivial-1-example-homepage | OK  cov=1.00  pu=0  turns=7 | OK  cov=1.00  pu=0  turns=8 | INCOMPLETE  cov=1.00  pu=0  turns=5 |
| trivial-2-wikipedia-main-page | OK  cov=1.00  pu=0  turns=7 | OK  cov=0.00  pu=0  turns=2 | INCOMPLETE  cov=1.00  pu=0  turns=4 |

## Flagged regressions (Δ ≥ 0.2)

### gemma-react vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-2-single-nav-news | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | finalState | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| calibration-5-three-step-search | stepCoverage | 0.333 | 0.667 | 0.333 | right-better |
| calibration-5-three-step-search | furthestKeyNode | 0.333 | 0.667 | 0.333 | right-better |
| hard-volvo-ex90-configurator | toolCallValidity | 0.429 | 0.000 | -0.429 | left-better |
| hard-volvo-ex90-configurator | furthestKeyNode | 0.667 | 0.000 | -0.667 | left-better |
| journey-1-car-configurator-bmw | stepCoverage | 0.667 | 0.000 | -0.667 | left-better |
| journey-1-car-configurator-bmw | furthestKeyNode | 0.833 | 0.000 | -0.833 | left-better |
| journey-3-flight-search | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-3-flight-search | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-4-account-signup | stepCoverage | 0.800 | 0.200 | -0.600 | left-better |
| journey-4-account-signup | furthestKeyNode | 1.000 | 0.200 | -0.800 | left-better |
| journey-5-insurance-quote | stepCoverage | 0.500 | 0.250 | -0.250 | left-better |
| journey-5-insurance-quote | furthestKeyNode | 0.750 | 0.250 | -0.500 | left-better |
| journey-6-media-streaming | stepCoverage | 0.800 | 0.000 | -0.800 | left-better |
| journey-6-media-streaming | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| journey-7-dashboard-filter | stepCoverage | 0.250 | 0.750 | 0.500 | right-better |
| journey-7-dashboard-filter | finalState | 0.000 | 1.000 | 1.000 | right-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | stepCoverage | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-1-github-explore-topics | stepCoverage | 0.000 | 0.333 | 0.333 | right-better |
| moderate-1-github-explore-topics | toolCallValidity | 1.000 | 0.000 | -1.000 | left-better |
| moderate-1-github-explore-topics | furthestKeyNode | 0.000 | 0.667 | 0.667 | right-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |
| trivial-2-wikipedia-main-page | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | toolCallValidity | 0.000 | 1.000 | 1.000 | right-better |
| trivial-2-wikipedia-main-page | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |

### gemma-react vs gemma-oracle-plan

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | finalState | 1.000 | 0.000 | -1.000 | left-better |
| calibration-2-single-nav-news | stepCoverage | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | furthestKeyNode | 0.000 | 1.000 | 1.000 | right-better |
| calibration-5-three-step-search | furthestKeyNode | 0.333 | 0.667 | 0.333 | right-better |
| hard-volvo-ex90-configurator | toolCallValidity | 0.429 | 0.000 | -0.429 | left-better |
| hard-volvo-ex90-configurator | furthestKeyNode | 0.667 | 0.000 | -0.667 | left-better |
| journey-1-car-configurator-bmw | stepCoverage | 0.667 | 0.000 | -0.667 | left-better |
| journey-1-car-configurator-bmw | furthestKeyNode | 0.833 | 0.000 | -0.833 | left-better |
| journey-2-ecom-checkout | stepCoverage | 0.200 | 0.000 | -0.200 | left-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.200 | 0.000 | -0.200 | left-better |
| journey-4-account-signup | stepCoverage | 0.800 | 0.000 | -0.800 | left-better |
| journey-4-account-signup | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| journey-5-insurance-quote | stepCoverage | 0.500 | 0.000 | -0.500 | left-better |
| journey-5-insurance-quote | furthestKeyNode | 0.750 | 0.000 | -0.750 | left-better |
| journey-6-media-streaming | stepCoverage | 0.800 | 0.000 | -0.800 | left-better |
| journey-6-media-streaming | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| journey-8-help-center | stepCoverage | 0.250 | 1.000 | 0.750 | right-better |
| journey-8-help-center | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| moderate-1-github-explore-topics | stepCoverage | 0.000 | 0.333 | 0.333 | right-better |
| moderate-1-github-explore-topics | toolCallValidity | 1.000 | 0.000 | -1.000 | left-better |
| moderate-1-github-explore-topics | furthestKeyNode | 0.000 | 0.333 | 0.333 | right-better |
| moderate-2-mdn-web-api-detail | finalState | 1.000 | 0.000 | -1.000 | left-better |

### gemma-oracle-plan vs gemini-react

| Task | Metric | Left | Right | Δ | Direction |
|---|---|---|---|---|---|
| calibration-1-single-nav-python-docs | finalState | 0.000 | 1.000 | 1.000 | right-better |
| calibration-2-single-nav-news | finalState | 0.000 | 1.000 | 1.000 | right-better |
| calibration-5-three-step-search | stepCoverage | 0.333 | 0.667 | 0.333 | right-better |
| journey-2-ecom-checkout | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-2-ecom-checkout | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| journey-3-flight-search | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-3-flight-search | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-4-account-signup | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-4-account-signup | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| journey-5-insurance-quote | stepCoverage | 0.000 | 0.250 | 0.250 | right-better |
| journey-5-insurance-quote | furthestKeyNode | 0.000 | 0.250 | 0.250 | right-better |
| journey-7-dashboard-filter | stepCoverage | 0.250 | 0.750 | 0.500 | right-better |
| journey-7-dashboard-filter | finalState | 0.000 | 1.000 | 1.000 | right-better |
| journey-7-dashboard-filter | furthestKeyNode | 0.250 | 1.000 | 0.750 | right-better |
| journey-9-form-wizard | stepCoverage | 0.000 | 0.200 | 0.200 | right-better |
| journey-9-form-wizard | furthestKeyNode | 0.000 | 0.200 | 0.200 | right-better |
| moderate-1-github-explore-topics | furthestKeyNode | 0.333 | 0.667 | 0.333 | right-better |
| moderate-2-mdn-web-api-detail | finalState | 0.000 | 1.000 | 1.000 | right-better |
| trivial-1-example-homepage | finalState | 0.000 | 1.000 | 1.000 | right-better |
| trivial-2-wikipedia-main-page | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | toolCallValidity | 0.000 | 1.000 | 1.000 | right-better |
| trivial-2-wikipedia-main-page | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |

---

Generated by `pnpm wave-r5-ab:report` from trace ndjson at run-time. Re-run after each sweep.
