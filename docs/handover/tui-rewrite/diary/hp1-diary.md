# HP-1 Diary: Screen Router + Navigation State

## Summary

Added screen routing to the Solid TUI so it can navigate between screens, replacing the hardcoded `<MainScreen />` with a `Switch`/`Match` router driven by navigation state.

**Files created (2):**
- `apps/cli-solid/src/context/navigation.tsx` — `NavigationProvider` with `createSignal`-based state, `Screen` tagged enum (10 variants matching Ink TUI), `screenForTestingOrPortPicker` helper, `ResultsOverlay` type
- `apps/cli-solid/src/utils/detect-url.ts` — `containsUrl` utility (ported from `apps/cli/src/utils/detect-url.ts`)

**Files modified (5):**
- `apps/cli-solid/src/app.tsx` — Added `NavigationProvider` to provider stack (after Sync, before Toast), replaced `<MainScreen />` with `Switch`/`Match` router, added `goBack` function for esc-back navigation
- `apps/cli-solid/src/commands/register-global.ts` — Extended `RegisterGlobalOptions` with `goBack`, `currentScreen`, `overlay`; esc command now handles both dialog pop and screen-back navigation
- `apps/cli-solid/src/commands/register-main.ts` — Added `currentScreen` to options; all main commands gated with `isMainScreen()` check so they don't fire on other screens
- `apps/cli-solid/tests/commands/register-global.test.ts` — Updated test helper to supply new navigation options
- `apps/cli-solid/tests/commands/register-main.test.ts` — Updated all `createMainCommands`/`createGlobalCommands` calls with navigation options
- `apps/cli-solid/tests/renderables/modeline.test.ts` — Updated all command factory calls with navigation options

## Decisions

### goBack as a pure function outside AppInner

Made `goBack` a standalone function that takes `screen` and `setScreen` as arguments rather than closing over navigation context. This keeps the logic testable and avoids coupling to the component tree. Testing/Watch screens are excluded from back-navigation (they have their own cancel dialogs).

### Esc handler unified in command registry

Rather than having esc handling split between the keyboard callback and commands, the global `esc` command now handles both dialog-pop and screen-back in a single `onSelect`. The `enabled` check covers both cases: `!isDialogEmpty() || (notMain && noOverlay)`. This avoids the keybind collision that would occur if esc were registered as two separate commands.

### Main commands gated via currentScreen accessor

Each main command's `enabled` field reads `currentScreen()._tag === "Main"` reactively. Because command factories are re-invoked on every `getCommands()` call (per the HACK comment in command-registry.ts), the signal read is tracked transitively in reactive scopes.

## Handover notes for HP-2

- `NavigationProvider` is in the provider stack. Use `useNavigation()` to get `navigateTo`, `setScreen`, `currentScreen`.
- `Screen.CookieSyncConfirm(...)` and `Screen.PortPicker(...)` are ready to use.
- `screenForTestingOrPortPicker` helper is exported from `context/navigation.tsx`.
- The `Switch`/`Match` in `app.tsx` currently shows `<text>Screen: {tag}</text>` for all non-Main screens. HP-2 should add `Match` branches for CookieSyncConfirm and PortPicker.
- Main commands are already gated to Main screen, so new screen-specific command registrations won't collide.
