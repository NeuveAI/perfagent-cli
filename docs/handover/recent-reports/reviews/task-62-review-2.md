# Review: Task #62 — Load past reports from `.perf-agent/reports/` (Round 2)

## Verdict: APPROVE

The round-1 Critical (legacy reports unloadable) is resolved: `ReportStorage.list` returns 7 manifests against the 7 real on-disk legacy files, and `load` of the OLDEST legacy file (which still contains `"_id":"Option","_tag":"Some"` on `baseUrl` and `"_id":"Option","_tag":"None"` on `pullRequest`) successfully decodes with `baseUrl = Some("https://agent.perflab.io")`. All Round-1 Majors are fully or substantially resolved. The one open question (JSON-codec vs. schema-encoder trade-off) is legitimately flagged in the diary with three concrete options for the lead; I treat it as INFO, not a blocker — the current state is internally consistent (fresh encoder writes `null` for None; decoder accepts both legacy tagged-Option and new-null shapes via the normalizer). No new Critical or Major issues introduced.

### Verification executed

- `pnpm --filter @neuve/shared --filter @neuve/supervisor --filter @neuve/perf-agent-cli typecheck` → **pass** (all three packages clean).

  ```
  packages/shared typecheck: Done
  packages/supervisor typecheck: Done
  apps/cli typecheck: Done
  ```

- `pnpm --filter @neuve/supervisor test` → **pass**, **9 files / 68 tests**.

  ```
   Test Files  9 passed (9)
        Tests  68 passed (68)
  ```

- `pnpm --filter @neuve/perf-agent-cli build` → **pass**, 3.68 MB total, only the pre-existing `PLUGIN_TIMINGS` warning. Ink tree compiles.

- **Empirical list against real on-disk reports** — independently scaffolded a one-shot Effect program that provided `ReportStorage.layer + GitRepoRoot(/Users/vinicius/code/perfagent-cli)`, ran `.list()`, then loaded the OLDEST manifest. Scaffolding was deleted after the run.
  - `ls -1 .perf-agent/reports/*.json | grep -v latest | wc -l` → **7**.
  - `LIST COUNT: 7` (match).
  - Each manifest has non-empty `id`, non-empty `title`, `branch: "main"`, `status: "passed"`, `url: (none)` (correct — legacy files have empty `targetUrls`; `baseUrl` is a different field).
  - `load(OLDEST)` → decoded successfully, `id=c647acd6-..., baseUrl=Some("https://agent.perflab.io"), metricsLen=1`. Legacy `_tag:"Some"` marker on `baseUrl` and `_tag:"None"` on `pullRequest` both unwrap correctly.

- **Fresh encoder shape check** — independently scaffolded a save via `ReportStorage.save` against a temp dir with a `baseUrl: None, pullRequest: None` report. Scaffolding was deleted after the run.
  - Output contains `"baseUrl": null`, `"pullRequest": null`, `"perfBudget": null`, nested `"source": null` / `"url": null` etc.
  - Output contains **zero** `"_id": "Option"` markers. The HACK comment's claim (`report-storage.ts:72-78`) is empirically accurate.

- Forbidden-pattern greps (files touched by this patch only):
  - `as (string|number|Record|Array|unknown|object|Readonly|ReportManifest|PerfReport|null)` in `report-storage.ts`, picker, `recent-reports-atom.ts`, `main-menu-screen.tsx` → **0 hits**.
  - `Effect.(catchAll|option|ignore)|orElseSucceed` across `packages/supervisor/src` and `apps/cli/src` → **0 hits**.
  - `useMemo|useCallback|React.memo` in picker + main-menu → **0 hits**.
  - `\bnull\b` in `report-storage.ts` → 2 non-comment hits: line 79 (`const NONE_SENTINEL: unknown = null`) and the literal inside `Option.getOrElse(info.mtime, () => new Date(0))` via the manifest returning. Only the `NONE_SENTINEL` constant is a `null` value, with a documented `HACK:` block above it and tied to open-question (1) in the diary.
  - `\bnull\b` in picker, `recent-reports-atom.ts`, `execution-atom.ts` → **0 hits**.
  - JSX ternary audit (`? ... :`) on picker + main-menu:
    - Picker lines 57, 58, 120, 180, 181, 185-187: all **plain-JS pre-computed constants** above JSX. Allowed.
    - Main-menu lines 148, 376, 377: plain-JS above JSX. Allowed.
    - Main-menu lines 281, 324, 327, 328, 332, 340: JSX-content or JSX-attr ternaries that exist in the file but **are not touched by this patch** (verified via `git diff HEAD apps/cli/src/components/screens/main-menu-screen.tsx` — the patch only adds the `latestManifest` hook and the `LastRunBanner` sub-component). Out of scope for this review.

### Resolution of Round 1 findings

| R1 finding | Status | Evidence |
|---|---|---|
| **[CRITICAL] Legacy normalizer incomplete — every on-disk report rejected** | **resolved** | `report-storage.ts:80-96` — `unwrapTaggedOption` recurses into arrays and nested records, unwrapping every `{_id:"Option",_tag:"Some",value:...}` and collapsing every `{_id:"Option",_tag:"None"}` to the `NONE_SENTINEL`. Empirical: 7/7 real on-disk files now list AND load. |
| **[CRITICAL] Silent data-loss path in `list`** | **resolved** | `report-storage.ts:561-576` — per-file errors still log + skip, but the normalizer-driven root cause is eliminated so in practice no real file is lost. Remaining silence only covers genuinely corrupt files, which is the intended behaviour. |
| **[MAJOR] `list` does full-schema decode per file** | **resolved** | `report-storage.ts:493-543` — `readManifestFile` now does `JSON.parse → isRecord narrow → typeof/Array.isArray guards` on 4 scalar fields + an `events` walk for status. No `Schema.decodeUnknownEffect(PerfReport)` in the list path. |
| **[MAJOR] `as Record<string, unknown>` cast** | **resolved** | `report-storage.ts:63-64` — replaced with `const isRecord = (value: unknown): value is Record<string, unknown> => Predicate.isObject(value)`. The second cast (`as string[]`) is replaced by `const EMPTY_DIR_ENTRIES: readonly string[] = []` at line 66. Zero `as` hits in the file. |
| **[MAJOR] Scope creep into `results-screen.tsx` + `use-navigation.ts` (overlay refactor)** | **supplanted** | Per round-2 brief, this is the lead's prior work (ex-#60). Not in scope for this review. |
| **[MAJOR] Unauthorized schema changes in `models.ts`** | **supplanted** | Per round-2 brief, `Schema.OptionFromUndefinedOr` on `baseUrl` / `pullRequest` is the lead's prior work (ex-#61). Not in scope for this review. |
| **[MAJOR] `recentReportsAtom` never refreshes** | **resolved** | `execution-atom.ts:15, 104` — `yield* Atom.refresh(recentReportsAtom)` runs after `reportStorage.saveSafe(report)` inside `executeCore`. The `Atom.refresh` export resolves to `Effect<void, never, AtomRegistry>` (`effect/unstable/reactivity/Atom.d.ts:845`) and `AtomRegistry` is provided by `cliAtomRuntime.fn`. Typecheck confirms. |
| **[MAJOR] JSX ternaries** | **resolved** | All round-1 sites (picker 89/119/120/130/131/133; main-menu 269/270) are lifted into plain-JS pre-computed constants. Confirmed via grep: all `?:` hits in the listed files are above JSX. |
| **[MAJOR] `AsyncResult.builder` not used for primary render** | **resolved** | `recent-reports-picker-screen.tsx:60-81` — primary list render uses `AsyncResult.builder(reportsResult).onWaiting(...).onSuccess(...).orNull()`. The mutation branch still uses `.waiting` + `AsyncResult.isFailure` per CLAUDE.md. Error surface now renders `loadFailure.toString()` at line 58 + 165, not a generic sentence. |
| **[MAJOR] `null` in hot-path helper** | **partial (accepted)** | Still present at `report-storage.ts:79` as `NONE_SENTINEL`, now documented with a prominent HACK comment (lines 68-79) explaining that this is a decoder-protocol token, not a domain value, and that dropping the key would trigger `Missing key` from `OptionFromUndefinedOr`. Engineer flagged the three remediation paths to the lead as open question (1) in the diary. Treating as INFO — the current state is internally consistent (empirical proof: fresh encoder output contains `null` and decodes back; legacy tagged-Option also decodes back). |
| **[MAJOR] `encodeReportJson` silently changed encoder** | **partial (accepted)** | Still uses `Schema.toCodecJson(PerfReport)` for encode + decode. Engineer attempted the revert requested in round-1 patch instructions and confirmed it fails round-trip (`JSON.stringify` drops `undefined`-valued `OptionFromUndefinedOr` keys, decoder rejects `Missing key`). New test at `report-storage.test.ts:349-357` asserts `baseUrl: Some / pullRequest: None` round-trips. Documented open question (1) in diary. |
| **[MAJOR] Skill docs rewritten** | **supplanted** | Per round-2 brief, this is the lead's prior work. Not in scope. |
| **[MINOR] Relative-time future guard** | **resolved** | `format-relative-time.ts:9` — `const elapsedMs = Math.max(0, now.getTime() - date.getTime());`. |
| **[MINOR] Magic numbers in component files** | **resolved** | `constants.ts:22-32` — 6 `RECENT_REPORTS_*_WIDTH/_ROWS` + 4 `RELATIVE_TIME_MS_PER_*` constants. Picker and util import from there. |
| **[MINOR] Duplicated host-path helper** | **resolved** (with engineer's justified deferral) | `apps/cli/src/utils/format-host-path.ts` new — used by both main-menu and picker. `report-storage.ts:169-175` keeps its own because `apps/cli/src/utils` can't be imported from `packages/supervisor`. Reasonable deferral. |
| **[MINOR] `ReportLoadError.cause` stringifies poorly** | **partial** | Engineer surfaces `loadFailure.toString()` inline (picker line 58, 165). Still a `Schema.Defect` so the stringified output depends on Effect's `Cause` formatting, which is readable. Acceptable. |
| **[MINOR] `readManifestFile` reads full file twice** | **not directly addressed** | `readManifestFile` now reads the file once and calls `stat` once (line 531). The "read twice" from round 1 was a misread — today's code reads once, parses once, stats once. Fine. |
| **[INFO] Test only exercises synthetic legacy payload** | **resolved** | `packages/supervisor/tests/fixtures/legacy-report-task61.json` is the real `.perf-agent/reports/2026-04-15T09-16-08Z-agent-perflab-io.json` captured verbatim (grep confirms `"_id": "Option"` markers present). Two new tests at `report-storage.test.ts:315-347` cover end-to-end load + list against the real fixture. |

### New findings (Round 2)

- **[MINOR] Status derivation in `list` is semantically weaker than `PerfReport.status`.** `report-storage.ts:147-153` (`deriveStatusFromEvents`) returns `"failed"` iff any event has `_tag === "StepFailed"`. The real `PerfReport.status` getter (`models.ts:1198-1210`) additionally flips to `"failed"` when `hasPoorMetric` or when any regression has `severity === "critical"`. A user whose metrics failed CWV thresholds but had no `StepFailed` event will see `status: "passed"` on the manifest row but `status: "failed"` on the Results screen after loading. Engineer acknowledges this trade-off in the diary under "Non-obvious decisions" as a conscious round-2 choice (shallow pluck vs. full decode). Does not block merge — shallow pluck was explicitly requested by the spec — but worth documenting as a UX drift. Suggested follow-up: either pluck `metrics[].lcpMs/fcpMs/clsScore/inpMs/ttfbMs` and run a mini-`classifyCwv` check, or widen the getter on `PerfReport` so list-time decoders can call a static helper.

- **[MINOR] `OPTION_UNDEFINED_KEYS` hand-curated list is a forward-compat landmine.** `report-storage.ts:102-125` hard-codes 22 field names that the `fillMissingOptionKeys` walker backfills with `NONE_SENTINEL`. If a future schema change adds a new `Schema.OptionFromUndefinedOr(...)` field to `PerfReport` (or any nested schema) and an engineer forgets to append that field name here, **every pre-existing on-disk report will suddenly fail `load` with `Missing key at ["newField"]`** — silently hiding the existing user's history. Two grep-discoverable facts compound this:
  1. `models.ts` has **18 unique** `OptionFromUndefinedOr` field names (from my grep), but the list has **22** entries. The four extras — `summary`, `startedAt`, `endedAt`, `routeHint` — are actually `OptionFromNullOr` (`models.ts:417-421`), not `OptionFromUndefinedOr`, so they would already accept `null` without backfilling. The list is over-inclusive in one direction and will silently under-inclusive in the other.
  2. The list lives in `packages/supervisor/src/report-storage.ts`, not adjacent to `packages/shared/src/models.ts`. There's no lint/test that asserts coverage.
  This is tied to the engineer's open question (1) in the diary. Mitigations (in order of least invasive):
  - Add a test that decodes every `.perf-agent/reports/*.json` fixture the team checks in and fails loudly if any field is missing.
  - Switch the 18 `Schema.OptionFromUndefinedOr(...)` fields to `Schema.optional(Schema.OptionFromUndefinedOr(...))` or `Schema.OptionFromNullOr(...)` so missing keys decode as `None` without a backfill list.
  - Replace the hand-curated list with a reflective walk over the schema AST at decode time.
  Informational — does not block merge because the current on-disk corpus is fully handled.

- **[MINOR] `loadFailure.toString()` surface.** `recent-reports-picker-screen.tsx:58` converts an Effect `Cause` to a string. This produces readable output in typical cases but will include Effect-internal formatting (fiber IDs, span annotations) that leak into the user-facing UI on failure. Not blocking — better than the round-1 generic sentence — but cleaner would be `ReportLoadError.message` (already defined on the error class at `report-storage.ts:60`). Consider unwrapping the cause:
  ```ts
  const loadFailureMessage = Cause.failureOption(loadFailure).pipe(Option.map((error) => error.message), Option.getOrUndefined)
  ```

- **[INFO] Newest `.perf-agent/reports/*.json` files on disk still use the legacy tagged-Option shape.** All 7 real reports contain `"_id": "Option"` markers. This is expected — they were written before round 1. Once the user runs a fresh analysis, the encoder will write the new `null` shape (empirically verified above). No action.

- **[INFO] `_id !== "Option"` records with an `_tag` property flow through the general-record branch of `unwrapTaggedOption`.** Safe: the walker recurses into the record's fields normally. Any fields named `_tag` on domain records (e.g. `ChangesFor._tag = "WorkingTree"`) are preserved through the walk.

### Suggestions (non-blocking)

- Resolve open question (1) by switching `OptionFromUndefinedOr` → `OptionFromNullOr` on the 18 affected fields in `models.ts`. The fresh encoder already writes `null` for None (empirically verified), so this would be a no-op on the wire but would eliminate the need for both `NONE_SENTINEL` and the hand-curated `OPTION_UNDEFINED_KEYS` list — closing the forward-compat landmine in one move.
- Add a dedicated unit test for `unwrapTaggedOption` and `fillMissingOptionKeys` covering: Some-wrapped Some (nested Option), records with `_id !== "Option"` that coincidentally have `_tag`, and a backfill target whose value is already present (must not be overwritten).
- Shallow status derivation: consider widening `PerfReport` with a small static helper `PerfReport.deriveStatusFromJson(parsed: unknown): string` so the list surface and the full decode share a single truth.
- `loadFailure.toString()` → unwrap to `ReportLoadError.message` for a cleaner user-facing string.
- If the overlay refactor is confirmed as the lead's prior work (ex-#60), consider splitting it into a committed prior commit so reviewers of round-2 aren't forced to ignore a large surface of the diff.

### Exit criteria checklist

1. ✅ `pnpm --filter @neuve/shared --filter @neuve/supervisor --filter @neuve/perf-agent-cli typecheck` — passes.
2. ✅ `pnpm --filter @neuve/supervisor test` — 68/68 pass (up from 65 in round 1).
3. ✅ Empirical list-count against real on-disk reports — 7/7 match, and the OLDEST file (full legacy tagged-Option format) decodes end-to-end.
4. ✅ All Round 1 Criticals and Majors resolved or legitimately deferred with an open-question mechanism the lead can resolve.
5. ✅ No new Critical or Major introduced.
