# FIX-Center — Cap overlay width at fixed tiers

## Problem

`OverlayContainer` computed panel width as `Math.max(40, Math.floor(dimensions().width * 0.8))`. On a wide terminal (e.g. 200+ cols) this produced an enormous card that visually bled past the reading-comfortable width and made long content look off-center.

## Fix

Mirrored the opencode Dialog pattern at `.repos/opencode/packages/opencode/src/cli/cmd/tui/ui/dialog.tsx:21-26,54-55`: fixed tier widths with a `maxWidth={dim.width - 2}` guard for narrow terminals.

### Before

```tsx
const OVERLAY_WIDTH_RATIO = 0.8;
const OVERLAY_MIN_WIDTH = 40;

const panelWidth = () =>
  Math.max(OVERLAY_MIN_WIDTH, Math.floor(dimensions().width * OVERLAY_WIDTH_RATIO));
```

### After

```tsx
type OverlaySize = "medium" | "large" | "xlarge";

interface OverlayContainerProps {
  readonly title: string;
  readonly children: JSX.Element;
  readonly footerHint?: string;
  readonly size?: OverlaySize;
}

const OVERLAY_WIDTH_MEDIUM = 60;
const OVERLAY_WIDTH_LARGE = 88;
const OVERLAY_WIDTH_XLARGE = 116;

const panelWidth = () => {
  const size = props.size ?? "large";
  if (size === "xlarge") return OVERLAY_WIDTH_XLARGE;
  if (size === "medium") return OVERLAY_WIDTH_MEDIUM;
  return OVERLAY_WIDTH_LARGE;
};
```

The inner panel already had `maxWidth={dimensions().width - 2}` from FIX-A, so no change was needed there — narrow terminals still clamp cleanly.

## Consumer size choices

| Overlay | Size | Width | Why |
| --- | --- | --- | --- |
| `raw-events-overlay.tsx` | `medium` | 60 | Short timeline rows (label + truncated detail) |
| `ask-panel.tsx` | `large` | 88 | Q&A history with wrapped prose |
| `insights-overlay.tsx` | `xlarge` | 116 | Long markdown analysis, summary, and resource list |

All three consumers pass `size` explicitly (including `ask-panel` which matches the default) so intent is visible at each call site.

## Things left untouched

- `position="absolute"`, `zIndex`, `backgroundColor`, `alignItems="center"`, `paddingTop=height/4` — all from FIX-A, untouched.
- Consumers' internal content structure — no changes beyond the new `size` prop.
- `useTerminalDimensions()` reactivity — already wired correctly.

## Verification

### Typecheck

```
$ cd apps/cli-solid && bunx tsc --noEmit -p tsconfig.json
EXIT=0
```

Clean.

### Tests

```
$ cd apps/cli-solid && bun test
bun test v1.3.11 (af24e281)

 572 pass
 0 fail
 1112 expect() calls
Ran 572 tests across 32 files. [7.91s]
EXIT=0
```

All 572 tests pass.

## Files changed

- `apps/cli-solid/src/renderables/overlay-container.tsx` — added `size` prop + tier lookup, removed ratio/min-width constants.
- `apps/cli-solid/src/routes/results/raw-events-overlay.tsx` — `size="medium"`.
- `apps/cli-solid/src/routes/results/insights-overlay.tsx` — `size="xlarge"`.
- `apps/cli-solid/src/routes/results/ask-panel.tsx` — `size="large"`.
