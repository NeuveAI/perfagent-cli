# Review: LC-2b — Wire Shutdown into TUI + q to Quit

## Verdict: APPROVE

### Round 2 (re-review after patches)

Both blocking issues from round 1 have been resolved:

1. **CRITICAL (fixed)**: Quit keybind changed from `q` to `ctrl+q` (register-global.ts:50). Modifier combo does not conflict with text input. No single-char keybind collision risk remains.
2. **MINOR (fixed)**: `onCleanup` in runtime.tsx:56-61 now checks `isShuttingDown()` and bails early if shutdown is already running. This prevents double-dispose: the shutdown controller handles disposal via its cleanup handler, and `onCleanup` only disposes when the component unmounts for a non-shutdown reason.
3. **MAJOR (withdrawn)**: Out-of-scope file modifications were LC-1b's uncommitted changes on the same working tree, not part of LC-2b's diff.

### Checklist results (round 2)

1. tsc --noEmit: PASS (zero errors)
2. Signal handler timing: PASS — `installSignalHandlers()` at tui.ts:9, before `render()` at tui.ts:11
3. exitOnCtrlC: PASS — `false` at tui.ts:14
4. Double-dispose prevention: PASS — `isShuttingDown()` guard at runtime.tsx:58
5. Quit keybind gating: PASS — `ctrl+q` avoids single-char input conflict
6. ctrl+c command: PASS — `hidden: true` at register-global.ts:62, `enabled: true` at line 63
7. void initiateShutdown(): PASS — correct use of `void` in synchronous callbacks
8. No files outside scope: PASS (LC-1b changes are separate)
9. Code style: PASS — arrow functions, no casts, existing comments unchanged
10. Import paths: PASS — `../lifecycle/shutdown` used consistently, `isShuttingDown` added to import at runtime.tsx:8

### Suggestions (non-blocking)

- The `ctrl+q` quit command is not `hidden`, so it appears in the modeline. This seems intentional (user discovers the quit affordance), but confirm this is the desired UX since it consumes modeline space on a screen where the user's primary action is typing.

---

### Round 1 (original review — kept for history)

**Verdict: REQUEST_CHANGES**

- [CRITICAL] `q` keybind fires even when the text input is focused on Main screen (register-global.ts:52, command-registry.ts:101-113). The `handleKeyEvent` function only skips `INPUT_TEXT_EDITING_KEYBINDS` (ctrl+a, ctrl+e, ctrl+w) when `inputFocused` is true — it does NOT skip single-character keybinds. Typing "q" in the instruction input quits the application.

- [MAJOR] Out-of-scope files modified (register-testing.ts, testing-screen.tsx). Later withdrawn — these were LC-1b's uncommitted changes.

- [MINOR] Potential double-dispose race in runtime.tsx:51-59 when `onCleanup` fires during shutdown iteration.
