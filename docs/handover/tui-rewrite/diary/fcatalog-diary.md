# F-Catalog — session artifact linking + grep-friendly index + directory docs

Task: make `.perf-agent/` easy to query, grep, and parse. Link sessions to
reports, add an append-only JSONL index, and document the directory layout.

## SessionRecord schema — before / after

**Before** (`apps/cli-solid/src/data/session-history.ts:8-16`):

```ts
interface SessionRecord {
  readonly id: string;
  readonly instruction: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly agentBackend: string;
  readonly error?: string;
}
```

**After** — `reportPath: Option.Option<string>` added (per CLAUDE.md — prefer
`Option` over nullable/undefined for domain fields):

```ts
interface SessionRecord {
  readonly id: string;
  readonly instruction: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly agentBackend: string;
  readonly reportPath: Option.Option<string>;
  readonly error?: string;
}
```

**Wire format** — serialized JSON keeps a plain optional `reportPath?: string`
(omitted when `None`). Legacy session files without the field decode as
`Option.none()`, so backward compat holds. Round-trip tested.

`error` stays as TS optional to avoid a migration that would widen scope
(teammate instruction: "Do NOT retroactively migrate old session files").

## Report path is relative to `.perf-agent/`

`ReportStorage.saveSafe` returns `Option<PersistedReport>` whose `jsonPath`
is absolute (`{repoRoot}/.perf-agent/reports/{iso-timestamp}-{slug}.json`).
`execution-atom.ts` relativizes via `path.join("reports", basename(jsonPath))`
so the on-disk session record holds `reports/{basename}.json`. Portable if
the user moves the repo.

## Append-only index — `.perf-agent/sessions/index.jsonl`

Written by `session-history.ts::appendToIndex`. Called from every write
point:

- `saveSession` — appends the freshly created record.
- `updateSession` — appends the updated record (no rewrite, no compaction).

Readers that want the latest state of session `X` take the LAST line whose
`id === X`. Every line is a single-line JSON object in the same shape as
the per-file session JSON, so grep/jq work directly. Example queries in the
README.

Trade-off: the index grows without bound. Per-file session JSONs are still
pruned to the most recent 100. The jsonl stream is append-only until the
user deletes it — acceptable because it's never in the hot path and
`wc -l .perf-agent/sessions/index.jsonl` on a busy project is still cheap.

## End-to-end wiring

1. `testing-screen.tsx::createEffect` — `saveSession(...)` at run start
   (status "running", reportPath `None`).
2. `executeFn` (wrapped in `executeCore` inside `apps/cli/src/data/execution-atom.ts`)
   runs the supervisor. On report completion: `saveSafe(report)` → `persisted:
   Option<PersistedReport>`. Relative reportPath is derived and returned on
   `ExecutionResult`.
3. `testing-screen.tsx::promise.then` on success — `updateSession(sid, {
   status: "completed", reportPath: result.reportPath })`. The Option is
   passed through unchanged.

## README outline

`.perf-agent/README.md` (< 100 lines):

- Layout diagram of the directory.
- How sessions link to reports (`reportPath` relative form).
- `sessions/index.jsonl` format and three grep/jq examples.
- Where logs go (`logs.md` Effect; `local-agent.log` subprocess).
- Safety notes: `tui.lock`, report atomicity, pruning.

## Files changed

- `apps/cli-solid/src/data/session-history.ts` — schema, Option round-trip,
  append-only index writer (`appendToIndex`).
- `apps/cli-solid/tests/data/session-history.test.ts` — 8 new tests
  covering: legacy decode, Option.some decode, `reportPath` persistence,
  append-only semantics (create + updates), `reportPath` omission on disk
  when `None`, grep-friendliness (no embedded newlines, one JSON per line).
- `apps/cli-solid/src/routes/testing/testing-screen.tsx` — on success path,
  passes `result.reportPath` into `updateSession`.
- `apps/cli/src/data/execution-atom.ts` — `ExecutionResult` gets
  `reportPath: Option.Option<string>`; derived from `saveSafe`'s return.
- `.perf-agent/README.md` — new directory doc.

## Verification

- `bun test apps/cli-solid/tests/data/session-history.test.ts` — 17 pass, 0
  fail (9 original + 8 new).
- `pnpm --filter cli-solid typecheck` — clean.
- `pnpm --filter @neuve/perf-agent-cli typecheck` — clean.
- Other packages' typecheck failures in the tree are NOT from F-Catalog —
  they belong to in-flight F-Prompt/F-AutoDrill work on the same branch.
  Confirmed by inspecting `git diff` for my 4 target files: no touches
  outside `apps/cli*/src/data`, `apps/cli-solid/src/routes/testing`,
  `apps/cli-solid/tests/data`.

## Manual verification spec

After this lands, the user can verify end-to-end:

```bash
# Run a real session
perf-agent tui -a local -u https://agent.perflab.io
# (complete the run in the TUI)

# 1. Session file has reportPath
LATEST=$(ls -1t .perf-agent/sessions/*.json | head -1)
cat "$LATEST" | jq '.reportPath'
# Expected: "reports/2026-...-agent-perflab-io.json"

# 2. Index has completed line
tail -1 .perf-agent/sessions/index.jsonl | jq '.status'
# Expected: "completed"

# 3. Index links session to report
tail -1 .perf-agent/sessions/index.jsonl | jq '.reportPath'
# Expected: same relative path as (1)

# 4. Report file actually exists at that relative path
REPORT_REL=$(tail -1 .perf-agent/sessions/index.jsonl | jq -r '.reportPath')
test -f ".perf-agent/${REPORT_REL}" && echo "linked report file exists"

# 5. README is readable
cat .perf-agent/README.md | head -20
```

Legacy sessions (those created before F-Catalog landed) continue to list in
the picker; their `reportPath` decodes as `Option.none()` silently.
