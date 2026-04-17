# FIX-Center Review

**Reviewer:** fixcenter-reviewer
**Task:** #21 — Cap overlay width at fixed tiers with `maxWidth` guard (opencode pattern)
**Verdict:** APPROVE

## Summary

Engineer replaced the ratio-based `panelWidth` with opencode's three-tier sizing (`60 / 88 / 116`) and added a responsive `maxWidth={dimensions().width - 2}` guard to the inner panel. All three consumers were updated with explicit sizes. Implementation matches the reference in `/.repos/opencode/packages/opencode/src/cli/cmd/tui/ui/dialog.tsx:21-26,54-55` exactly.

## Mandatory verification

1. **Typecheck** — `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` → exit 0, no output. Clean.
2. **Tests** — `cd apps/cli-solid && bun test` → `572 pass / 0 fail` in 8.03s, 1112 expect() calls. Matches engineer's claim.
3. **Diff scope** — `git diff --stat apps/cli-solid/src/renderables apps/cli-solid/src/routes/results` shows exactly the 4 expected files and nothing else:
   - `renderables/overlay-container.tsx` (+16/-4)
   - `routes/results/ask-panel.tsx` (+5/-1)
   - `routes/results/insights-overlay.tsx` (+5/-1)
   - `routes/results/raw-events-overlay.tsx` (+5/-1)
4. **overlay-container.tsx** read in full (73 lines). See analysis below.
5. **Consumers** — confirmed: `raw-events-overlay.tsx:224` → `size="medium"`, `insights-overlay.tsx:195` → `size="xlarge"`, `ask-panel.tsx:106` → `size="large"`.

## Correctness

1. **Tier values** — `OVERLAY_WIDTH_MEDIUM = 60`, `OVERLAY_WIDTH_LARGE = 88`, `OVERLAY_WIDTH_XLARGE = 116`. Match opencode `dialog.tsx:22-25` exactly.
2. **`maxWidth` guard** — `maxWidth={dimensions().width - 2}` applied to the inner panel box at line 45. Called inline in JSX, so it re-reads the reactive signal on every frame. Same pattern as opencode `dialog.tsx:55`. Correct.
3. **Default size** — `const size = props.size ?? "large";` at line 25. Falls through to `return OVERLAY_WIDTH_LARGE` (88). Matches opencode's fall-through default. Correct.
4. **Panel height** — No explicit height on the inner panel. Auto-sizes to content, consistent with FIX-A's intent and opencode's pattern (opencode uses `paddingTop={1}` only, no height). Correct.
5. **Removed constants** — `OVERLAY_WIDTH_RATIO`, `OVERLAY_MIN_WIDTH` removed. No `OVERLAY_HEIGHT_RATIO` or `panelHeight()` exists anywhere (`panelHeight|OVERLAY_HEIGHT` grep returned nothing). No dead code.
6. **FIX-A attributes preserved** — outer `<box>` still has `position="absolute"`, `zIndex={OVERLAY_Z_INDEX}` (= 3000), `alignItems="center"`, `paddingTop={dimensions().height / 4}`, `backgroundColor={RGBA.fromInts(0, 0, 0, OVERLAY_BACKDROP_ALPHA)}` (alpha = 150). All present and correct (lines 35-41).

## Consumer sizing

7. **raw-events-overlay → medium (60)** — content is a single-line-per-event list: `"▸ "` (2) + padded 14-char label + detail (truncated to `TESTING_ARG_PREVIEW_MAX_CHARS` / `AGENT_TEXT_PREVIEW_MAX_CHARS=80`). Plus the outer box uses `paddingLeft=1 + paddingRight=1 + border=2`, leaving ~56 inner chars. An 80-char agent-text detail will clip. However, the detail column is the last column and `truncateSingleLine` is already applied upstream; the row was designed to truncate. Medium is reasonable for a timeline view — this is a UX-sizing judgment, not a correctness bug.
8. **insights-overlay → xlarge (116)** — analysis markdown is pre-split on `\n` and rendered line-by-line; long lines from the LLM may still overflow the ~112 inner chars. FIX-Format (task #23) will replace this with a `<markdown>` renderable, at which point the renderer will handle wrapping and xlarge gives it plenty of room. Correct choice.
9. **ask-panel → large (88)** — Q/A lines are pre-wrapped at `\r?\n` boundaries only; long paragraphs from the agent may exceed 84 inner chars and clip. This is a pre-existing concern not introduced by this change. Large is a reasonable default for Q&A.

## Sibling parity

10. **Other consumers** — grepped `OverlayContainer` across `apps/cli-solid/src`: only the three updated consumers (`ask-panel`, `insights-overlay`, `raw-events-overlay`) import it. No callers missed.

## Style / CLAUDE.md compliance

11. **No `null`** — confirmed, uses `undefined` in `props.size ?? "large"`.
12. **No `as` casts** — none in the diff.
13. **`interface` over `type`** — `OverlayContainerProps` is an `interface`. However, `OverlaySize` at line 7 is a `type` alias for a string union. Per CLAUDE.md: *"`interface` over `type`"*. A string-literal union is not representable as an `interface`, so `type` is unavoidable here. Not a violation.
14. **Named exports only** — `export const OverlayContainer = ...`, no default export. Correct.
15. **Descriptive names** — `panelWidth`, `OVERLAY_WIDTH_MEDIUM/LARGE/XLARGE`, `OverlaySize`. All clear.

## Reactivity

16. **`dimensions()` inline** — every use is `dimensions().width` / `dimensions().height` inside JSX attributes (lines 33, 34, 40, 45). None captured in a `const` at function scope. Reactive. Correct.

## Regressions

17. **Test impact** — grepped `OVERLAY_WIDTH|OVERLAY_MIN_WIDTH|OVERLAY_HEIGHT|overlay-container|panelWidth` across `**/*.test.*` in `apps/cli-solid`: no matches. No overlay-sizing tests exist, so 572/0 passing is meaningful (not masked by stale assertions).

## Issues

### Critical
None.

### Major
None.

### Minor
None. The "medium = 60 may clip" concern on `raw-events-overlay` is a pre-existing truncation-by-design, not a regression introduced by this change.

### Nits
- `OverlaySize` is declared as a local `type` alias at file scope but only consumed by `OverlayContainerProps.size`. Could be inlined into the `interface`, but keeping it named aids readability. Non-issue.

## Verdict

**APPROVE**

The implementation mirrors opencode's `Dialog` width logic verbatim (tiers, default, `maxWidth` guard), preserves every FIX-A attribute on the outer backdrop, leaves no dead code, and touches only the four files in scope. Typecheck clean, 572/0 tests pass, no missed consumers. Consumer size choices (medium for event rows, large for Q&A, xlarge for insights analysis) are defensible and align with the content profile of each overlay.
