# Diary: memory and R12 dispatch

Ticket: `ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6`

Date: 2026-06-29

## Read-in

Read the full required task spec and packet before writing:

- `docs/handover/harness-r4/memory-r12-dispatch-scope.md`
- `docs/handover/harness-r4/memory-r12-dispatch-packet.md`

Also read the required evidence and memory context:

- `docs/handover/harness-r4/next-round-eval-report.md`
- `docs/handover/harness-r4/next-round-evidence.md`
- `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r3.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`

Re-read Kanban state before editing:

- `neuve kanban show ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6`
- `neuve kanban context ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6`

## Implementation

Created the harness-r4 memory closeout and R12 dispatch artifacts:

- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md`
- `docs/handover/harness-r4/project-harness-r4-memory.md`
- `docs/handover/harness-r4/r12-dispatch.md`
- `docs/handover/harness-r4/evidence/memory-r12-dispatch-evidence.md`

Updated:

- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`

Created this diary:

- `docs/handover/harness-r4/diary/memory-r12-dispatch-2026-06-29.md`

## Decisions recorded

- The detector closeout remains accepted: THOUGHT-only ACTION reset is fixed and focused tests passed in the prior code closeout.
- The stale `2 -> 6` / `3x pass-rate uplift` claim is explicitly rejected as verified evidence.
- Current sidecars show gemma-react flat at 6/20 passed in both r3 and r4.
- PLAN_UPDATE reproducibility remains unresolved because r4 has zero PLAN_UPDATE records and the planned second sweep is unavailable from current artifacts.
- R12 should be justified by recovery-shape generation after REFLECT, not by pass-rate uplift.
- The current code state is pushed/current through `origin/gemma-harness-lora` at `5b1b41bb`; this docs branch itself did not have a remote head before implementation.
- Merge to `main` is blocked on owner confirmation because the stack is 257 commits ahead of `origin/main`.

## Next steps

- Run the required verification commands.
- Record Kanban progress and evidence handoffs for `memory-closeout`, `next-dispatch`, and `git-state`.
- Run `neuve kanban gate ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6 --target done`.
- Do not record `strict-review`; reviewer owns that label.
