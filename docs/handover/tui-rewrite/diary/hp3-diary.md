# HP-3 Diary: Testing Screen (collapsed view + execution)

## Summary

Built the Testing screen for the Solid TUI. It triggers `executeFn` on mount, streams live `ExecutedPerfPlan` snapshots via `onUpdate`, renders a collapsed step list with tool call previews, handles cancel via dialog, and auto-navigates to Results on completion.

**Files created (4):**
- `apps/cli-solid/src/routes/testing/testing-screen.tsx` -- Testing screen with execution trigger, live streaming, step list, tool call rows, cancel dialog, error display
- `apps/cli-solid/src/commands/register-testing.ts` -- Command registration for Testing screen (esc cancel, ctrl+o expand stub)
- `apps/cli-solid/src/utils/format-elapsed-time.ts` -- Elapsed time formatter (pure reimplementation, no `pretty-ms` dep)
- `apps/cli-solid/src/utils/format-tool-call.ts` -- Tool call name/args formatter (ported from apps/cli, no `cli-truncate` dep)

**Files modified (2):**
- `apps/cli-solid/src/app.tsx` -- Added Match branch for Testing screen, registered testing commands
- `apps/cli-solid/src/constants.ts` -- Added testing constants (TESTING_TOOL_TEXT_CHAR_LIMIT, MAX_VISIBLE_TOOL_CALLS, etc.)

## Decisions

### ExecutedPerfPlan directly, NOT sync store

Per the task spec, we store `ExecutedPerfPlan` snapshots directly in a `createSignal` rather than converting to sync store events. The `executeFn` atom streams snapshots via `onUpdate` callback, and we pass `setExecutedPlan` directly. This matches the Ink TUI's approach and avoids the complexity of the sync reducer for MVP.

### No external deps for formatting

Instead of adding `pretty-ms` and `cli-truncate` to cli-solid's package.json, I wrote lightweight replacements:
- `formatElapsedTime` -- simple `Xm Ys` / `Xs` formatting
- `truncateText` in format-tool-call.ts -- string slice with ellipsis

This keeps cli-solid's dependency footprint small.

### atomFnToPromise for execution trigger

The execution is triggered via `atomFnToPromise(executeFn)(input)` which returns `Promise<Exit<ExecutionResult, E>>`. On success, we navigate to `Screen.Results`. On failure, we display the error and let esc go back to Main. The cleanup function calls `atomSet(executeFn, Atom.Interrupt)` to cancel on unmount.

### agentConfigOptionsAtom uses atomGet + atomSet

The `agentConfigOptionsAtom` is a basic `Atom.make` (not writable with functions), so we read the current value with `atomGet` and then write the merged result with `atomSet`.

### Keyboard handling in-screen via useKeyboard

Cancel dialog (esc -> confirm -> back) is handled inside the screen component via `useKeyboard`, matching the HP-2 pattern. The command registration has placeholder handlers.

### browserHeaded/cdpUrl/browserProfile not yet in Solid TUI

These preferences exist in the Ink TUI's zustand store but haven't been ported to the Solid agent context yet. For MVP, execution uses `isHeadless: true`, `cdpUrl: undefined`, `browserProfile: undefined`. A follow-up should add these to the agent context when browser preference UI is built.

## Handover notes for HP-4

- Testing screen auto-navigates to `Screen.Results({ report, videoUrl })` on success
- The Results screen will receive `report: PerfReport` and optional `videoUrl: string`
- The `screenOfTag` helper in app.tsx is already set up for the Results Match branch
- Testing screen handles its own esc (cancel dialog or error-back), so global back skips Testing (same as Watch)
- The `agentConfigOptionsAtom` import from `@neuve/perf-agent-cli/data/config-options` is already wired
