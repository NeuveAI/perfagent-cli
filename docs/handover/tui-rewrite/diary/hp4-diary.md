# HP-4 Diary: Minimal Results Screen

## Summary

Built the Results screen for the Solid TUI. It shows pass/fail status, CWV metrics table with color coding, step list with elapsed times, summary text, video URL, and a copy-summary callout box. Key actions: `y` copies report to clipboard, `s` saves flow, `r` restarts by navigating back through the flow, `esc` goes to Main.

**Files created (6):**
- `apps/cli-solid/src/routes/results/results-screen.tsx` -- Results screen with status header, step list, save/copy/restart actions, summary, video URL
- `apps/cli-solid/src/routes/results/metrics-table.tsx` -- CWV metrics table component with color-coded rows per URL
- `apps/cli-solid/src/commands/register-results.ts` -- Command registration for Results screen (y/s/r + stubs for a/i/ctrl+o)
- `apps/cli-solid/src/utils/copy-to-clipboard.ts` -- Clipboard utility using pbcopy (ported from Ink TUI)
- `apps/cli-solid/src/utils/step-elapsed.ts` -- Step elapsed time calculators (ported from Ink TUI)
- `tests/commands/register-results.test.ts` -- Command set, screen gating, keybind collision tests
- `tests/utils/step-elapsed.test.ts` -- Unit tests for getStepElapsedMs and getTotalElapsedMs
- `tests/utils/copy-to-clipboard.test.ts` -- Basic smoke tests for clipboard utility

**Files modified (1):**
- `apps/cli-solid/src/app.tsx` -- Added Match branch for Results screen, registered results commands, fixed goBack to clean up results actions (removed HACK comment)

## Decisions

### Module-level action refs for command -> screen communication

The Results screen registers its action handlers (copy, save, restart) via `setResultsActions()` when mounted, and the command registry reads them via `getResultsActions()`. This avoids threading callbacks through the entire component tree while keeping the command registry as the owner of key actions. The `clearResultsActions()` call in `goBack` ensures no stale handlers linger.

### Separate step-elapsed.ts from testing-helpers.ts

The Testing screen has its own `getStepElapsedMs` in `testing-helpers.ts` that returns the current wall time for in-progress steps (no endedAt). The Results screen only shows completed steps, so the simpler version in `utils/step-elapsed.ts` (ported from `apps/cli/src/utils/step-elapsed.ts`) is correct here -- it returns undefined when endedAt is missing.

### ctrl+o shared between Testing (expand) and Results (raw-events)

Both screens use `ctrl+o` but they're never active simultaneously since `enabled` is gated on `currentScreen()._tag`. The command registry's duplicate-keybind validation only fires for enabled commands, so there's no collision.

### bold on `<span>` not `<text>`

The `@opentui/solid` type definitions only allow `bold` in `<span style>`, not `<text style>`. All bold text is wrapped in `<span>` elements inside `<text>`.

### saveFlowFn imported from @neuve/perf-agent-cli

The `saveFlowFn` atom lives in `apps/cli/src/data/flow-storage-atom.ts`, exported as `@neuve/perf-agent-cli/data/flow-storage-atom`. The Solid TUI can import it directly since both TUIs share the same atom runtime.

## Handover notes for HP-5

- Results screen is wired end-to-end: Testing -> Results navigation works
- Commands are gated per-screen via `enabled: isResultsScreen()`
- The goBack handler cleans up results actions when leaving Results
- Overlay stubs (insights, raw-events, ask) are registered but do nothing
- The modeline should show results-specific commands (y/s/r) -- this is HP-5 work
- PR comment posting is not wired (no usePostPrComment equivalent in Solid TUI)
