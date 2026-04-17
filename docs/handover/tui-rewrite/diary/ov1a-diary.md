# OV-1a Diary — Raw Events Overlay Component

Date: 2026-04-17
Owner: engineer

## Scope

Pure presentation components. No atoms, no navigation writes, no command registration. Wiring is deferred to OV-1b.

## Files delivered

### `apps/cli-solid/src/renderables/overlay-container.tsx`

Reusable overlay primitive used by all three overlays (raw events, insights, ask). Exports `OverlayContainer` as a named export.

- Props: `{ title: string; children: JSX.Element; footerHint?: string }`.
- Fills the full terminal (`width/height: 100%`), centers a bordered panel with `alignItems` / `justifyContent` set to `center`.
- Panel size: `80% × 70%` of terminal dimensions, with minimums of 40 cols × 10 rows so it is usable on tiny terminals.
- Border: `@opentui/core`'s `<box>` supports `border` / `borderStyle` / `borderColor` props (verified in `node_modules/@opentui/core/renderables/Box.d.ts`). Uses `borderStyle="single"` with `COLORS.BORDER` (#bd93f9).
- Background: `COLORS.BANNER_BG` (#282a36) on both the full-screen wrapper and the panel. OpenTUI does not support alpha compositing against stdout; a solid dark bg gives the "dim the report underneath" feel without artifacts.
- Title row: `COLORS.SELECTION` fg as the spec required (`apps/cli-solid/src/renderables/overlay-container.tsx:46`).
- Footer hint: `COLORS.DIM` fg, only rendered when `footerHint` is provided via `<Show>`.

Styling borrowed from:

- `apps/cli-solid/src/routes/main/changes-banner.tsx` — `backgroundColor` on a padded `<box>`, the only existing precedent for a filled panel.
- `apps/cli-solid/src/renderables/ruled-box.tsx` — using `useTerminalDimensions()` for responsive sizing.
- `apps/cli-solid/src/renderables/error-display.tsx` — `<Show>` pattern for optional props.

Magic ratios pulled into module-local constants (`OVERLAY_WIDTH_RATIO`, `OVERLAY_HEIGHT_RATIO`, `OVERLAY_MIN_WIDTH`, `OVERLAY_MIN_HEIGHT`). I kept them local to the file rather than pushing into `constants.ts` because they are overlay-specific; if a second overlay needs different ratios we can promote them later.

### `apps/cli-solid/src/routes/results/raw-events-overlay.tsx`

Exports `RawEventsOverlay` as a named export.

- Props: `{ executedPlan: ExecutedPerfPlan; onClose: () => void }`.
- Reads `props.executedPlan.events` (readonly). Derives a `StepId → step number` map (1-based) by scanning `StepStarted` events, so `step N` labels remain stable across both `StepStarted` and `StepCompleted` rows.
- Renders each event via `Match.tagsExhaustive`-style `Match.value(event).pipe(Match.tag(...), ..., Match.exhaustive)` — covers every `ExecutionEvent` variant from `packages/shared/src/models.ts:757` (`RunStarted`, `StepStarted/Completed/Failed/Skipped`, `ToolCall`, `ToolProgress`, `ToolResult`, `AgentText`, `AgentThinking`, `RunFinished`).
- Timestamps: the spec said "all events have a timestamp field — format as HH:MM:SS". They do NOT — verified with `grep timestamp packages/shared/src/models.ts` (zero matches). I dropped the `[HH:MM:SS]` prefix instead of fabricating fake timestamps. Flagging this so OV-1b / the lead can decide whether to add timestamps to the schema or live without them.
- Row formatting:
  - `ToolCall` — `tool          <name>  <args>` using `formatToolCall` from `apps/cli-solid/src/utils/format-tool-call.ts`, truncated with `truncateSingleLine` from `testing/testing-helpers.ts` (`TESTING_ARG_PREVIEW_MAX_CHARS`).
  - `ToolResult` — `← tool        <name>  <size>b  OK|ERR`, green for OK, red for ERR.
  - `ToolProgress` — `tool...       <name>  <size>b` (spec didn't mention progress but exhaustive matching requires it).
  - `StepStarted/Completed/Failed/Skipped` — `step N[ done|failed|skipped]  <title or summary>`.
  - `AgentText` — `say           <truncated first line>`.
  - `AgentThinking` — `think         <truncated first line>` in dim fg.
  - `RunFinished` — `finished      status=passed|failed`.
  - `RunStarted` — `start         run started`.
- Scrolling: local `useKeyboard` handler with `up/k`, `down/j`, `pageup`, `pagedown`, `home`, `end`. Maintains `selectedIndex` + `scrollOffset` signals; `visibleRows` derives from terminal height minus `OVERLAY_CHROME_ROWS` chrome allowance. No global commands registered.
- `esc` → `props.onClose()`, `event.preventDefault()`. The container receives the onClose from its parent (OV-1b will pass `() => setOverlay(undefined)`).
- Shows `No events recorded.` when `events.length === 0`.
- Counter row at the bottom of the panel shows `i / N`.

Reuses:

- `formatToolCall` (`apps/cli-solid/src/utils/format-tool-call.ts:48`).
- `truncateSingleLine` (`apps/cli-solid/src/routes/testing/testing-helpers.ts:37`).
- `TESTING_ARG_PREVIEW_MAX_CHARS` (`apps/cli-solid/src/constants.ts:32`).
- Scroll-offset pattern copied from `apps/cli-solid/src/routes/port-picker/port-picker-screen.tsx:118`.

## Things deliberately NOT done

- Did not touch `results-screen.tsx`, `register-results.ts`, or `register-global.ts`. That is OV-1b.
- Did not add `setOverlay` calls inside the overlay — the component receives `onClose` as a prop.
- Did not add any atoms.
- Did not add timestamps to `ExecutionEvent` in `packages/shared/src/models.ts`. Separate discussion for OV-1b.

## Open question for review

`ExecutionEvent` has no timestamp field. The task spec assumed there was one. Two options:

1. **Leave it out** (current state). Rows omit the `[HH:MM:SS]` prefix.
2. **Add `occurredAt: Schema.DateTimeUtc`** to every `TaggedClass` event + plumb it through `ExecutedPerfPlan.addEvent` and the marker parser. This is a schema change that touches shared/supervisor/persisted-session-recording — out of scope for OV-1a.

Recommending (1) for now. If (2) is desired, split it out as its own task.

## Verification

### Typecheck

```
$ cd /Users/vinicius/code/perfagent-cli && bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
EXIT: 0
```

Full monorepo:

```
$ pnpm typecheck
Tasks:    9 successful, 9 total
Cached:    8 cached, 9 total
  Time:    567ms
```

### Tests

```
$ bun test
 559 pass
 0 fail
 1075 expect() calls
Ran 559 tests across 32 files. [7.62s]
```

Same 559-pass baseline as before OV-1a.

## Acceptance checklist

- [x] Both files exist at the paths specified and export named components.
- [x] No usage of `setOverlay` or navigation context anywhere in the two files.
- [x] No atoms created or subscribed.
- [x] No barrel files; imports are direct.
- [x] Typecheck clean.
- [x] Tests pass (559/559).
- [x] No pre-commit hook skips.
