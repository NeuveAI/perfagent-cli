# HP-5 Diary: Integration Wiring + Per-Screen Commands + Smoke Test

## Summary

Verified the full end-to-end integration of HP-1 through HP-4 in the Solid TUI. Added 88 integration tests covering command isolation, app wiring, modeline correctness, and screen transition data threading. No bugs found in the existing wiring -- all screens, commands, and navigation paths work as designed.

**Files created (3):**
- `tests/integration/screen-command-isolation.test.ts` -- Verifies commands from one screen don't leak to another. Covers all 5 main screens, esc behavior, enter keybind isolation, y/s/r results-only keys, ctrl+a main-only key.
- `tests/integration/app-wiring.test.ts` -- Verifies all 6 command sets are registered with expected values, no duplicates, correct visibility per screen (modeline), Screen tagged union has all critical variants.
- `tests/integration/screen-transitions.test.ts` -- Verifies navigation state machine: Main->CookieSync, screenForTestingOrPortPicker routing, PortPicker->Testing, Testing->Results, full data threading chain.

## Findings

### Command isolation is correct
Every command set gates on `currentScreen()._tag === "X"`. When the screen changes, the command factories re-evaluate and return `enabled: false` for commands belonging to other screens. The registry's keybind validator runs on registration, not on every key press, but since disabled commands are skipped in `handleKeyEvent`, there are no accidental cross-screen firings.

### Enter keybind conflict between Main/CookieSync/PortPicker is cleanly resolved
Three command sets bind `enter`: `main.submit`, `cookie-sync.confirm`, and `port-picker.confirm`. Only one is `enabled: true` at any time (gated by screen tag), so the registry validator never sees a collision.

### Esc on Testing/Watch is a design choice, not a bug
`global.back` is technically `enabled: true` on Testing/Watch screens, but its `goBack` handler returns early without navigating (no-op). The Testing screen handles esc via its own `useKeyboard` for cancel-confirmation. Both handlers fire independently because `handleKeyEvent` does not call `preventDefault`. This works but relies on `goBack` being a safe no-op.

### Modeline correctness
- Main: shows cookies, agent, pick pr, saved flows, past runs, watch (6 visible commands)
- CookieSyncConfirm: empty modeline (both commands are hidden)
- PortPicker: empty modeline (both commands are hidden)
- Testing: empty modeline (all commands are hidden, cancel handled in-screen)
- Results: shows copy [y], save flow [s], restart [r] (3 visible commands; ask/insights/raw-events are hidden stubs)

### Data threading is complete
Props thread correctly through the full path: Main builds `ChangesFor` + instruction -> CookieSyncConfirm adds `cookieBrowserKeys` -> PortPicker adds `baseUrls` + `devServerHints` -> Testing receives all props and builds `ExecuteInput` -> Results receives `report` + `videoUrl`.

## Test counts

- Before: 418 tests, 25 files
- After: 506 tests, 28 files (+88 tests, +3 files)
- Type check: clean
- Build: clean
