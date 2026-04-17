# `.perf-agent/` — runtime state for `perf-agent` CLI

This directory is gitignored and owned by the CLI. Every artifact here is
regeneratable. Safe to delete the whole directory (when the TUI is not
running) to reset state.

## Layout

```
.perf-agent/
├── README.md                           This file.
├── .gitignore                          Excludes the entire directory from git.
├── logs.md                             Effect file logger output (frontend + backend).
├── local-agent.log                     stdout/stderr of the local-agent subprocess.
├── last-tested                         Fingerprint of the last HEAD that passed.
├── project-preferences.json            Per-project UI prefs (agent backend, etc.).
├── tui.lock                            Stale-session guard. Created on TUI startup.
├── sessions/
│   ├── {timestamp}-{id}.json           One session (latest state).
│   └── index.jsonl                     Append-only stream of session states.
└── reports/
    ├── {iso-timestamp}-{slug}.json     Full PerfReport (schema-validated).
    ├── {iso-timestamp}-{slug}.md       Human-readable summary.
    ├── latest.json                     Symlink (or copy) to newest report.
    └── latest.md                       Symlink (or copy) to newest report.md.
```

## Session ↔ report linking

A session is lightweight (instruction, status, agent backend, timestamps).
When a run produces a report, the session's `reportPath` field is filled
with the relative path from `.perf-agent/` to the report JSON (e.g.
`reports/2026-04-17T17-37-22Z-agent-perflab-io.json`).

To jump from a session to its report:

```bash
# Get the reportPath of the most recent completed session
jq -r '.reportPath // empty' .perf-agent/sessions/index.jsonl \
  | tail -1
```

Sessions are written by `apps/cli-solid/src/data/session-history.ts`. Reports
are written by `packages/supervisor/src/report-storage.ts`. The link is
populated in `apps/cli/src/data/execution-atom.ts` after `saveSafe` returns
the persisted report path.

## `sessions/index.jsonl` — grep-friendly stream

Append-only. One line per session state change (create, status update,
reportPath set). Each line is a single-line JSON object in the same shape as
the per-file session JSON. To find the latest state of a given session, take
the last matching line.

Examples:

```bash
# All completed sessions
grep '"status":"completed"' .perf-agent/sessions/index.jsonl | jq .

# Latest instruction text
tail -1 .perf-agent/sessions/index.jsonl | jq -r .instruction

# Count by status (latest state per id)
jq -s 'group_by(.id) | map(.[-1]) | group_by(.status) | map({status: .[0].status, count: length})' \
  .perf-agent/sessions/index.jsonl
```

The stream is never rewritten or compacted. The per-file JSON at
`sessions/{timestamp}-{id}.json` always reflects the latest state; pruning
keeps at most 100 files but the index retains history until deleted.

## `logs.md` and `local-agent.log`

- `logs.md` — Effect logger output (all Effect-TS services). Grep by
  `[source: Backend]`, `[source: Frontend]`, `[ERROR]`, or log annotations.
- `local-agent.log` — raw subprocess output from the local agent.

## Safety

- `tui.lock` is created on TUI startup and tracks the process owner. **Do not
  delete while the TUI is running**, or stale-session detection will misfire.
- Reports are atomic: `*.tmp` → `rename`. Partial files should not appear.
- Sessions are pruned to the most recent 100. The jsonl index grows until
  deleted.
