# Review: OV-1a — Raw events overlay component

## Verdict: APPROVE

### Verification performed

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` → exit 0, clean.
- `bun test` → 559 pass, 0 fail (same baseline as before OV-1a).
- Read both new files fully.
- Inspected every `ExecutionEvent` tagged-class in `packages/shared/src/models.ts:599-699`.
- Compared overlay idioms to `app.tsx`, `port-picker-screen.tsx`, `context-picker.tsx`, `changes-banner.tsx`, `ruled-box.tsx`.
- Searched all `useKeyboard` usages and COLORS tokens.

### Findings

- [INFO] `ExecutionEvent` has no `timestamp`/`at`/`time`/`occurredAt` field on any of the 11 tagged classes (`RunStarted` at `models.ts:599`, `StepStarted` `:607`, `StepCompleted` `:616`, `StepFailed` `:625`, `StepSkipped` `:634`, `ToolCall` `:643`, `ToolProgress` `:658`, `ToolResult` `:667`, `AgentThinking` `:677`, `AgentText` `:685`, `RunFinished` `:693`). Engineer's claim is correct. Omitting the `[HH:MM:SS]` prefix was the right call — fabricating timestamps would be worse than dropping them. Suggested next step: if the lead wants timestamps, split a separate task to add `occurredAt: Schema.DateTimeUtc` to each event tagged-class and plumb it through `parseMarker` (`models.ts:719`) and `addEvent` (`models.ts:874`). Do NOT block OV-1a on this.

- [MINOR] `raw-events-overlay.tsx:98` — `ToolResult` row format omits the `/ tokens` segment that the spec (overlays-plan.md:73) asked for: `← name  Nb / tokens  OK|ERR`. The engineer emits `← tool  <name>  <size>b  OK|ERR` without the token count. Existing `testing-helpers.ts:166` uses `Math.round(event.outputSize / APPROX_CHARS_PER_TOKEN)` which is trivial to add. Consider adding it in OV-1b or as a follow-up; non-blocking since the size field already conveys magnitude.

- [MINOR] `raw-events-overlay.tsx:146` — `visibleRows()` is derived from `Math.floor(dimensions().height * 0.7) - OVERLAY_CHROME_ROWS` but `OverlayContainer` computes panel height independently as `max(10, floor(0.7 * height))` (`overlay-container.tsx:22`). The two formulas can disagree on small terminals (e.g. height < 15), so the overlay might render more rows than fit in the panel body. Not a correctness bug — `MIN_VISIBLE_ROWS = 4` guards the floor — but coupling the two would be cleaner. Could expose panel content-rows from `OverlayContainer` via render prop or a shared helper.

- [MINOR] `raw-events-overlay.tsx:33` — `formatEvent` signature takes `Map<string, number>` rather than `Map<StepId, number>`. `StepId` is a branded string, so losing the brand here is a very small type-safety regression. Trivial to change to `Map<StepId, number>`.

- [INFO] Spec calls for "dimmed background underneath the overlay". `OverlayContainer` renders an opaque `COLORS.BANNER_BG` full-screen wrapper (`overlay-container.tsx:31`), which visually replaces rather than dims the Results report. Diary acknowledges this (OpenTUI has no alpha compositing). Acceptable workaround — no change requested.

### Suggestions (non-blocking)

- In `raw-events-overlay.tsx:77-86` the `ToolCall` branch builds `detail` from `formatToolCall(...)` then passes through `truncateSingleLine`. `formatToolCall` already truncates its `args` via `truncateText(...)` at `TESTING_TOOL_TEXT_CHAR_LIMIT=100` (`format-tool-call.ts:61`), so the outer `truncateSingleLine(detail, 80)` can chop off the name as well as args. Consider preserving `formatted.name` verbatim and only truncating `formatted.args`.
- `ARROW_LEFT = "\u2190"` is defined at module scope but only used once on line 97. Inline it or lift to `constants.ts` with the other glyphs.
- The `EventRow.tag` field (`raw-events-overlay.tsx:16`) is assigned but never read downstream — consider dropping it.
- `buildStepNumberByStepId` is a pure function; fine as-is, but could live in a sibling helper file if other overlays need step numbering.

### Acceptance summary

- [x] Both files exist, named exports, no default exports.
- [x] Zero `setOverlay` / `useNavigation` / command-registry imports — props-only.
- [x] No atoms created or subscribed; no barrel files.
- [x] `useKeyboard` is scoped to the component (Solid's `@opentui/solid` variant auto-disposes on unmount, matching `port-picker-screen.tsx:208`).
- [x] `Match.exhaustive` covers all 11 `ExecutionEvent` variants (including `ToolProgress`, `StepSkipped` — not called out in spec but required for exhaustiveness).
- [x] Zero-events branch renders `"No events recorded."` — `end` key guarded with `Math.max(0, last)`.
- [x] No nested `<text>` elements; `<span>` is used correctly inside the single `<text>` in each row (`raw-events-overlay.tsx:232-238`).
- [x] No `useMemo`/`useCallback`/`React.memo` — uses Solid primitives (`createMemo`, `createSignal`).
- [x] No unnecessary comments; naming is descriptive.
- [x] File placement `renderables/overlay-container.tsx` and `routes/results/raw-events-overlay.tsx` follows the kebab-case sibling convention.
- [x] Typecheck + tests clean.

Wiring (setOverlay, esc at app level, command registration) is correctly deferred to OV-1b.
