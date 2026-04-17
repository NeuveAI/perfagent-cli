# FIX-A Diary — Float overlays with position=absolute + zIndex

## Scope

Rewrote `apps/cli-solid/src/renderables/overlay-container.tsx` to match opencode's `Dialog` pattern so overlays float above the Results screen content instead of being laid out as a flex-column sibling that squishes it.

## Before / after — overlay-container.tsx

### Before

- Outer `<box>`: `width="100%"`, `height="100%"`, `flexDirection="column"`, `alignItems="center"`, `justifyContent="center"`, `backgroundColor={COLORS.BANNER_BG}` (opaque).
- No `position="absolute"` — sat inside parent flex layout and pushed siblings.
- No `zIndex` — relied on DOM order.
- Inner panel had a fixed `height={panelHeight()}` computed from `OVERLAY_HEIGHT_RATIO = 0.7`.
- Content box used `flexGrow={1}` to fill the bounded panel.

### After

- Outer `<box>`:
  - `position="absolute"` — opts out of parent flex layout entirely.
  - `left={0}`, `top={0}`, `width=dimensions().width`, `height=dimensions().height` — fullscreen backdrop anchored at origin.
  - `zIndex={3000}` — sits above normal content.
  - `alignItems="center"` — centers inner panel horizontally.
  - `paddingTop=dimensions().height / 4` — pushes panel down ~quarter (opencode convention).
  - `backgroundColor={RGBA.fromInts(0, 0, 0, 150)}` — translucent dim backdrop (alpha 150).
- Inner panel:
  - `width={panelWidth()}` (unchanged: 80% of terminal width, min 40).
  - `maxWidth={dimensions().width - 2}` — prevents overflow on narrow terminals.
  - No `height` / `flexGrow` on content — panel auto-sizes to content. Short overlays no longer fill the screen awkwardly.
- Removed constants: `OVERLAY_HEIGHT_RATIO`, `OVERLAY_MIN_HEIGHT`, `panelHeight()`.
- Added constants: `OVERLAY_BACKDROP_ALPHA = 150`, `OVERLAY_Z_INDEX = 3000`.
- Imported `RGBA` from `@opentui/core`.

## Consumers audit

Checked the three overlay consumers after the change:

- `raw-events-overlay.tsx` — computes its own `visibleRows` from `dimensions().height * 0.7 - OVERLAY_CHROME_ROWS` and slices `rows()` accordingly. Does NOT rely on a bounded container; the `<For>` just renders the already-windowed slice. Safe.
- `insights-overlay.tsx` — same pattern. `visibleRows` is computed from terminal dimensions directly; the analysis scroll respects that window. Safe.
- `ask-panel.tsx` — same pattern for the history scroll window. One nuance: the panel uses `<box flexGrow={1} flexDirection="column">` around the history list. With the container no longer bounding height, `flexGrow` has no ceiling to grow against, but the history list is already windowed by `visibleSlice()` so it renders exactly `visibleRows()` entries regardless. The input row and error row sit below with `marginTop={1}`. Visually equivalent — the panel simply sizes to `title + history_window + input`, which is what we want.

None of the three consumers depended on OverlayContainer imposing a bounded panel height — all three self-window their content based on `dimensions().height * 0.7`. No consumer changes needed, and none are silently broken.

## Verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — clean, no errors.
- `cd apps/cli-solid && bun test` — **564 pass, 0 fail** across 32 files in 7.35s.
- `cd apps/cli-solid && bun run build` — succeeds, exit code 0.

## Notes

- Did NOT modify any overlay consumer.
- Did NOT change the z-index of anything else.
- Did NOT introduce hardcoded width/height; everything derives from `dimensions()`.
- Did NOT add comments beyond necessity (no load-bearing constraints needed documenting).
