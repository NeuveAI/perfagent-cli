# HP-3 Review: Testing Screen (collapsed view + execution)

**Reviewer:** Code Review Agent
**Date:** 2026-04-16
**Verdict:** REQUEST_CHANGES

---

## Verification

- **TypeScript:** `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` -- PASS (clean, no errors)
- **Tests:** `bun test` -- PASS (396 tests, 0 failures, 590 expect() calls)

---

## Critical

### C1: `createEffect` re-fires execution on signal changes (testing-screen.tsx:67-118)

The first `createEffect` reads reactive signals `agent.agentBackend()` (line 71) and `agent.modelPreferences()` (line 72). In Solid, `createEffect` tracks all signal reads and re-runs when any tracked signal changes. If the user changes the agent backend or model preference while on the Testing screen (unlikely but possible -- e.g. via a future keybind or command palette), the effect will:

1. Fire `onCleanup` which sends `Atom.Interrupt` to the running execution
2. Re-run, starting a **second execution** with the new agent

The Ink version avoids this because React's `useEffect` dependency array explicitly controls re-execution, and the values (`agentBackend`, `browserHeaded`, etc.) are stable zustand snapshots read before the effect.

**Fix:** Read the agent values outside the effect and capture them as plain values, or use `untrack()` around the signal reads:

```tsx
// Option A: read outside effect
const agentBackend = agent.agentBackend();
const modelPrefs = agent.modelPreferences();

createEffect(() => {
  // use agentBackend and modelPrefs as plain values (not reactive)
  ...
});

// Option B: untrack inside effect
import { untrack } from "solid-js";
createEffect(() => {
  const agentBackend = untrack(() => agent.agentBackend());
  const modelPrefs = untrack(() => agent.modelPreferences());
  ...
});
```

Option A is cleaner -- the values are captured once at component creation time, matching the Ink behavior where `useEffect` runs once on mount.

### C2: `as ExecutionResult` type cast (testing-screen.tsx:107)

```ts
const result = exit.value as ExecutionResult;
```

CLAUDE.md forbids `as` casts: "No type casts (as) unless unavoidable." This cast IS avoidable. The `atomFnToPromise` generic correctly infers `Out = ExecutionResult` from the `executeFn` atom's type, so `exit.value` is already typed as `ExecutionResult` when `Exit.isSuccess(exit)` narrows the exit. If the type isn't inferring correctly, the right fix is to annotate the `atomFnToPromise` call, not to cast.

**Fix:** Remove the cast. If TypeScript doesn't infer correctly, add a type parameter: `atomFnToPromise<ExecuteInput, ExecutionResult, E>(executeFn)`.

---

## Major

### M1: Missing `multilineArgs` rendering in ToolCallRow (testing-screen.tsx:325-384)

The Ink TUI renders multiline playwright code blocks (testing-screen.tsx:378-389):

```tsx
if (display.tool.multilineArgs) {
  const lines = display.tool.multilineArgs.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    rows.push(<Text>...</Text>);
  }
}
```

The Solid `ToolCallRow` component completely omits this. When a playwright tool call contains multiline code (e.g. a multi-line `page.evaluate()`), the Ink TUI shows the full code block while the Solid TUI silently drops it. This is a functional gap in the collapsed view.

The `formatToolCall` utility correctly computes `multilineArgs` (format-tool-call.ts:76-77), and `ToolCallDisplay` in testing-helpers.ts already has `tool: FormattedToolCall` which includes the field. It's just not rendered.

**Fix:** Add a `<Show when={props.display.tool.multilineArgs}>` block after the tool call header in `ToolCallRow` that renders each line.

### M2: `getPlanningToolCalls` collects ALL events, not just pre-step events (testing-helpers.ts:213-217)

```ts
export const getPlanningToolCalls = (events: readonly ExecutionEvent[]): ToolCallDisplay[] => {
  const calls = collectToolCalls(events, 0);
  ...
};
```

This collects tool calls from ALL events (index 0 to end), not just events before the first `StepStarted`. The function is called in testing-screen.tsx:166 when `totalCount() === 0` (no steps yet), so in practice it works during the planning phase. However, if the planning phase renders and steps haven't been picked up yet due to the 16ms batch coalescer in `atomToAccessor`, this could briefly show step-level tool calls in the planning section.

The Ink version has the same implementation, so this is technically a ported behavior. Flagging as major because the Solid version has the additional 16ms batching delay that makes the race window wider.

**Fix:** Add a `toIndex` that stops at the first `StepStarted` event:

```ts
export const getPlanningToolCalls = (events: readonly ExecutionEvent[]): ToolCallDisplay[] => {
  const firstStepIndex = events.findIndex((e) => e._tag === "StepStarted");
  const endIndex = firstStepIndex === -1 ? events.length : firstStepIndex;
  const calls = collectToolCalls(events, 0, endIndex);
  ...
};
```

---

## Minor

### m1: Redundant `!` non-null assertions in ToolCallRow JSX (testing-screen.tsx:360, 365, 372)

```tsx
{formatStreamingBytes(props.display.progressBytes!)}
{formatTokenCount(props.display.resultTokens!)}
{formatResultPreview(props.display.resultText!)}
```

These `!` assertions are inside `<Show when={...}>` guards that already check the values are defined. In Solid's `<Show>`, the child still receives the original prop type (not narrowed), so TypeScript requires the assertion. However, the `<Show when={...}>` callback form (used on line 371 `{(_resultText) => ...}`) would provide the narrowed value. Consider using the callback form consistently to avoid `!`.

### m2: Unicode glyphs defined as module-level constants but not in constants.ts (testing-screen.tsx:35-42)

```ts
const TICK = "\u2714";
const CROSS = "\u2718";
// ...
```

These are display constants that should live in `constants.ts` per the project convention ("Magic numbers go in constants.ts as SCREAMING_SNAKE_CASE"). They're also duplicated between testing-screen.tsx and any future screen that needs status glyphs.

### m3: `baseUrl` join logic duplicated from Ink TUI (testing-screen.tsx:75-77)

```ts
const baseUrl = props.baseUrls && props.baseUrls.length > 0 ? props.baseUrls.join(", ") : undefined;
```

This matches the Ink version (testing-screen.tsx:565) so it's a faithful port, but joining URLs with `, ` into a single string feels fragile. If a URL contains a comma, the downstream consumer would misparse it. This is an inherited issue, not introduced by HP-3.

### m4: `agentConfigOptionsAtom` update pattern differs from Ink TUI (testing-screen.tsx:96-101)

Ink version:
```ts
setConfigOptions((previous) => ({
  ...previous,
  [agentBackend]: [...configOptions],
}));
```

Solid version:
```ts
const previous = atomGet(agentConfigOptionsAtom);
atomSet(agentConfigOptionsAtom, {
  ...previous,
  [agentBackend]: [...configOptions],
});
```

The Ink version uses the updater callback form, which guarantees it reads the latest value at update time. The Solid version reads `atomGet()` which reads the current value at callback definition time. If two `onConfigOptions` callbacks fire in rapid succession, the second could overwrite the first's changes (lost update). In practice this is unlikely since `onConfigOptions` fires rarely, but the pattern is technically less safe.

### m5: `testing.expand` command registered with `ctrl+o` keybind but handler is a no-op (register-testing.ts:31)

The expand command is registered with a keybind but has an empty `onSelect` handler with a HACK comment. The keybind is consumed (preventing any other ctrl+o handler), and the user gets no feedback. Consider either removing the keybind until the feature is implemented, or showing a toast ("Expanded view coming soon").

---

## Positive

- **Helper extraction (testing-helpers.ts):** Clean separation of pure display logic from the component. All 15 exported functions are independently testable, and the 60 tests cover edge cases well (empty events, boundary conditions, truncation).
- **Test quality:** 101 tests across 4 files with good coverage of edge cases (negative ms clamping, invalid JSON parsing, empty events, truncation boundaries, keybind collision checks). The `register-testing.test.ts` correctly validates no keybind collisions with global and main commands.
- **Cancel flow:** The esc -> confirm -> enter/y pattern is clean and matches the Ink TUI behavior. The fix commit (d92eef24) correctly removed the esc keybind from the command registry to avoid collision with `global.back`.
- **Timer cleanup:** The `onCleanup(() => clearInterval(interval))` in the timer effect (line 129) correctly cleans up on unmount. The separate tracking of `isExecuting()` correctly stops timer updates when execution completes.
- **goBack guard:** `app.tsx:46-49` correctly blocks global back on the Testing screen, delegating esc handling to the in-screen keyboard handler.
- **Faithful port of display helpers:** `collectToolCalls`, `getActiveStepToolCalls`, `formatCommandPreview`, `formatArgsPreview`, `markLastCallRunning` are line-for-line equivalent to the Ink TUI versions, with the `showAll` parameter correctly dropped (not needed for collapsed-only MVP).

---

## Summary (Round 1)

Two critical issues block merge:

1. **C1** -- The `createEffect` tracking reactive signals will re-trigger execution if agent preferences change, causing double-execution and interrupted runs. Must use `untrack()` or read values outside the effect.
2. **C2** -- Forbidden `as` cast that is avoidable.

One major issue should also be addressed:

1. **M1** -- Missing multiline playwright code rendering is a visible behavioral gap vs. the Ink TUI.

M2 is a ported behavior from Ink, so at the author's discretion whether to fix it now or defer.

---

## Round 2 (2026-04-16) -- Patch commit `2dc21b61`

**Verdict:** APPROVE

### Verification

- **TypeScript:** `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` -- PASS (clean)
- **Tests:** `bun test` -- PASS (396 tests, 0 failures, 590 expect() calls)

### C1 -- RESOLVED

The entire effect body is now wrapped in `untrack(() => { ... })` at lines 67-114. Signal reads for `agent.agentBackend()` (line 71) and `agent.modelPreferences()` (line 72) are no longer tracked by the effect. The `onCleanup` at line 116-118 is correctly placed outside the `untrack` block but inside `createEffect`, so cleanup registration works properly. Changes to agent preferences will no longer re-fire execution.

### C2 -- RESOLVED

Line 107 now reads `const result = exit.value;` with no `as` cast. The `ExecutionResult` import type was also removed (no longer needed). Grep confirms zero `as` casts remain in the file.

### M1 -- RESOLVED

Lines 371-380 add multiline rendering:
```tsx
<Show when={props.display.tool.multilineArgs}>
  <For each={props.display.tool.multilineArgs!.split("\n")}>
    {(line) => (
      <text style={{ fg: COLORS.DIM }}>
        {`${props.indent}${PIPE}     `}
        <span style={{ fg: COLORS.TEXT }}>{line}</span>
      </text>
    )}
  </For>
</Show>
```

Functionally equivalent to the Ink TUI's multiline rendering (apps/cli/testing-screen.tsx:378-389). The `!` assertion on line 372 is inside a `<Show when={...}>` guard -- consistent with the existing pattern in the file (minor m1 from Round 1).

### Remaining notes

All Round 1 minor findings (m1-m5) and M2 remain as noted. None are merge-blocking. M2 is inherited from the Ink TUI and can be addressed separately.
