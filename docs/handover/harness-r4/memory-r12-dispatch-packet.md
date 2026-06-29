# Dispatch Packet: ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6

## Status

Ready for implementation.

## Task

Create the harness-r4 memory closeout and R12 dispatch handoff artifacts.

## Mandatory Reading

- `docs/handover/harness-r4/memory-r12-dispatch-scope.md`
- `docs/handover/harness-r4/next-round-eval-report.md`
- `docs/handover/harness-r4/next-round-evidence.md`
- `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r3.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`

## Kanban Context

- Ticket: `ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6`
- Lane: ready.
- Sources: `SRC-CLI-1782690515551-1` through `SRC-CLI-1782690515551-6`.
- Expected evidence: `scope`, `memory-closeout`, `next-dispatch`, `git-state`, `strict-review`.
- Validation route: agent-delegable.
- Main merge: blocked on owner confirmation.

## Write Scope

- External memory:
  - `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md`
  - `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`
- Repo artifacts:
  - `docs/handover/harness-r4/project-harness-r4-memory.md`
  - `docs/handover/harness-r4/r12-dispatch.md`
  - `docs/handover/harness-r4/evidence/memory-r12-dispatch-evidence.md`
  - `docs/handover/harness-r4/diary/memory-r12-dispatch-2026-06-29.md`

## Forbidden Scope

- Do not edit product/source code.
- Do not edit generated trace files or rerun evals.
- Do not merge to `main`.
- Do not commit `.neuve/`.
- Do not run `pnpm approve-builds`.

## Acceptance Criteria

- External memory has a `project_harness_r4.md` entry matching the style of `project_harness_r3.md`.
- External `MEMORY.md` links to `project_harness_r4.md`.
- Repo mirror captures the same conclusion for review.
- `r12-dispatch.md` gives the next agent a source-linked starting point and explicitly rejects the stale verified-3x-uplift framing.
- Evidence records:
  - branch and remote state,
  - merge decision,
  - artifact paths,
  - stale-claim scan,
  - static diff check.
- Kanban comments/evidence are recorded for implementation evidence labels where possible.

## Verification Commands

```bash
git status --short --branch
git merge-base --is-ancestor origin/main HEAD; echo $?
git rev-list --left-right --count origin/main...HEAD
git diff --check
rg -n "3x|2 -> 6|2→6|pass-rate uplift" docs/handover/harness-r4 /Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md /Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md
```

The `rg` command may find historical mentions if they are explicitly marked stale or contradicted.

## Review Lane

- Single strict-critique docs/process/git lane.
- Review output path: `docs/handover/harness-r4/reviews/memory-r12-dispatch-review.md`
- Reviewer must use the required strict-critique output structure and include Neuve dogfood feedback or an explicit unavailability note.
