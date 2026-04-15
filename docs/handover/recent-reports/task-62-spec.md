# Task #62 — Load past reports from `.perf-agent/reports/`

**Goal.** Let users reopen a prior `PerfReport` in the Results screen without re-running a trace. Reports already persist to disk via `packages/supervisor/src/report-storage.ts`. This task adds the read side: list, load, picker screen, keyboard entry, and a main-menu discovery nudge.

**Schema round-trip is already fixed** (task #61 committed). `PerfReport.pullRequest` and `PerfPlanDraft.baseUrl` now use `Schema.OptionFromUndefinedOr(...)`. The only remaining hazard is *legacy on-disk* files that still contain `{"_id":"Option","_tag":"None"}` under `pullRequest`. A small backcompat normalizer strips that marker before schema decode.

## Scope — files to add / change

### 1. Supervisor — reader surface

`packages/supervisor/src/report-storage.ts` — add `list` and `load`.

Required shape:

```ts
interface ReportManifest {
  readonly absolutePath: string;    // full path to the .json file
  readonly filename: string;        // basename, e.g. "2026-04-15T17-30-00Z-agent-perflab-io.json"
  readonly url: string | undefined; // report.targetUrls[0] when present
  readonly branch: string;          // report.currentBranch
  readonly title: string;           // report.title
  readonly status: string;          // report.status ("passed" | "failed")
  readonly id: string;              // report.id (PlanId)
  readonly collectedAt: Date;       // from mtime; stable, sortable
}
```

- `list` returns `Effect<readonly ReportManifest[], FindRepoRootError>`. Reads `.perf-agent/reports/*.json`, skips `latest.json` (dedupe symlink), parses each with `JSON.parse`, plucks the manifest fields via `Predicate.isRecord` narrowing (NO `as` casts). On a per-file parse failure, log a warning with the filename and skip it. Sort results by `collectedAt` DESC.
- `load` takes an absolute path, reads the file, runs the legacy normalizer, then `Schema.decodeEffect(PerfReport)`. Returns `Effect<PerfReport, ReportLoadError>`. Define `ReportLoadError` as a `Schema.ErrorClass` with `filename` and `cause` fields.
- Legacy normalizer: pure function. If the decoded object has `pullRequest._id === "Option"` and `pullRequest._tag === "None"`, return a copy without that field. Otherwise return as-is. Unit test covers: (a) legacy file decodes, (b) current-format file decodes, (c) Some(pr) file decodes.
- Both methods respect `.perf-agent/reports/` resolution from `GitRepoRoot`, same as existing `save`.
- Use `Effect.catchReason("PlatformError", "NotFound", ...)` narrowly — `list` on a missing directory returns `[]`, never throws.

### 2. Supervisor tests

`packages/supervisor/tests/report-storage.test.ts` — extend with:
- `list` returns empty array when reports dir is missing.
- `list` returns manifests sorted desc by `collectedAt`, skipping `latest.json` and malformed files.
- `load` round-trips a freshly-written report through `save` then `load`.
- `load` decodes a legacy payload containing `pullRequest: {"_id":"Option","_tag":"None"}` (hand-written fixture JSON).
- `load` propagates `ReportLoadError` for broken files (truncated JSON, schema mismatch).

### 3. CLI — atom

`apps/cli/src/data/recent-reports-atom.ts` (new file).

- `recentReportsAtom` — `Atom.Result` keyed to list the manifests. Uses `cliAtomRuntime` (see `apps/cli/src/data/runtime.ts`).
- `loadReportFn` — `cliAtomRuntime.fn` that takes `{ absolutePath }` and returns `PerfReport`.
- Follow the pattern in `apps/cli/src/data/ask-report-atom.ts` for atom composition (Effect.fn, structured logging).

### 4. CLI — navigation

`apps/cli/src/stores/use-navigation.ts`:
- Add a `RecentReportsPicker: {}` variant to `Screen`.

### 5. CLI — picker screen

`apps/cli/src/components/screens/recent-reports-picker-screen.tsx` (new file).

Mirror the shape of `apps/cli/src/components/screens/saved-flow-picker-screen.tsx`:
- `useAtomValue(recentReportsAtom)` for the list.
- Render `AsyncResult.builder(...).onWaiting(...).onSuccess(...).orNull()`.
- Scrollable list. `↑↓` / `j`/`k` navigate. `Enter` selects. `Esc` → `setScreen(Screen.Main())`.
- Row shape: `{url}   {branch}   {statusIcon}   {relativeTime}` — see resources notes below.
- On select: trigger `loadReportFn`, then `setScreen(Screen.Results({ report }))`. If load fails, surface the error inline and stay on the picker.

Row copy guidelines (no emojis — use `figures`):
- Status icon: `figures.tick` (green) for passed, `figures.cross` (red) for failed.
- Relative time: implement a small `formatRelativeTime(date: Date): string` in the screen file or in `apps/cli/src/utils/` — returns e.g. "just now", "5m ago", "2h ago", "3d ago", "Apr 10". Minutes under 1 → "just now"; under 60 → "Nm ago"; under 24h → "Nh ago"; under 7d → "Nd ago"; else locale short date.
- URL: if the URL parses, show `host + path` truncated to the available width; otherwise show the raw string.

### 6. CLI — main-menu banner

`apps/cli/src/components/screens/main-menu-screen.tsx`:
- When `recentReportsAtom` has at least one manifest, show a single line between the ASCII logo and the action list:
  - `Last run: {url-or-host}   {relativeTime}   {statusIcon}`
- When empty or the atom is not-yet-loaded, render nothing (no placeholder).

### 7. CLI — keyboard binding

`apps/cli/src/components/app.tsx`:
- Bind `ctrl+f` on Main only, guarded on non-empty `recentReportsAtom` success. Navigates to `Screen.RecentReportsPicker()`.
- Read the recent-reports atom inside `App` to source the guard — same pattern used for `ctrl+p` / `ctrl+w` guarded on `gitState.isGitRepo`.

### 8. CLI — modeline hint

`apps/cli/src/components/ui/modeline.tsx`:
- In the `Main` case, after `ctrl+r saved flows`, conditionally push `{ key: "ctrl+f", label: "past runs", cta: true }` when recent reports exist.
- In the `RecentReportsPicker` case, add its own hint set matching the saved-flow picker pattern: `↑↓ nav`, `esc back`, `enter select`.

## Acceptance criteria

All of the following MUST pass before reporting done:

1. `pnpm --filter @neuve/shared --filter @neuve/supervisor --filter @neuve/perf-agent-cli typecheck` — zero errors.
2. `pnpm --filter @neuve/supervisor test` — new tests green, existing tests green.
3. `pnpm build` — no warnings beyond the existing harmless `@neuve/devtools#build outputs` note.
4. Manual smoke test the changes cannot be skipped is OK (no TTY available to the engineer). Instead, verify by `pnpm --filter @neuve/perf-agent-cli build` that the Ink tree compiles.

## Rules

- `pnpm` only (never `bun`/`bunx`).
- Follow the project `CLAUDE.md` to the letter: `interface` over `type`, no JSX ternaries (use `&&`), no `as` casts, no null (use `Option` or `undefined`), no `useMemo`/`useCallback`/`React.memo`, kebab-case filenames, magic numbers in `constants.ts` with unit suffixes.
- No barrel files. Import directly from source files.
- Effect v4 idioms: `ServiceMap.Service`, `Effect.fn`, `Schema.ErrorClass`, `Effect.catchReason` for narrow recovery. Never `Effect.catchAll` / `orElseSucceed` / `option` / `ignore`.
- New domain errors: `{Entity}{Reason}Error`. Use `.asEffect()` for failures.
- Log mutations at `Effect.logInfo`, reads at `Effect.logDebug`. No `console.log`.
- React Compiler: plain functions, no manual memoization.
- If any design decision is ambiguous (binding choice, copy, grouping, etc.), STOP and ask the lead via your diary. Do not auto-resolve.

## Diary / handover

Write your implementation diary to `docs/handover/recent-reports/diary/task-62-engineer.md` as you go. Minimum sections:
- **Summary**: what you changed and why (link file paths).
- **Non-obvious decisions**: any pattern or design choice not in the spec.
- **Issues / unknowns**: things you flagged for the lead, test flakes, etc.
- **Verification**: exact commands you ran and their outcomes.

When the reviewer returns findings, append a **Patch round N** section to the same diary describing what you changed and why.

## What NOT to do

- Do not flatten old `.perf-agent/reports/` files in place. The normalizer runs on read only.
- Do not change the on-disk JSON format beyond what's already in `PerfReport`.
- Do not add a retention/cleanup policy in this task — separate concern.
- Do not attempt to compare two reports / show deltas — that's Phase 2 (#62 is Phase 1, list + reopen only).
- Do not touch `ask-report-atom.ts` or `results-screen.tsx` aside from what the spec requires. The Results screen receives a `PerfReport` — nothing about downstream consumers changes.
