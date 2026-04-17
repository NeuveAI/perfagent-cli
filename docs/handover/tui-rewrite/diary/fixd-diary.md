# FIX-D Diary — RuledBox layout collision

## Context

Screenshot evidence on the Results screen proved that the title
`<text>` ("Copy this summary now") and the hint `<text>` ("Press y to
copy the test summary...") were rendering on the SAME terminal row
inside `RuledBox`. Character-by-character mask showed positions
5,7,10,15,19 of the title overwriting the spaces at the same columns of
the hint, producing "Presstyitoscopyrtheotest summary...".

Two sibling `<text>` elements inside a `flexDirection="column"` box
should land on distinct Y coordinates. Something was collapsing their
heights to 0 so they stacked on the same row.

## Investigation

### 1. RuledBox and its callers

`apps/cli-solid/src/renderables/ruled-box.tsx` (pre-fix):

```tsx
return (
  <box flexDirection="column" width="100%">
    <text style={{ fg: ruleColor() }}>{rule()}</text>
    <box flexDirection="column" paddingLeft={...} paddingRight={...}>
      {props.children}
    </box>
    <text style={{ fg: ruleColor() }}>{rule()}</text>
  </box>
);
```

No explicit `flexShrink` anywhere. Both the outer box and the inner
wrapper default to the web default `flexShrink=1` (see Renderable.ts
below).

`apps/cli-solid/src/routes/results/results-screen.tsx` lines 149-163:
the three `<text>` callout children are direct siblings of the inner
flex-column (no per-child wrapper box).

`apps/cli-solid/src/routes/main/context-picker.tsx` lines 87-120:
each `<text>` inside RuledBox is wrapped in its own `<box>`. This is
why context-picker is immune to the bug — the wrapping `<box>` is a
distinct Yoga node that owns its row and is sized to content.

### 2. opentui Text measurement

`.repos/opentui/packages/core/src/renderables/TextBufferRenderable.ts`
lines 376-420 — the `measureFunc` set on every text node. The salient
block:

```ts
const effectiveHeight = isNaN(height) ? 1 : height
// ...
if (widthMode === MeasureMode.AtMost && this._positionType !== "absolute") {
  return {
    width: Math.min(effectiveWidth, measuredWidth),
    height: Math.min(effectiveHeight, measuredHeight),
  }
}
```

When Yoga asks for measurement with a bounded `height` (AtMost with
`height=0`), the text node returns `height=0`. That's how sibling
`<text>` elements can collapse and share a row.

### 3. Flex-shrink default (the root cause)

`.repos/opentui/packages/core/src/Renderable.ts` lines 717-727:

```ts
if (options.flexShrink !== undefined) {
  this._flexShrink = options.flexShrink
  node.setFlexShrink(options.flexShrink)
} else {
  const hasExplicitWidth = typeof options.width === "number"
  const hasExplicitHeight = typeof options.height === "number"
  this._flexShrink = hasExplicitWidth || hasExplicitHeight ? 0 : 1
  node.setFlexShrink(this._flexShrink)
}
```

Note `typeof options.width === "number"` — percentages (`width="100%"`)
are strings, so they do NOT trigger the `flexShrink=0` branch. The
RuledBox outer box had `width="100%"` but no numeric width/height →
`flexShrink=1`.

Consequence: when the Results screen's main column ran short on
vertical space (long step list, summary, metrics, video URL all
competing), Yoga distributed the shortfall across shrinkable children
proportionally. RuledBox's outer box (flexShrink=1) shrank, its inner
box (flexShrink=1) shrank, and the three `<text>` siblings (flexShrink=1
each) had their allocated heights driven toward 0. Because
`TextBufferRenderable.measureFunc` caps at `Math.min(effectiveHeight,
measuredHeight)`, each text's reported height became 0 and they all
landed on the same Y.

### 4. opencode reference pattern

`.repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx`
lines 418-428:

```tsx
<box flexDirection="column" gap={0}>
  <box flexDirection="row" gap={1} flexShrink={0}>
    <text fg={theme.warning}>{"△"}</text>
    <text fg={theme.text}>Permission required</text>
  </box>
  <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
    <text fg={theme.textMuted} flexShrink={0}>{current.icon}</text>
    <text fg={theme.text}>{current.title}</text>
  </box>
</box>
```

Note the explicit `flexShrink={0}` on every wrapper box that stacks
content. That is the convention opencode uses — it is NOT defaulted; it
is opt-in per-caller.

### 5. text-selection-demo.tsx:196

```tsx
<text style={{ fg: "#f0f6fc", zIndex: 31, height: "auto" }}>
```

This sets `height: "auto"` explicitly — inside an absolutely-positioned
box with explicit numeric width/height. It's about ensuring the text is
sized-to-content inside a parent with fixed dimensions. Not directly
relevant to our flex-column shrinkage case, but it confirms `<text>`
accepts yoga dimension props directly.

### Hypothesis verdict

- H1 (`<text>` needs `height="auto"`): FALSE for our case. `height`
  defaults to auto already; the bug is shrink, not measurement.
- H2 (`<text>` needs `width="100%"`): FALSE — RuledBox outer already
  has `width="100%"` and the collision persisted.
- H3 (inner box needs `flexShrink=0`): **TRUE.** Confirmed by the
  opencode convention and the flexShrink default rule in
  Renderable.ts:725.
- H4 (opentui-specific bug triggered by `<span bold: true>`): FALSE.
  Nothing in Text/TextNode/TextBuffer paths special-cases `bold`.

## Fix

File: `apps/cli-solid/src/renderables/ruled-box.tsx`

Added `flexShrink={0}` to both the outer column and the inner padded
column, plus to each rule `<text>`. This makes the entire RuledBox
incompressible by its parent:

```tsx
return (
  <box flexDirection="column" width="100%" flexShrink={0}>
    <text style={{ fg: ruleColor() }} flexShrink={0}>{rule()}</text>
    <box
      flexDirection="column"
      paddingLeft={props.paddingX ?? 1}
      paddingRight={props.paddingX ?? 1}
      flexShrink={0}
    >
      {props.children}
    </box>
    <text style={{ fg: ruleColor() }} flexShrink={0}>{rule()}</text>
  </box>
);
```

Why this is the minimum fix:
- The public RuledBox API is unchanged.
- All callers (results-screen, context-picker) benefit without edits.
- Callers' `<text>` children inherit correct heights because their
  parent (the inner padded box) is now sized to its content and is not
  shrunk by the screen's main flex column.
- Context-picker was already immune (it wrapped its texts in `<box>`),
  so this change only hardens — it does not regress.

## context-picker impact

Checked `apps/cli-solid/src/routes/main/context-picker.tsx` — no edits
needed. Each `<text>` there is already wrapped in `<box>` (lines 90,
103), so the Yoga shrink path never flattened its texts. The new
`flexShrink={0}` inside RuledBox does not affect its behaviour beyond
the screen-column level (where context-picker also benefits by not
being compressed).

## Verification

```
$ bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
(clean, exit 0)

$ cd apps/cli-solid && bun test
 564 pass
 0 fail
 1090 expect() calls
Ran 564 tests across 32 files. [7.18s]

$ cd apps/cli-solid && bun run build
$ bun build.ts
(exit 0, no errors)
```

## User visual verification spec

When the user runs `perf-agent tui -a local -u https://agent.perflab.io`
and reaches the Results screen, the yellow "Copy this summary now"
RuledBox should render like this (one line per `<text>`, top and bottom
rules on their own rows):

```
────────────────────────────────────────────────
 Copy this summary now
 Press y to copy the test summary so you can paste it into your chat or PR.
 Press s to save this flow or r to run it again.
────────────────────────────────────────────────
```

Key checks:
- Title "Copy this summary now" appears alone on its row (yellow, bold).
- First hint starts with "Press y" (primary-colored) and contains
  contiguous readable words, NOT "Presstyitoscopyrtheotest...".
- Second hint starts with "Press s" and is on a separate row below the
  first hint.
- Top and bottom horizontal rules are on their own rows.
- No character-mask garbling anywhere in the callout.

If the terminal is very short (<20 rows), the RuledBox will now push
content out of view rather than compressing to scrambled garbage; that
is the intended behavior. The user should be able to resize the
terminal taller and see everything intact.

## Files changed

- `apps/cli-solid/src/renderables/ruled-box.tsx`

No commits. Waiting for reviewer APPROVE before the lead commits.

---

## Round 2 — screen-header collisions

Reviewer REQUEST_CHANGES: the same flexShrink=1 collision exists in
five header `<box>` patterns that wrap `<Logo />` plus a sibling
`<text>`. Screenshot evidence (image #6) showed a garbled
"PerffAgent vdevormance..." title — the Logo and instruction text
collapsing onto the same row via the same mechanism as the RuledBox
bug.

### Pattern comparison

Checked all five files to decide whether a shared `ScreenHeader`
extraction was warranted:

| File | Prefix | Dim content | Notes |
| --- | --- | --- | --- |
| `routes/results/results-screen.tsx` | POINTER | ` ▸ ` then TEXT instruction | no margin |
| `routes/testing/testing-screen.tsx` | POINTER | identical to results | no margin |
| `routes/cookie-sync-confirm/...` | POINTER_SMALL | leading space, trailing space, TEXT with `??` fallback | no margin |
| `routes/port-picker/...` | POINTER_SMALL | leading/trailing space, TEXT | no margin |
| `routes/session-picker/...` | none | static dim-colored string, no POINTER | `marginBottom={1}` |

Three-way divergence (POINTER vs POINTER_SMALL vs none; static text vs
instruction prop vs fallback; presence of `marginBottom`). Abstracting
this into a single `ScreenHeader` would require ≥3 optional props
(pointer variant, instruction slot, marginBottom flag) — more surface
area than the one-line fix per file. Per the reviewer's "if any one
diverges enough, apply directly" guidance, applied `flexShrink={0}` in
place to each of the five outer header `<box>` elements.

### Patches applied

All five edits add `flexShrink={0}` to the outer header `<box>` only;
Logo internals untouched.

- `apps/cli-solid/src/routes/results/results-screen.tsx:115` —
  `<box>` → `<box flexShrink={0}>`
- `apps/cli-solid/src/routes/testing/testing-screen.tsx:222` —
  `<box>` → `<box flexShrink={0}>`
- `apps/cli-solid/src/routes/cookie-sync-confirm/cookie-sync-confirm-screen.tsx:158` —
  `<box>` → `<box flexShrink={0}>`
- `apps/cli-solid/src/routes/port-picker/port-picker-screen.tsx:267` —
  `<box>` → `<box flexShrink={0}>`
- `apps/cli-solid/src/routes/session-picker/session-picker-screen.tsx:133` —
  `<box marginBottom={1}>` → `<box marginBottom={1} flexShrink={0}>`

### Regression test consideration (skipped per reviewer guidance)

Tried to add a `RuledBox` regression test asserting distinct Y
coordinates for sibling `<text>` children under height pressure. Two
attempts:

1. Parent `height=6` with 3 texts + 2 rules — fit comfortably, did not
   reproduce the bug.
2. Parent `height=10` with RuledBox next to a `flexGrow={1}` sibling —
   Yoga assigned the leftover space to the grow sibling; RuledBox
   kept its natural height whether or not our fix was applied.

To reliably force Yoga's proportional-shrink path that produces the
bug requires specific content-exceeds-parent geometry that's sensitive
to width/measurement of the rules (terminal width in the test). That
is testing-scaffold work, not a single assertion. Per reviewer
direction ("Only add if the testing primitives already support
Y-assertion; don't build scaffolding"), skipped the regression test.
The fix itself is surgical and the user will visually verify the
Results screen.

### Verification (round 2)

```
$ bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
(clean, exit 0)

$ cd apps/cli-solid && bun test
 564 pass
 0 fail
 1090 expect() calls
Ran 564 tests across 32 files. [6.81s]

$ cd apps/cli-solid && bun run build
$ bun build.ts
(exit 0, no errors)
```

### Files changed (round 2)

- `apps/cli-solid/src/renderables/ruled-box.tsx` (unchanged from round 1)
- `apps/cli-solid/src/routes/results/results-screen.tsx`
- `apps/cli-solid/src/routes/testing/testing-screen.tsx`
- `apps/cli-solid/src/routes/cookie-sync-confirm/cookie-sync-confirm-screen.tsx`
- `apps/cli-solid/src/routes/port-picker/port-picker-screen.tsx`
- `apps/cli-solid/src/routes/session-picker/session-picker-screen.tsx`

### User visual verification spec (round 2)

After round 2, on every screen that shows the logo-plus-instruction
header:

- Results: "PerfAgent ▸ <instruction>" stays as one contiguous row with
  Logo on the left and the instruction flowing to the right — no
  garbled "PerffAgent vdevormance..." letter-swap.
- Testing: same — Logo + ` ▸ ` + instruction, one row.
- Cookie-sync-confirm: Logo + ` › ` + "Select browsers for cookie sync"
  (or passed instruction), one row.
- Port-picker: Logo + ` › ` + instruction, one row.
- Session-picker: Logo + "  Recent sessions — enter to resume, esc to
  go back", one row, with one blank line below.

No character-level overwriting anywhere in the headers. If the screen
is unusually short the header should stay intact and later sections
may be clipped — that is the intended tradeoff.

No commits. Waiting for reviewer APPROVE before the lead commits.
