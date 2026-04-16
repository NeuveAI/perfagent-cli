# Review: HP-1 — Screen Router + Navigation State

## Round 1 Verdict: REQUEST_CHANGES

### Verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — passes (no errors)
- `cd apps/cli-solid && bun test` — 296 tests pass, 0 failures
- Screen enum parity — all 10 variants match the Ink TUI exactly (field types included)
- `screenForTestingOrPortPicker` — identical logic to Ink TUI
- `detect-url.ts` — identical regex and function to Ink TUI
- Provider stack order — correct (NavigationProvider depends on nothing below it, CommandProvider above it consumes it)
- Import consistency — `import type` used correctly throughout
- Code style — no `as` casts in new code, no non-HACK comments, arrow functions only

### Findings

- [CRITICAL] Dead code in `global.back` dialog handling (`register-global.ts:43-49`) — The `!options.isDialogEmpty()` branch in `enabled` and the `options.popDialog()` path in `onSelect` can never execute. The `useKeyboard` handler in `app.tsx:79-83` intercepts esc when a dialog is open and returns early before the command registry sees the event. This creates a false contract that will mislead future engineers.

- [MAJOR] `goBack` does not clear plan execution state for Results screen (`app.tsx:30-33`) — The Ink TUI's `goBack` calls `setExecutedPlan(undefined)` before navigating away from the Results screen. The Solid TUI silently omits this, which will cause stale state when HP-4 wires the Results screen.

- [MINOR] Test coverage gap for esc-back on non-Main screen (`tests/commands/register-global.test.ts`) — No test verifies esc is enabled and calls `goBack` when on a non-Main screen (e.g., `Screen.SelectPr()`).

### Suggestions (non-blocking)

- The `goBack` function is defined at module scope in `app.tsx` rather than inside `AppInner`. Consider whether this should live in `navigation.tsx` as a method on the context value for co-location with the navigation state it operates on.
- The `Switch`/`Match` fallback renders `<text>Screen: {tag}</text>` for unimplemented screens. Track for removal before release.

---

## Round 2 Verdict: APPROVE

Commit `f0afc0cd` addresses all three findings.

### Re-verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — passes (no errors)
- `cd apps/cli-solid && bun test` — 295 tests pass, 0 failures (net -1: removed 3 dead dialog tests, added 2 navigation tests)
- No remaining references to `isDialogEmpty` or `popDialog` in any source or test file

### Finding resolutions

- [CRITICAL] **Fixed.** `RegisterGlobalOptions` no longer contains `popDialog` or `isDialogEmpty`. The `global.back` command's `enabled` is now `options.currentScreen()._tag !== "Main" && options.overlay() === undefined` — purely about screen-back navigation. `onSelect` simply calls `options.goBack()`. Separation of concerns is clean: `useKeyboard` in `app.tsx` owns dialog pop, `global.back` owns screen-back.

- [MAJOR] **Fixed.** HACK comment added at `app.tsx:33`: `// HACK: HP-4 must add plan execution cleanup here when Results screen is built`. The divergence from the Ink TUI source of truth is now explicitly documented and will not be silently missed.

- [MINOR] **Fixed.** New test `"esc is enabled and calls goBack on non-Main screen"` creates commands with `currentScreen: () => Screen.SelectPr()`, asserts `enabled` is `true`, invokes `onSelect`, and verifies `goBack` was called. Companion test `"esc is disabled on Main screen"` covers the inverse case.
