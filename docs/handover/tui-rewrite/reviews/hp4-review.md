# HP-4 Review: Minimal Results Screen

**Reviewer:** Code Review Agent
**Date:** 2026-04-16
**Verdict:** REQUEST_CHANGES

---

## Verification

- **TypeScript:** `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` -- PASS (clean, no errors)
- **Tests:** `bun test` -- PASS (418 tests, 0 failures, 652 expect() calls)

---

## Critical

### C1: Non-null assertion `!` on stepStatus in StepRow (results-screen.tsx:263)

```tsx
<Show when={(isFailed() || isSkipped()) && stepStatus()?.summary}>
  <text style={{ fg: COLORS.DIM }}>{`     ${stepStatus()!.summary}`}</text>
</Show>
```

The `!` non-null assertion violates the project's "No type casts (`as`) unless unavoidable" rule. Non-null assertions (`!`) are a form of type assertion that suppresses the compiler's null check.

While the `<Show when={...}>` guard ensures `stepStatus()` is defined at the point where the children execute, this is still a code style violation, and the assertion is avoidable. Solid's `<Show>` supports a callback form that narrows the type:

**Fix:** Use the `<Show>` callback form to avoid the assertion:

```tsx
<Show when={(isFailed() || isSkipped()) && stepStatus()?.summary}>
  {(summary) => (
    <text style={{ fg: COLORS.DIM }}>{`     ${summary()}`}</text>
  )}
</Show>
```

The `when` expression already evaluates to the summary string (or falsy), so the callback receives the narrowed value. This eliminates the `!` entirely.

---

## Major

### M1: No `onCleanup` for `clearResultsActions` (results-screen.tsx:88)

```tsx
setResultsActions({ onCopy: handleCopy, onSave: handleSave, onRestart: handleRestart });
```

The module-level `currentActions` is set during component creation but only cleared in `goBack()` (app.tsx:50). The `handleRestart` function navigates directly via `navigation.setScreen()` without calling `goBack`, so `clearResultsActions()` is never invoked on restart. This leaves stale action handlers referencing the old component's closures in the module-level variable.

While the stale handlers are gated by `isResultsScreen()` (commands won't fire on non-Results screens), the pattern is fragile. Any future navigation path that bypasses `goBack` will have the same problem. The Solid idiom is to use `onCleanup` for cleanup:

**Fix:** Add `onCleanup(clearResultsActions)` inside the ResultsScreen component:

```tsx
import { onCleanup } from "solid-js";

export const ResultsScreen = (props: ResultsScreenProps) => {
  // ...
  setResultsActions({ onCopy: handleCopy, onSave: handleSave, onRestart: handleRestart });
  onCleanup(clearResultsActions);
  // ...
};
```

This ensures cleanup runs regardless of which navigation path unmounts the component.

---

## Minor

### m1: Unicode glyph constants duplicated across files (results-screen.tsx:17-20, metrics-table.tsx:22-24)

```ts
// results-screen.tsx
const TICK = "\u2714";
const CROSS = "\u2718";
const ARROW_RIGHT = "\u2192";
const POINTER = "\u25B8";

// metrics-table.tsx
const TICK = "\u2714";
const WARNING = "\u26A0";
const CROSS = "\u2718";
```

`TICK` and `CROSS` are defined in both files, and also in the testing screen (flagged in HP-3 review m2). Per CLAUDE.md, display constants should live in `constants.ts`. These are now duplicated across at least three files.

### m2: `atomFnToPromise` created inside `handleSave` on every invocation (results-screen.tsx:68)

```ts
const handleSave = async () => {
  // ...
  const trigger = atomFnToPromise(saveFlowFn);
  const exit = await trigger({ plan: props.report });
  // ...
};
```

`atomFnToPromise(saveFlowFn)` creates a new wrapper function and subscription on each call. The wrapper is lightweight and the save action fires rarely, so this is not a functional bug. However, it would be cleaner to create the trigger once at component scope, like `handleCopy` uses `copyToClipboard` directly. The early-return guard (`if (savePending() || saveSucceeded()) return`) prevents concurrent calls, so a single trigger instance would be safe.

### m3: Three `createSignal` booleans for save state could be a single signal (results-screen.tsx:34-36)

```ts
const [savePending, setSavePending] = createSignal(false);
const [saveSucceeded, setSaveSucceeded] = createSignal(false);
const [saveFailed, setSaveFailed] = createSignal(false);
```

These three signals are mutually exclusive (idle/pending/succeeded/failed). A single signal with a union type (e.g. `"idle" | "pending" | "succeeded" | "failed"`) would be clearer and prevent impossible states like `savePending && saveSucceeded`. Not a bug since the handlers correctly manage transitions, but it's needlessly complex state.

### m4: `copyToClipboard` is macOS-only -- no cross-platform support (copy-to-clipboard.ts:5)

```ts
childProcess.execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
```

This is a faithful port of the Ink TUI's `copy-to-clipboard.ts` (identical code), so it's not introduced by HP-4. However, the Ink version also only supports macOS. On Linux (`xclip`/`xsel`) or Windows (`clip.exe`) this silently fails and returns `false`. Worth noting for future cross-platform work, but not a regression.

### m5: `copyToClipboard` called with `.toPlainText` as getter, not call (results-screen.tsx:50)

```ts
const didCopy = copyToClipboard(props.report.toPlainText);
```

If `toPlainText` is a getter on `PerfReport`, this is correct. If it's a method (i.e. requires `()`), this would pass the function itself as the text string. Verified by TypeScript compilation that `toPlainText` is indeed a getter (not a method), so this is correct. No action needed -- just documenting the verification.

---

## Positive

- **Metrics table is well-structured (metrics-table.tsx):** Clean separation into `MetricsTable` -> `SnapshotTable` -> `MetricRow`. The `collectCwvRows` helper correctly filters undefined metrics and uses `classifyCwv` from shared for color classification. The ordered `CWV_METRIC_ORDER` array ensures consistent display.

- **CWV color coding is correct:** `colorForClassification` maps `good/needs-improvement/poor` to `GREEN/YELLOW/RED` matching the Ink TUI exactly. The `classifyCwv` function from `@neuve/shared/cwv-thresholds` is used directly without reimplementation.

- **Step status rendering is faithful:** `report.stepStatuses.get(step.id)` correctly reads from the Map. Failed steps show red + cross, skipped show yellow + arrow, passed show green + tick. Failure summaries are displayed inline.

- **Command registration with screen gating is clean (register-results.ts):** All 6 commands are gated on `isResultsScreen()`. The test suite validates correct enablement on Results vs. Main/Testing/PortPicker screens, and checks for keybind collisions with global, main, and testing commands. The hidden stubs (a/i/ctrl+o) are properly marked with HACK comments.

- **goBack cleanup handles Results (app.tsx:49-51):** The Results -> Main transition correctly calls `clearResultsActions()` before navigating. The guard `screen._tag === "Results"` is specific and won't fire on other screens.

- **Test coverage is solid (192 tests across 3 new test files):** `step-elapsed.test.ts` covers all edge cases (both undefined, one undefined, same timestamps, multi-step sums). `register-results.test.ts` validates command set, visibility, screen gating, keybinds, collision checks, and category. `copy-to-clipboard.test.ts` is basic but platform-aware.

- **Faithful port of utilities:** Both `copy-to-clipboard.ts` and `step-elapsed.ts` are line-for-line identical to their Ink counterparts. No divergence risk.

- **Restart correctly uses `screenForTestingOrPortPicker`:** The restart handler passes `changesFor` and `instruction` from the report, matching the Ink TUI's restart behavior. The `screenForTestingOrPortPicker` helper handles the URL-detection-based routing (Testing vs PortPicker).

---

## Summary

One critical style violation (C1 -- non-null assertion) and one major robustness issue (M1 -- missing `onCleanup` for stale action handlers) need to be addressed before merge. Both have straightforward fixes.

The implementation is otherwise a faithful and clean port of the Ink Results screen, correctly using Solid idioms (`Show`, `For`, `createSignal`) and the established command registration pattern. The metrics table, step list, and action handlers all work correctly.

---

## Round 2 (2026-04-16) -- Patch commit `4e6e3cd6`

**Verdict:** APPROVE

### Verification

- **TypeScript:** `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` -- PASS (clean)
- **Tests:** `bun test` -- PASS (418 tests, 0 failures, 652 expect() calls)

### C1 -- RESOLVED

Line 263-264 now uses the `<Show>` callback form:

```tsx
<Show when={(isFailed() || isSkipped()) && stepStatus()?.summary}>
  {(summary) => <text style={{ fg: COLORS.DIM }}>{`     ${summary()}`}</text>}
</Show>
```

The callback receives the narrowed truthy value, eliminating the `!` non-null assertion entirely. Grep confirms zero `!.` patterns remain in the results route files.

### M1 -- RESOLVED

Line 1 now imports `onCleanup` from `solid-js`, and line 89 registers cleanup immediately after setting actions:

```tsx
setResultsActions({ onCopy: handleCopy, onSave: handleSave, onRestart: handleRestart });
onCleanup(clearResultsActions);
```

This ensures `clearResultsActions` fires on component disposal regardless of navigation path (goBack, restart, or any future route). The `clearResultsActions()` call in `goBack` (app.tsx:50) is now redundant but harmless -- belt-and-suspenders cleanup is acceptable.

### Remaining notes

All Round 1 minor findings (m1-m5) remain as noted. None are merge-blocking.
