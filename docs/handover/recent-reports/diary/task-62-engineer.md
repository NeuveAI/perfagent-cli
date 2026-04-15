# Task #62 — engineer diary

## Summary

Implemented the read side for persisted `PerfReport` JSON files plus the
supporting TUI surface.

- `packages/supervisor/src/report-storage.ts`
  - Added `ReportManifest` interface, `ReportLoadError` (`Schema.ErrorClass`),
    and a `normalizeLegacyReportJson` pure helper that rewrites the legacy
    `pullRequest: {"_id":"Option","_tag":"None"}` marker to `null` so the
    JSON codec accepts it.
  - Added `list` — reads `.perf-agent/reports/*.json`, skips `latest.json`,
    calls a per-file manifest reader that decodes each file via the
    `Schema.toCodecJson(PerfReport)` canonical JSON codec, files `mtime` as
    `collectedAt`. Bad files log a `Warning` and are skipped (tagged catches
    for `ReportLoadError`, `SchemaError`, and `PlatformError`). Sorted desc
    by `collectedAt` with `Order.flip` on `Order.Date`. Missing directory
    returns `[]` via `Effect.catchReason("PlatformError", "NotFound", …)`.
  - Added `load` — reads a specific file, applies the normalizer, decodes
    via the JSON codec, and wraps `PlatformError`/`SchemaError`/parse errors
    as `ReportLoadError` (preserving `filename`).
  - Switched `encodeReportJson` to use the same JSON codec
    (`Schema.toCodecJson(PerfReport)`) so dates and `Option` fields encode
    to JSON-safe values (ISO string / `null`). Existing save/encode tests
    still pass.
- `packages/supervisor/src/index.ts` — re-exports `ReportLoadError` and the
  `ReportManifest` type.
- `packages/supervisor/tests/report-storage.test.ts` — appended six new
  cases: empty-directory list, sort+skip malformed+skip `latest.json`,
  save→load round-trip, legacy-payload decode, truncated JSON → error,
  schema-mismatch → error.
- `apps/cli/src/data/recent-reports-atom.ts` *(new)* — `recentReportsAtom`
  (runtime atom returning the manifest array) and `loadReportFn` (runtime
  fn taking `{ absolutePath }` and returning `PerfReport`).
- `apps/cli/src/stores/use-navigation.ts` — new `RecentReportsPicker` screen
  variant.
- `apps/cli/src/components/screens/recent-reports-picker-screen.tsx` *(new)*
  — mirrors the saved-flow picker: scrollable list, `↑↓/jk/enter/esc`, row
  shape `url · branch · statusIcon · relativeTime`, URL formatted via host +
  path, status icon `figures.tick`/`figures.cross` in green/red. Loading
  overlay + inline error on failure.
- `apps/cli/src/utils/format-relative-time.ts` *(new)* — "just now" /
  "Nm ago" / "Nh ago" / "Nd ago" / short-locale-date, per spec thresholds.
- `apps/cli/src/components/screens/main-menu-screen.tsx` — shows a single
  `Last run: {host+path}   {relativeTime}   {statusIcon}` line between the
  ASCII logo and the action list only when the recent-reports atom resolves
  non-empty.
- `apps/cli/src/components/app.tsx` — registers the new screen, adds
  `ctrl+f` binding guarded on Main + non-empty recent reports.
- `apps/cli/src/components/ui/modeline.tsx` — adds the `ctrl+f past runs`
  CTA on Main (when recent reports exist) and a hint set for the new
  `RecentReportsPicker` screen.

## Non-obvious decisions

- **Used `Schema.toCodecJson(PerfReport)` for both encode and decode.** The
  spec says task-61 fixed the round-trip, but the hazard is JSON itself:
  `JSON.stringify` drops keys whose value is `undefined`, so encoding
  `PerfPlanDraft.baseUrl: None` (which `OptionFromUndefinedOr` encodes to
  `undefined`) would produce JSON without that key, and schema decode then
  rejected it with `Missing key at ["baseUrl"]`. Likewise for nested
  `OptionFromUndefinedOr` fields inside `NetworkRequest`, `InsightDetail`,
  `PerfMetricSnapshot`, `PerfBudget`. Switching both save and load to the
  canonical JSON codec emits `null` for `None` (JSON-safe) and parses
  `DateTime.Utc` values back from strings. Existing save test still
  passes (it asserts on field presence, not on the exact encoded shape of
  optional `None` values, and the top-level key count still includes the
  expected names).
- **Legacy normalizer writes `null` instead of deleting the key.** The JSON
  codec requires the key to be present; deleting it would trigger
  `Missing key`. Setting the value to `null` decodes cleanly to
  `Option.none()` via the codec's `Option`-from-null form.
- **Sort uses `Order.flip(Order.mapInput(Order.Date, ...))`** rather than
  a non-existent `Order.reverse`. `Order.Date` is the canonical date
  ordering in Effect v4.
- **List catches granular tags** (`ReportLoadError`, `SchemaError`,
  `PlatformError`) and logs + skips individual files. No `catchAll` or
  `orElseSucceed` — each failure mode is named and logged.
- **No getter on `PerfReport` for manifest fields.** The manifest is a
  list-time summary derived by decoding the whole report and reading its
  `.status` getter, not a new getter on the domain model.

## Issues / unknowns

- None open.

## Verification

Commands run:

- `pnpm --filter @neuve/supervisor typecheck` → clean.
- `pnpm --filter @neuve/perf-agent-cli typecheck` → clean.
- `pnpm --filter @neuve/shared --filter @neuve/supervisor --filter @neuve/perf-agent-cli typecheck` → clean.
- `pnpm --filter @neuve/supervisor test` → 9 files / 65 tests pass
  (previously 62; added 6 new tests, reused one existing fixture helper).
- `pnpm --filter @neuve/perf-agent-cli build` → clean.
- `pnpm build` (full Turbo) → clean; only the expected
  `@neuve/devtools#build outputs` note.
- `pnpm test` (full) surfaces one pre-existing failure in
  `packages/cookies` (real-Chrome integration test), unrelated to this
  task. Verified it also fails on a clean `git stash` of this task's
  changes, so it is a pre-existing environmental flake.

## Patch round 1

Applied the round-1 review feedback. Short version: the on-disk reports now
load (empirical verification: 7 real files list as 7 manifests), shallow
pluck replaces the full-schema decode in the list path, the atom refreshes
after a run, JSX ternaries/`as` casts/stale helpers are cleaned up, and a
real-legacy fixture is part of the test matrix.

### Changes

- **A. Recursive legacy normalizer** — `packages/supervisor/src/report-storage.ts:82-108`. Replaced the single-field `pullRequest` check with `unwrapTaggedOption` that walks the parsed JSON recursively, unwrapping every `{_id:"Option",_tag:"Some",value:...}` to its inner value and collapsing `{_id:"Option",_tag:"None"}` to `null`. This is applied across the whole tree so nested `events[].plan`, `metrics[].insightSetId`, etc. all normalize.
- **A (continued). Missing-key backfill** — `report-storage.ts:110-136`. Old reports pre-dating later schema additions don't contain `perfBudget` at all. The JSON codec (see F) rejects a missing `OptionFromUndefinedOr` key with `Missing key at ["perfBudget"]`. A second pass `fillMissingOptionKeys` inserts the canonical known Option keys with `null` when absent, so decode succeeds.
- **B. `list` warning-level logging** — `report-storage.ts:556-573`. Per-file decode failures now log via `Effect.logWarning` with `filename` and `cause` (not just `message`) and the entry is still skipped so one bad file doesn't kill the whole list. `SchemaError` branch removed since the shallow pluck cannot produce one.
- **C. `list` shallow pluck** — `report-storage.ts:445-501`. `readManifestFile` no longer decodes the full `PerfReport`. It `JSON.parse`s, narrows with `isRecord` (Predicate.isObject-backed local guard), and plucks `id`, `title`, `currentBranch`, `targetUrls[0]` with `typeof`/`Array.isArray` guards. Emits `ReportLoadError` when required fields are missing. Status is derived via a small `deriveStatusFromEvents` helper (`StepFailed` tag → "failed", else "passed") — sufficient for the listing; the detailed metrics-driven status is only needed post-`load`.
- **D. `as` cast removed** — `report-storage.ts:63-64`. Replaced `return value as Record<string, unknown>;` with a local type guard `isRecord = (v: unknown): v is Record<string, unknown> => Predicate.isObject(v)`. `Predicate.isObject` narrows to `{[x: PropertyKey]: unknown}` which is assignable to `Record<string, unknown>` without a cast. Removed the sister `as string[]` on the catchReason fallback by declaring a top-level `EMPTY_DIR_ENTRIES: readonly string[] = []` (no cast, no mutable empty array flying around).
- **E. `null` usage (normalizer)** — the normalizer still writes `null` for decoder-protocol reasons, documented in a `// HACK:` comment (`report-storage.ts:70-80`). See "Open questions" below.
- **F. Encoder / decoder round-trip** — `report-storage.ts:378-386, 588-592`. Attempted the spec-suggested revert to `Schema.encodeSync(PerfReport)` / `Schema.decodeUnknownEffect(PerfReport)`. **That revert fails round-trip** — `JSON.stringify` drops `OptionFromUndefinedOr`-emitted `undefined` keys, and the schema decoder rejects missing required keys with `Missing key at ["baseUrl"]` (and `perfBudget`, `pullRequest`). Since the patch instructions explicitly say "if this produces a `Missing key` error... flag it in the diary and escalate to the lead", I kept the JSON-codec form, now with an explicit `// HACK:` comment documenting the trade-off, and added a new round-trip test (`packages/supervisor/tests/report-storage.test.ts:333-345`) that saves a report with `baseUrl: Some` / `pullRequest: None` and asserts `load` recovers both. Flagged as an open question below.
- **G. Atom refresh after run** — `apps/cli/src/data/execution-atom.ts:16, 103`; `apps/cli/src/data/recent-reports-atom.ts:8-17`. Added `yield* Atom.refresh(recentReportsAtom)` after `reportStorage.saveSafe(report)` in `executeCore`. The atom re-executes its listing effect and the Main-menu banner + ctrl+f picker + modeline hint all pick up the new manifest without a CLI restart.
- **H. JSX ternaries** — `apps/cli/src/components/screens/recent-reports-picker-screen.tsx` (full rewrite) and `apps/cli/src/components/screens/main-menu-screen.tsx:262, 364-391`. All status-icon/status-color/pointer ternaries were lifted out of JSX into plain-JS constants above the returned JSX. The `Last run` banner block is now its own `LastRunBanner` sub-component. `plural` is pre-computed. Inline `&&` conditionals replace the empty-state vs list ternary.
- **I. `AsyncResult.builder`** — `recent-reports-picker-screen.tsx:60-81`. Primary list render uses `AsyncResult.builder(reportsResult).onWaiting(...).onSuccess(...).orNull()`. The mutation branch (`loadResult` from `loadReportFn`) still uses `.waiting` + `AsyncResult.isFailure` per CLAUDE.md's mutation-pattern section. Error surface now renders `loadFailure.toString()` inline instead of the generic sentence.
- **J. Relative-time future guard** — `apps/cli/src/utils/format-relative-time.ts:10`. Wrapped `elapsedMs` with `Math.max(0, ...)`.
- **K. Magic numbers moved to `constants.ts`** — `apps/cli/src/constants.ts:22-31`. Added `RECENT_REPORTS_VISIBLE_ROWS`, `RECENT_REPORTS_BRANCH_COLUMN_WIDTH`, `RECENT_REPORTS_STATUS_COLUMN_WIDTH`, `RECENT_REPORTS_TIME_COLUMN_WIDTH`, `RECENT_REPORTS_URL_MIN_WIDTH`, `RECENT_REPORTS_GUTTER_WIDTH` (`_ROWS` / `_WIDTH` unit suffixes), plus `RELATIVE_TIME_MS_PER_MINUTE/HOUR/DAY/WEEK`. The screen file and relative-time util import from there.
- **L. Shared host-path helper** — `apps/cli/src/utils/format-host-path.ts` (new). Used by both `main-menu-screen.tsx` and `recent-reports-picker-screen.tsx`. `report-storage.ts` keeps its own `safeHostPath` because it's in a separate package and the helper lives in `apps/cli/` — cross-package extraction is out of round-1 scope and the duplication is two files of ~6 lines each.
- **M. Real legacy fixture** — `packages/supervisor/tests/fixtures/legacy-report-task61.json` (new, captured verbatim from `.perf-agent/reports/2026-04-15T09-16-08Z-agent-perflab-io.json`). Two new tests in `report-storage.test.ts:315-346`: `load decodes a real legacy fixture` (end-to-end load against the real file) and `list returns manifests for a real legacy fixture` (list surface works against the fixture). Both pass.

### Non-obvious decisions

- **`null` in `report-storage.ts` is retained.** The reviewer flagged `null` as a CLAUDE.md violation. The original engineer's diary explained the JSON codec required `null` for `None`; the round-1 patch instructions hypothesised that switching to `Schema.encodeSync(PerfReport)` + `JSON.stringify` would sidestep the issue. It does not — `OptionFromUndefinedOr` decode requires the key present (value can be `undefined`), but `JSON.stringify` drops undefined-valued keys, so a round-trip via the plain schema encoder fails with `Missing key at ["baseUrl"]`. The JSON codec handles this correctly (emits `null`, decodes `null` as `None`). Flagged to the lead as open question below.
- **Status derivation for the listing is shallow.** The real `PerfReport.status` getter considers CWV thresholds, regressions, and step statuses. A true shallow pluck can't reproduce that without the full schema. I derive `passed` vs `failed` from the presence of `StepFailed` events only. This is documented as a trade-off and covered by the existing test that saves a "passed" report and verifies `status === "passed"` on the manifest. If we want the full semantics, we'd need to decode the whole thing — which is exactly what the review warned against.
- **Normalizer + backfill pass.** I considered combining the unwrap and fill into a single walker but kept them separate for clarity. Each pass is pure, small, and easy to test independently. The backfill list of option keys is intentionally hand-curated — unknown optional fields in old files would still decode as long as the JSON codec accepts their absence (it does when they're not present in the schema at all, and fails with `Missing key` when the schema requires them). The 22-key list covers every `OptionFromUndefinedOr` field I could find via grep.
- **Atom refresh vs tick-atom.** Initially wired a `recentReportsTickAtom` + `get(tick)` dependency, but `Atom.refresh(recentReportsAtom)` achieves the same thing with less moving parts. The registry-scoped refresh is already provided by the runtime.

### Verification

- `pnpm --filter @neuve/shared --filter @neuve/supervisor --filter @neuve/perf-agent-cli typecheck` → clean.

  ```
  packages/shared typecheck: Done
  packages/supervisor typecheck: Done
  apps/cli typecheck: Done
  ```

- `pnpm --filter @neuve/supervisor test` → 9 files / 68 tests pass (3 new cases over round 0: legacy-fixture load, legacy-fixture list, Some/None round-trip).

  ```
  Test Files  9 passed (9)
       Tests  68 passed (68)
  ```

- `pnpm --filter @neuve/perf-agent-cli build` → clean, 3.68 MB total. Only the expected rolldown PLUGIN_TIMINGS warning (pre-existing).

- **Empirical list-count** (one-shot Effect program against `.perf-agent/reports/`):

  ```
  LIST COUNT: 7
  - 2026-04-15T15-53-55Z-agent-perflab-io.json / branch=main / status=passed / url=(none)
  - 2026-04-15T15-27-00Z-agent-perflab-io.json / branch=main / status=passed / url=(none)
  - 2026-04-15T14-39-36Z-agent-perflab-io.json / branch=main / status=passed / url=(none)
  - 2026-04-15T12-19-57Z-agent-perflab-io.json / branch=main / status=passed / url=(none)
  - 2026-04-15T11-11-00Z-agent-perflab-io.json / branch=main / status=passed / url=(none)
  - 2026-04-15T10-29-12Z-agent-perflab-io.json / branch=main / status=passed / url=(none)
  - 2026-04-15T09-16-08Z-agent-perflab-io.json / branch=main / status=passed / url=(none)
  ```

  On-disk count (`ls -1 .perf-agent/reports/*.json | grep -v latest | wc -l`) = 7. Match. (`url=(none)` is correct — the legacy files have an empty `targetUrls: []`; the `baseUrl` is stored at root but is not shown in the manifest's `url` field, which by spec derives only from `targetUrls[0]`.)

- **Forbidden-pattern greps**:
  - `rg "\bas (string|number|Record|Array|unknown|object|Readonly)" packages/supervisor/src/report-storage.ts apps/cli/src/components/screens/recent-reports-picker-screen.tsx apps/cli/src/data/recent-reports-atom.ts` → **0 hits**.
  - `rg "\bnull\b" packages/supervisor/src/report-storage.ts` → 1 hit on `const NONE_SENTINEL: unknown = null;` (decoder-protocol sentinel; documented in `HACK:` comment; open question below) + 6 hits inside documentation comments.
  - `rg "Effect\.(catchAll|option|ignore)|orElseSucceed" packages/supervisor/src/report-storage.ts apps/cli/src` → **0 hits**.
  - JSX ternaries in the listed files: all round-1 sites (picker lines 89, 119-120, 130-131, 133; main-menu 269-270) are resolved. Any remaining `?:` hits are in plain JS statements above the JSX (allowed) or in pre-existing code outside the round-1 patch scope.

### Open questions

1. **Encoder/decoder: keep `Schema.toCodecJson(PerfReport)` or switch to raw schema?** The patch instructions asked me to revert to `Schema.encodeSync(PerfReport)`. That revert breaks round-trip because `OptionFromUndefinedOr` keys are required at decode time and `JSON.stringify` drops undefined-valued keys. Three ways to resolve:
   - (a) Keep the JSON codec (current state). Safe, works, emits `null` for None on disk.
   - (b) Flip `OptionFromUndefinedOr(...)` → `OptionFromNullOr(...)` in `models.ts` — but that's a task-#61 schema re-revision that changes on-disk semantics again.
   - (c) Mark the `OptionFromUndefinedOr` fields as `Schema.optional(OptionFromUndefinedOr(...))` so a missing key decodes as `None`. Arguably the cleanest fix but requires schema audit and is still schema-scope. Flagging to decide.
2. **`null` in the normalizer.** Tied to (1). If we go with (c), I can drop `null` entirely — the walker returns `undefined` for None and the decode accepts either undefined-valued or missing keys. Today the `null` is unavoidable because the JSON codec form is the one we can make work without touching the schema.
3. **Should the `latest.json` symlink be resolved + deduped in `list`?** Currently we skip the file literally named `latest.json`. If `latest.json` is a symlink (which `save` writes), its target is still a separate `.json` file we list anyway. No dedup issue. Double-checked: the 7 manifests do not include `latest.json` despite it being symlinked to `2026-04-15T15-53-55Z-agent-perflab-io.json`.

The task remains `in_progress` in the task system; the lead should close after reviewer approval.
