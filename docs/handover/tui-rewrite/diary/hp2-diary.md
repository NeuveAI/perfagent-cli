# HP-2 Diary: Wire Submit + CookieSyncConfirm + PortPicker

## Summary

Wired the submit flow so the user can go from Main -> CookieSyncConfirm -> PortPicker -> Testing. The Testing screen itself is HP-3 -- this work just navigates TO it.

**Files created (6):**
- `apps/cli-solid/src/routes/cookie-sync-confirm/cookie-sync-confirm-screen.tsx` -- CookieSyncConfirm screen with browser detection, multi-select, and forward navigation
- `apps/cli-solid/src/routes/port-picker/port-picker-screen.tsx` -- PortPicker screen with listening port detection, project detection, custom URL entry, and skip
- `apps/cli-solid/src/commands/register-cookie-sync.ts` -- Command registration for CookieSync screen (placeholder commands for keybind reservation)
- `apps/cli-solid/src/commands/register-port-picker.ts` -- Command registration for PortPicker screen (placeholder commands for keybind reservation)
- `apps/cli-solid/src/utils/detect-listening-ports.ts` -- Port detection via lsof + TLS probing (ported from apps/cli/src/hooks/use-listening-ports.ts)
- `apps/cli-solid/src/utils/detect-projects.ts` -- Nearby project detection via package.json scanning (ported from apps/cli/src/utils/detect-projects.ts)

**Files modified (4):**
- `apps/cli-solid/src/routes/main/main-screen.tsx` -- Wired handleSubmit to build ChangesFor and navigate to CookieSyncConfirm or PortPicker/Testing
- `apps/cli-solid/src/commands/register-main.ts` -- Changed main.submit onSelect to no-op (actual submit handled by Input.onSubmit)
- `apps/cli-solid/src/app.tsx` -- Added Match branches for CookieSyncConfirm and PortPicker, registered new command sets, added screenOfTag helper
- `apps/cli-solid/src/constants.ts` -- Added port picker constants (PORT_PICKER_VISIBLE_COUNT, MIN_USER_PORT, etc.)

## Decisions

### Keyboard handling in screen components via useKeyboard

Rather than routing all keyboard events through the command registry, screen-specific keyboard handling (up/down navigation, space toggle, enter confirm) uses `useKeyboard` directly inside the screen component. This matches the Ink TUI pattern where `useInput` handles screen-local keys. The command registry is used for modeline display commands and global commands (like esc-to-back).

The `enter` keybind is registered in both the command files (cookie-sync, port-picker) and the screen's `useKeyboard`. The command's `onSelect` is a no-op -- the actual handler runs in the screen component. This avoids the need to expose screen state to the command factory. When screen-specific commands are disabled (screen != current), the keybind doesn't collide with other screen's commands.

### Browser detection runs Effect from outside Effect context

The browser detection in CookieSyncConfirmScreen uses `Effect.runPromise` to run the Effect program (same approach as the Ink TUI's `useInstalledBrowsers`). This is wrapped in Solid's `createResource` for async loading state management. The Effect program provides `layerLive` and `NodeServices.layer` inline.

### Port detection and project detection ported as standalone utils

`detectListeningPorts` and `detectNearbyProjects` were ported from `apps/cli/` into `apps/cli-solid/src/utils/` as standalone async/sync functions. They use `createResource` for the async boundary in the Solid component. These could eventually be extracted to a shared package, but for MVP they're duplicated to avoid coupling changes.

### No esc handling inside PortPicker custom URL entry

In the Ink TUI, pressing esc during custom URL entry cancels the entry (but stays on PortPicker). In the Solid TUI, the global back command fires before component-level keyboard handlers (due to @opentui/solid's priority system where global handlers fire before renderable handlers). For MVP, esc during custom URL entry navigates back to Main. The user can press enter with empty input to cancel the custom URL entry instead.

### screenOfTag helper for type-safe Match branches

Added a `screenOfTag` helper function in app.tsx that narrows the Screen tagged union based on the `_tag` field, returning the specific variant or undefined. This avoids `as` type casts in the Match branches while keeping the JSX clean with `{(screen) => <Component {...screen()} />}`.

## Handover notes for HP-3

- Submit flow works: Main -> CookieSyncConfirm -> PortPicker -> Testing (navigates to Screen.Testing)
- The Testing screen will receive props via `Screen.Testing({ changesFor, instruction, savedFlow, cookieBrowserKeys, baseUrls, devServerHints })`
- The `screenOfTag` helper in app.tsx can be reused for the Testing and Results Match branches
- The port picker saves `lastBaseUrl` to kv preferences on confirm
- Cookie browser keys are saved to kv preferences on CookieSyncConfirm confirm
- Global back (esc) handles going back from CookieSyncConfirm and PortPicker to Main
- Testing and Watch screens are excluded from back navigation in `goBack` (they need cancel dialogs)
- Command registrations for cookie-sync and port-picker are already in app.tsx
