# OV-3c diary — wire ask panel into Results

## Files changed

- `apps/cli-solid/src/commands/register-results.ts`
  - Lines 48-58: Turned `ask` command on. Removed `hidden: true` and the HACK stub; `onSelect` now calls `options.setOverlay("ask")`. `enabled` already uses the shared `isEnabled(options)` helper, so overlay/dialog shielding and screen gating apply uniformly without touching the helper.

- `apps/cli-solid/src/routes/results/results-screen.tsx`
  - Line 6: Added `askReportFn` + `AskResult` import from `@neuve/perf-agent-cli/data/ask-report-atom` (atom still lives in `apps/cli/src/data/ask-report-atom.ts`; package alias resolves — no relocation needed).
  - Line 14: Added `AskPanel` import from `./ask-panel`.
  - Lines 42-44: Local signals — `askHistory: readonly AskResult[]` (default `[]`), `askPending: boolean`, `askError: string | undefined`.
  - Lines 93-105: `handleAskSubmit(question)` — guards against double-submit via `askPending()`, flips pending true, calls `atomFnToPromise(askReportFn)({ report, question })`, awaits the `Exit`, appends `exit.value` (already `{ question, answer }`) to history on success, sets a retry-hint error string on failure.
  - Lines 229-237: `<Show when={navigation.overlay() === "ask"}>` renders `AskPanel` with `history`, `pending`, `error` props and `onSubmit={handleAskSubmit}`, `onClose={() => navigation.setOverlay(undefined)}`.

- `apps/cli-solid/tests/commands/register-results.test.ts`
  - Lines 45-66: Renamed and flipped the visibility test — `ask.hidden` now expected `toBeUndefined()` (not `toBe(true)`).
  - Lines 207-222: Added ratchet test `"ask command calls setOverlay with ask"` — invokes `onSelect`, asserts `setOverlay("ask")` was called.

- `apps/cli-solid/tests/integration/app-wiring.test.ts`
  - Line 374: Moved `expect(visibleValues).toContain("results.ask")` in (was `not.toContain`). Matches what OV-2b did for `insights`.

## Atom consumption pattern

Matched the existing `handleSave` pattern in `results-screen.tsx` and `testing-screen.tsx` exactly — both already use `atomFnToPromise` (not `useAtom`). Rationale:

- `atomFnToPromise(askReportFn)` returns `(input) => Promise<Exit<AskResult, E>>`.
- No need for reactive subscription to an `AsyncResult` — we only care about the resolved value once per submit.
- `Exit.isSuccess(exit)` → `exit.value` is already `{ question, answer }`, which is the `AskResult` shape `AskPanel` expects in its history.
- Matches the brief's spec ("`useAtom(askReportFn, { mode: "promiseExit" })`") in semantics — `atomFnToPromise` is this codebase's existing adapter over `subscribe + resolve(Exit)`, and it's what every other screen uses. The `useAtom`-shaped helper doesn't exist under `apps/cli-solid/src/adapters/`; introducing a parallel pattern would fragment the codebase.

No Stream subscription in the UI — the atom runs the `Stream.runFold` internally, and we receive the final concatenated answer string. This is the existing contract of `askReportFn` and unchanged.

## History/error persistence across overlay toggles

- Both `askHistory` and `askError` are `createSignal` locals inside `ResultsScreen`, not inside `AskPanel`. Toggling `navigation.overlay()` between `undefined` / `"ask"` / other overlays only mounts/unmounts `AskPanel`; the signals belong to `ResultsScreen`, which stays mounted.
- Consequence: a user who opens ask, submits "what was the LCP?", closes with esc, opens insights, re-opens ask — they still see the prior Q&A pair.
- Signals reset only when `ResultsScreen` itself unmounts (navigating away from the Results screen). This matches the brief: "don't reset on mere overlay toggle".
- `askError` is cleared on next submit (`setAskError(undefined)` at the start of `handleAskSubmit`), so a retry after an error clears the red message immediately rather than lingering.

## Verification

`bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` → clean (no output).

`cd apps/cli-solid && bun test` →
```
 564 pass
 0 fail
 1090 expect() calls
Ran 564 tests across 32 files. [7.17s]
```

Test count went from 563 → 564 exactly as predicted (new `ask command calls setOverlay with ask` ratchet).

## Non-changes verified

- `app.tsx` — no change needed. `setOverlay` is already threaded through `createResultsCommands` via the command registry setup; `ask` just piggy-backs on the same plumbing `insights` and `rawEvents` use.
- `AskPanel`, `InsightsOverlay`, `RawEventsOverlay`, `askReportFn`, `isEnabled` — untouched.
