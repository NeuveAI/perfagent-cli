# Wave R5 A:B Regression Report

_Generated 2026-04-30T13:41:43.973Z from `evals/traces/wave-r9-bridge-coerce` (20/60 traces present)._

**Runners:**
- `gemma-react` — production runtime; Gemma 4 E4B owns plan + execute via the ReAct loop.
- `gemini-react` — frontier baseline; Gemini Flash 3 driving the same ReAct loop.
- `gemma-oracle-plan` — ablation; Gemini decomposes upfront, Gemma executes via ReAct.

## Aggregate scoreboard

| Runner | Tasks | Pass | Fail | Incomplete | Mean step-coverage | Mean final-state | Mean tool-validity | Mean furthest-key-node | Mean total tokens | Mean peak prompt | Mean turns | Mean PLAN_UPDATEs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma-react | 20 | 8 | 2 | 10 | 0.372 | 0.200 | 0.050 | 0.425 | 68848 | 14234 | 9.8 | 0.0 |

## Per-task summary

Cells: `<status>  cov=<step-coverage>  pu=<plan-update-count>  turns=<turn-count>`.
Status legend: `OK` = RUN_COMPLETED:passed, `FAIL` = RUN_COMPLETED:failed, `INCOMPLETE` = stream ended without RUN_COMPLETED.

| Task | gemma-react | gemini-react | gemma-oracle-plan |
|---|---|---|---|
| calibration-1-single-nav-python-docs | OK  cov=1.00  pu=0  turns=4 | — | — |
| calibration-2-single-nav-news | OK  cov=1.00  pu=0  turns=8 | — | — |
| calibration-3-two-step-docs | OK  cov=0.50  pu=0  turns=8 | — | — |
| calibration-4-two-step-ecom | INCOMPLETE  cov=0.00  pu=0  turns=1 | — | — |
| calibration-5-three-step-search | INCOMPLETE  cov=0.00  pu=0  turns=0 | — | — |
| hard-volvo-ex90-configurator | INCOMPLETE  cov=0.00  pu=0  turns=7 | — | — |
| journey-1-car-configurator-bmw | INCOMPLETE  cov=0.00  pu=0  turns=13 | — | — |
| journey-2-ecom-checkout | FAIL  cov=0.00  pu=0  turns=14 | — | — |
| journey-3-flight-search | INCOMPLETE  cov=0.00  pu=0  turns=15 | — | — |
| journey-4-account-signup | INCOMPLETE  cov=0.80  pu=0  turns=15 | — | — |
| journey-5-insurance-quote | INCOMPLETE  cov=0.00  pu=0  turns=15 | — | — |
| journey-6-media-streaming | INCOMPLETE  cov=0.80  pu=0  turns=15 | — | — |
| journey-7-dashboard-filter | INCOMPLETE  cov=0.25  pu=0  turns=15 | — | — |
| journey-8-help-center | OK  cov=0.25  pu=0  turns=12 | — | — |
| journey-9-form-wizard | INCOMPLETE  cov=0.00  pu=0  turns=12 | — | — |
| journey-10-marketplace-filter | FAIL  cov=0.17  pu=0  turns=10 | — | — |
| moderate-1-github-explore-topics | OK  cov=0.33  pu=0  turns=14 | — | — |
| moderate-2-mdn-web-api-detail | OK  cov=0.33  pu=0  turns=6 | — | — |
| trivial-1-example-homepage | OK  cov=1.00  pu=0  turns=6 | — | — |
| trivial-2-wikipedia-main-page | OK  cov=1.00  pu=0  turns=6 | — | — |

## Flagged regressions (Δ ≥ 0.2)

### gemma-react vs gemini-react

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
| calibration-5-three-step-search | toolCallValidity | 1.000 | 0.000 | -1.000 | left-better |
| journey-4-account-signup | stepCoverage | 0.800 | 0.000 | -0.800 | left-better |
| journey-4-account-signup | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
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
| trivial-1-example-homepage | finalState | 1.000 | 0.000 | -1.000 | left-better |
| trivial-1-example-homepage | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |

### gemma-react vs gemma-oracle-plan

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
| calibration-5-three-step-search | toolCallValidity | 1.000 | 0.000 | -1.000 | left-better |
| journey-4-account-signup | stepCoverage | 0.800 | 0.000 | -0.800 | left-better |
| journey-4-account-signup | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
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
| trivial-1-example-homepage | finalState | 1.000 | 0.000 | -1.000 | left-better |
| trivial-1-example-homepage | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | stepCoverage | 1.000 | 0.000 | -1.000 | left-better |
| trivial-2-wikipedia-main-page | furthestKeyNode | 1.000 | 0.000 | -1.000 | left-better |

### gemma-oracle-plan vs gemini-react

_No deltas above ±0.2._

---

Generated by `pnpm wave-r5-ab:report` from trace ndjson at run-time. Re-run after each sweep.
