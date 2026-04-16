# Review: HP-2 — Wire Submit + CookieSyncConfirm + PortPicker

## Round 1 Verdict: REQUEST_CHANGES

### Round 1 Verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — passes clean, zero errors
- `cd apps/cli-solid && bun test` — 295 tests pass, 460 assertions, 0 failures

### Round 1 Findings

- [MAJOR] PortPicker esc during custom URL entry navigates to Main instead of cancelling entry (`port-picker-screen.tsx:208-209`). When `isEnteringCustomUrl()` is true, the handler does `return` without calling `event.preventDefault()` or `event.stopPropagation()`. The app-level `useKeyboard` in `app.tsx:102-109` then processes the same esc event via `registry.handleKeyEvent`, which triggers `global.back` and navigates to `Screen.Main()`. The Ink TUI reference correctly intercepts esc inside custom URL mode at `apps/cli/src/components/screens/port-picker-screen.tsx:262-267` and cancels entry without navigating. Fix: handle esc explicitly in the port-picker `useKeyboard` when `isEnteringCustomUrl()` is true — reset the state and call `event.preventDefault()`.

- [MAJOR] Submit flow drops `cliBaseUrls` support (`main-screen.tsx:113-148`). The Ink TUI's submit at `apps/cli/src/components/screens/main-menu-screen.tsx:142-149` checks `cliBaseUrls` (CLI-provided base URLs) and passes them to `screenForTestingOrPortPicker`. The cli-solid `handleSubmit` has no equivalent. If the CLI is invoked with `--url` flags, those URLs will be silently ignored. This changes the navigation path: users who pass `--url` expect to skip the PortPicker and go directly to Testing.

- [MINOR] CookieSyncConfirm missing `ctrl+n` / `ctrl+p` navigation keybinds (`cookie-sync-confirm-screen.tsx:118-153`). The Ink TUI reference at `apps/cli/src/components/screens/cookie-sync-confirm-screen.tsx:91-95` supports `ctrl+n` for down and `ctrl+p` for up in addition to arrow keys and j/k. The cli-solid version only supports arrow keys and j/k. Not a functional break but a parity gap for users accustomed to Emacs-style navigation.

- [MINOR] PortPicker search functionality not ported (`port-picker-screen.tsx`). The Ink TUI port picker supports `/` to open a search bar with filtering (`apps/cli/src/components/screens/port-picker-screen.tsx:281-284`) and `isPortOrUrl` parsing for search-and-toggle. The cli-solid version has no search. With many detected ports this makes the list harder to navigate. Acceptable to defer if documented.

- [MINOR] PortPicker does not refetch listening ports on interval. The Ink TUI uses `useListeningPorts` with `refetchInterval: LISTENING_PORTS_REFETCH_INTERVAL_MS` (5s) via TanStack Query (`apps/cli/src/hooks/use-listening-ports.ts:221-225`). The cli-solid version uses `createResource(detectListeningPorts)` which fetches once. If the user starts their dev server after navigating to PortPicker, it won't appear without navigating back and forward.

- [INFO] `screenOfTag` cast in `app.tsx:32` — `return screen as Extract<Screen, { _tag: T }>` is sound because it's guarded by `screen._tag === tag` on line 32. The narrowing is correct; TypeScript just can't infer it through the accessor indirection. Acceptable use of `as`.

- [INFO] Command registrations with no-op `onSelect` handlers (`register-cookie-sync.ts`, `register-port-picker.ts`) are correctly documented with `// HACK:` comments explaining that actual handling lives in `useKeyboard` inside each screen component. The `enabled` gating on `currentScreen()._tag` is reactive because command factories are re-invoked on every `getCommands()` call (per the HACK comment in `command-registry.ts:44-49`).

- [INFO] `detect-listening-ports.ts` and `detect-projects.ts` are faithful ports of the Ink TUI originals. Port detection logic (lsof parsing, process resolution, framework patterns, TLS probing, ephemeral port filtering) matches line-for-line. Project detection logic (workspace patterns, scanning, sibling detection) also matches. The only structural change is that `LOCK_FILE_TO_MANAGER` is defined locally in the cli-solid version instead of imported from constants, which is fine since it's only used in one place.

### Round 1 Suggestions (non-blocking)

- Consider extracting the `fetchInstalledBrowsers` Effect program in `cookie-sync-confirm-screen.tsx:19-50` into a separate utility file (e.g. `utils/detect-browsers.ts`) to match the pattern used for `detect-listening-ports.ts` and `detect-projects.ts`. Currently the screen component mixes data fetching logic with UI rendering.

- The `normalizeCustomUrl` function in `port-picker-screen.tsx:39-51` is a standalone pure function that could benefit from unit tests, especially the edge cases around bare port numbers inheriting protocol from matching entries.

---

## Round 2 Verdict: APPROVE

### Round 2 Verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — passes clean, zero errors
- `cd apps/cli-solid && bun test` — 295 tests pass, 460 assertions, 0 failures

### Round 2 Patches

**`392c4040` — fix(cli-solid): handle esc during custom URL entry in PortPicker**

Fix at `port-picker-screen.tsx:209-214`: when `isEnteringCustomUrl()` is true and esc is pressed, the handler now resets state (`setIsEnteringCustomUrl(false)`, `setCustomUrlValue("")`) and calls `event.preventDefault()` to stop the event from propagating to the app-level `useKeyboard` handler. This matches the Ink TUI behavior at `apps/cli/src/components/screens/port-picker-screen.tsx:262-266`. The `preventDefault()` call is necessary in @opentui/solid because unlike Ink's `useInput`, multiple `useKeyboard` handlers all receive the same event unless explicitly stopped. Verified correct.

**`2daee5fc` — feat(cli-solid): add --url CLI flag to skip port picker**

Full data flow verified:
1. `tui.ts:13-16` — Commander parses `-u, --url <urls...>` flag
2. `tui.ts:21` — Passes `urls: options.url` to `App()`
3. `app.tsx:134,144` — `AppProps.urls` threaded to `<ProjectProvider cliBaseUrls={props.urls}>`
4. `project.tsx:69,74-75` — `ProjectProvider` stores in `createSignal`, exposes `cliBaseUrls` accessor and `clearCliBaseUrls`
5. `main-screen.tsx:137-146` — `handleSubmit` reads `project.cliBaseUrls()`, clears immediately via `project.clearCliBaseUrls()`, then passes `baseUrls: cliUrls ? [...cliUrls] : undefined` to `screenForTestingOrPortPicker`

This faithfully ports the Ink TUI's pattern: read once, clear immediately, pass to navigation. The Ink version uses Zustand store + `useRef` for the "read once" semantic; the cli-solid version uses a Solid signal + `clearCliBaseUrls()`, which is the idiomatic equivalent. The conditional at line 140 (`cookieKeys.length > 0 || containsUrl(trimmed) || cliUrls`) exactly matches the Ink TUI's condition at `main-menu-screen.tsx:142`.

### Round 2 Assessment

Both MAJOR findings from Round 1 are resolved. The 3 MINOR findings (ctrl+n/p keybinds, search, refetch interval) remain but are non-blocking parity gaps acceptable to defer. No new issues introduced by the patches.
