# P1 Diary: Command Registry + Main Menu Parity

## Summary

Implemented the unified `command.register(...)` pattern, keybind parser/printer, dialog stack, toast system, modeline, and Main menu screen layout for the Solid TUI rewrite.

**Files created:**

Context layer (pure logic):
- `apps/cli-solid/src/context/keybind.tsx` -- key parser (`match`) + human-readable printer (`print`), no leader-key v1
- `apps/cli-solid/src/context/command.tsx` -- `CommandProvider` with `register`, `trigger`, `handleKeyEvent`, `getVisibleCommands`; validates no duplicate keybinds on register
- `apps/cli-solid/src/context/dialog.tsx` -- `DialogProvider` with `push`, `replace`, `pop`, `clear`, `top`, `isEmpty`, `depth`
- `apps/cli-solid/src/context/toast.tsx` -- `ToastProvider` with `show(message, durationMs?)`, `current()`, auto-dismiss

Command registrations:
- `apps/cli-solid/src/commands/register-global.ts` -- `ctrl+l` (clear/repaint), `ctrl+u` (update stub), `esc` (dialog pop)
- `apps/cli-solid/src/commands/register-main.ts` -- `ctrl+k`, `ctrl+a`, `ctrl+p`, `ctrl+r`, `ctrl+f`, `ctrl+w`, `enter` stubs; gated on `isGitRepo()` and `hasRecentReports()` placeholder signals

Renderables:
- `apps/cli-solid/src/renderables/modeline.tsx` -- derived from command registry, no `HintSegment[]`
- `apps/cli-solid/src/renderables/ruled-box.tsx` -- port from Ink
- `apps/cli-solid/src/renderables/screen-heading.tsx` -- port from Ink
- `apps/cli-solid/src/renderables/hint-bar.tsx` -- reads from command registry
- `apps/cli-solid/src/renderables/spinner.tsx` -- Solid interval with `onCleanup`
- `apps/cli-solid/src/renderables/input.tsx` -- multiline text input with word-boundary nav, `@` trigger
- `apps/cli-solid/src/renderables/toast-display.tsx` -- renders active toast above modeline
- `apps/cli-solid/src/renderables/logo.tsx` -- updated to use hex color strings

Routes:
- `apps/cli-solid/src/routes/main/main-screen.tsx` -- Main menu layout with logo, banners, input, context chip
- `apps/cli-solid/src/routes/main/changes-banner.tsx` -- "Changes detected" banner (placeholder signals)
- `apps/cli-solid/src/routes/main/last-run-banner.tsx` -- "Last run" banner (placeholder signals)
- `apps/cli-solid/src/routes/main/context-picker.tsx` -- `@`-triggered context picker with placeholder data

App shell:
- `apps/cli-solid/src/app.tsx` -- wires providers, registers commands, handles esc/key routing
- `apps/cli-solid/src/constants.ts` -- hex color strings + spinner frames

Tests:
- `apps/cli-solid/tests/commands/register-main.test.ts` -- 25 tests covering registry validation, trigger behavior, keybind matching, printing
- `apps/cli-solid/tests/renderables/modeline.test.ts` -- asserts every visible modeline entry corresponds to a live enabled command

## Non-obvious decisions

**Colors as hex strings, not RGBA integers.** OpenTUI's `fg`/`bg` style properties accept `string | RGBA`. The P0 logo used raw integer hex values (e.g. `0xff5555ff`) which tsgo typed as `number`, causing TS2322 on the `style.fg` assignment. Switched all colors in `constants.ts` to hex strings (e.g. `"#ff5555"`). This is simpler and avoids importing `RGBA` from `@opentui/core` everywhere.

**Command registry is not a Solid store.** The registry is a plain class with `factories: Array<() => CommandDef[]>`. Commands are resolved by calling factories on demand (via `getCommands()`). This means Solid reactivity comes from the factory closures themselves reading Solid signals (e.g. `isGitRepo()` returns a signal value), not from the registry being reactive. This matches opencode's pattern where `command.register(() => [...])` is called once and the factory is re-evaluated each time commands are queried.

**Duplicate keybind validation happens at register time.** If two enabled commands share the same keybind, the registry throws immediately on `register()`. Disabled commands (`enabled: false`) are excluded from the collision check so that phase-gated commands can share keys across screens.

**Dialog stack `esc` handling in app.tsx, not inside dialog.tsx.** The `useKeyboard` in app.tsx checks `dialog.isEmpty()` before popping, and handles esc before delegating to the command registry. This matches the scope spec: "esc always pops the top. If stack is empty, esc is a no-op on Main."

**`renderer.requestRender()` for ctrl+l.** The CliRenderer does not expose a `clear()` method. `requestRender()` triggers a full redraw on the next frame, which achieves the same visual effect as clear-and-repaint.

**Input component uses `useKeyboard` from `@opentui/solid`.** Unlike the Ink version which used `useInput`, OpenTUI's `useKeyboard` receives `KeyEvent` objects with `.name`, `.ctrl`, `.meta`, `.shift`. The input handles word-boundary navigation (meta+b/f), line navigation in multiline mode, and fires `onAtTrigger` when `@` is typed on an empty input.

## Issues / blockers

**Pre-existing test failure in `@neuve/cookies`.** The `Chrome: extracted cookies have valid expiry timestamps` test fails because the Chrome Guest Profile returns 0 cookies. This is environment-specific and pre-dates all P1 changes.

**`bun:test` types.** tsgo did not find `bun:test` module declarations until `bun-types` was added to devDependencies and `"types": ["bun-types"]` was added to tsconfig.json.

## Verification

```
$ pnpm typecheck
 Tasks:    9 successful, 9 total

$ cd apps/cli-solid && bun test
 25 pass
 0 fail
 85 expect() calls
Ran 25 tests across 2 files. [74.00ms]

$ pnpm --filter @neuve/perf-agent-cli typecheck
> tsgo --noEmit
(clean exit)

$ grep -r 'from "react"\|from "ink"\|from "zustand"' apps/cli-solid/src/
(no matches)

$ grep -r 'useMemo\|useCallback\|React\.memo' apps/cli-solid/src/
(no matches)
```

## Patch round 1

Fixes for the 2 CRITICAL + 2 MAJOR findings from `reviews/P1-review.md`.

### CRITICAL #1 — `handleKeyEvent` skips hidden commands

**File:** `apps/cli-solid/src/context/command-registry.ts:108-123` (was `command.tsx:102`)

Removed the `if (command.hidden === true) continue;` line from `handleKeyEvent`. Hidden commands are hidden from `getVisibleCommands()` (modeline/palette display) only, not from key dispatch. Only `enabled === false` prevents key dispatch.

### CRITICAL #2 — Input `useKeyboard` collides with command registry

**Files:**
- `apps/cli-solid/src/context/input-focus.tsx` (new) — `InputFocusProvider` with `focused` signal + `setFocused`
- `apps/cli-solid/src/context/command-registry.ts:38-42` — `INPUT_TEXT_EDITING_KEYBINDS` set (`ctrl+a`, `ctrl+e`, `ctrl+w`); `handleKeyEvent` skips these when `inputFocused()` is true
- `apps/cli-solid/src/context/command.tsx:20-22` — `CommandProvider` accepts `inputFocused` prop
- `apps/cli-solid/src/renderables/input.tsx:66-68` — Input syncs its `focus` prop to the `InputFocusProvider` via `createEffect`
- `apps/cli-solid/src/app.tsx:5,62-70` — Wires `InputFocusProvider` → `AppInnerWithFocus` → `CommandProvider`

**Non-obvious decision:** Rather than making the Input call `event.preventDefault()` (which would require each input consumer to know about command conflicts), the command registry itself checks `inputFocused()` and skips only the specific text-editing keybinds. This keeps the Input component generic and the priority logic centralized. Non-text-editing `ctrl+` commands like `ctrl+k`, `ctrl+l`, `ctrl+f`, `ctrl+p`, `ctrl+r` still fire even when the input is focused.

### MAJOR #3 — `ctrl+l` should be `hidden: true`

**File:** `apps/cli-solid/src/commands/register-global.ts:16`

Changed `hidden: false` to `hidden: true` on the `global.clear` command. Per scope doc line 596: "hidden from modeline by default but discoverable via command palette." With CRITICAL #1 fixed, hidden commands still trigger via keybind, so `ctrl+l` works correctly while no longer consuming modeline real estate.

### MAJOR #4 — `enabled` reactivity is fragile

**File:** `apps/cli-solid/src/context/command-registry.ts:51-57`

Added a `HACK` comment documenting the factory reactivity contract: factories are a plain JS array, not a Solid signal. Reactivity works because factories are re-invoked on every `getCommands()` call and each factory closure reads Solid signals. Caching or memoizing the return value of `getCommands()` would break reactivity silently. The comment warns future developers.

### MINOR — Unused `onCleanup` import

**File:** `apps/cli-solid/src/routes/main/main-screen.tsx:1`

Removed unused `onCleanup` import from `solid-js`.

### Structural change: command-registry.ts extracted

Extracted pure logic (types, `CommandDef`, `CommandRegistry`, `createCommandRegistry`) from `command.tsx` into `command-registry.ts` (plain `.ts`, no JSX). This allows tests to import the registry without triggering the `@opentui/solid` JSX runtime, which fails to load in `bun:test`. The `.tsx` file re-exports everything and adds the JSX `CommandProvider`.

### Tests added

10 new tests (25 → 35 total, 101 expect calls):
- `hidden commands DO trigger via handleKeyEvent`
- `hidden commands do NOT appear in getVisibleCommands`
- `ctrl+l is hidden but still triggers via keybind`
- `enter (main.submit) is hidden but triggers via keybind`
- `ctrl+a is NOT dispatched when input is focused`
- `ctrl+a IS dispatched when input is NOT focused`
- `ctrl+w is NOT dispatched when input is focused`
- `ctrl+e is NOT dispatched when input is focused`
- `ctrl+k IS dispatched even when input is focused`
- `ctrl+l IS dispatched even when input is focused`

### Verification

```
$ pnpm typecheck
 Tasks:    9 successful, 9 total

$ cd apps/cli-solid && bun test
 35 pass
 0 fail
 101 expect() calls
Ran 35 tests across 2 files. [94.00ms]

$ pnpm --filter @neuve/perf-agent-cli typecheck
> tsgo --noEmit
(clean exit)

$ pnpm test
1 pre-existing failure in @neuve/cookies (Chrome Guest Profile, documented). No new failures.
```
