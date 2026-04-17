# OV-3c Review — Wire Ask Panel Into Results

**Reviewer:** reviewer (antagonistic)
**Date:** 2026-04-17
**Verdict:** APPROVE

---

## Scope verification

`git diff --stat HEAD` confirms exactly 4 files touched, matching the engineer's diary:

```
apps/cli-solid/src/commands/register-results.ts           |  3 +--
apps/cli-solid/src/routes/results/results-screen.tsx      | 29 ++++++++++++++++++++++
apps/cli-solid/tests/commands/register-results.test.ts    | 21 ++++++++++++++--
apps/cli-solid/tests/integration/app-wiring.test.ts       |  3 +--
4 files changed, 50 insertions(+), 6 deletions(-)
```

- No modifications to `app.tsx`, `AskPanel`, `RawEventsOverlay`, `InsightsOverlay`, or `askReportFn` (Q1).
- `isEnabled` helper (`register-results.ts:12-15`) untouched — `ask` reuses the same shared predicate (Q2, Q6).

## Mandatory checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` | Clean (exit 0, no output) |
| `bun test` in `apps/cli-solid` | **564 pass, 0 fail, 1090 expect() calls** (+1 ratchet from 563) |
| Only 4 files touched | Confirmed |
| Diary line-ranges match | Confirmed |

## Findings

### `register-results.ts` (lines 48-57)

- Removed `hidden: true` — `ask` defaults to visible (Q4 ✓).
- Removed the HACK stub comment; `onSelect: () => { options.setOverlay("ask"); }` (Q5 ✓).
- `keybind: "a"` (Q3 ✓), `category: "Results"`, `enabled: isEnabled(options)` (Q6 ✓). Mirrors the shape of `insights` and `raw-events`.
- `ResultsOverlay` union (`src/context/navigation.tsx:40`) already includes `"ask"` — `setOverlay("ask")` typechecks.

### `results-screen.tsx`

**Signal declarations (lines 41-43)** — declared in `ResultsScreen`'s body, NOT inside `AskPanel`. They survive open → close → re-open cycles because:
- `<Show>` unmounts `AskPanel`, but `AskPanel` owns only ephemeral input state (`inputValue`, `scrollOffset`).
- `ResultsScreen`'s own signals persist for the lifetime of the Results screen instance.
- `onCleanup` in `ResultsScreen` only clears `currentActions`; it does NOT reset ask signals.
- The `<Show>` wrapping `AskPanel` has no `onCleanup` in `AskPanel` that touches `askHistory`/`askError`/`askPending` on parent.

Re-opening the overlay after a Q&A exchange will render `AskPanel` with the accumulated `askHistory` intact (Q7, Q8 ✓).

**`handleAskSubmit` flow (lines 95-107)** — mirrors `handleSave` (lines 71-84) faithfully:
- Double-submit guard: `if (askPending()) return;` (Q9 ✓).
- `atomFnToPromise(askReportFn)` — input `{ report: props.report, question }` matches `AskInput` shape at `ask-report-atom.ts:210-213` (Q10 ✓).
- `atomFnToPromise` returns `Promise<Exit<AskResult, E>>` — verified at `effect-atom.ts:84-108`. The adapter subscribes to the mutation atom, waits for non-Initial/non-waiting state, then resolves with `Exit.succeed(value)` or `Exit.failCause(cause)`. Engineer correctly unwraps via `Exit.isSuccess` (Q10 ✓).
- Clears prior error on new submit (`setAskError(undefined)` before trigger) (Q9 ✓).
- Push on success: `setAskHistory((prev) => [...prev, exit.value])` — immutable concat (Q9 ✓).
- Failure branch: sets a user-visible error string with enter-to-retry hint (Q9, Q18 ✓).

**Optimistic vs. streaming (Q11)** — non-optimistic path: question is not echoed into `askHistory` until the answer arrives. During `pending`, the user sees the spinner + "Thinking…" text rendered by `AskPanel` (`ask-panel.tsx:128-133`). The spec explicitly allows non-optimistic for this task since the atom does `Stream.runFold` (single answer after stream terminates). Minor UX gap (the in-flight question isn't echoed), but this is cosmetic and the spinner does convey "request in flight." Not a blocker.

**Overlay rendering (lines 238-246)** — placed as a **sibling** of the `rawEvents` (line 227) and `insights` (line 234) `<Show>` blocks, not nested (Q12 ✓). Props wired correctly (Q13 ✓):
- `history={askHistory()}`
- `pending={askPending()}`
- `error={askError()}`
- `onSubmit={handleAskSubmit}`
- `onClose={() => navigation.setOverlay(undefined)}`

### Tests

**`register-results.test.ts`**
- Line 45 visibility test flipped to `ask?.hidden).toBeUndefined()` — correct direction (Q17 ✓, no stale assertions left).
- New ratchet `"ask command calls setOverlay with ask"` (lines 207-222) mirrors the `rawEvents` and `insights` ratchets — asserts `onSelect()` invokes `setOverlay("ask")` (Q14 ✓).
- Dialog/overlay shielding tests (lines 124-148) iterate all commands via `for (const cmd of commands) { expect(cmd.enabled).toBe(false); }` — `ask` is covered automatically (Q15, Q20, Q21 ✓).
- Enabled-on-Results test (line 68-79) same for-loop pattern — covers `ask`.
- Keybinds test (line 150-171) explicitly asserts `ask?.keybind).toBe("a")`.

**`app-wiring.test.ts`**
- Line 374 flipped from `not.toContain` to `toContain("results.ask")` (Q16 ✓). The `expect(visibleValues).not.toContain("results.ask")` is removed.
- Lines 54 and `screen-command-isolation.test.ts:135` already include `"results.ask"` in the expected command values list — they were added in earlier work and now simply pass because `ask` is no longer hidden.

No failing tests — the flip is consistent across all three files that reference the ask visibility state.

### Error handling (Q18)

`askReportFn` (`ask-report-atom.ts:220-262`) can surface errors from `Agent.stream` (agent failures), `Schema.encodeSync(PerfReport)` (should never fail since `PerfReport` round-trips), and `Stream.runFold`. Engineer swallows the specific cause and renders `"Couldn't answer that. Press enter to retry."` This is generic but acceptable for a first cut — the spec doesn't require error discrimination, and the retry affordance matches `AskPanel`'s input re-enable after `pending` clears. Not a blocker.

### Defensive checks (Q19)

`props.report` is typed `PerfReport` (required prop, line 27). Screen construction happens via `Screen.Results({ report, videoUrl })` — always present. No crash risk on submit.

### Code quality

- No nested `<text>` elements (Q22 ✓).
- No `useMemo` / `useCallback` / `React.memo` — SolidJS uses reactive primitives (Q23 ✓).
- No explanatory comments; diff removes the HACK comment (Q24 ✓).
- No barrel files; direct import from `@neuve/perf-agent-cli/data/ask-report-atom` (Q25 ✓).
- No `null`; `askError` uses `string | undefined` (Q26 ✓).
- No `as` casts in the diff (Q27 ✓). The pre-existing `as never` at `register-results.test.ts:12` is unchanged.
- kebab-case filenames preserved. Arrow functions throughout.

### Additional sanity checks

- No race condition on `atomFnToPromise`: the adapter captures a single Promise-resolving subscription per call, unsubscribes after Success/Failure. Concurrent submits are blocked by the `askPending()` guard.
- `setInputValue("")` fires in `AskPanel` (line 98) before `props.onSubmit` so the input clears immediately; `pending` then flips to `true` and hides the input box (lines 134-145), which is a reasonable UX.
- Ctrl+Q / global shortcuts still fire because `AskPanel` only intercepts `escape`/arrow keys inside the overlay (`ask-panel.tsx:70-92`) and doesn't preventDefault unknown keys.

## Verdict

**APPROVE.**

All 21 review questions answered satisfactorily. Scope is minimal (4 files, ~50 LOC net). Typecheck clean, 564/564 tests pass (+1 ratchet as claimed). Mirrors `handleSave` pattern exactly, reuses shared `isEnabled` predicate, and respects overlay/dialog shielding via existing tests. The non-optimistic UX choice is spec-sanctioned. No critical, major, or minor blockers.
