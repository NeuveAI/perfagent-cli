# Memory and R12 dispatch evidence

Ticket: `ticket:f4bd1b46-2491-4c19-b919-cf58abbd60b6`

Generated: 2026-06-29

## Scope performed

Docs and memory only:

- created external memory: `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md`
- updated external memory index: `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`
- created repo memory mirror: `docs/handover/harness-r4/project-harness-r4-memory.md`
- created R12 dispatch: `docs/handover/harness-r4/r12-dispatch.md`
- created this evidence record
- created diary: `docs/handover/harness-r4/diary/memory-r12-dispatch-2026-06-29.md`

No product/source code, generated traces, dependency files, or `.neuve` files were edited.

## Required reading completed

- `docs/handover/harness-r4/memory-r12-dispatch-scope.md`
- `docs/handover/harness-r4/memory-r12-dispatch-packet.md`
- `docs/handover/harness-r4/next-round-eval-report.md`
- `docs/handover/harness-r4/next-round-evidence.md`
- `docs/handover/harness-r4/reviews/closeout-strict-review.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r3.md`
- `/Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md`

## Branch and remote evidence

Commands run before writing:

```bash
git rev-parse HEAD
```

Result:

```text
5b1b41bbbb5fb9b57c18a6152d1b8e7e397479c4
```

```bash
git rev-parse origin/gemma-harness-lora
```

Result:

```text
5b1b41bbbb5fb9b57c18a6152d1b8e7e397479c4
```

```bash
git rev-list --left-right --count origin/main...HEAD
```

Result:

```text
0	257
```

Interpretation:

- The local dispatch branch is at the same commit as the pushed `origin/gemma-harness-lora` code state.
- `origin/main` is an ancestor of `HEAD`.
- The stack is 257 commits ahead of `origin/main`, so merging to `main` is blocked on owner confirmation.

Remote branch note:

- `git ls-remote --heads origin codex/harness-r4-memory-r12-dispatch` returned no remote head before these docs were created.
- Therefore "pushed/current" refers to the underlying code state at `origin/gemma-harness-lora`, not to a pushed remote copy of this docs branch.

## Corrected conclusion preserved

The memory and dispatch artifacts record:

- detector code verified;
- THOUGHT-only ACTION reset fixed;
- current repo artifacts do not prove the stale `2 -> 6` / `3x pass-rate uplift` framing;
- PLAN_UPDATE reproducibility remains unresolved;
- R12 is justified by recovery-shape generation gap, not verified pass-rate uplift;
- main merge requires owner confirmation because the stack is 257 commits ahead of `origin/main`.

## Verification checklist

Run after implementation:

```bash
git status --short --branch
git merge-base --is-ancestor origin/main HEAD; echo $?
git rev-list --left-right --count origin/main...HEAD
git diff --check
rg -n "3x|2 -> 6|2→6|pass-rate uplift" docs/handover/harness-r4 /Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r4.md /Users/vinicius/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/MEMORY.md
```

Expected interpretation for `rg`: matches are allowed only where the phrase is marked stale, contradicted, or historical/source-contextualized.
