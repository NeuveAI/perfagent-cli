# OV-2a — Insights overlay component

## Deliverable

`apps/cli-solid/src/routes/results/insights-overlay.tsx` — named export `InsightsOverlay`.

```ts
interface InsightsOverlayProps {
  readonly report: PerfReport;
  readonly onClose: () => void;
}
```

No barrel file, no default export, no command registration (OV-2b will wire `setOverlay("insights")` into the command registry).

## Two modes

A single component with a `mode` signal (`"list" | "detail"`) and a single `useKeyboard` that branches on the mode.

- **List mode** — `<For>` over `report.insightDetails` rendering a numbered line per entry. `title` is shown as the label, falling back to `insightName` when title is empty. Up/down (and `j`/`k`) move selection; `enter` switches to detail; `esc` calls `props.onClose()`.
- **Detail mode** — shows the selected `InsightDetail`:
  - `title` in `COLORS.SELECTION` bold
  - `summary` dim (only when non-empty)
  - scrollable `analysis`
  - `estimatedSavings` — only rendered when the `Option` is `Some`
  - `externalResources` — rendered as dim bullet lines when the array is non-empty
  `esc` in detail mode returns to list, NOT dismiss.

## Long analysis scrolling

`analysis` is a free-form multi-kilobyte string. OpenTUI `<text>` does not auto-wrap, so the component chunks the analysis on `\n` into a `readonly string[]` via `createMemo`, then renders only `analysisLines().slice(offset, offset + visibleRows())` where `visibleRows()` is derived from the terminal height (`floor(height * 0.7) - OVERLAY_CHROME_ROWS`, min 4). `pagedown`/`pageup` scroll by a page, `j`/`k` by a line. Scroll is clamped against `max(0, analysisLines.length - visibleRows)`. An indicator line shows `line N / total` when the content exceeds the visible window.

Empty lines in the analysis are rendered as a single space so the `<text>` element doesn't collapse them and the vertical cadence matches the source.

Matches the scrolling pattern used in `raw-events-overlay.tsx` (same `OVERLAY_CHROME_ROWS` / `MIN_VISIBLE_ROWS` constants, same clamp helpers) so both overlays feel consistent.

## Option-wrapped fields

`InsightDetail.estimatedSavings` is `Schema.OptionFromUndefinedOr(Schema.String)` per `packages/shared/src/models.ts:517`. I unwrap it with `Option.getOrUndefined` and gate rendering on a `<Show when={...}>` — so when the option is `None` nothing renders, and when it's `Some` the string value is displayed after a dim `savings:` label.

`externalResources` is `Schema.Array(Schema.String)` — plain strings (not `{title, url}` objects as the overlays-plan implied). I render them as bullets without any URL parsing. If a later schema change adds structured resources, the render block is the only place to touch.

## Things I deliberately did NOT do

- No `useMemo` / `useCallback` / `React.memo` — Solid's `createMemo` / `createSignal` throughout.
- No `setOverlay` / `useNavigation` / command imports — the overlay is driven entirely by props, per spec.
- No ternaries in JSX — used `<Switch>` / `<Match>` and `<Show>` everywhere.
- No hardcoded widths — `OverlayContainer` owns panel dimensions.
- No nested `<text>` — `<span>` is used inside `<text>` for multi-style runs.
- No comments — behavior reads from code.

## Verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` → exit 0.
- `cd apps/cli-solid && bun test` → `559 pass, 0 fail, 1075 expect()` in 7.18s.

## Files touched

- `apps/cli-solid/src/routes/results/insights-overlay.tsx` (new, ~210 lines).
