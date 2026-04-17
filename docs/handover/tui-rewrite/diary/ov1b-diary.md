# OV-1b Diary — Wire Raw Events Overlay Into Results

Date: 2026-04-17
Owner: engineer

## Scope

Wire the `e` keybind on the Results screen to open the `RawEventsOverlay` (delivered in OV-1a). `esc` dismisses the overlay via the overlay's own `onClose`. Global `esc` was already predicate-gated on `overlay() === undefined` (`apps/cli-solid/src/commands/register-global.ts:42`) — no change needed there.

## Files changed

### `apps/cli-solid/src/commands/register-results.ts`

- `register-results.ts:1-9` — imported `ResultsOverlay` type and extended `RegisterResultsOptions` with `setOverlay: (overlay: ResultsOverlay | undefined) => void`.
- `register-results.ts:66-74` — replaced the stubbed `raw events` command:
  - `title: "events"` (shows as `/events` in the command menu).
  - `value: "results.raw-events"` (preserved so modeline/tests/other references still resolve).
  - `keybind: "e"` (was `ctrl+o`).
  - Removed `hidden: true`, so the command is now visible in the modeline (needed for OV-4).
  - `onSelect: () => options.setOverlay("rawEvents")`.
- Did NOT touch `results.insights` (keybind `i`, hidden) or `results.ask` (keybind `a`, hidden) — those belong to OV-2b and OV-3c.

### `apps/cli-solid/src/routes/results/results-screen.tsx`

- `results-screen.tsx:12` — imported `RawEventsOverlay`.
- `results-screen.tsx:28` — `navigation = useNavigation()` already existed; no change to how the component reads navigation.
- `results-screen.tsx:206-211` — added `<Show when={navigation.overlay() === "rawEvents"}>` rendering `<RawEventsOverlay executedPlan={props.report} onClose={() => navigation.setOverlay(undefined)} />` as the last child of the screen's root box. `RawEventsOverlay`'s `OverlayContainer` is absolutely positioned and fills the viewport, so it paints over the Results content without disturbing the existing layout.
- `PerfReport extends ExecutedPerfPlan` (`packages/shared/src/models.ts:1140`), so `props.report` satisfies `executedPlan: ExecutedPerfPlan` without any adaptation.

### `apps/cli-solid/src/app.tsx`

- `app.tsx:129-134` — passed `setOverlay: navigation.setOverlay` into `createResultsCommands` so the new command can reach the navigation setter.

### `apps/cli-solid/src/commands/register-global.ts`

- Inspected only. Line 42 already reads:
  ```ts
  enabled: options.currentScreen()._tag !== "Main" && options.overlay() === undefined
  ```
  This disables the global `esc` command when any overlay is active, handing the key to the overlay's own `useKeyboard` handler (`raw-events-overlay.tsx:178-183` calls `props.onClose()` on escape). No changes required.

## Test updates

`register-results.ts` now takes an extra option, so every callsite had to pass a `setOverlay` stub. Also, `raw-events` flipped from hidden/`ctrl+o` to visible/`e`, so assertions flipped accordingly.

- `apps/cli-solid/tests/commands/register-results.test.ts`
  - Added a shared `noopSetOverlay` and threaded it into every `createResultsCommands({ … })` call.
  - Updated the `hidden` test: `rawEvents?.hidden` is now `undefined` (visible); `ask` and `insights` remain `true`.
  - Updated the `keybind` test: `rawEvents?.keybind` is now `"e"`.
  - Added a new test: invoking the raw-events command's `onSelect` calls `setOverlay("rawEvents")`.
- `apps/cli-solid/tests/integration/app-wiring.test.ts`
  - All `createResultsCommands({ currentScreen })` usages now pass `setOverlay: () => {}`.
  - Flipped the `Results screen shows results category visible commands` assertion so `results.raw-events` is in the visible set (it was previously in the `not.toContain` block).
- `apps/cli-solid/tests/integration/screen-command-isolation.test.ts`
  - Single `createResultsCommands` usage updated to pass `setOverlay: () => {}`.

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
 560 pass
 0 fail
 1076 expect() calls
Ran 560 tests across 32 files. [7.19s]
```

560 (spec expected 559; the delta is the new "raw-events command calls setOverlay with rawEvents" test — a ratchet, not a regression).

### Repo-wide `pnpm test`

```bash
pnpm test
```

One pre-existing failure in `@neuve/cookies`:

```
FAIL tests/cookies.test.ts > Cookies > Chrome: extracted cookies have valid expiry timestamps
AssertionError: expected Chrome to return at least one cookie
  packages/cookies/tests/cookies.test.ts:129:16
```

This test reads a live Chrome browser profile on the host machine (`browsers.list` → `cookies.extract(chrome)`). It's environment-dependent and unrelated to any OV-1b code path. All other packages (180+ tests) pass.

## Manual behaviour check (logical trace)

1. User on Results → keyboard `e` fires → `command-registry.handleKeyEvent` matches `results.raw-events` (enabled because `currentScreen._tag === "Results"`) → `onSelect` calls `navigation.setOverlay("rawEvents")`.
2. Results re-renders; `<Show when={navigation.overlay() === "rawEvents"}>` turns truthy, mounts `<RawEventsOverlay>` on top of the existing layout.
3. `RawEventsOverlay`'s own `useKeyboard` owns the escape key (`raw-events-overlay.tsx:178`). Pressing `esc` calls `props.onClose()` → `navigation.setOverlay(undefined)` → `<Show>` unmounts the overlay.
4. While the overlay is visible, the global `esc` command is disabled because of the `overlay() === undefined` predicate on `register-global.ts:42`, so it does NOT race with the overlay's own handler or trigger `goBack`.

## What I did NOT do

- Did NOT modify `RawEventsOverlay` itself. Treated as a black box, passed `props.report` directly as `executedPlan`.
- Did NOT wire `insights` (`i`) or `ask` (`a`) — those are OV-2b and OV-3c.
- Did NOT change how `results-screen.tsx` sources `executedPlan` (it still uses `props.report`).
- Did NOT add barrel files or explanatory comments.

## Open questions

None for OV-1b. Ready for review.

## Revisions after review (2026-04-17)

Reviewer flagged 2 MAJORs: Results commands didn't shield while overlay was open (y/s/r still fired, and `r` navigated away), and they also didn't shield while a dialog was open (`e` stole focus on top of a dialog).

### Fix

Extended `RegisterResultsOptions` with two new signal accessors and consolidated the `enabled` check into a helper.

`apps/cli-solid/src/commands/register-results.ts`:

```ts
interface RegisterResultsOptions {
  readonly currentScreen: () => Screen;
  readonly overlay: () => ResultsOverlay | undefined;
  readonly isDialogEmpty: () => boolean;
  readonly setOverlay: (overlay: ResultsOverlay | undefined) => void;
}

const isEnabled = (options: RegisterResultsOptions): boolean =>
  options.currentScreen()._tag === "Results" &&
  options.overlay() === undefined &&
  options.isDialogEmpty();
```

Applied to all 6 Results commands (`copy`, `save`, `restart`, `ask`, `insights`, `events`) — favoring consistency over per-command nuance. `events` gating is redundant (hitting `e` while the overlay is open would only re-fire `setOverlay("rawEvents")`), but matching the rest avoids bifurcation.

`apps/cli-solid/src/app.tsx:129-136` — threaded `overlay: navigation.overlay` and `isDialogEmpty: dialog.isEmpty` into the `createResultsCommands(...)` call. `dialog` was already acquired via `useDialogStack()` at `app.tsx:61`; no new imports needed.

### Predicate chain trace

| Situation                 | `_tag === "Results"` | `overlay() === undefined` | `isDialogEmpty()` | `enabled` |
| ------------------------- | -------------------- | ------------------------- | ----------------- | --------- |
| Clean Results screen      | yes                  | yes                       | yes               | true      |
| Raw-events overlay open   | yes                  | no (= `"rawEvents"`)      | yes               | false     |
| Dialog open on Results    | yes                  | yes                       | no                | false     |
| Main screen               | no                   | yes                       | yes               | false     |

### esc routing while gated

- **Overlay open:** `register-global.ts:42` already disables the global `esc` command when `overlay() !== undefined`. `RawEventsOverlay`'s own `useKeyboard` owns escape and calls `onClose()`.
- **Dialog open:** `app.tsx:142-149` intercepts `esc` at the app-level `useKeyboard` BEFORE `registry.handleKeyEvent(event)`, calling `dialog.pop()` and returning. Results commands never see the key.

### New tests (in `register-results.test.ts`)

- `"commands are disabled when overlay is active"` — constructs commands with `overlay: () => "rawEvents"` and asserts all 6 have `enabled === false`.
- `"commands are disabled when a dialog is open"` — constructs commands with `isDialogEmpty: () => false` and asserts all 6 have `enabled === false`.

### Test suite plumbing

All callsites of `createResultsCommands` updated to pass the two new options:

- `apps/cli-solid/tests/commands/register-results.test.ts` — rewritten with shared `noOverlay` / `emptyDialog` / `openDialog` helpers.
- `apps/cli-solid/tests/integration/app-wiring.test.ts` — all invocations now include `overlay: () => undefined, isDialogEmpty: () => true`.
- `apps/cli-solid/tests/integration/screen-command-isolation.test.ts` — single invocation updated.

### Verification after patch

```bash
bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
# clean, exit 0

cd apps/cli-solid && bun test
# 562 pass, 0 fail, 1088 expect() calls  (+2 vs previous 560)
```

### Not addressed (non-blocking minors)

- **m-1**: passing `props.report` as `executedPlan`. `PerfReport extends ExecutedPerfPlan`; structural compat holds. Reviewer marked non-blocking; left as-is.
- **m-2**: `hidden: true → false` flip for `events` is intentional for OV-4; no action needed.
