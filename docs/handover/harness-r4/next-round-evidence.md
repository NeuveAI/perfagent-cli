# Harness-r4 next-round evidence

Generated: 2026-06-26

## Scope

Ticket: `ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9`

Owned code/test files touched:

- `packages/local-agent/src/tool-loop.ts`
- `packages/evals/src/runners/gemini-react-loop.ts`
- `packages/local-agent/tests/tool-loop-agent-turn.test.ts`
- `packages/evals/tests/gemini-react-loop.test.ts`

Owned evidence files touched:

- `docs/handover/harness-r4/next-round-evidence.md`
- `docs/handover/harness-r4/next-round-eval-report.md`
- `docs/handover/harness-r4/evidence/neuve-ax-feedback.md`

## Detector semantics fix

Correctness target: THOUGHT-only means consecutive THOUGHT envelopes without ACTION/progress. A `THOUGHT -> ACTION -> THOUGHT` sequence must not count as two consecutive THOUGHTs.

Change made:

- Local-agent loop: added a `resetThoughtOnlyStreak()` helper and call it when handling `ACTION`, `PLAN_UPDATE`, and `STEP_DONE`.
- Gemini-react loop: mirrored the same helper and `ACTION` reset.
- Existing thresholds were preserved: THOUGHT reflect at 5, THOUGHT abort at 6, rejection reflect at 2, doom-loop abort at 3.
- Existing REFLECT and doom-loop behavior was not intentionally changed.

Decision on failed ACTIONs: the reset runs when an `ACTION` envelope is handled, before tool execution, regardless of whether the tool succeeds. This matches the detector name and plan text: the detector is for THOUGHT-only loops, meaning no ACTION/progress. Failed ACTIONs remain covered by existing tool-error rejection tracking and identical-ACTION doom-loop detection.

Focused regression tests added:

- Local-agent: four THOUGHTs, one ACTION, two more THOUGHTs, then RUN_COMPLETED. The test asserts no THOUGHT-only REFLECT/abort chunk and terminal passed status.
- Gemini-react: same envelope sequence and assertions.

## Verification commands

Requested package-script route, local-agent:

```bash
CI=true pnpm --filter @neuve/local-agent test -- tests/tool-loop-agent-turn.test.ts
```

Result: blocked before Vitest by package-manager policy.

Key output:

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.4, keytar@7.9.0, msgpackr-extract@3.0.3, node-pty@1.1.0, protobufjs@7.5.4, protobufjs@8.0.0, tree-sitter-bash@0.25.1

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

Requested package-script route, evals:

```bash
CI=true pnpm --filter @neuve/evals test -- tests/gemini-react-loop.test.ts
```

Result: blocked before Vitest by the same `ERR_PNPM_IGNORED_BUILDS` policy gate.

Non-mutating direct test route, local-agent:

```bash
./node_modules/.bin/vp test run packages/local-agent/tests/tool-loop-agent-turn.test.ts
```

Result: passed.

```text
Test Files  1 passed (1)
Tests  12 passed (12)
```

Non-mutating direct test route, evals:

```bash
./node_modules/.bin/vp test run packages/evals/tests/gemini-react-loop.test.ts
```

Result: passed.

```text
Test Files  1 passed (1)
Tests  10 passed (10)
```

No `pnpm approve-builds`, approval config mutation, destructive git command, commit, or push was run.

Note: the blocked pnpm command attempted to insert an `allowBuilds` placeholder block into `pnpm-workspace.yaml`. That accidental config churn was removed before handoff; `git diff -- pnpm-workspace.yaml` is clean.

Direct typecheck, local-agent:

```bash
./node_modules/.bin/tsgo --noEmit -p packages/local-agent/tsconfig.json
```

Result: passed.

Direct typecheck, shared:

```bash
./node_modules/.bin/tsgo --noEmit -p packages/shared/tsconfig.json
```

Result: passed after adding `packages/shared/src/which.d.ts` to declare the `which` package API used by `packages/shared/src/is-command-available.ts`.

Direct typecheck, evals:

```bash
./node_modules/.bin/tsgo --noEmit -p packages/evals/tsconfig.json
```

Result: passed.

## THOUGHT visibility evidence

Source inspection:

- `packages/local-agent/src/tool-loop.ts` emits THOUGHT-only reflect and abort notices through `connection.sessionUpdate({ sessionUpdate: "agent_message_chunk", ... })`.
- `packages/evals/src/runners/gemini-react-loop.ts` emits Gemini THOUGHT-only reflect and abort notices through `emitMessageChunk`, which creates `AcpAgentMessageChunk` with `sessionUpdate: "agent_message_chunk"`.
- The focused tests assert that THOUGHT-only reflect/abort strings are present for pure THOUGHT loops and absent when ACTION resets the streak.

Trace grep:

```bash
rg -n 'THOUGHT-only|thought-only|consecutive THOUGHTs|THOUGHTs detected' \
  packages/evals/evals/traces/wave-harness-r4-detectors \
  packages/evals/evals/traces/wave-harness-r3-reflect-injection
```

Result: no matches in the current r3/r4 trace artifacts. Current evidence therefore supports: if the THOUGHT-only branch fires, it is trace-visible through `agent_message_chunk`; the available sweep artifacts do not show a firing.

## PLAN_UPDATE reproducibility evidence

Current trace artifact counts:

```text
wave-harness-r3-reflect-injection: 60 ndjson, 60 scores
wave-harness-r4-detectors: 60 ndjson, 60 scores
wave-harness-r4-detectors-sweep2: 0 files
```

Actual `type=plan_update` trace records:

```bash
rg -n '"type":"plan_update"' packages/evals/evals/traces/wave-harness-r3-reflect-injection
```

Result:

```text
packages/evals/evals/traces/wave-harness-r3-reflect-injection/gemma-react__calibration-5-three-step-search.ndjson:8:{"type":"plan_update","ts":1778105327773,"turn":7,"stepId":"","action":"remove"}
```

```bash
rg -n '"type":"plan_update"' packages/evals/evals/traces/wave-harness-r4-detectors
```

Result: no matches.

Read: current available evidence is r3 = 1/60 PLAN_UPDATE and r4 = 0/60 PLAN_UPDATE. The requested second sweep is not available in this repo (`wave-harness-r4-detectors-sweep2` has 0 files), so reproducibility is unresolved. The current r4 artifacts do not reproduce calibration-5 PLAN_UPDATE.

## Pass-rate mechanism evidence

Current sidecar-derived status counts:

| Sweep | Runner | Passed | Failed | Unfinished | Mean step coverage |
|---|---:|---:|---:|---:|---:|
| r3 current scores | gemma-react | 6 | 5 | 9 | 0.307 |
| r4 current scores | gemma-react | 6 | 3 | 11 | 0.283 |
| r3 current scores | gemini-react | 8 | 11 | 1 | 0.426 |
| r4 current scores | gemini-react | 7 | 13 | 0 | 0.413 |
| r3 current scores | gemma-oracle-plan | 0 | 0 | 20 | 0.257 |
| r4 current scores | gemma-oracle-plan | 0 | 0 | 20 | 0.275 |

The June 2 memo's headline that gemma-react moved `2 -> 6` passed is contradicted by current repo artifacts unless a different source is later found. Current repo evidence shows gemma-react passed count is flat at 6/20.

Gemma-react status flips from current r3 to current r4:

- `moderate-2-mdn-web-api-detail`: unfinished -> passed, coverage 0.333 -> 0.333.
- `calibration-3-two-step-docs`: passed -> unfinished, coverage 0.500 -> 0.500.
- `calibration-5-three-step-search`: failed -> unfinished, coverage 0.000 -> 0.333.
- `journey-4-account-signup`: failed -> unfinished, coverage 0.000 -> 0.000.

Mechanism read:

- There is no net gemma-react pass-rate lift in current artifacts.
- The only gemma-react task that flips to passed (`moderate-2-mdn-web-api-detail`) has no r4 REFLECT marker in the current trace and terminates passed at 7 turns, so current evidence does not support a detector-driven pass mechanism for that flip.
- `calibration-3-two-step-docs` regresses from passed to unfinished without a REFLECT marker in the r4 trace.
- r4 `calibration-5-three-step-search` has a REFLECT marker but no `type=plan_update`, so the known recovery-shape gap remains.

## Direction call

Code closeout direction: accept the THOUGHT-only semantic fix after review because it aligns the implementation with the detector plan and has focused passing tests via the direct non-mutating test route.

Eval direction: do not carry forward the June 2 `2 -> 6` / `3x pass-rate lift` claim from current repo artifacts. Current evidence supports a narrower conclusion: harness-r4 preserves similar aggregate behavior, r4 still does not reproduce PLAN_UPDATE, and the capability gap remains recovery-shape generation after REFLECT. R12 remains the likely next research direction for recovery-shape generation, but it should be justified by the PLAN_UPDATE/recovery gap, not by a contradicted gemma-react pass-rate uplift.

Remaining blockers before ticket done:

- Strict review evidence is still needed.
- Fresh two-sweep PLAN_UPDATE reproducibility remains unavailable from current artifacts.
- The requested package-script verification route is blocked by pnpm build-approval policy, but the non-mutating direct typecheck/test route is passing for this slice.
- Unrelated dirty files `.devcontainer/devcontainer.json` and `packages/evals/docs/handover/harness-evals/baselines/wave-r5-ab.md` are out of scope for this closeout and must be staged separately or left out of the closeout commit.

## Kanban gate state

After this review patch, passed evidence handoffs were recorded for:

- `next-round-evidence`
- `next-round-eval-report`
- `scoped-tests`

`strict-review` was intentionally not recorded as passed because re-review has not approved yet.

Gate check:

```bash
neuve kanban gate ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9 --target done
```

Result: blocked only on `strict-review`.
