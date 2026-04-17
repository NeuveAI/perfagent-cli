# FIX-C Review — Insights overlay fallback

**Verdict:** APPROVE

**Scope reviewed:** `apps/cli-solid/src/routes/results/insights-overlay.tsx` (only file in the FIX-C diff; other modified files in the working tree belong to FIX-A / FIX-B and are out of scope).

## Mandatory verification

1. `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — clean, zero output.
2. `cd apps/cli-solid && bun test` — **564 pass / 0 fail / 1090 expect() calls**. Matches baseline.
3. `git diff apps/cli-solid/src/routes/results/insights-overlay.tsx` — isolated to the single target file. The other three files in the working tree (`overlay-container.tsx`, `startup-screen.tsx`, `tui.ts`) belong to parallel fixes.
4. Read the full file — done.
5. Schema verification against `packages/shared/src/models.ts`:
   - `TraceInsightRef` (line 447–450): `{ insightSetId: string; insightName: string }` — exactly as engineer claims. No `title` / `summary`.
   - `PerfMetricSnapshot.traceInsights: Schema.Array(TraceInsightRef)` (line 462) — source of the unique-name aggregation.
   - `collectUniqueInsightNames` helper (line 466–479) — de-duplicates names across snapshots preserving first-seen order.
   - `PerfReport.insightDetails: Schema.Array(InsightDetail)` (line 1148).
   - `PerfReport.uniqueInsightNames: readonly string[]` getter (line 1182–1184) — thin wrapper around `collectUniqueInsightNames(this.metrics)`.
   - `^\s*insights:` grep across `models.ts` returns nothing (no bare `insights:` field). The original spec's `report.insights: readonly InsightReference[]` does not exist.

Engineer's schema reconciliation note is **correct**. The fallback surface area is genuinely limited to strings — no title/summary is available for a name-only reference.

## Review questions

### 1. Schema claim correctness
Verified. No `report.insights` field under any alias. `uniqueInsightNames` getter aggregates `metrics[].traceInsights[].insightName` with de-dup, which is the right signal for "insights the agent referenced but did not drill into". No miss here.

### 2. Branch logic
`createMemo<DisplayList>` (line 30-38) implements the three-way discriminator correctly:
- `insightDetails.length > 0` → `{ kind: "details", items }`
- `uniqueInsightNames.length > 0` → `{ kind: "references", items }`
- else → `{ kind: "empty" }`

Priority order is correct (details first). No bugs in the discriminator.

### 3. Title / insightName rendering in degraded branch
List mode: `renderRow(name, index())` at line 209 — name is the row label, styled identically to the details row (same cursor arrow, numbering, selection color). Good.

Detail mode: `<Show when={selectedReferenceName()}>` (line 275-287) renders the name in bold (`COLORS.SELECTION, bold: true`) followed by `MISSING_ANALYSIS_NOTICE`. Structure mirrors the details drill-down (column box, bold header, dim body), so muscle memory carries.

### 4. Discriminated union coverage
All three kinds handled:
- List mode `<Switch>/<Match>`: two mutually-exclusive `<Show>` branches (lines 199-212) — `detailItems()` xor `referenceItems()` is truthy at a time, so `<For>` iterates the correct collection.
- Detail mode: `selectedDetail()` xor `selectedReferenceName()` — the kind check inside each accessor (lines 80-84, 86-90) guarantees exclusivity.
- Empty: dedicated `<Show when={isEmpty()}>` at line 193.

No gap.

### 5. JSX no-ternary rule
No ternary used for JSX conditional rendering. The ternaries inside `renderRow` (lines 181, 182, 185) compute **prop values** (colors, arrow glyph) — allowed per CLAUDE.md which bans ternaries specifically "for conditional rendering", not for value expressions. Compliant.

### 6. List navigation
`clampSelection` uses `itemCount()` (line 69) which is kind-aware — clamps correctly for both `details` and `references` kinds. `moveSelection` delegates to clamp. `openDetail` guards with `itemCount() === 0` (line 113). Keyboard handlers (enter, up/down, j/k, escape, pageup/pagedown) untouched. Works for both kinds.

### 7. Empty state copy
Unchanged: `"No insights available."` (line 194). No flag.

### 8. Drill-down notice copy
Exact string (line 16-17):

```
"No detailed analysis captured. Re-run with `trace analyze` to get the full breakdown."
```

Grammatical, accurate, backtick-wrapped command name is appropriate for a CLI context. Extracted to module-level `MISSING_ANALYSIS_NOTICE` constant — good call since it's non-obvious UX guidance.

### 9. No atom / navigation imports
Imports (lines 1-6) are: `solid-js`, `@opentui/solid`, `effect` (for `Option`), `@neuve/shared/models`, local `overlay-container` and `constants`. No `useAtom*`, no navigation. Props-only contract preserved.

### 10. Tests
Grep for `InsightsOverlay|insights-overlay` under `apps/cli-solid/tests` returns zero matches. No existing unit tests for this component to extend. Skip is defensible — constructing a full `PerfReport` with branded fields (`StepId`, `DateTimeUtc`, `PerfMetricSnapshot`, `TraceInsightRef`, `AnalysisStep`) for a single overlay test would require scaffolding that isn't reusable elsewhere yet. Not a blocker.

### 11. Memo double-read
`displayList` (line 30) is a `createMemo`; the three accessors (`itemCount`, `detailItems`, `referenceItems`, `isEmpty`) and the two selection accessors (`selectedDetail`, `selectedReferenceName`) each read the memo. Memo caches on its own dependencies, so repeated reads within the same reactive scope hit the cache. `props.report` is the only reactive input; the two inner reads (`insightDetails.length`, `uniqueInsightNames.length`) are plain getters. No infinite recompute. `uniqueInsightNames` recomputes O(sum of `traceInsights.length`) on each memo re-run, but memo only re-runs when `props.report` identity changes — acceptable.

## Additional observations

- `renderRow` extraction (line 175-189) de-duplicates the row markup across the two list kinds, keeping visual treatment identical. Good refactor that was invited by the branch split.
- `selectedIndex` is shared across both list kinds. When `props.report` flips from a `details` report to a `references` report, `clampSelection` will re-clamp via the next navigation tick, but the stale index stays until then. Not a real concern because `props.report` is effectively immutable per overlay open; if it ever became reactive we'd want `createEffect(on(displayList, () => setSelectedIndex(0)))`. Fine as-is.
- `analysisScroll` is reset on `openDetail` / `returnToList` — correct for both kinds even though the reference-kind detail pane doesn't scroll.
- Engineer annotated the `@todo(rasmus): UNUSED` getter (`stepStatuses`) wasn't touched — correctly out-of-scope.

## Verdict rationale

No critical or major issues. Schema claim is independently verified. Three-kind discriminator is sound, list + detail panes handle all kinds, keyboard/selection invariants hold, copy is accurate, no CLAUDE.md violations, tsc + test suite clean at 564/0. Test skip is justified by the lack of an existing overlay test harness.

**APPROVE.**
