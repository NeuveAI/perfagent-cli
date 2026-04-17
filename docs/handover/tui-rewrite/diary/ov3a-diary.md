# OV-3a — Ask panel UI component

Diary for the Ask-panel overlay component (UI only). Wiring comes later in OV-3c.

## Deliverable

Single file: `apps/cli-solid/src/routes/results/ask-panel.tsx`.

## Exports

- Named export `AskPanel` (component). Only export from the file.

## Props

```ts
interface AskPanelProps {
  readonly history: readonly AskResult[];
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onSubmit: (question: string) => void;
  readonly onClose: () => void;
}
```

`AskResult` shape (from `@neuve/perf-agent-cli/data/ask-report-atom`):

```ts
interface AskResult {
  readonly question: string;
  readonly answer: string;
}
```

## Where `AskResult` lives

**Imported** from `@neuve/perf-agent-cli/data/ask-report-atom` as a type-only import:

```ts
import type { AskResult } from "@neuve/perf-agent-cli/data/ask-report-atom";
```

Reviser's note (post-review patch): my initial pass defined `AskResult` locally. That was wrong — OV-3b's diary (`ov3b-diary.md`) confirms the package name `@neuve/perf-agent-cli` is aliased to `apps/cli/` itself and already exposes `./data/ask-report-atom` via its `exports` map (lines 49–52 of `apps/cli/package.json`). The Solid TUI already consumes sibling atoms via the same pattern (`execution-atom`, `recent-reports-atom`, `runtime`, `flow-storage-atom`, `config-options`). `AskResult` is exported from that module. No local re-definition needed; local definition removed.

## Layout

`OverlayContainer` (title `Ask follow-up`, footer `enter submit · esc close`) wraps:

1. **History area** (flex-grow column):
   - Empty-state message when no questions.
   - Otherwise renders a windowed slice of rendered lines. Each `AskResult` becomes:
     - `Q: {question}` in `PRIMARY`
     - `A: {firstAnswerLine}` in `TEXT`, followed by `   {subsequentLine}` for each `\n`-split answer line
     - blank line separator
   - No truncation — the user wants the full answer; scroll handles overflow.
2. **Error row** — `Show when={props.error !== undefined}` above the bottom row, rendered in `RED`.
3. **Bottom row** — exactly one of:
   - Pending: `SpinnerSpan` + `" Thinking…"` (dim).
   - Input: `> ` prompt in primary color + `<Input>` with placeholder.

## Input + spinner handling

- Pending state simply **hides the `<Input>`** and renders the spinner row instead. This is simpler than keeping the input mounted and disabled, and avoids any chance of the user submitting while a question is in flight. (Spec allowed either approach; favored simpler.)
- Input reuses the existing `Input` renderable at `apps/cli-solid/src/renderables/input.tsx`. It already handles `return` -> `onSubmit(value)`, cursor movement, backspace/delete, word-boundary jumps, and paste. I pass `focus` so it registers with `InputFocusProvider`.
- The panel's own `useKeyboard` handles `escape` (always `onClose`) and up/down/pageup/pagedown for scrolling — gated on `lines.length > visibleRows` so short histories don't try to scroll. Up/down in non-multiline Input is a no-op, so there's no conflict.
- `handleSubmit` trims, refuses empty submissions, refuses submissions while pending, clears the input, then calls `props.onSubmit(trimmed)`.

## Scroll behavior

- History is flattened to a list of rendered lines (question row + N answer rows + blank spacer).
- `visibleRows()` derives from terminal height via `useTerminalDimensions` — `floor(height * 0.7) - 8` clamped to `MIN_VISIBLE_ROWS = 4`. Matches the approach used by `raw-events-overlay.tsx`.
- `scrollOffset` signal drives the slice window. Clamped against `lines.length - visibleRows()`.

## Things deliberately omitted

- No atom wiring, no navigation setters, no Effect runtime calls — pure presentational component.
- No `useMemo` / `useCallback` / `React.memo` — Solid primitives only (`createSignal`, `createMemo`, `Show`, `For`).
- No nested `<text>`; spans are inside `<text>` where needed.
- No comments.
- No barrel file, no default export.

## Post-review minor patches

- `answer.split("\n")` → `answer.split(/\r?\n/)` to handle `\r\n` agent output.
- `lineColor` collapsed to a single expression (`kind === "question" ? PRIMARY : TEXT`); dead "blank" branch dropped (blank rows render empty text, color is irrelevant).

## Verification (after patches)

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — clean, no output.
- `cd apps/cli-solid && bun test` — **559 pass, 0 fail, 1075 expect() calls** (7.33s).

## Files touched

- `apps/cli-solid/src/routes/results/ask-panel.tsx` (new)
