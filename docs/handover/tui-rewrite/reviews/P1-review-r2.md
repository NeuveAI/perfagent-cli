# Review: TUI-P1 — Command registry + Main menu parity (Round 2)

## Verdict: APPROVE

All four Round 1 findings are resolved. No new Critical or Major findings. All mandatory verification passes.

### Verification executed

- `pnpm typecheck` -> PASS (9/9 packages green, all cache hits)
- `bun test` in `apps/cli-solid/` -> PASS (35 tests, 101 expect calls, 0 failures)
- `pnpm --filter @neuve/perf-agent-cli typecheck` -> PASS (existing CLI unaffected)
- `pnpm --filter cli-solid build` -> PASS (produces `dist/tui.js`)
- `pnpm test` (repo-wide) -> 1 pre-existing failure in `@neuve/cookies` (Chrome Guest Profile returns 0 cookies, environment-specific, documented in diary). No new failures. `@neuve/shared`: 10 test files, 113 tests passed.
- Pattern compliance:
  - `grep "react|React|ink|Ink" apps/cli-solid/src/` -> 3 hits, all in HACK comment discussing "reactivity", zero actual React/Ink imports
  - `grep "useMemo|useCallback|React\.memo" apps/cli-solid/src/` -> zero hits
  - `grep "\bnull\b" apps/cli-solid/src/` -> zero hits
  - `grep "\bas " apps/cli-solid/src/` -> 4 hits: `import * as` namespace imports (2), `as const` (1), `import * as keybind` (1). Zero type casts.
  - Kebab-case filenames -> all 23 source files verified compliant
  - No barrel files -> `grep "index.ts" apps/cli-solid/src/` -> zero hits

### Resolution of Round 1 findings

**CRITICAL #1 — Hidden commands now trigger via keybind** -> RESOLVED

Evidence: `command-registry.ts:101-112` — the `handleKeyEvent` function iterates commands and only skips on `enabled === false` (line 106) or input-focus text-editing key (line 107). There is no `hidden` check gating key dispatch. The old `if (command.hidden === true) continue;` line is gone.

Test coverage: `register-main.test.ts:280-302` ("hidden commands DO trigger via handleKeyEvent") registers a hidden command with keybind `ctrl+u`, simulates the key event, and asserts both `handled === true` and the `onSelect` callback fired. Additional tests at lines 323-372 verify `ctrl+l` (hidden global.clear) and `enter` (hidden main.submit) both trigger via keybind while being absent from `getVisibleCommands()`.

**CRITICAL #2 — Input focus prevents command collision** -> RESOLVED

Evidence chain:
1. `input-focus.tsx` — clean Solid context with `createSignal(false)` (line 23). No race condition: `setFocused` is called synchronously from `createEffect` in the Input component.
2. `input.tsx:68-69` — Input syncs its `focus` prop to the InputFocusProvider via `createEffect(() => { inputFocus.setFocused(focus()); })`.
3. `command-registry.ts:34` — `INPUT_TEXT_EDITING_KEYBINDS = new Set(["ctrl+a", "ctrl+e", "ctrl+w"])`. These are exactly the Emacs text-editing keys that collide with registered commands.
4. `command-registry.ts:102,107` — `handleKeyEvent` reads `options.inputFocused()` and skips text-editing keys when input is focused. Non-text-editing ctrl keys (`ctrl+k`, `ctrl+l`, `ctrl+f`, `ctrl+p`, `ctrl+r`) are NOT in the skip set and fire normally even with input focused.
5. `app.tsx:60-70` — Provider wiring order: `ToastProvider` > `DialogProvider` > `InputFocusProvider` > `AppInnerWithFocus` > `CommandProvider(inputFocused=...)` > `AppInner`. `InputFocusProvider` is above `CommandProvider`, which is correct.
6. `app.tsx:72-79` — `AppInnerWithFocus` bridges the two contexts: reads `useInputFocus().focused` and passes it as a prop to `CommandProvider`.

Test coverage (lines 375-515):
- `ctrl+a` NOT dispatched when input focused (line 376)
- `ctrl+a` IS dispatched when input NOT focused (line 400)
- `ctrl+w` NOT dispatched when input focused (line 424)
- `ctrl+e` NOT dispatched when input focused (line 447)
- `ctrl+k` IS dispatched even when input focused (line 470)
- `ctrl+l` IS dispatched even when input focused (line 493)

**MAJOR #3 — `ctrl+l` is hidden** -> RESOLVED

Evidence: `register-global.ts:16` — `hidden: true` on the `global.clear` command. Combined with CRITICAL #1 fix, `ctrl+l` is hidden from modeline but still triggers via keybind. Test at `register-main.test.ts:323-348` verifies all three conditions: `hidden === true`, not in `getVisibleCommands()`, and keybind dispatch works.

**MAJOR #4 — Reactivity documented** -> RESOLVED

Evidence: `command-registry.ts:44-49` — HACK comment present:
```
// HACK: factories is a plain JS array, not a Solid signal. Reactivity works because
// factories are re-invoked on every getCommands() call, and each factory closure reads
// Solid signals (e.g. isGitRepo(), isDialogEmpty()). This means Solid tracks signal
// reads transitively when getCommands() is called inside a reactive scope (like JSX).
// Do NOT cache or memoize the return value of getCommands() — it would break reactivity.
// Factories MUST be pure functions that read Solid signals on each call.
```

The contract is clear: factories are re-invoked on every call, must be pure, must not be cached. This is a reasonable interim documentation strategy for P1; the suggestion from Round 1 to make `enabled` accept `() => boolean` remains valid for a future phase but is non-blocking.

### New findings (Round 2)

**[MINOR] `register-global.ts:39` — `enabled: !options.isDialogEmpty()` is eagerly evaluated**

The `enabled` field for `global.back` (esc) is `!options.isDialogEmpty()`. This boolean is evaluated when the factory closure runs. Because factories are re-invoked on every `getCommands()` call, this works correctly — the value is always fresh. However, the pattern is subtly different from how other commands declare `enabled` (they use literal `true`/`false`). This is the same pattern flagged in Round 1's MAJOR #4, and the HACK comment now covers it. Not blocking.

**[MINOR] `modeline.tsx:31` — `command.keybind!` non-null assertion inside `<Show when={command.keybind}>`**

Inside the `<Show when={command.keybind}>` guard, `command.keybind!` uses a non-null assertion. This is safe because the `<Show>` gate ensures the value is truthy, but the `!` assertion is a minor style concern. Solid's `<Show>` with a `keyed` prop and callback could eliminate it, but this is cosmetic.

**[MINOR] `register-main.test.ts:21` — `as unknown as KeyEvent` double cast persists from Round 1**

This was flagged as MINOR in Round 1 and was not addressed. Still minor — test files have more latitude, and the mock shape is close enough to the real `KeyEvent` type.

**[INFO] Input component does not call `event.preventDefault()` on handled keys**

The Input component (`input.tsx:72-186`) handles keys like `ctrl+a`, `ctrl+w`, `ctrl+e` but does not call `event.preventDefault()`. This is acceptable because the command registry now handles deconfliction via the `inputFocused` check. However, if a future phase adds a second `useKeyboard` consumer that also handles these keys, the lack of `preventDefault()` could cause double-handling. The current architecture is safe.

**[INFO] `app.tsx:40-47` — esc handling is duplicated between app-level `useKeyboard` and the command registry**

The `esc` key is handled in two places: `app.tsx:41-44` checks `dialog.isEmpty()` and pops, AND `register-global.ts:33-45` registers `global.back` with `keybind: "esc"`. In practice, the `app.tsx` handler fires first and calls `event.preventDefault()`, so the registry never sees the esc event when a dialog is open. When no dialog is open, `global.back` is disabled (`enabled: !options.isDialogEmpty()` evaluates to `false`), so the registry also does nothing. The dual handling is redundant but not broken — esc is correctly handled in all states.

### Suggestions (non-blocking)

- Consider making `enabled` accept `boolean | (() => boolean)` in a future phase. This would make the reactive intent explicit rather than relying on factory re-invocation. The HACK comment is a fine interim solution.
- The `as unknown as KeyEvent` in tests could be replaced with a proper builder that satisfies the full interface, avoiding drift between the mock and real types.
- The esc handling duplication between `app.tsx` and `register-global.ts` could be consolidated. The dialog pop logic could live exclusively in the registry's `global.back` command, removing the `app.tsx:41-44` special case. This would be cleaner but is not necessary for P1.
