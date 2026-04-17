# OV-1b Review — Wire raw events overlay into Results

**Reviewer:** ov1b-reviewer
**Date:** 2026-04-17
**Verdict:** REQUEST_CHANGES

## Verification

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` | Clean, exit 0 |
| `cd apps/cli-solid && bun test` | 560 pass / 0 fail / 1076 expects |
| Test count delta | 559 → 560 (+1 for new `setOverlay` onSelect assertion) |
| `git diff --stat` | 6 files, +58 / -21 |

## Files actually touched

```
apps/cli-solid/src/app.tsx                                     |  1 +
apps/cli-solid/src/commands/register-results.ts                | 10 +++----
apps/cli-solid/src/routes/results/results-screen.tsx           |  8 +++++
apps/cli-solid/tests/commands/register-results.test.ts         | 34 ++++++++++++++++++--
apps/cli-solid/tests/integration/app-wiring.test.ts            | 24 +++++++--------
apps/cli-solid/tests/integration/screen-command-isolation.test.ts |  2 +-
```

## What the change does

- `register-results.ts:66-74` — replaces the hidden `raw events` / `ctrl+o` stub with a visible `events` / `e` command that calls `setOverlay("rawEvents")`.
- `register-results.ts:5-8` — extends `RegisterResultsOptions` with `setOverlay`.
- `results-screen.tsx:12,207-211` — imports `RawEventsOverlay` and renders it under `<Show when={navigation.overlay() === "rawEvents"}>` with `executedPlan={props.report}` and `onClose={() => navigation.setOverlay(undefined)}`.
- `app.tsx:132` — passes `setOverlay: navigation.setOverlay` into `createResultsCommands`.
- Global esc predicate (`register-global.ts:42`) unchanged; engineer verified `overlay() === undefined` gate still holds.
- Three test files updated to supply the new `setOverlay` option. One new ratchet test asserts `setOverlay("rawEvents")` is invoked.

## Findings

### C-1 (none) — No critical issues.

### M-1 — Overlay does not shield Results keybinds while open (MAJOR)

**Evidence:** `command-registry.ts:101-113` iterates all registered commands keyed by `enabled`. `register-results.ts:19,29,39` gates Results commands on `isResultsScreen(options.currentScreen)` only. There is no overlay predicate. `app.tsx:142-149` calls `registry.handleKeyEvent` on every non-escape keypress.

**Consequence:** While the raw-events overlay is mounted:
- `y` → `handleCopy()` fires from under the overlay (results-screen.tsx:50).
- `s` → `handleSave()` kicks off a save flow (results-screen.tsx:65).
- `r` → `handleRestart()` calls `navigation.setScreen(...)` which navigates away from Results entirely (results-screen.tsx:80-86; `setScreen` also clears overlay at navigation.tsx:89-91, so the effect is "overlay + screen swap").
- `e` → re-fires `setOverlay("rawEvents")` (idempotent, but confirms stealing is real).

**Why this matters:** The overlay is positioned as a modal surface over the Results screen. Pressing `r` accidentally while scrolling events will silently yank the user back to port-picker. Pressing `s` will initiate a save mutation. Pressing `y` will mutate the clipboard. The spec for OV-1b scoped only the `esc` interaction, but introducing a visible overlay modal without input isolation is user-hostile — it is the same class of bug the spec flags for dialogs ("overlays should not steal from dialogs").

**Fix options (pick one):**
1. Gate Results commands on `overlay() === undefined` the same way `register-global.ts:42` gates `esc`. Extend `RegisterResultsOptions` with `overlay: () => ResultsOverlay | undefined`.
2. Make the overlay-open predicate a registry-level concept (overlay commands register themselves; other Results commands become disabled while any overlay is open).

Option 1 is the minimal, local fix and follows the pattern already established in `register-global.ts`.

### M-2 — Overlay also steals from an open dialog (MAJOR)

**Evidence:** `app.tsx:142-149` only intercepts `escape` for dialogs; any other key (including `e`) falls through to `registry.handleKeyEvent`. If a confirmation dialog is open on Results (e.g. future save-confirm), pressing `e` opens the overlay on top of the dialog. Conversely, pressing any of `y/s/r/e` with the overlay open and a dialog open hits both layers.

**Why this matters:** The spec explicitly calls out "overlays should not steal from dialogs." The current wiring does.

**Fix:** Same shape as M-1 — Results commands should be `enabled: isResults && overlay === undefined && dialog.isEmpty()`. Or the key-routing in `app.tsx` needs a short-circuit for "overlay active → skip registry unless key is owned by the overlay."

### m-1 (minor) — `executedPlan` is the entire `PerfReport`, not just the execution subset

`RawEventsOverlay` accepts `ExecutedPerfPlan`; `PerfReport extends ExecutedPerfPlan` (models.ts:1140), so `props.report` satisfies structurally. Not a bug, but passing the full report when only `events` are read is over-broad; if a future `RawEventsOverlay` rename narrows the prop, this breaks. Acceptable as-is.

### m-2 (minor) — `hidden` default flip is correct but undocumented in spec

The `raw-events` command flipped from `hidden: true` to default-visible. OV-4 needs this to surface `/events` in the modeline, so the flip is correct, but OV-1b's spec did not explicitly request it. Engineer called this out in the diary; acceptable.

## Scope discipline

- `app.tsx` touch is minimal (one line, one property) and strictly required to thread `setOverlay` from the provider to the command factory. Not scope creep.
- `register-results.ts` still has `insights` (keybind `i`, hidden) and `ask` (keybind `a`, hidden) as pre-existing HACK stubs. Engineer did NOT modify them. No OV-2b / OV-3c leakage.
- Tests: three files updated, all changes are strictly plumbing (`setOverlay: () => {}`) or correct assertion flips for the new visible state. No weakening of unrelated invariants.

## Rendering / wiring

- `<Show when={navigation.overlay() === "rawEvents"}>` is a top-level child of the screen's root `<box>` (results-screen.tsx:207). Underlying content still renders; overlay paints over via `OverlayContainer`'s positioning.
- `onClose` wiring: `() => navigation.setOverlay(undefined)` — correct, no self-pointer, no stale closure (navigation provider signal is stable).
- No additional overlays mounted (only `rawEvents` case). No OV-2b preview code.

## Global esc / predicate

- `register-global.ts:42` predicate re-read: `enabled: options.currentScreen()._tag !== "Main" && options.overlay() === undefined`. Confirmed unchanged; engineer verified correctly.
- With overlay open, `global.back` is disabled → `esc` falls through the registry → `RawEventsOverlay.useKeyboard` (raw-events-overlay.tsx:178-183) catches it and calls `onClose`. Single-dismiss, no double-fire.

## Code quality

| Check | Result |
|---|---|
| Nested `<text>` | None in touched files |
| `useMemo` / `useCallback` / `React.memo` | None (Solid's `createMemo` is fine) |
| Explanatory comments | None added |
| Barrel files | None created |
| Named exports only | Yes |

## Regression risks

- **Modeline**: `/events` now appears alongside `/restart /save /copy`. Not tight on typical terminal width; no evidence of overflow. Safe.
- **Test ratchet**: new test for `setOverlay("rawEvents")` is a proper additive ratchet, not a weakening.

## Verdict: REQUEST_CHANGES

The mechanical wiring is sound and the changes are tightly scoped, but M-1 and M-2 are blocking. The overlay is a modal surface, and modal surfaces must not let underlying-screen commands fire through them. The minimal fix is to add an `overlay: () => ResultsOverlay | undefined` option to `RegisterResultsOptions` and AND it into each command's `enabled` predicate, mirroring the pattern already in `register-global.ts:42`. Dialog interaction (M-2) should be handled at the same time.

Once M-1 + M-2 are fixed, re-run typecheck and `bun test`, extend the register-results test suite with two cases:
- "commands are disabled when overlay is active"
- "commands are disabled when a dialog is open" (if we go that route)

Then this passes.

---

## Round 2 Review

**Date:** 2026-04-17
**Reviewer:** ov1b-reviewer
**Verdict:** APPROVE

### Verification

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` | Clean, exit 0 |
| `cd apps/cli-solid && bun test` | 562 pass / 0 fail / 1088 expects |
| Test count delta | 560 → 562 (+2 for overlay-active and dialog-open disable tests) |
| `git diff --stat` | 6 files, +130 / -29 |

### M-1 fix audit — ✅ resolved

`register-results.ts:12-15` now defines a shared helper:

```ts
const isEnabled = (options: RegisterResultsOptions): boolean =>
  options.currentScreen()._tag === "Results" &&
  options.overlay() === undefined &&
  options.isDialogEmpty();
```

All 6 Results commands (`results.copy` line 23, `results.save` line 33, `results.restart` line 43, `results.ask` line 54, `results.insights` line 65, `results.raw-events` line 75) use `enabled: isEnabled(options)`. No bespoke predicates, no drift. Every command participates in the overlay/dialog gate uniformly.

**Self-disable verified:** when `setOverlay("rawEvents")` fires, `isEnabled()` returns false on the next `getCommands()` call, so `results.raw-events` itself flips to `enabled: false`. `handleKeyEvent` (command-registry.ts:106) skips disabled commands, so re-entry via `e` is structurally impossible — not merely idempotent.

### M-2 fix audit — ✅ resolved

`RegisterResultsOptions` (line 5-10) now takes `isDialogEmpty: () => boolean`. Wired in `app.tsx:132`: `isDialogEmpty: dialog.isEmpty`. `dialog.isEmpty` is a first-class API on `DialogStack` (`context/dialog.tsx:14,72`: `readonly isEmpty: () => boolean`), so we're not inventing a new contract.

When any dialog is on the stack, every Results command disables. `y`/`s`/`r`/`e` no longer fire through the dialog layer.

### New tests

Two new cases (register-results.test.ts:124-148):
- `"commands are disabled when overlay is active"` — iterates all 6 commands (`for (const cmd of commands)`), asserts every `cmd.enabled === false` with `overlay: () => "rawEvents"`.
- `"commands are disabled when a dialog is open"` — same iteration, with `isDialogEmpty: () => false`.

Both assert the full command set, not just one command. Tight coverage, not a drive-by.

The existing `no keybind collisions with global commands` test (line 200) passes `overlay: () => undefined` to `createGlobalCommands`, matching the updated global-command options signature. No weakening.

### Plumbing correctness

- `app.tsx:130-134` passes `overlay: navigation.overlay` and `isDialogEmpty: dialog.isEmpty` as signal/function references (not pre-invoked) — reactivity preserved because the command-registry factory re-invokes on each `getCommands()`.
- 3 test-file callsites in `app-wiring.test.ts` (24 changed lines) and `screen-command-isolation.test.ts` (7 changed lines) all pass consistent stubs. Spot-checked: no site mixes stub shapes.

### Residual minors

- m-1 (`executedPlan` over-broad): untouched. Acceptable.
- m-2 (`hidden` flip for `raw-events`): untouched. Needed for OV-4.

### Verdict: APPROVE

M-1 and M-2 are fully resolved via the correct fix (shared `isEnabled` helper, uniform predicate on all 6 commands, additive tests). No regressions, no scope creep, typecheck clean, 562/562 tests pass. Ready to merge.

