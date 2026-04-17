# OV-2b Diary — Wire Insights Overlay Into Results

Date: 2026-04-17
Owner: ov2b-engineer

## Scope

Flip the pre-existing `results.insights` HACK stub (landed untouched in OV-1b) into an active command: `i` on the Results screen opens the `InsightsOverlay` delivered by OV-2a. `esc` dismissal is already owned by the overlay's own `useKeyboard` handler.

## Files changed

### `apps/cli-solid/src/commands/register-results.ts`

- `register-results.ts:59-68` — replaced the `insights` stub. Removed `hidden: true` (so OV-4 modeline shows `/insights`) and swapped the `onSelect` body from the HACK comment to `options.setOverlay("insights")`. Kept `keybind: "i"`, `value: "results.insights"`, `category: "Results"`, and `enabled: isEnabled(options)` — the shared `isEnabled` helper from OV-1b already covers the `"Results" + no overlay + no dialog` predicate.
- Did NOT touch the `ask` HACK stub (keybind `a`, still `hidden: true`) — that is OV-3c.
- Did NOT introduce a new helper or predicate; reused OV-1b's `isEnabled`.

### `apps/cli-solid/src/routes/results/results-screen.tsx`

- `results-screen.tsx:13` — added `import { InsightsOverlay } from "./insights-overlay";`.
- `results-screen.tsx:215-217` — added a second overlay match directly after the existing `rawEvents` `<Show>` block:
  ```tsx
  <Show when={navigation.overlay() === "insights"}>
    <InsightsOverlay report={props.report} onClose={() => navigation.setOverlay(undefined)} />
  </Show>
  ```
  `InsightsOverlay`'s props are `{ report: PerfReport; onClose: () => void }`; `props.report` is already a `PerfReport` so no adaptation is needed. The `OverlayContainer` used by `InsightsOverlay` paints over the Results layout the same way `RawEventsOverlay` does.

### `apps/cli-solid/src/app.tsx`

- No change. `setOverlay: navigation.setOverlay`, `overlay: navigation.overlay`, and `isDialogEmpty: dialog.isEmpty` were already threaded into `createResultsCommands({ ... })` at `app.tsx:129-136` by OV-1b.

## Test updates

### `apps/cli-solid/tests/commands/register-results.test.ts`

- Renamed the hidden/visible ratchet from `"copy, save, restart, raw-events are visible; ask, insights are hidden"` to `"copy, save, restart, insights, raw-events are visible; ask is hidden"`. `insights?.hidden` now asserted `toBeUndefined()`; `ask?.hidden` still `toBe(true)`.
- Added new test `"insights command calls setOverlay with insights"` — mirrors the existing raw-events ratchet: constructs `createResultsCommands` with a capturing `setOverlay`, invokes `results.insights`'s `onSelect`, and asserts the captured value is `"insights"`.
- The existing `"commands are disabled when overlay is active"` and `"commands are disabled when a dialog is open"` tests iterate all six commands and already cover `insights` — no change needed.
- The existing `"keybinds are correct"` test already asserts `insights?.keybind).toBe("i")` — no change needed.

### `apps/cli-solid/tests/integration/app-wiring.test.ts`

- `"Results screen shows results category visible commands"` — moved `results.insights` from the `not.toContain` block to the `toContain` block. `results.ask` remains in `not.toContain`.
- `EXPECTED_COMMAND_SETS` — no change; it already listed `results.insights` in the `results` group and was only asserting presence, not visibility.

## Predicate chain trace (insights command)

Same shared `isEnabled` predicate from OV-1b applies:

| Situation                          | `_tag === "Results"` | `overlay() === undefined` | `isDialogEmpty()` | `enabled` |
| ---------------------------------- | -------------------- | ------------------------- | ----------------- | --------- |
| Clean Results screen               | yes                  | yes                       | yes               | true      |
| `insights` overlay already open    | yes                  | no (= `"insights"`)       | yes               | false     |
| `rawEvents` overlay already open   | yes                  | no (= `"rawEvents"`)      | yes               | false     |
| Dialog open on Results             | yes                  | yes                       | no                | false     |
| Main screen                        | no                   | yes                       | yes               | false     |

## esc routing

- `InsightsOverlay` owns escape via its own `useKeyboard` (`insights-overlay.tsx:78-103`): in `list` mode `esc` calls `props.onClose()`; in `detail` mode `esc` goes back to the list. The nested esc handling spec'd in overlays-plan.md (detail → list → dismiss) is already implemented by OV-2a; wiring changes nothing about that contract.
- Global `esc` remains disabled while any overlay is active (`register-global.ts:42` predicate `overlay() === undefined`).
- Dialog `esc` is intercepted at `app.tsx:144-149` before the registry sees the key, so an open dialog on top of Results never reaches the overlay command.

## Verification

### TSC

```bash
bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
```

Clean — no output, exit 0.

### Bun tests

```bash
cd apps/cli-solid && bun test
```

```
 563 pass
 0 fail
 1089 expect() calls
Ran 563 tests across 32 files. [6.74s]
```

+1 vs the 562 on the OV-1b baseline — the delta is the new `"insights command calls setOverlay with insights"` ratchet.

## What I did NOT do

- Did NOT modify `InsightsOverlay`, `RawEventsOverlay`, or `AskPanel`.
- Did NOT wire the `ask` command — that is OV-3c.
- Did NOT change the shared `isEnabled` helper, the `RegisterResultsOptions` interface, or the `navigation` overlay model.
- Did NOT add barrel files or explanatory comments.
- Did NOT touch `app.tsx`; the wiring there was already correct from OV-1b.

## Open questions

None. Ready for review.
