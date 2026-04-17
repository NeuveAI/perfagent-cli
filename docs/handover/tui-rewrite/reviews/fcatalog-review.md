# F-Catalog Review

**Verdict: APPROVE**

## Summary

F-Catalog delivers the session ↔ report link, the append-only `index.jsonl`,
and `.perf-agent/README.md` in a focused, well-tested diff. Scope is clean,
all 572 tests pass, both typechecks are clean, and the code matches CLAUDE.md
style (no `null`, arrow functions, kebab-case, no barrel files, no `as`
casts except at the `JSON.parse` boundary).

## Scope verification

`git diff --stat` shows exactly the claimed surfaces:

- `apps/cli-solid/src/data/session-history.ts` — schema + helpers (89/12).
- `apps/cli-solid/src/routes/testing/testing-screen.tsx` — threads reportPath (4/0).
- `apps/cli-solid/tests/data/session-history.test.ts` — +164 lines of tests.
- `apps/cli/src/data/execution-atom.ts` — ExecutionResult.reportPath (12/0).
- `.perf-agent/README.md` — untracked because `.perf-agent/.gitignore = *`,
  but physically present at `.perf-agent/README.md`. This matches the spec
  (the directory is gitignored; the README is for humans who `ls` into it).
- `docs/handover/tui-rewrite/diary/fcatalog-diary.md` — diary.

Scope NOT touched: local-agent (0), tool-loop (0), prompts (0), supervisor
(0). There is a one-line comment update in `execution-atom.ts`
(`LOCAL_AGENT_SYSTEM_PROMPT` → `buildLocalAgentSystemPrompt`) which is F-Prompt
terminology, but it's a comment-only sync and does not change behavior.

## Verification run

- `cd apps/cli-solid && bun test` → **572 pass / 0 fail / 1112 expects** in 7.15s. Includes the 8 new tests.
- `pnpm --filter cli-solid typecheck` → **clean**.
- `pnpm --filter @neuve/perf-agent-cli typecheck` → **clean**.

## Design review

### Schema: `reportPath: Option.Option<string>`

The runtime shape uses `Option`, and on-disk serialization omits the key
entirely when `None`, produces a plain string when `Some`. This is encoded
manually via `toSerialized` / `fromSerialized` helpers (not via Schema
decoders — acceptable here because session-history does not live inside the
Effect world; it's a synchronous `fs`-based helper called from Solid
lifecycle effects).

Backward compat verified by test at lines 101–120: a legacy file without
`reportPath` round-trips to `Option.none()`. Forward compat verified at
122–144: a file *with* `reportPath` round-trips to `Option.some("...")`.

### Path format

`ExecutionResult.reportPath` is derived in `execution-atom.ts`:

```ts
const reportPath = Option.map(persisted, (value) =>
  path.join(REPORTS_DIRECTORY, path.basename(value.jsonPath)),
);
```

`value.jsonPath` is the absolute path produced by
`report-storage.ts:451` (`path.join(reportsDir, ${baseName}.json)`). Taking
the basename and re-joining with `"reports"` gives `reports/{filename}`,
which is the relative-from-`.perf-agent/` path the README documents. Good:
portable, no cwd/repo-root coupling.

**Minor coupling**: this reconstructs the relative path from the filename
rather than letting the supervisor expose a canonical relative path. If
`report-storage` ever adds subdirectories under `reports/`, this will
silently flatten them. Not blocking — report-storage has no such plans —
but worth noting for future refactors.

### Append-only index

- `appendToIndex` is called from both `saveSession` (line 116) and
  `updateSession` (line 189). Every state transition adds one line.
- The **reader** in this codebase is `listSessions`, which reads the
  per-file JSON (always "latest"), not the jsonl. Correct: the jsonl is a
  grep-only stream, not the authoritative state. Test at
  lines 222–237 confirms appends happen on update without overwriting.
- **Crash safety**: `fs.appendFileSync` on POSIX opens with `O_APPEND`, so
  short writes are atomic at the line level up to PIPE_BUF (~4 KiB).
  Session records are well under this. A mid-write kill -9 could leave a
  truncated line; readers filter empty lines
  (`test/data/session-history.test.ts:28-30`) and the per-file JSON is the
  source of truth, so no data loss.
- **Concurrency**: two concurrent TUI processes are already guarded by
  `tui.lock` (LC-2/LC-3). Even without the lock, `O_APPEND` gives atomic
  interleaving at line granularity.
- **Format**: one JSON object per line, `\n`-separated, no surrounding
  array — confirmed by test at 250–265 that every line is single-line
  valid JSON even when the instruction contains newlines (`JSON.stringify`
  escapes them).
- **Growth**: the README explicitly calls out that the jsonl grows
  unbounded until deleted, while per-file JSON is pruned to
  `MAX_SESSIONS = 100`. Non-blocking per spec.

### Testing-screen integration

`testing-screen.tsx:117-131` reads `result.reportPath` from the completed
execution and threads it to `updateSession(sid, { status: "completed",
reportPath: result.reportPath })`. Clean, single callsite.

**Semantic note**: `saveSafe` returns `Option.none()` when (a) persistence
raises `PlatformError` (disk full, permission denied) OR (b)
`shouldSkip(report)` is true (no metrics, console, or network). In case
(b), the session ends up `status: completed` with `reportPath: None` —
that's correct (the run succeeded but nothing was persisted). Non-blocking;
model is consistent.

### Tests

8 new tests cover:

1. `reportPath` defaults to `Option.none()` on `saveSession`.
2. On-disk omission of `reportPath` key when `None`.
3. Legacy decode (no key) → `Option.none()`.
4. Present-key decode → `Option.some(...)`.
5. `updateSession` persists `reportPath` and round-trips through
   `listSessions`.
6. Index appends one line per `saveSession`.
7. Index appends another line per `updateSession` (no rewrite).
8. Every index line is single-line valid JSON, even with multi-line
   instructions.

No missing cases of note. Crash-mid-write is infeasible to test in bun
without process killing, and is adequately mitigated by `O_APPEND` + per-
file JSON fallback.

### `.perf-agent/README.md`

Accurate, concise, references real files (`session-history.ts`,
`execution-atom.ts`, `report-storage.ts`), real commands (grep + jq
snippets are valid). The `tui.lock` safety note is correct
(`apps/cli-solid/src/lifecycle/shutdown.ts` owns the lock).

The directory-layout ASCII tree lists `.gitignore`, `logs.md`,
`local-agent.log`, `last-tested`, `project-preferences.json`, `tui.lock`,
`sessions/`, `reports/`. All of those exist in my local `.perf-agent/` and
are documented elsewhere in the codebase.

## Style

- `interface` over `type`: ✅ (`SessionRecord`, `SerializedSessionRecord`,
  `SaveSessionInput`, `UpdateSessionInput`).
- Arrow functions only: ✅.
- No `null`: ✅ (uses `Option.none()` and `undefined` in the serialized
  shape, which is correct for JSON).
- No `as` casts except at the `JSON.parse` boundary: ✅ (`parsed = JSON.parse(...) as SerializedSessionRecord` — unavoidable since `JSON.parse` returns `unknown` and `fromSerialized` normalizes).
- kebab-case filenames: ✅.
- No comments beyond what's necessary: ✅.
- Namespace imports for node built-ins: ✅ (`import * as crypto`, `* as fs`, `* as path`).
- No barrel files: ✅ (direct imports).

## Observations (non-blocking)

1. The `reportPath` reconstruction in `execution-atom.ts` couples to the
   assumption that reports live flat under `.perf-agent/reports/`. If
   report-storage ever nests (e.g., by date), this will flatten silently.
   Minor. Could be hardened by exposing a canonical `relativePath` on
   `PersistedReport` in a future iteration — not required for F-Catalog.

2. The README's `tail -1 .perf-agent/sessions/index.jsonl | jq -r
   .instruction` example gives the instruction of the last *event*, not
   the last *session*. Readers who want the latest session's instruction
   need the group-by-id idiom (shown lower in the README). Minor nit; the
   README's own "Count by status" example shows the correct idiom.

3. `updateSession`'s `error: updates.error ?? existing.error` preserves
   existing error if caller passes `undefined`. Previous behavior with
   `{...existing, ...updates}` would have overwritten with `undefined`.
   No caller hits this edge case today, but the semantic is slightly
   tighter now. Non-blocking.

## Verdict

**APPROVE.** The implementation is clean, tested, documented, and in scope.
No critical or major issues. The minor observations above are follow-ups,
not merge blockers.
