# Scope: ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6 — Harness-r4 Memory And R12 Dispatch Handoff

## Correctness Target

- The pushed `gemma-harness-lora` state is preserved and not silently merged into `main`.
- The harness-r4 closeout conclusion is made durable in both the external project memory files and repo handover docs.
- The next R12-oriented work has a dispatch artifact that cites the corrected evidence: detector code verified, 3x pass-rate uplift not verified, PLAN_UPDATE reproducibility unresolved.
- The work is reviewed with strict critique before final closeout.

## Source Of Truth

- Primary:
  - User request on 2026-06-29: proceed with next steps as a goal; push/merge current state only if it makes sense; start next work on a separate branch if appropriate; keep using team orchestration and strict critique.
  - `docs/handover/harness-r4/next-round-eval-report.md`
  - `docs/handover/harness-r4/next-round-evidence.md`
  - `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- Supporting:
  - `docs/handover/harness-r4/eval-signals-2026-06-02.md`
  - `docs/handover/harness-r4/closeout-scope.md`
  - `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r3.md`
  - `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`
- Legacy/current behavior:
  - `gemma-harness-lora` is pushed at `5b1b41bb`.
  - `origin/main` is an ancestor of this branch, and this branch is 257 commits ahead of `origin/main`.
- Anti-sources:
  - The old `2 -> 6` / `3x pass-rate uplift` claim must not be carried forward as verified.
  - Do not treat generated `.neuve/` SQLite state as source content.
- Clarity: clear for documentation/memory closeout; guarded for any actual merge into `main`.
- Gaps:
  - No open PR exists for `gemma-harness-lora`.
  - External project memory lives outside the repo and must be reviewed by absolute path.

## Literature Packet

- `docs/handover/harness-r4/next-round-eval-report.md`
  - Classification: primary.
  - Why it matters: corrected eval conclusion and R12 rationale.
  - Question answered: what should the next wave believe.
- `docs/handover/harness-r4/next-round-evidence.md`
  - Classification: primary.
  - Why it matters: verification and blocker record.
  - Question answered: which claims are proven and which are not.
- `docs/handover/harness-r4/reviews/closeout-strict-review.md`
  - Classification: primary.
  - Why it matters: strict review approval of detector closeout.
  - Question answered: whether harness-r4 code/docs slice is approved.
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r3.md`
  - Classification: supporting/template.
  - Why it matters: memory format and continuity from prior wave.
  - Question answered: how to write `project_harness_r4.md`.
- `docs/handover/harness-r4/eval-signals-2026-06-02.md`
  - Classification: anti-source for pass-rate headline, supporting for historical context.
  - Why it matters: contains the superseded 3x claim and original open questions.
  - Question answered: what needs correction.

## Verifiability Map

- Easy to verify:
  - Branch name and git ancestry/counts.
  - External memory file and index entry exist.
  - Repo memory mirror, dispatch artifact, diary/evidence, and review exist.
- Proxy-verifiable:
  - Memory text accurately reflects current handover reports.
  - R12 dispatch cites the right evidence and avoids stale claims.
- Human judgment:
  - Whether to merge the 257-commit research branch into `main`.
- Unknown:
  - Whether the owner wants a PR for the whole research branch; this scope does not auto-create or merge one.

## Verification Methods

- Typecheck/lint/static:
  - Docs-only slice: no package typecheck is required unless code changes occur.
  - If reviewer requires a cheap static check, run `git diff --check`.
- Reviewer inspection:
  - Strict review validates memory accuracy, branch/merge decision, artifact completeness, and no stale 3x claim leakage.
- Manual QA:
  - Check exact memory/index paths and repo artifacts with `test -f`, `rg`, and `git status`.

## Definition Of Done

- Required checks:
  - `git status --short --branch`
  - `git merge-base --is-ancestor origin/main HEAD`
  - `git rev-list --left-right --count origin/main...HEAD`
  - `git diff --check`
- Required artifacts:
  - `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md`
  - Updated `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`
  - `docs/handover/harness-r4/project-harness-r4-memory.md`
  - `docs/handover/harness-r4/r12-dispatch.md`
  - `docs/handover/harness-r4/evidence/memory-r12-dispatch-evidence.md`
  - `docs/handover/harness-r4/diary/memory-r12-dispatch-2026-06-29.md`
  - `docs/handover/harness-r4/reviews/memory-r12-dispatch-review.md`
- Required approvals:
  - Strict critique reviewer approval.
- Definition of ready status:
  - Ready for delegated implementation.
- Explicit non-goals:
  - Do not merge to `main` unless the owner explicitly confirms the 257-commit research stack should land.
  - Do not run a fresh eval sweep in this slice.
  - Do not implement R12 training or harness changes.
  - Do not commit `.neuve/` state.

## Type, Lint, And Documentation Gates

- Canonical type/source research: not applicable; docs/memory only.
- Type-system expectations: no code changes.
- Schema/edge validation: not applicable.
- Lint/static commands: `git diff --check`.
- Allowed unsafe casts or ignores: none.
- Major functions requiring TSDoc: none.
- DevTools-style documentation notes: memory should explain invariants and caveats, not just list files.

## Decomposition

- Task slice 1: Memory closeout.
  - Correctness point: external and repo memory carry the corrected harness-r4 conclusion.
  - Likely write/read scope: external memory files, `docs/handover/harness-r4/project-harness-r4-memory.md`, diary/evidence.
  - Must not change: source code or generated trace files.
  - Verification method: file existence, `rg` for stale pass-rate phrasing, reviewer inspection.
  - Evidence artifact: `docs/handover/harness-r4/evidence/memory-r12-dispatch-evidence.md`.
  - Type/lint/doc gate: docs-only static diff check.
  - Commit intent: `docs(harness-r4): add closeout memory and R12 dispatch`.
  - Approval: strict critique.
- Task slice 2: R12 dispatch handoff.
  - Correctness point: next work is framed around recovery-shape generation and unresolved PLAN_UPDATE, not verified pass-rate uplift.
  - Verification method: source-linked dispatch artifact and reviewer inspection.
  - Evidence artifact: same evidence file plus review.
  - Type/lint/doc gate: docs-only static diff check.
  - Commit intent: same docs commit unless reviewer requests split.
  - Approval: strict critique.

## Guardrails

- In scope:
  - Docs, handover, external memory, Kanban evidence, branch push.
- Out of scope:
  - Code changes, eval sweeps, dependency changes, pnpm approval changes, main merge.
- Commands/services allowed:
  - `git`, `rg`, `sed`, `test`, `neuve kanban`, `git diff --check`.
- Commands/services forbidden:
  - `git reset --hard`, `git checkout --`, `git stash`, `pnpm approve-builds`, fresh eval sweep, direct merge to `main` without owner confirmation.

## Decision Log Rules

- Agent may decide:
  - Exact memory wording and dispatch structure, as long as it cites primary evidence.
  - To start the next work on a separate branch.
- Agent must ask:
  - Before merging `gemma-harness-lora` or this branch into `main`.
  - Before running long fresh sweeps.
- Agent may proceed but must log:
  - Treating `gemma-harness-lora` as pushed/current but not merge-ready because of 257-commit integration scope.
  - Updating external memory outside git and mirroring the content in repo docs for review.

## Evidence Plan

- Tests/checks:
  - Git branch/ancestry/status commands.
  - `git diff --check`.
  - `rg` stale-claim scan.
- Artifacts:
  - Memory, dispatch, diary, evidence, review.
- Review evidence:
  - `docs/handover/harness-r4/reviews/memory-r12-dispatch-review.md`

## Dependency And Dispatch Plan

- Can start now:
  - Memory closeout and R12 dispatch artifact creation.
- Blocked by:
  - Main merge is blocked on owner confirmation.
- Dependency edges:
  - Strict review depends on implementation artifacts and evidence.
- Parallelization constraints:
  - Single implementer because external memory index and repo docs are coupled.
- Dispatch packet path:
  - `docs/handover/harness-r4/memory-r12-dispatch-packet.md`

## HITL Decision Register

- Blocking decisions:
  - Main merge requires owner confirmation; default is no merge.
- Proposed defaults:
  - Start next work on `codex/harness-r4-memory-r12-dispatch`.
  - Push this branch after review approval.
- Assumptions agents may use if logged:
  - External memory path from prior handover is the intended project memory location.
- Waived or deferred decisions:
  - Fresh sweep and R12 implementation are deferred.
- Questions to ask user before dispatch:
  - None for docs/memory work.

## Scoping Output Artifacts

- Scope artifact path:
  - `docs/handover/harness-r4/memory-r12-dispatch-scope.md`
- Criteria/interview notes:
  - User asked to proceed, allowed push/merge if sensible, and required team orchestration plus strict critique.
- Open questions:
  - Whether to merge the full research branch into `main`; deferred to owner.
- Follow-up artifacts to create during implementation:
  - Memory, dispatch, diary, evidence, review listed above.
- Dependency graph:
  - Implementation -> strict review -> commit/push -> close ticket/goal.
- HITL decisions:
  - Main merge blocked on owner confirmation.
- Dispatch packets:
  - `docs/handover/harness-r4/memory-r12-dispatch-packet.md`
- Artifact conventions:
  - Use `docs/handover/harness-r4/` and external memory directory named above.
- Review lanes:
  - Single docs/process/git lane via strict critique.

## Git History Plan

- Commit slices:
  - One docs commit for scope, memory mirror, dispatch, diary/evidence/review if review approves.
- Suggested commit messages:
  - `docs(harness-r4): add closeout memory and R12 dispatch`
- Staging boundaries:
  - Stage repo docs only; do not stage `.neuve/`.
  - External memory updates are outside git and must be listed in final output.
- Mechanical changes to isolate:
  - None.

## Review Posture

- Focused.
- Why:
  - Docs-only, but it sets the strategic direction for the next research wave and must not preserve stale eval claims.
- Required reviewers or review lanes:
  - Strict critique docs/process/git lane.
