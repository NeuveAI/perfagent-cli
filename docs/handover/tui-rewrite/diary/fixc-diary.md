# FIX-C Diary — Insights overlay falls back to insights[] when insightDetails[] empty

## Scope

Rewrote `apps/cli-solid/src/routes/results/insights-overlay.tsx` so it renders a non-empty list when the agent references insights in the narrative but never drills into them with `trace analyze` (i.e. `report.insightDetails[]` is empty while the metrics carry `traceInsights[]`).

## Schema reconciliation note (important)

The task description and `docs/handover/tui-rewrite/overlays-plan.md` both refer to `PerfReport.insights: readonly InsightReference[]` with `{ insightName, title, summary }` fields. **That type does not exist in the current codebase.** The actual shape is:

- `PerfReport.insightDetails: readonly InsightDetail[]` — full analysis (title, summary, analysis, estimatedSavings, externalResources, …). Populated only when the agent runs `trace analyze`.
- `PerfReport.uniqueInsightNames: readonly string[]` — a getter that collects `insightName` values from `metrics[].traceInsights[]` via `collectUniqueInsightNames` (models.ts:466). This is what feeds the `Insights available: LCPBreakdown, CLSCulprits, …` line in the reporter (`packages/supervisor/src/reporter.ts:305`).
- `TraceInsightRef` (models.ts:447) only carries `{ insightSetId, insightName }` — no title or summary.

So the fallback can only surface the **name** of each referenced insight; there is no title/summary to show. The detail-mode fallback pane therefore renders the name and the notice explaining that no detailed analysis was captured.

## Union shape

```ts
type DisplayList =
  | { readonly kind: "details"; readonly items: readonly InsightDetail[] }
  | { readonly kind: "references"; readonly items: readonly string[] }
  | { readonly kind: "empty" };

const displayList = createMemo<DisplayList>(() => {
  if (props.report.insightDetails.length > 0) {
    return { kind: "details", items: props.report.insightDetails };
  }
  if (props.report.uniqueInsightNames.length > 0) {
    return { kind: "references", items: props.report.uniqueInsightNames };
  }
  return { kind: "empty" };
});
```

Helpers `detailItems()` / `referenceItems()` / `isEmpty()` narrow without type casts so the rest of the component can keep using `<Show>` branches per `CLAUDE.md` (no ternaries in JSX, no `as` casts).

## Behavior

### List mode

- `details` kind: renders each detail via `renderRow(getInsightLabel(detail), index)` — unchanged look (title, falling back to insightName).
- `references` kind: renders each name via `renderRow(name, index)` — same row shape, so selection highlighting and keyboard nav feel identical.
- `empty`: "No insights available." text.

The row renderer is factored out (`renderRow`) so both list kinds share identical visual treatment — cursor arrow, number label, selection color.

### Detail mode

- `details` kind: unchanged — full analysis, summary, estimatedSavings, externalResources (Option unwrap, scrolling, line counter).
- `references` kind: shows the insight name in bold + one-line notice `"No detailed analysis captured. Re-run with \`trace analyze\` to get the full breakdown."`. Same overall structure (column box with bold header then dim body text) so the user's muscle memory for nav/esc still works.

Extracted the notice to module-level `MISSING_ANALYSIS_NOTICE` constant since it's non-obvious UX guidance.

### Keyboard & props

- Prop contract unchanged: `{ report: PerfReport; onClose: () => void }`.
- All keyboard handling (enter, escape, j/k, up/down, pageup/pagedown) untouched.
- No `setOverlay` / `useNavigation` imports — remains props-only.
- Selection clamp now uses `itemCount()` (kind-aware) instead of `details().length` so clamping works for the `references` kind too.

## Tests

Skipped per team-lead guidance ("if none exist, you can skip a unit test"). No existing `insights-overlay` test file — OV-2a did not add component-level overlay tests, and constructing a full `PerfReport` with branded schema fields (`PerfMetricSnapshot`, `TraceInsightRef`, `DateTimeUtc`, `AnalysisStep` with `StepId`, etc.) for a single test would require a lot of scaffolding that isn't reusable yet. Overall test count held steady at 564.

## Verification

```
$ bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
# (no output — clean)

$ cd apps/cli-solid && bun test
bun test v1.3.11 (af24e281)

 564 pass
 0 fail
 1090 expect() calls
Ran 564 tests across 32 files. [7.07s]
```

## Manual verification spec

With a report where `report.insightDetails = []` and `report.metrics[i].traceInsights` contains `LCPBreakdown`, `CLSCulprits`, `RenderBlocking`, `NetworkDependencyTree`:

1. Press `i` from results screen → overlay opens with 4 rows (one per unique insight name), cursor on first row.
2. Arrow keys move selection, enter opens detail pane → shows name in bold + "No detailed analysis captured. Re-run with `trace analyze` to get the full breakdown."
3. `esc` returns to list; second `esc` closes overlay.
4. With `insightDetails.length > 0`, behavior is unchanged (full analysis / savings / resources).
5. With both empty → "No insights available." (unchanged).

## Files touched

- `apps/cli-solid/src/routes/results/insights-overlay.tsx` — union-shape rewrite.
- `docs/handover/tui-rewrite/diary/fixc-diary.md` — this diary.
