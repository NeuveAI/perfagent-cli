# Review: FIX-A -- Float overlays with position=absolute + zIndex

## Verdict: APPROVE

### Scope confirmation

`git diff` shows four modified files in the working tree:

- `apps/cli-solid/src/renderables/overlay-container.tsx` -- FIX-A (this task).
- `apps/cli-solid/src/routes/results/insights-overlay.tsx` -- belongs to FIX-C (task #16, already completed).
- `apps/cli-solid/src/routes/startup/startup-screen.tsx` -- belongs to FIX-B (task #15, in progress).
- `apps/cli-solid/src/tui.ts` -- belongs to FIX-B.

FIX-A engineer's diary claims only `overlay-container.tsx` was touched, and the diff for that file matches the diary's before/after description. The other three files are unrelated to this task and will be reviewed under their own tasks. Scoped this review to `overlay-container.tsx` only.

### Verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` -- exit 0, no errors.
- `cd apps/cli-solid && bun test` -- **564 pass / 0 fail** across 32 files in 7.30s (matches diary claim).
- Only `overlay-container.tsx` touched within FIX-A scope: confirmed.
- File read in full (65 lines) and compared against opencode's `Dialog` (lines 10-63).

### Opencode parity check

The implementation matches opencode's `Dialog` outer shell exactly on the relevant attributes:

| Attribute | opencode | fixa | Match |
| --- | --- | --- | --- |
| `width` | `dimensions().width` | `dimensions().width` | yes |
| `height` | `dimensions().height` | `dimensions().height` | yes |
| `position` | `"absolute"` | `"absolute"` | yes |
| `zIndex` | `3000` | `3000` (const) | yes |
| `left` | `0` | `0` | yes |
| `top` | `0` | `0` | yes |
| `alignItems` | `"center"` | `"center"` | yes |
| `paddingTop` | `dimensions().height / 4` | `dimensions().height / 4` | yes |
| `backgroundColor` | `RGBA.fromInts(0,0,0,150)` | `RGBA.fromInts(0,0,0,150)` (const) | yes |

All four anchor attributes (`left`, `top`, `width`, `height`) are present and reactive via `dimensions()`. All values are read inside JSX attributes, so Solid's compiler will track them -- no stale closure risk. Confirmed against review questions 1, 2, 3, 5, 7.

### Review question answers

1. **Absolute positioning anchor**: all four present, all reactive. Pass.
2. **zIndex uniqueness**: grep for `zIndex` across `apps/cli-solid/src` shows only one hit -- in `overlay-container.tsx` itself. No other Solid tree element competes at zIndex >= 3000. Pass.
3. **Backdrop alpha import**: `RGBA` imported from `@opentui/core` at line 4. Used correctly as `RGBA.fromInts(0, 0, 0, OVERLAY_BACKDROP_ALPHA)` where `OVERLAY_BACKDROP_ALPHA = 150`. Pass.
4. **Inner panel sizing**: no `height`, no `maxHeight`, no `minHeight`. Panel auto-sizes to content. Opencode behaves identically (no height on inner panel either, just `paddingTop={1}`). The risk of a tall child overflowing is real in principle, but all three consumers already cap their own content at `dimensions().height * 0.7 - chrome_rows` via `visibleRows()`, so the inner panel's height is bounded by the children. Verified below. Acceptable.
5. **Centering math**: `alignItems="center"` on outer centers the inner panel horizontally across the full terminal width; `paddingTop = dimensions().height / 4` positions it at ~25% down from the top. Matches opencode exactly. Pass.
6. **Title/footer rendering**: title still rendered inside a `<box>` wrapping a `<text>` with `COLORS.SELECTION` + `bold`; footer still wrapped in `<Show when={props.footerHint}>` block with `COLORS.DIM`. Readable, unchanged semantically. Pass.
7. **Reactivity**: `dimensions()` is called inline inside JSX attributes (`width={dimensions().width}`, `height={dimensions().height}`, `paddingTop={dimensions().height / 4}`). Solid's JSX compiler wraps these as getters, so they re-run on terminal resize. Not cached outside JSX. Pass.
8. **Backdrop click-to-dismiss**: opencode wires `onMouseDown`/`onMouseUp` on the outer backdrop box to dismiss the dialog when the backdrop is clicked. fixa did not add these handlers. Spec did not require it, and the three consumers already handle `esc` via their own `useKeyboard` blocks (`raw-events-overlay.tsx:179`, `insights-overlay.tsx`, `ask-panel.tsx:71`). Additionally, the CLI has `useMouse: false` in `tui.ts` (render options), so mouse events wouldn't be delivered anyway. Non-blocking, but noted in suggestions.
9. **Breaking consumers**: grep for `OverlayContainer` shows three consumers: `raw-events-overlay.tsx:221`, `insights-overlay.tsx:192`, `ask-panel.tsx:103`. None pass `height` (the props interface never had one). No dead prop to clean up. Pass.
10. **Removed panel height logic**: `OVERLAY_HEIGHT_RATIO`, `OVERLAY_MIN_HEIGHT`, `panelHeight()` all removed. No dead imports -- the file's imports are `JSX`, `Show`, `useTerminalDimensions`, `RGBA`, `COLORS`, all used. Pass.
11. **TypeScript strict**: no `any`, no `as`, no `null`. `readonly` props, `Math.max`/`Math.floor` on numbers. Pass.
12. **React Compiler rules**: no `useMemo` / `useCallback` / `React.memo`. Solid primitives only (`Show`, `createMemo` is not used here but would be idiomatic -- not required since these are inline accessors). Pass.
13. **Filename / exports / barrel**: `overlay-container.tsx` (kebab-case). Named export `OverlayContainer`. No barrel file. Pass.

### Consumer bounded-height verification

Diary claims all three consumers self-window via `dimensions().height * 0.7`. Grep confirms:

- `raw-events-overlay.tsx:146` -- `Math.floor(dimensions().height * 0.7) - OVERLAY_CHROME_ROWS`
- `insights-overlay.tsx:65` -- `Math.floor(dimensions().height * 0.7) - OVERLAY_CHROME_ROWS`
- `ask-panel.tsx:47` -- `Math.floor(dimensions().height * 0.7) - OVERLAY_CHROME_ROWS`

All three clamp their row slice via `visibleSlice()` before rendering into the `<For>`. With the container no longer bounding height, these consumers continue to render exactly `visibleRows()` entries. The ask-panel's inner `<box flexGrow={1}>` (ask-panel.tsx:104) no longer has a parent bound to grow against, but the `<For each={visibleSlice()}>` caps the rendered row count anyway, so the box naturally sizes to its windowed content. Safe.

### Suggestions (non-blocking)

- Consider adding backdrop `onMouseDown`/`onMouseUp` handlers to match opencode's dismiss-on-click behavior if mouse support is enabled later. Currently `tui.ts` sets `useMouse: false`, so this is moot for now but worth leaving a note in the diary for future work.
- The ask-panel still has `<box flexGrow={1}>` on its inner history wrapper (ask-panel.tsx:104). This is now ineffective (the overlay panel auto-sizes), but harmless. If we later want the history window to grow to fill available height, we would need to restore a height bound on the overlay -- the current implementation intentionally auto-sizes to content, matching opencode.
- `paddingTop={dimensions().height / 4}` -- if terminal height is small (e.g. 10 rows) this could place the panel at row 2 with limited vertical room. Opencode has the same behavior; not a FIX-A regression.

### Out-of-scope observations

- `tui.ts` has unrelated changes (externalOutputMode, kitty flags) from FIX-B -- flagged for FIX-B review.
- `insights-overlay.tsx` has unrelated changes (display-list refactor for FIX-C) -- already reviewed under task #16.
- `startup-screen.tsx` uses `toast.show` instead of `console.error` -- FIX-B related. Flagged for FIX-B review.
