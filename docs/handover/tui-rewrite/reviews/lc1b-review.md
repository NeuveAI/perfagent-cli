# Review: LC-1b — Error Display Component + Retry Action

## Verdict: APPROVE

### Findings

No critical or major issues found.

- [Minor] Dead signal resets before navigation (`testing-screen.tsx:153-157`) — The retry handler resets all five signals (`setExecutionError`, `setExecutedPlan`, `setIsExecuting`, `setRunStartedAt`, `setElapsedTimeMs`) and then immediately calls `navigation.setScreen(Screen.Testing({...}))`. Because `Data.taggedEnum` produces a new object reference each call, Solid's keyed `<Match>` callback will unmount the old `TestingScreen` and mount a fresh one. The signal resets execute against the about-to-be-destroyed instance and have no observable effect. Harmless but unnecessary — the `setScreen` call alone is sufficient.

- [Minor] Duplicate `CROSS` constant (`error-display.tsx:5`, `testing-screen.tsx:37`) — The unicode cross glyph `\u2718` is defined in both files. Not a bug, but a minor duplication. Could be extracted to `constants.ts` alongside the other shared glyphs. Non-blocking since the testing screen uses it for step status (a different concern from error display).

### Checklist results

1. **tsc**: `bunx tsc --noEmit` passes cleanly with zero errors.
2. **ErrorDisplay component**: Correctly renders title (red), message (dim), and hint (yellow, conditional). `<Show>` uses the callback form `{(hint) => ...}` for proper type narrowing. Component is clean and minimal.
3. **Signal type change**: `executionError` signal changed from `string | undefined` to `ParsedError | undefined`. Correct.
4. **parseExecutionError usage**: `exit.cause` from the `Exit.failCause(result.cause)` path in `atomFnToPromise` is `Cause.Cause<E>`, which is assignable to `parseExecutionError`'s parameter type `Cause.Cause<unknown>`. Correct.
5. **Retry handler**: Pressing `r` in error state calls `navigation.setScreen(Screen.Testing({...}))` with a new object reference, causing Solid's keyed Match to unmount/remount TestingScreen. The fresh mount re-runs the `createEffect` which starts execution. The old instance's `onCleanup` fires `atomSet(executeFn, Atom.Interrupt)`, properly cancelling the previous run. Correct.
6. **Props spreading on retry**: Readonly array props (`cookieBrowserKeys`, `baseUrls`, `devServerHints`) are spread with `[...arr]` to avoid reference sharing. Correct.
7. **Escape still works**: `escape` in error state calls `goToMain()` (line 170-172). Correct.
8. **Register-testing.ts**: Retry command entry added with `hidden: true`, `keybind: "r"`, gated by `isTestingScreen`. The `onSelect` body is a HACK stub (actual handling is in-screen via `useKeyboard`), consistent with the existing `testing.cancel` pattern. Correct.
9. **No files outside scope**: The three LC-1b files are the only ones changed by this task. Other modified files (`register-global.ts`, `tui.ts`, `runtime.tsx`) contain LC-2b changes, which is a separate completed task sharing the same working tree. `parse-execution-error.ts` (LC-1a) is unchanged.
10. **Code style**: Arrow functions only, no comments except HACK, no type casts, kebab-case filenames. Compliant.
11. **ErrorDisplay import**: Correctly imported at `testing-screen.tsx:21`.

### Suggestions (non-blocking)

- Remove the five signal resets in the retry handler (lines 153-157) since the component unmounts immediately after `setScreen`. The code is not wrong but reads as if the resets are load-bearing when they are not.
- Consider extracting shared unicode glyphs (`CROSS`, `TICK`, `CIRCLE`, etc.) to `constants.ts` to avoid duplication across components. This would be a separate cleanup task.
