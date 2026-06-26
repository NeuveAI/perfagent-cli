# Harness-r4 next-round eval report

Generated: 2026-06-26

## Verdict

Harness-r4 should not be reported as a 3x gemma-react pass-rate lift based on the current repo. The current score sidecars show gemma-react at 6/20 passed in both r3 and r4.

The implemented detector fix is still warranted: THOUGHT-only loop state now resets on ACTION in both local-agent and Gemini-react paths, matching the intended "consecutive THOUGHTs without ACTION/progress" semantics. Focused direct test runs pass.

## Inputs inspected

- `docs/handover/harness-r4/eval-signals-2026-06-02.md`
- `docs/handover/harness-r4/t_f1abb9ba-review-feedback.md`
- `docs/research/harness-r4/detectors-plan.md`
- `docs/handover/harness-evals/baselines/wave-harness-r3.md`
- `packages/evals/evals/traces/wave-harness-r3-reflect-injection/*.ndjson`
- `packages/evals/evals/traces/wave-harness-r3-reflect-injection/*.scores.json`
- `packages/evals/evals/traces/wave-harness-r4-detectors/*.ndjson`
- `packages/evals/evals/traces/wave-harness-r4-detectors/*.scores.json`

## Scoreboard from current sidecars

| Sweep | Runner | Tasks | Passed | Failed | Unfinished | Mean step coverage |
|---|---|---:|---:|---:|---:|---:|
| r3 | gemma-react | 20 | 6 | 5 | 9 | 0.307 |
| r4 | gemma-react | 20 | 6 | 3 | 11 | 0.283 |
| r3 | gemini-react | 20 | 8 | 11 | 1 | 0.426 |
| r4 | gemini-react | 20 | 7 | 13 | 0 | 0.413 |
| r3 | gemma-oracle-plan | 20 | 0 | 0 | 20 | 0.257 |
| r4 | gemma-oracle-plan | 20 | 0 | 0 | 20 | 0.275 |

The r3 baseline file is internally inconsistent: its aggregate scoreboard shows gemma-react 6 passed / 5 failed / 9 incomplete, while a later hand-augmented delta table says strict-pass 2/20. The current `.scores.json` sidecars match the aggregate scoreboard, not the later 2/20 line.

## Task-level gemma-react changes

Status changes from current r3 to current r4:

| Task | r3 status | r4 status | r3 coverage | r4 coverage | Read |
|---|---|---|---:|---:|---|
| `moderate-2-mdn-web-api-detail` | unfinished | passed | 0.333 | 0.333 | Only current r3->r4 flip into passed. No r4 REFLECT marker found in this trace. |
| `calibration-3-two-step-docs` | passed | unfinished | 0.500 | 0.500 | Offset pass loss. No r4 REFLECT marker found in this trace. |
| `calibration-5-three-step-search` | failed | unfinished | 0.000 | 0.333 | r4 has REFLECT but no PLAN_UPDATE. |
| `journey-4-account-signup` | failed | unfinished | 0.000 | 0.000 | Status improved from failed to unfinished, not passed. |

Mechanism conclusion: current artifacts do not support a detector-driven pass-rate uplift. The only new pass does not show a detector marker in r4, and an r3 pass is lost in r4.

## REFLECT and PLAN_UPDATE

REFLECT marker files:

| Sweep | Files with `agent_message` REFLECT marker |
|---|---:|
| r3 | 7 |
| r4 | 7 |

Actual PLAN_UPDATE records:

| Sweep | PLAN_UPDATE records | Detail |
|---|---:|---|
| r3 | 1 | `gemma-react__calibration-5-three-step-search.ndjson`, turn 7, `action=remove` |
| r4 | 0 | No `type=plan_update` records found |

Reproducibility state: unresolved. Current r4 artifacts do not reproduce the calibration-5 PLAN_UPDATE. The planned second sweep directory has no files, so current available evidence cannot distinguish one-off r3 noise from a prompt/detector regression.

## THOUGHT-only visibility

The current r3/r4 trace directories have no THOUGHT-only reflect/abort markers:

```text
rg 'THOUGHT-only|thought-only|consecutive THOUGHTs|THOUGHTs detected' current r3/r4 traces
```

Result: no matches.

Source and test evidence:

- Local-agent THOUGHT-only reflect and abort messages are emitted as `agent_message_chunk`, so they are trace-visible if fired.
- Gemini-react THOUGHT-only reflect and abort messages are emitted through `AcpAgentMessageChunk`, also trace-visible.
- Existing and added focused tests assert those message chunks for pure THOUGHT loops and assert absence after `THOUGHT -> ACTION -> THOUGHT` reset.

## Verification status

Blocked package-script commands:

- `CI=true pnpm --filter @neuve/local-agent test -- tests/tool-loop-agent-turn.test.ts`
- `CI=true pnpm --filter @neuve/evals test -- tests/gemini-react-loop.test.ts`

Both failed before Vitest with `ERR_PNPM_IGNORED_BUILDS` for `esbuild`, `keytar`, `msgpackr-extract`, `node-pty`, `protobufjs`, and `tree-sitter-bash`.

The blocked pnpm invocation attempted to create an `allowBuilds` placeholder block in `pnpm-workspace.yaml`; that accidental config churn was removed and the workspace file has no remaining diff from this run.

Passing non-mutating direct commands:

- `./node_modules/.bin/vp test run packages/local-agent/tests/tool-loop-agent-turn.test.ts`: 12 tests passed.
- `./node_modules/.bin/vp test run packages/evals/tests/gemini-react-loop.test.ts`: 10 tests passed.

Direct typecheck:

- `./node_modules/.bin/tsgo --noEmit -p packages/shared/tsconfig.json`: passed.
- `./node_modules/.bin/tsgo --noEmit -p packages/local-agent/tsconfig.json`: passed.
- `./node_modules/.bin/tsgo --noEmit -p packages/evals/tsconfig.json`: passed.

The prior evals typecheck blocker was fixed by adding `packages/shared/src/which.d.ts` to declare the `which` package API used by `packages/shared/src/is-command-available.ts`.

## Direction call

Proceed with review of the semantic fix and close the code-level THOUGHT-only issue if approved.

Do not close the broader eval narrative as "pass-rate uplift verified." Current evidence supports:

- THOUGHT-only reset semantics fixed.
- THOUGHT-only trace visibility is source/test verified, with zero firings in current traces.
- PLAN_UPDATE remains unreproduced in r4 and unresolved without a fresh second sweep.
- Recovery-shape generation remains the substantive capability gap.

R12 remains a plausible next direction for recovery-shape generation, but the dispatch should cite the PLAN_UPDATE/recovery gap and flat current pass-rate evidence, not the contradicted `2 -> 6` claim.

Out-of-scope worktree note: `.devcontainer/devcontainer.json` and `packages/evals/docs/handover/harness-evals/baselines/wave-r5-ab.md` are unrelated to this closeout and must be staged separately or left out of the closeout commit.

Kanban state: passed evidence handoffs now exist for `next-round-evidence`, `next-round-eval-report`, and `scoped-tests`; the done gate remains blocked on `strict-review`, which should only be marked passed after re-review approves.
