# R12 dispatch from harness-r4 closeout

## Starting point

R12 should proceed from the corrected harness-r4 conclusion:

- detector code verified;
- THOUGHT-only ACTION reset fixed;
- current repo artifacts do not prove the stale `2 -> 6` / `3x pass-rate uplift` claim;
- PLAN_UPDATE reproducibility remains unresolved;
- the substantive next gap is recovery-shape generation after REFLECT.

Do not use pass-rate uplift as the R12 justification unless a future source independently proves it. The current repo score sidecars show gemma-react at 6/20 passed in both r3 and r4.

## Source packet

Primary sources:

- `docs/handover/harness-r4/next-round-eval-report.md`
- `docs/handover/harness-r4/next-round-evidence.md`
- `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md`

Supporting source:

- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r3.md`

Anti-source:

- The old June 2 pass-rate headline is historical context only. Treat `2 -> 6` and `3x pass-rate uplift` as stale unless clearly contradicted in the same passage.

## Evidence summary

Current sidecar-derived pass counts:

| Sweep | Runner | Passed | Failed | Unfinished |
|---|---|---:|---:|---:|
| r3 | gemma-react | 6 | 5 | 9 |
| r4 | gemma-react | 6 | 3 | 11 |
| r3 | gemini-react | 8 | 11 | 1 |
| r4 | gemini-react | 7 | 13 | 0 |
| r3 | gemma-oracle-plan | 0 | 0 | 20 |
| r4 | gemma-oracle-plan | 0 | 0 | 20 |

PLAN_UPDATE records:

- r3: one record, `gemma-react__calibration-5-three-step-search.ndjson`, turn 7, `action=remove`.
- r4: zero records.
- second r4 sweep: unavailable from current repo artifacts.

Detector evidence:

- THOUGHT-only reflect/abort paths are trace-visible through `agent_message_chunk` / `AcpAgentMessageChunk` when they fire.
- Current r3/r4 trace artifacts contain no THOUGHT-only reflect/abort marker matches.
- Focused tests verify the pure THOUGHT-loop marker path and verify no false THOUGHT-only marker after `THOUGHT -> ACTION -> THOUGHT`.

## R12 work shape

Use R12 to create or select training/eval data that makes recovery-shape behavior likely after REFLECT:

- prefer `PLAN_UPDATE action=replace` and `PLAN_UPDATE action=insert` exemplars over surrender shapes;
- include negative examples where `action=remove` or premature RUN_COMPLETED is a surrender response;
- emphasize canonical tool-discriminator shapes where prior traces show confusion around `interact`, `observe`, and `navigate`;
- include repeated-failure cases where the model must stop externalizing blame to the tool/environment and revise the plan.

## Suggested acceptance checks

- R12 report states the exact source artifact used for every load-bearing statistic.
- Any pass-rate claim is recomputed from current sidecars or marked historical/stale.
- PLAN_UPDATE count is measured directly from trace records, not inferred from REFLECT markers.
- Recovery-shape rate distinguishes `remove` from `replace` / `insert`.
- If a fresh sweep is required, it is explicitly authorized and records the branch, build state, trace directory, and scoring script.

## Git guardrail

The current harness research stack is pushed/current through `origin/gemma-harness-lora` at `5b1b41bb`, but it is 257 commits ahead of `origin/main`. Do not merge it to `main` without owner confirmation.
