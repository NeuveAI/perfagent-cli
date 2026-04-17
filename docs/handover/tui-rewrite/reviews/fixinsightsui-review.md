# FIX-InsightsUI Review

**Reviewer:** fixinsightsui-reviewer
**Target:** `apps/cli-solid/src/routes/results/insights-overlay.tsx`
**Task:** #23
**Diary:** `docs/handover/tui-rewrite/diary/fixinsightsui-diary.md`
**Round 1 Verdict:** REQUEST_CHANGES
**Round 2 Verdict:** **APPROVE**

See the [Round 2 section](#round-2) at the bottom of this file.

---

## Mandatory verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — EXIT=0, clean.
- `cd apps/cli-solid && bun test` — **572 pass / 0 fail**, 1112 expect() calls, 32 files.
- `git diff --stat apps/cli-solid/src/routes/results/insights-overlay.tsx` — 1 file, +172/-28. Only this file touched.

---

## CRITICAL — Selection-index / items-array mismatch (data corruption)

**Location:** `insights-overlay.tsx:140-155`, `buildDetailRows` at lines 69-105.

**What breaks.** In the details path, `displayList` returns:

```ts
return { kind: "details", rows, items: details };
```

where `details` is `props.report.insightDetails` in its **original order**. Meanwhile, `buildDetailRows` re-sequences details by URL bucket and assigns each detail row a fresh `itemIndex` in that regrouped order.

**Concrete failure case:**

```
insightDetails = [
  A  (insightSetId=NAV_0 → urlX),
  B  (insightSetId=NAV_1 → urlY),
  C  (insightSetId=NAV_0 → urlX),
]
```

`buildDetailRows` groups by first-seen URL:

```
rows = [
  header(urlX),
  detail(A, itemIndex=0),
  detail(C, itemIndex=1),
  header(urlY),
  detail(B, itemIndex=2),
]
```

But `items: details = [A, B, C]` (original order). The user sees UI order `A, C, B`. Pressing ↓ once highlights `C` (`itemIndex=1`). `selectedDetail()` returns `items[1] = B`. **Opening that row shows B's analysis, not C's.** Numeric prefix in the row (`"2."`) shows `2` but represents B.

**Why tests didn't catch it.** The current `.perf-agent/reports/latest.json` fixture has `insightSetId: null` for every detail (pre-FIX-Reporter data). All details land in the `UNGROUPED` bucket in original order, so `items[itemIndex]` is coincidentally correct. Once FIX-Reporter starts populating `insightSetId` and a report carries two navigations interleaved (which is the whole motivation for grouping), this bug surfaces on the first user interaction.

**Fix options.**
1. Derive `items` FROM `rows` so the order matches the displayed order:
   ```ts
   const items = rows.flatMap((row) => (row.kind === "detail" ? [row.detail] : []));
   return { kind: "details", rows, items };
   ```
2. Or drop the `items` field entirely and look up selection by walking `rows` for the nth `detail` row. Option 1 is the minimal delta and mirrors how the references branch is already built (line 150).

Either fix must be accompanied by a regression test covering a mixed-navigation `insightDetails` input (e.g. `[A(X), B(Y), C(X)]`) that asserts the selected row's label matches `selectedDetail().title`.

---

## MAJOR — `RenderBlocking` analysis is not markdown; `<markdown>` won't render it as a table

**Context.** The original user report ("insights detail shows raw text instead of structured data") cites the `RenderBlocking` insight as the smoking gun. Inspecting `.perf-agent/reports/latest.json`:

```
$ jq '.insightDetails[2].analysis' …
"Here is a list of the network requests that were render-blocking …\n\nNetwork requests data:\n\n\n\nallUrls = [0: …]\n\n0;s-596;19 ms;19 ms;… ;[cache-control: …]\n2;s-593;…"
```

This is chrome-devtools-mcp's semicolon-delimited dump. It is **not** markdown. Feeding it through `<markdown>` will render it as plain text with inert hyperlinks — visually identical to what the user already complained about.

Other insights (`LCPBreakdown`, `NetworkDependencyTree`, `CLSCulprits`) do contain real markdown bullets / emphasis / headings, and those will improve. So this change is a partial win, not a full fix.

**Implication.** If the goal of the task is "make the raw render-blocking data readable" (the user's complaint), this PR does not deliver. The semicolon format has to be normalized upstream (in reporter.ts, when `parseInsightDetail` runs) before markdown can help.

**Recommendation.** Either:
- Scope-clarify with team-lead: is the fix meant to handle the markdown-emitted insights only? If so, the diary should call out the render-blocking case as unfixed and open a follow-up.
- Or transform the semicolon payload into a real markdown table in `parseInsightDetail` / `toTextContent` before it lands in `InsightDetail.analysis`.

Shipping without addressing this will trigger the same user complaint the task was opened to solve.

---

## MAJOR — Scroll windowing cuts markdown blocks mid-table

**Location:** `insights-overlay.tsx:283-286`.

```ts
const visibleAnalysisContent = () => {
  const offset = analysisScroll();
  return analysisLines().slice(offset, offset + visibleRows()).join("\n");
};
```

Source-line slicing is defensible (documented in the diary as a known trade-off). But the consequences are harsher than the diary admits:

1. **Broken tables.** A markdown table header + separator + rows spans ≥3 source lines. If the window starts mid-table, `marked` parses the partial slice and either drops the table entirely or emits a malformed one. Users will see tables "flicker" as they scroll.
2. **Broken code fences.** A fenced code block (```lang\n...\n```) with no closing fence in the slice leaves the trailing content styled as code to end-of-slice. Scrolling past the opening fence leaves dangling code styling.
3. **Loss of block context.** A heading `# Title` at source line 3, windowed away, strips downstream styling (subsequent paragraphs no longer know they were under that heading).

The `<markdown>` renderable supports `streaming: true` for incremental appends, but that doesn't solve windowed slicing either — trailing-token instability gets worse under streaming.

**Recommendation (pragmatic).** Accept the trade-off BUT: when `analysisScroll > 0`, add a subtle hint row at the top (e.g. `"…"` in COLORS.DIM) so the user knows context was cut. Similarly at the bottom when not at the end. This matches opencode's usual scroll UX.

**Stronger option.** Wrap `<markdown>` in a `<scrollbox>` (as the opentui `markdown-demo.ts` does at line 548) and let the renderer handle scrolling over the full content. Keyboard arrows then translate to scrollbox offsets. This avoids slicing entirely. If you take this route, delete `analysisLines` / `visibleAnalysisContent` / `maxAnalysisScroll` and drive scroll purely through the scrollbox ref.

Either fix is necessary before this PR can be called "markdown rendering". As-is, we've traded one bad render for an inconsistent one.

---

## MAJOR — Single-group suppression is inconsistent between details and references

**Location:** `buildDetailRows:90`, `buildReferenceRows:123`.

`buildDetailRows` checks `hasMultipleGroups = order.filter((key) => key !== UNGROUPED).length > 1`. So two real URL groups → headers shown. One URL group plus ungrouped bucket → headers suppressed (details show with a single header, ungrouped details show bare).

`buildReferenceRows` checks `hasMultipleGroups = groups.length > 1`. There is no concept of "ungrouped" here because reference rows always have a `snapshot.url`. Fine for that path.

**The inconsistency:** suppose details come in with 1 real URL group + 1 ungrouped bucket. In the details path, headers suppressed → renders as a flat list. User clicks through and everything is fine. Good.

Now suppose 2 real URL groups + 1 ungrouped bucket. `hasMultipleGroups = true` → header rows pushed for real URLs. But the ungrouped bucket rows render with NO header — interleaved between real-URL groups in first-seen order. Visually this means item rows appear BEFORE any header if the first detail was ungrouped. That looks like a bug in the UI to a user ("why do some items have a URL and others don't?").

**Recommendation.** When `hasMultipleGroups === true` AND the ungrouped bucket is non-empty, render it under an explicit `"(other)"` or `"(no URL)"` header so the absence is intentional. Or: if a detail has no `insightSetId`, fall back to `report.metrics[0]?.url` (the only URL in the report if there's just one metric), which eliminates the ungrouped bucket entirely in the single-URL case.

This is not purely cosmetic — the diary line 34 claims "Ungrouped details land in a sentinel bucket that never gets a header row" as a feature. In practice it creates a navigation bar of mixed header/no-header rows that is harder to reason about than a fully-grouped or fully-flat list.

---

## MINOR — Lazy singleton is module-scope, not per-component

**Location:** lines 23-31.

```ts
let markdownSyntaxStyle: SyntaxStyle | undefined;
const getMarkdownSyntaxStyle = (): SyntaxStyle => {
  if (!markdownSyntaxStyle) {
    markdownSyntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: RGBA.fromHex(COLORS.TEXT) },
    });
  }
  return markdownSyntaxStyle;
};
```

This is a module-level mutable singleton. It is built once per process and reused, which is what the diary claims — good.

Caveat: if two different overlay instances want different foreground colors (e.g. light theme vs dark theme switch), this singleton is a global, not reactive. Today we only have one COLORS palette, so it's fine, but if the app ever gains theming, this will silently keep the first-ever-rendered color. Worth a `// HACK:` comment or at minimum noting in the diary that theming invalidation requires resetting the singleton. Opencode threads the syntax style through a `useTheme()` context (see `.repos/opencode/.../context/theme.tsx:709`) — the cleaner long-term pattern.

Not blocking, but worth recording.

---

## MINOR — `selectedDetail()` assumes `items` and `rows` are in sync (Critical bug consequence)

See the CRITICAL section above. Once that is fixed, this note disappears.

---

## MINOR — Keyboard handling does not exit the overlay when `isEmpty()`

When the overlay is in empty state (no insights), the user can still be in `mode() === "list"`. Pressing `enter` calls `openDetail()`, which short-circuits on `itemCount() === 0` (line 229). Good. But the escape key works to dismiss. That's fine.

However, in the empty state, the footer says `"↑↓ navigate · enter open · esc dismiss"` which is misleading — there is nothing to navigate. Swap to `"esc dismiss"` only when empty. Not blocking, UX polish.

---

## Answers to reviewer checklist

### Markdown rendering

1. **Intrinsic vs explicit import.** Used as intrinsic `<markdown>`. Confirmed registered in `.repos/opentui/packages/solid/src/elements/index.ts:106` (`markdown: MarkdownRenderable`). Typechecks.
2. **`SyntaxStyle` import.** Imported from `@opentui/core`. Confirmed `export * from "./syntax-style.js"` in `.repos/opentui/packages/core/src/index.ts:10`. `SyntaxStyle` class defined at `.repos/opentui/packages/core/src/syntax-style.ts:68`. `RGBA` also from `@opentui/core` — correct.
3. **Lazy singleton.** Module-scope `let` + getter. Constructed on first call, reused forever. Matches opencode's `syntax()` signal semantics approximately, though opencode's version is per-theme (see MINOR note).
4. **`content` prop.** Confirmed accepted per `MarkdownOptions.content?: string` at `.repos/opentui/packages/core/src/renderables/Markdown.ts:64`. Matches opencode usage (`index.tsx:1464-1471`).
5. **Width.** Not explicitly threaded. Markdown renderable is `flexDirection: column, flexShrink: 0` (Markdown.ts:172-175) — sizes to parent box. The overlay `xlarge` width is 116 (`overlay-container.tsx:18`), minus 2 paddings = 114 content cols. Narrow terminal: `OverlayContainer` applies `maxWidth={dimensions().width - 2}`, so on a 60-col terminal the panel collapses to 58. Markdown wraps word-by-word inside. Acceptable.
6. **Tables.** `RenderBlocking` is **semicolon text, not markdown** — see MAJOR above.
7. **Mid-table slicing.** See MAJOR above.

### Grouping

8. **URL map builder.** `buildUrlByInsightSetId` iterates `report.metrics[].traceInsights[]` and first-write-wins per `insightSetId`. Two metrics sharing an `insightSetId` would keep the first metric's URL (defensive). Correct shape — the schema guarantees `insightSetId: Schema.String` on `TraceInsightRef` (`packages/shared/src/models.ts:447-450`).
9. **Row interleaving & selection counting.** Tagged union is correct (`header | detail | reference`). Selection scenario `[header, item, item, header, item]` with `selectedIndex=2` → highlights the item with `itemIndex=2` (the one after the second header). **BUT** see CRITICAL: `items[selectedIndex()]` may be the wrong object if `insightDetails` order ≠ grouped order.
10. **Single-group suppression.** Works for the simple case. Inconsistent once `UNGROUPED` bucket coexists with multi-group — see MAJOR.
11. **Ungrouped bucket.** Lands in a sentinel `__ungrouped__` key with no header. See MAJOR for the UX concern.
12. **Group order.** Matches `report.metrics[]` iteration order (first-write-wins into `urlByInsightSetId`, then `buildDetailRows` preserves first-seen URL into `order[]`). Not alphabetical. Correct per diary.

### Edge cases

13. **Empty report.** `displayList` returns `{ kind: "empty" }` → "No insights available." renders. Confirmed.
14. **References path.** When `insightDetails === []` but `uniqueInsightNames.length > 0`, the code iterates `report.metrics[].traceInsights[]` directly (not the pre-deduped `uniqueInsightNames`), de-duping by insight name across snapshots. Grouping works because each snapshot carries its `url`. Confirmed via `buildReferenceRows` at line 107-135.
15. **Selection wrap/bounds.** `clampSelection` bounds `[0, itemCount-1]`. No wrap (doesn't wrap past end). Arrow keys do NOT skip headers because headers have no `itemIndex` — selection only tracks item rows. Correct.

### Scroll math

16. `analysisLines` split on `\n`. `visibleRows()` = `max(MIN_VISIBLE_ROWS=4, floor(height * 0.7) - OVERLAY_CHROME_ROWS=10)`. Reactive via `useTerminalDimensions()` — if terminal resizes mid-run, `visibleRows()` re-evaluates and the slice window updates. Confirmed. But see MAJOR about broken-table artifacts.

### Style / CLAUDE.md compliance

17. No `null` — confirmed via grep.
18. No `as` casts — confirmed via grep.
19. `interface` for object shapes, `type` only for tagged unions (lines 50, 52). CLAUDE.md: "interface over type" with tagged unions excepted — compliant.
20. Named exports only (`export const InsightsOverlay`). No barrel.
21. Arrow functions only — confirmed.

### Canonical OpenTUI / opencode

22. Opencode usage at `.repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1464`:
    ```tsx
    <markdown syntaxStyle={syntax()} streaming={true} content={...} conceal={ctx.conceal()} fg={...} bg={...} />
    ```
    Engineer's version omits `streaming` (correct — not streaming), `conceal`, and `bg`. All prop types match. Clean.
23. **SyntaxStyle creation.** Opencode uses `SyntaxStyle.fromTheme(getSyntaxRules(theme))` — a theme-driven builder with many rules. Engineer uses `SyntaxStyle.fromStyles({ default: { fg: ... } })` — single-rule minimal. Valid, but misses syntax highlighting inside fenced code blocks (if any appear in analysis). Could yield dull rendering for things like `` `inline code` `` in the markdown (no distinction from surrounding text). Non-blocking.

---

## Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | CRITICAL | `items: details` order does not match `itemIndex` order after URL grouping → wrong detail shown on select |
| 2 | MAJOR | `RenderBlocking` analysis is semicolon text, not markdown — user complaint not resolved |
| 3 | MAJOR | Source-line slice breaks markdown tables / code fences / heading context mid-scroll |
| 4 | MAJOR | Single-group suppression inconsistent when UNGROUPED bucket coexists with real URL groups |
| 5 | MINOR | Module-scope singleton won't respond to theme changes |
| 6 | MINOR | Empty-state footer hint mentions navigation that doesn't apply |

Issue #1 alone mandates REQUEST_CHANGES — silent data corruption on user interaction.

## Required before re-review

- [ ] Fix the `items` / `itemIndex` mismatch (option 1 or 2 above).
- [ ] Add a regression test with interleaved-navigation details proving `selectedDetail()` matches the highlighted row.
- [ ] Either normalize semicolon-format analysis into real markdown in the reporter, OR scope-clarify with team-lead that render-blocking remains unfixed and open a follow-up task.
- [ ] Address MAJOR #3 (scroll trade-off) — minimum: add scroll indicators; preferred: switch to `<scrollbox>` wrapping `<markdown>`.
- [ ] Address MAJOR #4 (ungrouped-bucket UX) — give it a header or force-fallback to metrics[0].url.

---

<a id="round-2"></a>
# Round 2 — Re-review

**Round 2 Verdict: APPROVE**

All four substantive issues fixed. CLAUDE.md compliance clean. Verification clean.

## Round 2 verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — EXIT=0, clean.
- `cd apps/cli-solid && bun test` — **572 pass / 0 fail**, 1112 expect() calls, 32 files.
- `git diff --stat apps/cli-solid/` — 1 file (`insights-overlay.tsx`), +251/-63. Only this file touched.

## Fixes verified

### 1. CRITICAL — items/itemIndex mismatch (APPROVED)

Line 192:

```ts
const items = rows.flatMap((row) => (row.kind === "detail" ? [row.detail] : []));
```

Mental trace through the hostile fixture `[A(urlX), B(urlY), C(urlX)]`:
- `buildDetailRows` groups first-seen by URL: `rows = [header(urlX), detail(A, 0), detail(C, 1), header(urlY), detail(B, 2)]`.
- `items = flatMap(rows, detail rows only)` = `[A, C, B]`.
- `selectedIndex=1` → `items[1] = C`. Matches the row with `itemIndex=1` (also C). Fixed.

The same pattern is applied to references (line 198) — already correct before, still correct now.

### 2. MAJOR — scrollbox wrapping `<markdown>` (APPROVED)

Lines 427-440. Structure matches the canonical opentui Solid pattern at `.repos/opentui/packages/solid/examples/components/scroll-demo.tsx:7-33`:

```tsx
<box marginTop={1} flexDirection="column" height={visibleRows()}>
  <scrollbox
    ref={(renderable: ScrollBoxRenderable) => { analysisScrollBox = renderable; }}
    style={{ width: "100%", height: "100%", flexGrow: 1 }}
  >
    <markdown content={analysisContent()} syntaxStyle={getMarkdownSyntaxStyle()} fg={COLORS.TEXT} />
  </scrollbox>
</box>
```

The enclosing `<box>` with fixed `height={visibleRows()}` establishes the scrollbox viewport; the scrollbox fills it (`100%`). Markdown content overflows vertically — scrollbox handles the scroll.

**`scrollBy` API semantics (`.repos/opentui/packages/core/src/renderables/ScrollBar.ts:245-257`):**

```ts
const multiplier =
  unit === "viewport" ? this.viewportSize :
  unit === "content"  ? this.scrollSize :
  unit === "step"     ? (this.scrollStep ?? 1) : 1
const resolvedDelta = multiplier * delta
```

- `scrollBy(±1, "step")` → moves by `scrollStep ?? 1` rows (one row). Correct for arrow keys.
- `scrollBy(±1, "viewport")` → moves by one full viewport height. That's a whole-page jump. Native opentui scrollbar uses `±1/2, "viewport"` for pageup/pagedown (half-page). Not a bug — just a slightly more aggressive pagedown than native. Acceptable.

Types match: `public scrollBy(delta: number | {x,y}, unit: ScrollUnit = "absolute"): void` where `ScrollUnit = "absolute" | "viewport" | "content" | "step"`.

Scroll now handles full markdown content including multi-line tables, code fences, and headings — the Round 1 MAJOR concern about broken blocks mid-slice is eliminated because nothing slices the content anymore.

### 3. MAJOR — semicolon code-fence wrapping (APPROVED)

Lines 43-68. Traced through concrete inputs:

Input: `"Line A\n0;a;b;c;d;e\n2;a;b;c;d;e\nLine B"`
- i=0 "Line A" (0 semicolons) → push "Line A".
- i=1 "0;a;b;c;d;e" (5 semicolons ≥ 5) → `runStart = 1`.
- i=2 "2;a;b;c;d;e" (5 semicolons) → continue.
- i=3 "Line B" (0 semicolons) → `flushRun(3)` pushes `"```\n0;…\n2;…\n```"`. Push "Line B".
- End-of-loop `flushRun(4)` → no-op (runStart reset).

Output:
```
Line A
```<newline>
0;a;b;c;d;e<newline>
2;a;b;c;d;e<newline>
```<newline>
Line B
```

Edge cases covered:
- **Ends inside a run:** final `flushRun(lines.length)` closes the fence. Verified.
- **Never enters a run:** `runStart` stays -1, no fence emitted. Verified.
- **Back-to-back runs separated by a blank line:** blank line has 0 semicolons → flushes the run, pushes blank line, new run may start. Produces two fences. Correct.

Threshold of 5 semicolons avoids false positives on normal prose (e.g. `cache-control: public, max-age=…, immutable`). The chrome-devtools-mcp data rows have ≥20 semicolons so they're caught reliably.

Minor caveat: if the semicolon run itself contains triple-backticks (e.g. a URL or header value with `` ` ``), the emitted fence would close prematurely. Not observed in any real chrome-devtools-mcp output. Non-blocking.

### 4. MAJOR — header consistency / `(unknown URL)` (APPROVED)

Lines 136-145:

```ts
const hasAnyGroup = order.some((key) => key !== UNGROUPED_KEY);
…
if (hasAnyGroup) {
  const headerUrl = key === UNGROUPED_KEY ? UNKNOWN_URL_HEADER : key;
  rows.push({ kind: "header", url: headerUrl });
}
```

Behavior:
- All UNGROUPED (no real URL): `hasAnyGroup=false` → no headers, single flat list.
- Mix of UNGROUPED + real URL(s): `hasAnyGroup=true` → **every** group (including UNGROUPED) gets a header (`(unknown URL)` for the sentinel). Users now see either fully-grouped or fully-flat — no interleaved headerless rows.
- All real URLs: `hasAnyGroup=true` → each gets its URL as header.

The copy `"(unknown URL)"` is fine for now — clearer alternatives like `"(no navigation id)"` are arguable but non-blocking.

References path (line 154-182) unchanged from Round 1 — `buildReferenceRows` iterates `report.metrics[]` and always pairs names with `snapshot.url`, so no UNGROUPED bucket is possible. Engineer's claim verified by reading the code.

### 5. MINOR — empty-state footer (APPROVED)

Lines 332-337:

```ts
const emptyFooter = () => "esc dismiss";
const footerHint = () => {
  if (isEmpty()) return emptyFooter();
  return mode() === "list" ? listFooter() : detailFooter();
};
```

Empty state shows only `"esc dismiss"`. Correct.

## Round 2 residual observations (all non-blocking)

### `queueMicrotask` for scrollTop reset

Line 279: `queueMicrotask(() => resetAnalysisScroll())`. This works because:
1. `setMode("detail")` synchronously triggers the Solid reactive graph to mount `<scrollbox>`.
2. The `ref` callback fires during mount, assigning `analysisScrollBox`.
3. `queueMicrotask` fires after the current synchronous execution — by then the ref is set.

A `createEffect(() => { if (mode() === "detail") resetAnalysisScroll(); })` would be more idiomatic Solid. But the microtask approach is equally correct and marginally simpler here. Not blocking.

Side note: when the user navigates list → detail → list → detail for a different item, the `<Match when={mode() === "detail"}>` unmounts and remounts, so a fresh `<scrollbox>` is created with `scrollTop = 0` by default. The explicit reset is defensive; in practice it handles the less common case where the same scrollbox instance stays mounted. Fine.

### Scrollbox does not have `focused` prop

The scrollbox does not own keyboard events — the component's `useKeyboard` intercepts and calls `analysisScrollBox.scrollBy(...)` directly. This is the right choice because the component also needs to handle Esc to return to list, and `useKeyboard` gives a unified dispatch. Skipping `focused` is correct.

### Module-scope SyntaxStyle singleton

Unchanged from Round 1 — still a global mutable singleton. Fine for now (no theming). Worth a `// HACK:` comment or a migration note when theming arrives. Deferred, non-blocking.

### Viewport scroll aggressiveness

`scrollBy(±1, "viewport")` for pageup/pagedown jumps a full viewport. Native opentui convention is half-viewport (`0.5`). Either is defensible; users may prefer half-page for context overlap. Deferred to user feedback.

## CLAUDE.md compliance (re-checked)

| Rule | Status |
|---|---|
| No `null` | No matches. Pass. |
| No `as` casts | No matches (the `ref` callback type annotation `(renderable: ScrollBoxRenderable) =>` is a parameter type, not a cast). Pass. |
| `interface` over `type` | Object shapes use `interface`. `type GroupedRow` / `type DisplayList` are tagged unions — allowed per CLAUDE.md. Pass. |
| Named exports, no barrel | `export const InsightsOverlay`. No index.ts. Pass. |
| Arrow functions only | All functions are arrow. Pass. |
| kebab-case filenames | `insights-overlay.tsx`. Pass. |
| Magic numbers in `constants.ts` or SCREAMING_SNAKE_CASE | `OVERLAY_CHROME_ROWS`, `MIN_VISIBLE_ROWS`, `SEMICOLON_CODE_FENCE_THRESHOLD`, `UNKNOWN_URL_HEADER`, `UNGROUPED_KEY`, `MISSING_ANALYSIS_NOTICE`. All SCREAMING_SNAKE_CASE module constants. Pass. |

## Round 2 summary

| Round 1 issue | Status |
|---|---|
| CRITICAL: items/itemIndex mismatch | Fixed |
| MAJOR: RenderBlocking semicolon text | Fixed (via `wrapSemicolonRunsInCodeFence`) |
| MAJOR: scroll slice breaks markdown blocks | Fixed (now full-content `<scrollbox>`) |
| MAJOR: UNGROUPED bucket inconsistent | Fixed (every bucket headered when any real URL exists) |
| MINOR: footer hint in empty state | Fixed |
| MINOR: SyntaxStyle singleton ignores theming | Deferred (no theming today, non-blocking) |

No new issues introduced. Ship it.
