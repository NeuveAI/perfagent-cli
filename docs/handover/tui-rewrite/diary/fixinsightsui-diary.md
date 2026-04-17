# FIX-InsightsUI — markdown analysis + URL grouping

Task #23. Target file: `apps/cli-solid/src/routes/results/insights-overlay.tsx`.

## Revision round 2 (reviewer feedback addressed)

### CRITICAL: items array now derived from grouped rows

Previously `items` held the original `InsightDetail[]` order while `rows` re-sequenced visually by URL. That meant `items[selectedIndex]` could point at a different insight than the highlighted row when details crossed navigations. Fixed by deriving both kinds of items from the rows list:

```ts
const items = rows.flatMap((row) => (row.kind === "detail" ? [row.detail] : []));
```

Same pattern for references. Item indices assigned while walking `rows` are now the single source of truth for selection; highlight and enter both resolve through the same visual order.

### MAJOR: scrollbox wraps full markdown

Source-line windowing is gone. Now:

```tsx
<box height={visibleRows()}>
  <scrollbox ref={(renderable) => (analysisScrollBox = renderable)} style={{ height: "100%" }}>
    <markdown content={analysisContent()} syntaxStyle={...} />
  </scrollbox>
</box>
```

The markdown renderer sees the full preprocessed analysis and can parse tables and code fences intact. Scroll is driven programmatically from the existing `useKeyboard` handler via the ref:

- `down`/`j`: `scrollBy(1, "step")`
- `up`/`k`: `scrollBy(-1, "step")`
- `pagedown`: `scrollBy(1, "viewport")`
- `pageup`: `scrollBy(-1, "viewport")`
- `openDetail()`: `queueMicrotask` to reset `scrollTop = 0`

Keyboard focus stays with the overlay's `useKeyboard` — the scrollbox doesn't need `focused`, since we don't want it stealing esc or other keys. No more `analysisScroll` signal or line counter.

### MAJOR: consistent header behavior with UNGROUPED bucket

`buildDetailRows` now checks `hasAnyGroup = order.some(key => key !== UNGROUPED_KEY)`. If any details carry a resolvable URL, every bucket emits a header (the ungrouped bucket gets a literal `"(unknown URL)"` header). This fulfills option (a) from the review — consistent headers when groups exist rather than mixed headered+headerless rows.

References fallback (`uniqueInsightNames`): still skips the header when there's a single snapshot, since references mode has no UNGROUPED bucket — the data model guarantees each name is tied to one snapshot, so a single-snapshot run would only produce one header.

### MAJOR: semicolon-heavy lines wrapped in code fence

`wrapSemicolonRunsInCodeFence(analysis)` scans lines and collects runs where each line has ≥5 semicolons (the `SEMICOLON_CODE_FENCE_THRESHOLD` constant). Each contiguous run gets wrapped in `\`\`\`` fences so the markdown renderer treats it as a code block rather than attempting to reflow it as a paragraph. Non-data lines stay untouched. Threshold picked as a conservative heuristic for chrome-devtools-mcp dumps like `RenderBlocking` output.

### MINOR: empty-state footer hint

`footerHint()` now switches on three cases:

- empty: `"esc dismiss"`
- list: `"↑↓ navigate · enter open · esc dismiss"`
- detail: `"↑↓ scroll · esc back"`

## Ref pattern

Followed the opencode convention (`let scroll: ScrollBoxRenderable | undefined; <scrollbox ref={(r) => (scroll = r)} />`). The ref is captured at mount and used imperatively from the shared `useKeyboard` handler. Guarded with `if (!analysisScrollBox) return;` since the ref isn't assigned during the first-paint microtask.

## Row type shape

`GroupedRow = GroupedHeaderRow | GroupedDetailItem | GroupedReferenceItem` — a single discriminated union. `<Switch><Match when={row.kind === "header" ? row : undefined}>` narrows inside each branch so the callback gets a properly-typed row variant. This lets one `<For>` interleave headers and items while the renderer receives typed data.

## Verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — EXIT=0 clean.
- `cd apps/cli-solid && bun test` — **572 pass / 0 fail** across 32 files, 1112 expect() calls.
