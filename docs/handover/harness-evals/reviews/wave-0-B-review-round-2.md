# Review: Wave 0.B — Eval scaffold (Round 2)

## Verdict: APPROVE

### Scope of Round 2

Targeted re-review of the dedup patch for Round 1 Minor finding. Not a full re-review.

### Patch contents

- **New file:** `packages/evals/src/scorers/key-node-matches.ts` — 8 lines, exports exactly the `keyNodeMatches` helper with the same equality-then-regex body. No extra utilities, no scope creep.
- **Edited:** `packages/evals/src/scorers/step-coverage.ts` — removed local `keyNodeMatches`, now imports `./key-node-matches`. Body of `stepCoverage` unchanged.
- **Edited:** `packages/evals/src/scorers/furthest-key-node.ts` — removed local `keyNodeMatches`, now imports `./key-node-matches`. Body of `furthestKeyNode` unchanged.
- No other files touched under `packages/evals/`. No `index.ts` created anywhere.

### Verification executed

| Command | Outcome |
|---|---|
| `git status` (packages/evals) | New file `key-node-matches.ts`; `step-coverage.ts` and `furthest-key-node.ts` modified; no other files. |
| Glob `packages/evals/**/index.ts` | Zero hits. No barrel file. |
| `pnpm --filter @neuve/evals test` | **PASS** — 3 files, 25/25 tests (matches Round 1). |
| `pnpm --filter @neuve/evals typecheck` | **PASS** — `tsgo --noEmit` clean. |
| `pnpm --filter @neuve/evals eval` | **PASS** — 15-row scoreboard, numbers identical to Round 1: `success`=100%; `stops-at-1`=75% (trivial-1/2), 42% (moderate-1/2), 33% (hard-volvo); `malformed-tools`=50% across all tasks. Overall 68%. |

### Findings

None. Round 1 Minor finding is resolved cleanly. No new issues introduced.

### Exit criteria status

1. Mandatory verification commands for scoped tasks — all pass.
2. Prior-round findings resolved — yes, the sole Round 1 Minor is fixed.
3. Diary claims independently verified — yes; test count, typecheck status, and scoreboard numbers all match the engineer's claim.
4. DoD behavior demonstrated end-to-end — unchanged from Round 1 (already satisfied).
5. Sibling-code checklist — no new code paths introduced; dedup is a pure refactor.
