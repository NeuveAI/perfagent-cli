# Review: Pre-wave — vite-plus `pnpm check` loader fix (Round 1)

## Verdict: APPROVE

### Verification executed

| Command | Outcome |
|---|---|
| `git status --short` | Only `D vite.config.ts`, `?? vite.config.mjs`, `?? docs/handover/harness-evals/diary/pre-wave-vite-plus-fix.md`. No stray edits. |
| `git diff --stat HEAD` | `vite.config.ts \| 39 ---------------------------------------` (1 file, 39 deletions — the new `.mjs` is untracked, so not shown in stat). |
| `diff <(git show HEAD:vite.config.ts) vite.config.mjs` | `IDENTICAL` — byte-equivalent, content preservation confirmed. |
| `pnpm check` | Loader error GONE. Residual: format-only failures in `@neuve/shared` (7 files) and `@neuve/evals` (3 files). No `ERR_UNKNOWN_FILE_EXTENSION`. No type errors. |
| `pnpm --filter @neuve/evals test` | 3 files / 25 tests passed. Matches engineer claim. |
| `pnpm --filter @neuve/perf-agent-cli typecheck` | Pass (tsgo --noEmit, no output = success). |
| `pnpm --filter cli-solid typecheck` | Pass (tsgo --noEmit, no output = success). |
| `pnpm build` | 5/5 tasks successful (FULL TURBO cache hit on 4, fresh build on perf-agent-cli). |
| `find packages apps -name 'vite.config.*'` | 9 per-package `.ts` configs left intact (as claimed — loader only walks up to monorepo root). |
| `git log -1 <failing-file>` for pre-existing format claim | All 10 failing files last committed by prior authors (9 days ago for shared, 3 hours ago via commits `62746a41` / `4d2d91d7` / `4ce748e3` for evals — NOT the current uncommitted engineer session). Claim verified. |
| `git diff HEAD -- packages/shared packages/evals` | Empty. Engineer did not touch those files. |
| `node --version` | `v22.14.0` — matches the engineer's stated trigger condition. |
| `.nvmrc` / `package.json engines` | Neither present. Fix is not load-bearing on a pin; it works on every Node the loader targets. Acceptable (noted below). |

### Findings

None at Critical or Major severity.

- [INFO] `vite.config.mjs` content is byte-equivalent to the deleted `vite.config.ts` (confirmed via `diff`). Only the file extension changed, which is exactly the surgical fix the diary claims. No semantic drift.
- [INFO] 9 per-package `packages/*/vite.config.ts` files are untouched. The diary correctly reasons that the native `oxfmt`/`oxlint` binaries load configuration only from the monorepo root walking upward — not from per-package configs — so leaving those as TS is fine. Verified empirically: `pnpm check` no longer emits `ERR_UNKNOWN_FILE_EXTENSION` from any package invocation.
- [INFO] Residual `pnpm check` failures are purely `oxfmt` formatting findings (`Formatting issues found` / `Run \`vp check --fix\` to fix them`), not type errors and not loader errors. Task #11 scope explicitly excluded these pre-existing format failures.
- [INFO] Diary correctly documents rejected approaches (A–E), including concrete evidence for (A) vite-plus 0.1.19 upgrade test and (B) `.mts` not helping. This matches the reviewer-side checklist on documenting rejections.
- [INFO] No `.nvmrc` or `engines` pin exists in the repo root `package.json`. The fix is therefore not load-bearing on a pinned Node version — it also unblocks contributors on newer Nodes that would have worked anyway, and unblocks older Nodes (≥18) that would have failed. Net improvement regardless of who runs it.
- [INFO] Commit plan is clean: 1 rename (`.ts` → `.mjs`) + 1 diary add. Splits naturally into one or two small commits. No sprawl.

### Suggestions (non-blocking)

- Consider, in a follow-up task (not this one), fixing the 10 pre-existing format failures with `pnpm check --fix` so `pnpm check` returns green for the first time. Out of scope here — explicitly called out as non-goal in the task — but worth logging as a separate hygiene task.
- If the team later standardises on Node ≥ 22.18, converting back to `.ts` is harmless and consistent with per-package configs. Not urgent; current `.mjs` works on all Node versions.
- The diary is well-written. No changes requested.

### Antagonistic checklist summary

1. Scope minimality: PASS (only 3 expected paths changed).
2. Content preservation: PASS (byte-equivalent via `diff`).
3. Loader claim: PASS (`ERR_UNKNOWN_FILE_EXTENSION` gone; only format findings remain).
4. Pre-existing formatting claim: PASS (all 10 files last-committed by prior authors; engineer diff is empty for those paths).
5. No sibling regression: PASS (evals 25/25; two typecheck filters green; full build 5/5).
6. Per-package configs: PASS (9 `.ts` configs retained; loader does not descend into them).
7. Runtime assumption: PASS with nuance (no Node pin exists; fix works on all versions).
8. Diary quality: PASS (rejected approaches enumerated with reasoning).
9. Commit plan readiness: PASS (1–2 commits, small, logical).

No Critical or Major findings. Fix is minimal, correct, reversible, and unblocks `pnpm check` end-to-end for the loader error — which is exactly the task's stated scope.
