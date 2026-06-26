# Scope: harness-r4 detector validation closeout

## Correctness Target

- The harness-r4 detector implementation is either closed as INFO-VERIFIED with inspectable evidence, or the remaining blocker is recorded with exact proof.
- The THOUGHT-only detector semantics are validated against the intended "consecutive THOUGHTs without ACTION/progress" behavior.
- The branch has durable closeout artifacts answering the PLAN_UPDATE reproducibility, THOUGHT-only visibility, pass-rate mechanism, and next-direction questions.
- The Kanban ticket `ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9` has proof-backed evidence for `next-round-evidence`, `next-round-eval-report`, `scoped-tests`, and `strict-review` before it can move to done.

## Source Of Truth

- Primary:
  - User request: use team-orchestration and strict-critique to validate and perform next steps.
  - `docs/handover/harness-r4/t_f1abb9ba-review-feedback.md`: merge readiness and missing DoD artifacts.
  - `docs/handover/harness-r4/eval-signals-2026-06-02.md`: eval signals and open questions.
- Supporting:
  - `docs/research/harness-r4/detectors-plan.md`: intended detector behavior.
  - `docs/handover/harness-r4/diary/r0-2026-05-29.md`: implementation diary.
  - `packages/local-agent/src/tool-loop.ts`: local-agent detector implementation.
  - `packages/evals/src/runners/gemini-react-loop.ts`: eval runner detector implementation.
  - `packages/evals/evals/traces/wave-harness-r4-detectors/`: prior 60-trace sweep.
- Legacy/current behavior:
  - `packages/evals/docs/handover/harness-evals/baselines/wave-r5-ab.md` is auto-generated and can be overwritten by future sweeps.
- Anti-sources:
  - Any claim that harness-r4 is merge-ready without `next-round-evidence.md`, `next-round-eval-report.md`, scoped tests, and strict review evidence.
- Clarity: guarded. The code/doc closeout is clear; full two-sweep repro may depend on external eval/provider environment.
- Gaps:
  - Neuve warm/scan/triage are blocked until repo-local consent/setup exists; `neuve doctor` artifact `.neuve-artifact/doctor-1782495962-37981000-66913.json` records this.

## Literature Packet

- `docs/handover/harness-r4/t_f1abb9ba-review-feedback.md`
  - Classification: primary.
  - Why it matters: names the missing closeout artifacts and failed sweep state.
  - Question answered: what blocks merge/readiness.
- `docs/handover/harness-r4/eval-signals-2026-06-02.md`
  - Classification: primary.
  - Why it matters: records the existing r4 sweep, open questions, and recommended R12 pivot.
  - Question answered: what should be validated before direction call.
- `docs/research/harness-r4/detectors-plan.md`
  - Classification: supporting.
  - Why it matters: defines vary-each-attempt and THOUGHT-only detector intent.
  - Question answered: what code behavior was intended.
- `packages/local-agent/src/tool-loop.ts`
  - Classification: current behavior.
  - Why it matters: local-agent path used by gemma-react and gemma-oracle-plan.
  - Question answered: whether detector emits trace-visible messages and resets streaks correctly.
- `packages/evals/src/runners/gemini-react-loop.ts`
  - Classification: current behavior.
  - Why it matters: Gemini comparison path should mirror detector semantics.
  - Question answered: sibling parity.
- `packages/local-agent/tests/tool-loop-agent-turn.test.ts`
  - Classification: current behavior.
  - Why it matters: focused local-agent detector tests live here.
  - Question answered: scoped regression coverage.
- `packages/evals/tests/gemini-react-loop.test.ts`
  - Classification: current behavior.
  - Why it matters: focused Gemini detector tests live here.
  - Question answered: sibling regression coverage.

## Verifiability Map

- Easy to verify:
  - THOUGHT-only streak clears on ACTION in both loop implementations.
  - Focused detector unit tests cover THOUGHT-only interleaving and vary-each-attempt.
  - Required closeout artifacts exist at exact paths.
- Proxy-verifiable:
  - Prior r4 sweep metrics from existing traces and score sidecars.
  - Pass-rate mechanism via trace-pair inspection against r3 anchor.
- Human judgment:
  - Whether remaining eval variance is sufficient to pivot to R12 or requires harness-r5.
  - Whether full rerun cost is acceptable if provider/browser environment is degraded.
- Unknown:
  - Whether a fresh 60-trace or two-sweep repro can run in this local environment without provider/runtime setup.

## Verification Methods

- TDD/unit:
  - `CI=true pnpm --filter @neuve/local-agent test -- tests/tool-loop-agent-turn.test.ts`
  - `CI=true pnpm --filter @neuve/evals test -- tests/gemini-react-loop.test.ts`
- Integration/eval:
  - If environment is ready: `EVAL_TRACE_DIR=evals/traces/wave-harness-r4-detectors-sweep2 pnpm --filter @neuve/evals eval:wave-r5-ab`
  - If environment is not ready: record the exact command failure and use existing 60-trace sweep only as prior evidence, not fresh verification.
- Typecheck/lint/static:
  - `CI=true pnpm --filter @neuve/local-agent typecheck`
  - `CI=true pnpm --filter @neuve/evals typecheck`
  - `CI=true pnpm --filter @neuve/local-agent check`
  - `CI=true pnpm --filter @neuve/evals check`
- Reviewer inspection:
  - Strict critique review to `docs/handover/harness-r4/reviews/closeout-strict-review.md`.

## Definition Of Done

- Required checks:
  - Focused local-agent detector test passes.
  - Focused evals Gemini detector test passes.
  - Relevant package typecheck/check commands pass, or failures are recorded as blockers with exact output.
  - Kanban gate for ticket `ticket:7845b452-aaf4-48f9-9ff7-abb525fac9e9` passes or records the exact remaining blocker.
- Required artifacts:
  - `docs/handover/harness-r4/next-round-evidence.md`
  - `docs/handover/harness-r4/next-round-eval-report.md`
  - `docs/handover/harness-r4/evidence/neuve-ax-feedback.md`
  - `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- Required approvals:
  - Separate strict-critique reviewer verdict APPROVE before closeout.
- Definition of ready status:
  - Ready for implementation of detector semantic fix and artifact generation.
  - Guarded for full fresh sweep until provider/runtime environment is proven.
- Explicit non-goals:
  - Do not implement R12 distillation in this slice.
  - Do not introduce new detector families unless evidence reveals a concrete harness-r5 blocker.
  - Do not revert unrelated dirty files.

## Type, Lint, And Documentation Gates

- Canonical type/source research:
  - Use existing `Thought`, `Action`, `PlanUpdate`, `StepDone`, `RunCompleted`, and ACP update types already imported by the loop implementations.
- Type-system expectations:
  - No new `any`, unchecked casts, non-null assertions, or lint disables.
- Schema/edge validation:
  - Keep existing `AgentTurn` parsing and response schema paths unchanged.
- Lint/static commands:
  - Package-level `typecheck` and `check` commands above.
- Allowed unsafe casts or ignores:
  - None newly allowed.
- Major functions requiring TSDoc:
  - No new exported major function expected. If one is introduced, document behavior and invariants.

## Decomposition

- Task slice 1: Detector semantic fix.
  - Correctness point: `THOUGHT -> ACTION -> THOUGHT` must not trip the consecutive THOUGHT-only detector.
  - Likely write/read scope: `packages/local-agent/src/tool-loop.ts`, `packages/evals/src/runners/gemini-react-loop.ts`, related tests.
  - Must not change: REFLECT thresholds, doom-loop thresholds, envelope schema, or unrelated retry behavior.
  - Verification method: focused unit tests in both packages.
  - Evidence artifact: `docs/handover/harness-r4/next-round-evidence.md`.
  - Type/lint/doc gate: no unsafe type escape; package checks.
  - Commit intent: behavior + tests.
  - Approval: strict reviewer.
- Task slice 2: Closeout evidence/report.
  - Correctness point: report answers THOUGHT visibility, PLAN_UPDATE reproducibility state, pass-rate mechanism, and direction call.
  - Likely write/read scope: `docs/handover/harness-r4/next-round-evidence.md`, `docs/handover/harness-r4/next-round-eval-report.md`, existing trace dirs.
  - Must not change: auto-generated baseline unless a fresh sweep is intentionally run.
  - Verification method: trace grep/status commands and reviewer inspection.
  - Evidence artifact: the two required markdown files.
  - Type/lint/doc gate: docs only.
  - Commit intent: closeout docs.
  - Approval: strict reviewer.

## Guardrails

- In scope:
  - Harness-r4 detector semantics, focused tests, closeout evidence/report, Kanban evidence, strict review.
- Out of scope:
  - R12 implementation, broad eval harness redesign, unrelated devcontainer changes.
- Commands/services allowed:
  - `pnpm` with `CI=true`, `neuve kanban`, bounded trace grep/node scripts.
- Commands/services forbidden:
  - `git reset --hard`, `git checkout --`, `git stash`, `git push`, destructive cleanup.

## Decision Log Rules

- Agent may decide:
  - Exact wording of closeout report and evidence layout.
  - Whether fresh eval command failure is a blocker or a documented environment limitation.
- Agent must ask:
  - Before changing repo-local Neuve consent/setup with `neuve init`.
  - Before running very long fresh sweeps if local preflight shows missing provider/browser/runtime dependencies.
- Agent may proceed but must log:
  - Treating existing 60-trace sweep as prior evidence rather than fresh verification.
  - Any skipped full sweep due to unavailable runtime.

## Evidence Plan

- Tests/checks:
  - Focused unit tests and package checks recorded in `next-round-evidence.md`.
- Artifacts:
  - Required closeout files above.
  - Neuve AX feedback file recording doctor/Kanban/warm limitations.
- Review evidence:
  - Strict review file with verdict and findings.
  - Kanban evidence commands satisfying all four labels.

## Dependency And Dispatch Plan

- Can start now:
  - Detector semantic fix and closeout artifact drafting.
- Blocked by:
  - Full fresh two-sweep variance check may be blocked by provider/runtime environment and owner approval for long run.
- Dependency edges:
  - Strict review depends on implementation/evidence artifacts.
  - Kanban done depends on strict review and proof-backed evidence handoffs.
- Parallelization constraints:
  - One worker owns code and evidence because touched files are coupled.
  - Reviewer starts after worker reports ready; implementer remains available for patches.
- Dispatch packet path:
  - This file.

## HITL Decision Register

- Blocking decisions:
  - None for focused code/doc closeout.
- Proposed defaults:
  - Fix THOUGHT-only reset semantics because it aligns implementation with detector intent.
  - If fresh sweep cannot run locally, record blocker evidence and keep ticket active rather than claiming done.
- Assumptions agents may use if logged:
  - Later review feedback wins over earlier readiness language.
  - R12 is the likely next strategic direction if no new harness-r5 blocker appears.
- Waived or deferred decisions:
  - R12 dispatch is deferred until this closeout is reviewed.
- Questions to ask user before dispatch:
  - None for focused closeout.

## Scoping Output Artifacts

- Scope artifact path:
  - `docs/handover/harness-r4/closeout-scope.md`
- Criteria/interview notes:
  - User requested team-orchestration + strict-critique and allowed additional agents/research/synthetic data if needed.
- Open questions:
  - Can a fresh full sweep run in the current environment?
- Follow-up artifacts to create during implementation:
  - `docs/handover/harness-r4/next-round-evidence.md`
  - `docs/handover/harness-r4/next-round-eval-report.md`
  - `docs/handover/harness-r4/evidence/neuve-ax-feedback.md`
  - `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- Dependency graph:
  - Scope -> worker implementation/evidence -> reviewer -> patches if needed -> Kanban evidence/gate.
- HITL decisions:
  - Owner approval required before `neuve init` or expensive full fresh sweeps if preflight is not clean.
- Dispatch packets:
  - Worker and reviewer prompts should cite this file and Kanban ticket.
- Artifact conventions:
  - Harness-r4 docs stay under `docs/handover/harness-r4/`.
- Review lanes:
  - Strict critique code/evidence lane covering local-agent, evals, docs, and Kanban evidence.

## Git History Plan

- Commit slices:
  - Slice 1: detector semantic fix + focused tests.
  - Slice 2: closeout evidence/report/review artifacts.
- Suggested commit messages:
  - `fix(evals): reset thought-only detector on action progress`
  - `docs(harness-r4): record detector closeout evidence`
- Staging boundaries:
  - Keep unrelated devcontainer changes separate or leave unstaged.
  - Keep auto-generated baseline separate unless intentionally regenerated.
- Mechanical changes to isolate:
  - Formatting-only changes should not be mixed with behavior changes.

## Review Posture

- Guarded.
- Why:
  - The branch has a real detector semantics risk and missing evidence artifacts; full eval repro may require external runtime setup.
- Required reviewers or review lanes:
  - One separate strict-critique reviewer with antagonistic directive.
