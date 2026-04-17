# Review: OV-2a — Insights Overlay Component

## Verdict: APPROVE

File: `apps/cli-solid/src/routes/results/insights-overlay.tsx` (224 lines, named export `InsightsOverlay`).

## Verification

- **tsc**: `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — exit 0, no errors.
- **tests**: `cd apps/cli-solid && bun test` — **559 pass, 0 fail**, 1075 expect() calls, 32 files, 7.25s.
- **Schema confirmed** in `packages/shared/src/models.ts:511-520`:
  - `insightName: Schema.String` (line 513)
  - `title: Schema.String` (line 514)
  - `summary: Schema.String` (line 515)
  - `analysis: Schema.String` (line 516)
  - `estimatedSavings: Schema.OptionFromUndefinedOr(Schema.String)` (line 517) — Option of string
  - `externalResources: Schema.Array(Schema.String)` (line 518) — array of plain strings
- Engineer's plan-deviation claim is **correct**. The overlays-plan at line 111 implied `externalResources` would be structured as URLs; actual schema is `Schema.Array(Schema.String)`. The engineer correctly rendered them as plain bullets. See "Plan deviation" section below.

## Behavior walkthrough

Two-mode signal (`mode: "list" | "detail"`, line 23) branched inside a single `useKeyboard` (lines 78-120):

**List mode** (lines 79-98):
- `esc` → `props.onClose()` + `preventDefault()` → returns. Correct.
- `down` / `j` → `moveSelection(+1)`. Correct.
- `up` / `k` → `moveSelection(-1)`. Correct.
- `return` / `enter` → `openDetail()`. Correct.
- `openDetail` guards `details().length === 0` (line 68), so enter on empty list is a no-op — **no crash**.

**Detail mode** (lines 99-119):
- `esc` → `returnToList()` + `preventDefault()`. Does NOT call `onClose()` — matches spec exactly.
- `down` / `j` → `scrollAnalysis(+1)`.
- `up` / `k` → `scrollAnalysis(-1)`.
- `pagedown` / `pageup` → full page scroll.
- Scroll clamped via `clampAnalysisScroll` against `max(0, lines - visibleRows)` (lines 53-61). Bounded.

## Findings

No critical or major issues.

### Minor

- [Minor] **Long-line overflow in `analysis`** (line 50, `detail.analysis.split("\n")`). If an insight's analysis is a single unbroken string (no `\n`), `analysisLines()` has length 1 and the single row will overflow the panel horizontally because OpenTUI `<text>` does not auto-wrap. The spec explicitly names this as risk #4 ("Large insight text wrapping"). The component does not split on width. In practice `InsightDetail.analysis` is LLM-generated prose that reliably contains `\n`, but a hostile or malformed input could produce an ugly render. Non-blocking because (a) realistic analyses have paragraphs and (b) every other overlay has the same constraint. Consider a follow-up to wrap long lines on width as part of OV-4 polish.

- [Minor] **`numberLabel` padding breaks at 100+ entries** (line 141, `` `${index() + 1}.`.padEnd(4, " ") ``). `padEnd(4)` won't truncate, so 3-digit indices render 5 chars wide and shift the row. Realistic insight counts are <50, so this is cosmetic. Non-blocking.

- [Minor] **`getInsightLabel` fallback edge case** (line 17). Falls back from `title` to `insightName` when title is empty. If both are empty (allowed by schema — `Schema.String` permits `""`), renders nothing visible for the selected row. Engineer followed spec literally. Non-blocking — a fallback to `"insight #N"` could be added in polish.

### Suggestions (non-blocking)

- `selectedIndex` is not reset when transitioning from detail back to list, nor clamped if `details()` shrinks between mounts (props are `PerfReport`, so the array is immutable per-report — non-issue in practice, but `clampSelection` would protect against future dynamic sources).
- `analysisScroll` is reset in both `openDetail` (line 69) and `returnToList` (line 75). Double reset is redundant but harmless.
- Footer strings are built by functions (`listFooter()`, `detailFooter()` at lines 127-128) that take no inputs and always return the same string. These could be constants rather than functions. Cosmetic.

## Plan deviation: `externalResources` shape

**Engineer is correct, plan is wrong.**

- `packages/shared/src/models.ts:518` confirms `externalResources: Schema.Array(Schema.String)`.
- Plan at `overlays-plan.md:111` says "externalResources as clickable-looking URLs" — misleading. Implementation renders as dim bullet strings (lines 203-214). Correct per actual schema.
- Suggest updating `overlays-plan.md` line 111 to reflect the real schema, and possibly a schema TODO to eventually add structured `{title, url}` resources since the plan's original intent was richer.

## Plan deviation: `estimatedSavings`

- Schema is `OptionFromUndefinedOr(Schema.String)` (line 517) — already a string. Plan suggested "numeric + unit" rendering; engineer correctly treats it as opaque string via `Option.getOrUndefined` + `<Show when={savings()}>` (lines 161, 193-202). Correct.
- Note: `Option.getOrUndefined` wrapped in `<Show when>` is idiomatic. No unsafe `.value` access anywhere.

## Sibling-parity with `raw-events-overlay.tsx` (OV-1a)

- Same `OverlayContainer` wrapper: confirmed (line 131 vs OV-1a line 221).
- Same `OVERLAY_CHROME_ROWS` / `MIN_VISIBLE_ROWS` idiom: confirmed — OV-1a uses `6`, OV-2a uses `10` (difference justified: OV-2a has extra title + summary + savings + resources chrome).
- Same `visibleRows()` formula `floor(height * 0.7) - OVERLAY_CHROME_ROWS`: confirmed (line 30).
- Same `clampSelection` pattern: confirmed (lines 33-39).
- Same `useKeyboard` scoping (single handler, `preventDefault()` on consumed events): confirmed.
- Same `COLORS.PRIMARY` / `COLORS.DIM` / `COLORS.TEXT` / `COLORS.SELECTION` token usage: confirmed.
- Selection indicator `\u25B8` matches OV-1a's `\u25B8` (line 146, same as OV-1a line 234).
- The escape sequences `\u2191\u2193` and `\u00b7` in footer match OV-1a exactly.

## Banned patterns: confirmed absent

- No `useMemo` / `useCallback` / `React.memo` — grep returns zero matches.
- No `setOverlay` / `useNavigation` / command-registry imports — OV-2a is props-only, per spec.
- No nested `<text>` elements — every child of `<text>` is a `<span>` or a primitive string.
- No barrel files — direct imports from source modules.
- No unsafe `as` casts.
- No `null`. `Option.getOrUndefined` used correctly.
- No `!!` boolean coercion (`Show when` predicates use `.length > 0` or value presence).
- No type annotations on function return types (TypeScript infers).
- No comments — behavior reads from code.
- Arrow functions throughout (component, helpers, callbacks).

## JSX ternaries note

CLAUDE.md bans "ternary operators for conditional rendering in JSX" — specifically `cond ? <A/> : <B/>` for component selection. The ternaries in this file are:
- Line 131: string attribute (`footerHint`)
- Lines 145, 149: color values (`fg:`)
- Line 146: string children (chevron vs spaces)
- Line 181: string fallback for empty lines

These all match precedent in the already-approved OV-1a (`raw-events-overlay.tsx:233-234`). They are value-level ternaries, not render-selection ternaries. Acceptable.

## Imports and conventions

- `import { Option } from "effect"` (line 3) — correct Effect v4 path.
- `import type { InsightDetail, PerfReport } from "@neuve/shared/models"` (line 4) — type-only import, matches sibling style.
- Named export only. No default export.

## Test coverage

No tests were added for `InsightsOverlay` itself. Spec did not require them (OV-2a acceptance is "Both modes render. Navigation works. `bun test` passes"). 559 existing tests still pass. Acceptable for a pure-UI component — wiring is covered by OV-2b.

## Summary

The implementation is clean, matches the spec except for two plan deviations that the engineer correctly identified and justified. Sibling-parity with OV-1a is strong. No banned patterns. All keyboard paths behave per spec including the critical nested-esc behavior (detail esc returns to list; list esc dismisses). The only concerns are cosmetic edge cases around text overflow and padding for large counts, both non-blocking.

**Recommend merging. Update `overlays-plan.md:111` to reflect the actual `externalResources: Array<string>` schema as a follow-up.**
