# Harness-r4 project memory mirror

Source mirror for external memory:

- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`

## Closeout conclusion

Harness-r4 closes with the detector fix verified, but not with a verified pass-rate uplift.

The THOUGHT-only ACTION reset fix is accepted for the detector slice: ACTION resets the THOUGHT-only streak in both local-agent and Gemini-react paths, while local-agent also preserves reset behavior for PLAN_UPDATE and STEP_DONE. Focused direct tests and direct package typechecks passed in the prior closeout evidence. The pnpm package-script test route remained blocked before Vitest by `ERR_PNPM_IGNORED_BUILDS`, and no build-approval mutation was authorized.

The old `2 -> 6` / `3x pass-rate uplift` headline must not be treated as verified. Current sidecars show gemma-react flat at 6/20 passed in both r3 and r4. The only new r4 gemma-react pass does not show a detector marker in the current trace, and an r3 gemma-react pass regresses to unfinished in r4.

PLAN_UPDATE reproducibility remains unresolved. Current r3 artifacts contain one PLAN_UPDATE record, while current r4 artifacts contain zero. The planned second r4 sweep is not available from current repo artifacts.

R12 remains justified by the recovery-shape generation gap: Gemma can notice REFLECT in at least one r3 case, but the observed PLAN_UPDATE was `action=remove` rather than a recovery shape such as `action=replace` or `action=insert`. R12 should target recovery-shape generation and tool-discriminator canonicalization, not a contradicted pass-rate headline.

## Git and merge state

- Current local branch: `codex/harness-r4-memory-r12-dispatch`
- Current HEAD: `5b1b41bb`
- Pushed/current code state: `origin/gemma-harness-lora` also points to `5b1b41bb`
- `origin/main` is an ancestor of `HEAD`
- `origin/main...HEAD`: `0 257`
- Merge to `main`: blocked on owner confirmation because the research stack is 257 commits ahead of `origin/main`

## Primary evidence

- `docs/handover/harness-r4/next-round-eval-report.md`
- `docs/handover/harness-r4/next-round-evidence.md`
- `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- `docs/handover/harness-r4/memory-r12-dispatch-scope.md`
- `docs/handover/harness-r4/memory-r12-dispatch-packet.md`

## Carry-forward invariants

- Detector code verified.
- THOUGHT-only ACTION reset fixed.
- Current repo artifacts do not prove a `3x` or `2 -> 6` pass-rate uplift.
- PLAN_UPDATE reproducibility remains unresolved.
- R12 should be dispatched from the recovery-shape generation gap.
- Do not merge this stack to `main` without owner confirmation.
