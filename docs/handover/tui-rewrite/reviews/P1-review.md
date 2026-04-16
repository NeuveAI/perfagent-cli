# Review: TUI-P1 -- Command registry + Main menu parity (Round 1)

## Verdict: REQUEST_CHANGES

Two critical findings and two major findings block merge.

### Verification executed

- `pnpm typecheck` -> PASS (9/9 packages, all cache hits)
- `bun test` in `apps/cli-solid/` -> PASS (25 tests, 85 expect calls, 0 failures)
- `pnpm --filter @neuve/perf-agent-cli typecheck` -> PASS (existing CLI unaffected)
- `pnpm --filter cli-solid build` -> PASS (produces `dist/tui.js`)
- `pnpm test` (repo-wide) -> 1 pre-existing failure in `@neuve/cookies` (`Chrome: extracted cookies have valid expiry timestamps` -- Chrome Guest Profile returns 0 cookies, environment-specific, documented in diary). No new failures.
- Pattern compliance:
  - `grep "react|React|ink|Ink" apps/cli-solid/src/` -> zero hits
  - `grep "useMemo|useCallback|React\.memo" apps/cli-solid/src/` -> zero hits
  - `grep "\bnull\b" apps/cli-solid/src/` -> zero hits
  - `grep "index\.ts" apps/cli-solid/src/` -> zero barrel files
  - `as` cast check -> zero type-cast `as` in src (only `as const` in `constants.ts`, `import * as` namespace imports)
  - Kebab-case filenames -> all 21 source files verified compliant

### Findings

#### [CRITICAL] `handleKeyEvent` skips hidden commands -- breaks the core contract (`command.tsx:102`)

`handleKeyEvent` at `command.tsx:102` contains:

```ts
if (command.hidden === true) continue;
```

Per the scope doc (rewrite-scope.md lines 389-390) and the opencode reference (opencode-tui-reference.md lines 389-390), hidden commands **MUST still trigger via keybind** -- they just don't appear in the palette/modeline. The opencode reference is explicit: "Hidden commands use `hidden: true` (still trigger via keybind, don't clutter the palette, e.g. `messages_page_down`)."

The concrete consequence: `enter` (main.submit) is registered as `hidden: true` in `register-main.ts:76`. Pressing Enter on Main would be a **silent no-op** through the command registry path. This is masked because the Input component has its own `useKeyboard` handling `return`, but the command registry path is dead. Similarly, `ctrl+u` (global.update) is `hidden: true` in `register-global.ts:28` and would silently never fire through `handleKeyEvent`.

This is the exact "silent no-op" bug class that the entire unified command registry was designed to eliminate. The fix is to remove line 102 from `handleKeyEvent`.

#### [CRITICAL] Input `useKeyboard` collides with command registry keybinds -- double-fire on `ctrl+a`, `ctrl+w`, `ctrl+k` (`input.tsx:127-130`, `app.tsx:39-46`)

The Input component handles `ctrl+a` (cursor to start, `input.tsx:127-130`), `ctrl+w` (delete word backward, `input.tsx:152-159`), and `ctrl+e` (cursor to end, `input.tsx:132-135`) via its own `useKeyboard`. Meanwhile, the command registry registers `ctrl+a` (agent picker), `ctrl+w` (watch), and `ctrl+k` (cookies) as Main commands.

In OpenTUI, all `useKeyboard` handlers fire for every key event. Neither the Input nor the app-level handler coordinates priority. When the user presses `ctrl+a`:
1. The Input handler fires and moves the cursor to position 0.
2. The app-level handler fires and `registry.handleKeyEvent()` matches `ctrl+a` to "agent picker" and fires the toast (or in P2+, opens the picker).

Both side effects happen simultaneously. This means:
- `ctrl+w` both deletes a word AND navigates to watch mode.
- `ctrl+a` both moves the cursor AND opens the agent picker.
- `ctrl+k` is not handled by the Input (no line-kill), but if added later it would collide.

The architecture needs an explicit priority mechanism: either (a) the Input calls `event.preventDefault()` for keys it handles, so the outer handler skips them; or (b) the command handler checks input focus state and defers to the Input for Emacs bindings; or (c) the Input stops handling keys that are registered as commands. The opencode reference handles this in `component/dialog-command.tsx` with the gate `if (dialog.stack.length === 0) return` -- registered command keybinds only fire when no dialog/input is consuming them. A similar mechanism is needed here.

#### [MAJOR] `enabled` field in `register-global.ts` for `esc` is evaluated once at creation time, not reactively (`register-global.ts:39`)

```ts
{
  title: "back",
  value: "global.back",
  keybind: "esc",
  category: "Global",
  hidden: true,
  enabled: !options.isDialogEmpty(),  // <-- evaluated once
  onSelect: () => {
    if (!options.isDialogEmpty()) {
      options.popDialog();
    }
  },
},
```

`createGlobalCommands` is called from inside a factory function (`app.tsx:20-29`), so `!options.isDialogEmpty()` is evaluated each time `getCommands()` is called. **However**, `isDialogEmpty` is `() => dialog.isEmpty()` which is a Solid accessor. When `getCommands()` is called from inside `handleKeyEvent`, the factory re-runs and evaluates the accessor. This works in the non-reactive path (imperative calls).

But the **modeline** at `modeline.tsx:11` calls `registry.getVisibleCommands()` inside a render function. In Solid, this means the computed result of `getVisibleCommands()` is cached after the first evaluation and won't re-run unless a tracked signal changes. Since `getCommands()` calls factories that call `dialog.isEmpty()` (a signal), this SHOULD track reactively. However, the `factories` array is a plain JS array, not a Solid signal. The `getCommands()` function iterates a non-reactive array. Even though the factory closures read Solid signals, the modeline's call to `visibleCommands()` (which is `() => registry.getVisibleCommands()`) is not automatically tracked because the factory array mutation is not reactive.

This means: when the dialog stack changes (push/pop), `dialog.isEmpty()` changes, but the modeline won't re-render to hide/show the `esc` command because the modeline's derived signal has no Solid dependency tracking path to `dialog.isEmpty()`. The `visibleCommands` computed function (`modeline.tsx:11`) creates a new derivation, but `getVisibleCommands()` calls `getCommands()` which just iterates a plain array and calls functions -- Solid can track signal reads inside those function calls, so this SHOULD work IF the modeline calls `visibleCommands()` inside the JSX tree (which it does via `<For each={visibleCommands()}>`).

Actually, on deeper analysis: when `visibleCommands()` is called inside `<For>`, Solid creates a tracking scope. Inside that scope, `getVisibleCommands()` -> `getCommands()` iterates the factories and calls each. Each factory call invokes `createGlobalCommands(options)` which reads `options.isDialogEmpty()` = `dialog.isEmpty()` = reads the `stack` signal from `dialog.tsx:33`. So Solid WILL track this dependency, and the modeline WILL re-render.

Downgrading this to MAJOR because the `enabled: !options.isDialogEmpty()` pattern (evaluating a boolean eagerly in the factory) works correctly due to factories being re-invoked each time. But it's fragile -- if anyone caches the command array or memoizes `getCommands()`, reactivity breaks silently. The pattern should either: (a) make `enabled` accept a function `() => boolean` for reactive fields, or (b) document clearly that factories MUST be pure closures that read signals on each invocation. As-is, this is a landmine for the next phase.

#### [MAJOR] `ctrl+l` (clear) is not hidden from modeline, contradicting scope doc (`register-global.ts:17`)

```ts
{
  title: "clear",
  value: "global.clear",
  keybind: "ctrl+l",
  category: "Global",
  hidden: false,  // <-- should be hidden
  enabled: true,
  ...
}
```

The scope doc (rewrite-scope.md line 596) says: "`ctrl+l` clear-and-repaint -- **now with a palette entry** (hidden from modeline by default but discoverable via command palette)." The current code sets `hidden: false`, which means `ctrl+l` appears in the modeline alongside the Main commands, consuming limited modeline real estate.

This should be `hidden: true` to match the spec. Since `handleKeyEvent` currently skips hidden commands (the CRITICAL finding above), fixing this requires fixing both issues together.

#### [MINOR] Unused `onCleanup` import (`main-screen.tsx:1`)

```ts
import { createSignal, Show, onCleanup } from "solid-js";
```

`onCleanup` is imported but never used in the component body. CLAUDE.md: "No unused code."

#### [MINOR] Ternaries in computed functions outside JSX (`last-run-banner.tsx:15-16`, `context-picker.tsx:105-106`)

`last-run-banner.tsx:15-16`:
```ts
const statusColor = () => (props.passed ? COLORS.GREEN : COLORS.RED);
const statusIcon = () => (props.passed ? TICK : CROSS);
```

`context-picker.tsx:105-106`:
```ts
fg: isSelected() ? COLORS.PRIMARY : COLORS.TEXT
{isSelected() ? "\u25B6 " : "  "}
```

CLAUDE.md says "Never use ternary operators for conditional rendering in JSX." The `statusColor`/`statusIcon` ternaries in `last-run-banner.tsx` are in computed functions, not directly in JSX, so they're borderline acceptable. However, the ternaries in `context-picker.tsx:105-106` are directly inside JSX `<span>` attributes and children, which is a direct violation. Use `<Show>` or `&&` patterns.

Also `changes-banner.tsx:34`:
```tsx
{props.fileCount === 1 ? "" : "s"}
```
This is an inline JSX ternary for pluralization.

#### [MINOR] `as unknown as KeyEvent` cast in test file (`tests/commands/register-main.test.ts:21`)

```ts
return { ...base, ...overrides } as unknown as KeyEvent;
```

This is a double cast. While test files have more latitude, this masks any type drift between the mock and the real `KeyEvent` type. Consider using `Partial<KeyEvent>` + runtime defaults or creating a proper test helper that satisfies the full interface.

#### [MINOR] Toast module-level mutable state (`toast.tsx:31`)

```ts
let nextToastId = 0;
```

Module-level mutable state. If two `ToastProvider` instances existed (e.g., in tests), they'd share the same counter. Not a bug per se -- IDs only need to be unique within a provider -- but worth noting.

#### [INFO] `changes-banner.tsx:34` uses `props.fileCount === 1 ? "" : "s"` pluralization

This is a ternary, but it's a string-computation ternary for pluralization, not a rendering ternary. Borderline. Could be extracted to a helper.

#### [INFO] No `event.preventDefault()` calls in Input for handled keys

The Input component (`input.tsx`) handles many keys (backspace, delete, ctrl+a, ctrl+e, ctrl+w, arrows, etc.) but never calls `event.preventDefault()` on handled events. In OpenTUI, `event.preventDefault()` suppresses the event from being dispatched to further handlers. The context-picker (`context-picker.tsx:43-84`) does call `event.preventDefault()` correctly. The Input should follow the same pattern for consistency and correctness (see CRITICAL #2 above).

#### [INFO] `handleKeyEvent` iterates all commands linearly on every keypress

`command.tsx:97-108` iterates the full command list on every keypress. With the current ~10 commands this is negligible, but as phases add more commands (Results has 9+, Testing has 5+, etc.), this becomes O(n) per keypress. A Map lookup by keybind would be O(1). Not blocking, but worth noting for P3+.

#### [INFO] `getCommands()` re-invokes all factories on every call

`command.tsx:48-55` rebuilds the full command list by calling all factories on every `getCommands()` call. This happens on every keypress (via `handleKeyEvent`) and every render frame (via `modeline.tsx` calling `getVisibleCommands()`). At 60 FPS + keystrokes, factories are called ~60+ times/sec. The current factories are trivial, but as more phases add heavier factories this could become a performance concern. Consider caching with Solid's `createMemo` or a dirty flag.

### Suggestions (non-blocking)

- Consider making `enabled` accept `boolean | (() => boolean)` and evaluate lazily in `handleKeyEvent`/`getVisibleCommands`. This would make the reactive intent explicit rather than relying on the factory re-invocation pattern.
- The `handleKeyEvent` function should also handle the `disabled` vs `enabled` distinction more clearly. Currently `disabled: true` has no effect on key handling -- only `enabled: false` gates. The `disabled` flag is meant to grey out a palette entry but still allow keybind triggering per the opencode reference. Verify this is intentional.
- Add a test that exercises the `hidden: true` + keybind trigger path (e.g., register a hidden command, simulate its keybind via `handleKeyEvent`, assert `onSelect` fires). This would have caught CRITICAL #1.
- Add a test for the Input/command-registry priority interaction -- simulate `ctrl+a` with a focused Input and verify only one handler fires (or that the intended behavior is documented).
- The `createTestRegistry` in `register-main.test.ts:24-63` duplicates the logic of `createCommandRegistry` from `command.tsx`. Consider exporting `createCommandRegistry` and using it directly in tests.
