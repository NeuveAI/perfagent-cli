# Test Infrastructure Diary

## OpenTUI test capabilities discovered

`@opentui/core` ships a full testing toolkit under `@opentui/core/testing`:

- **`createTestRenderer({ width, height, kittyKeyboard?, ... })`** — creates a headless renderer with mock stdin/stdout. Returns `{ renderer, mockInput, mockMouse, renderOnce, captureCharFrame, captureSpans, resize }`.
- **`createMockKeys(renderer)`** — simulates keyboard input: `pressKey(key, modifiers?)`, `pressEnter()`, `pressEscape()`, `pressArrow(direction)`, `pressBackspace()`, `pressTab()`, `pressCtrlC()`, `typeText(text)`, `pasteBracketedText(text)`. Supports modifier combos `{ shift, ctrl, meta, super, hyper }`.
- **`createMockMouse(renderer)`** — simulates mouse: `click`, `doubleClick`, `drag`, `scroll`, `moveTo`, `pressDown`, `release`.
- **`createSpy()`** — lightweight call-tracking spy with `callCount()`, `calledWith()`, `reset()`.
- **`captureCharFrame()`** — snapshot the rendered terminal content as a plain string for assertions.
- **`captureSpans()`** — structured `CapturedFrame` with style/color metadata per span.

`@opentui/solid` wraps this as **`testRender(node, options?)`** — mounts a Solid component tree onto a test renderer and returns the same API surface. This is the primary entry point for component tests.

**Shift-modifier caveat:** Standard terminal escape sequences cannot distinguish `shift+enter` from `enter`. Tests that need shift/alt/super modifiers on special keys must opt into `kittyKeyboard: true` in the renderer options.

## Test harness design

### Preload requirement

Bun's default JSX transform targets React. OpenTUI's Solid JSX transform is loaded via a Babel preload plugin (`@opentui/solid/preload`). The existing `bunfig.toml` only had this in the top-level `preload` key, which Bun ignores for `bun test`. Added a `[test]` section:

```toml
[test]
preload = ["@opentui/solid/preload"]
```

No `@jsxImportSource` pragma is needed in test files — the preload plugin handles all `.tsx` transformation.

### Test helpers

- **`tests/helpers/make-key-event.ts`** — factory for `KeyEvent` instances. Provides named constructors: `ctrlKey("a")`, `arrowKey("up")`, `enterKey()`, `escKey()`, `backspaceKey()`, `charKey("x")`, `metaKey("b")`, `shiftEnterKey()`.
- **`tests/helpers/create-test-app.tsx`** — `renderInProviders(component, options?)` wraps a component in Toast/Dialog/InputFocus/Command providers for integration tests. `renderBare(component, options?)` for isolated rendering.

### Two test tiers

1. **Pure-logic tests** (`.test.ts`) — no rendering, no OpenTUI. Test keybind matching, command registry, dialog stack, toast queue, word-boundary cursor logic, sync reducer. Fast, no native dependency.
2. **Component tests** (`.test.tsx`) — use `testRender` + `captureCharFrame` / `mockInput`. Mount real Solid components into the headless renderer. Verify rendered output and keyboard interaction.

## Coverage summary

| Area | File | Tests |
|---|---|---|
| **Keybind matching** | `context/keybind.test.ts` | 72 (all ctrl+letter combos, arrow keys, special keys, modifiers, case insensitivity, rejection) |
| **Command registry** | `commands/register-main.test.ts` | 33 (existing: validation, dispatch, hidden, input focus) |
| **Command registry stress** | `context/command-registry-stress.test.ts` | 18 (20-command stress, register/unregister cycles, async onSelect, inputFocused interaction, empty registry) |
| **Global commands** | `commands/register-global.test.ts` | 7 (ctrl+l clear, ctrl+u update, esc pop/disabled, no collisions) |
| **Dialog stack** | `context/dialog.test.ts` | 12 (push/pop/replace/clear, onClose callbacks, empty pop, depth tracking) |
| **Toast queue** | `context/toast.test.ts` | 9 (show/dismiss, auto-dismiss timing, replacement, unique ids, rapid fire) |
| **Input focus** | `context/input-focus.test.ts` | 6 (focus transitions, text-editing key blocklist) |
| **Sync reducer** | `context/sync.test.ts` | 19 (existing: all event types, full lifecycle, binary search) |
| **Effect-atom adapter** | `adapters/effect-atom.test.ts` | 7 (existing: batch coalescer, accessor, atomGet/Set) |
| **Modeline derivation** | `renderables/modeline.test.ts` | 5 (existing: orphan hints, hidden/disabled, print labels) |
| **Word boundary** | `renderables/input-word-boundary.test.ts` | 18 (findPrevious/NextWordBoundary, cursorLineAndColumn, resolveOffset) |
| **Logo** | `renderables/logo.test.tsx` | 4 (render, text content, version, symbols) |
| **Spinner** | `renderables/spinner.test.tsx` | 4 (render, spinner frame, message, no-message) |
| **Screen heading** | `renderables/screen-heading.test.tsx` | 4 (uppercase title, subtitle, divider, no-divider) |
| **Ruled box** | `renderables/ruled-box.test.tsx` | 3 (children, rules, empty children) |
| **Input component** | `renderables/input.test.tsx` | 16 (placeholder, value, typing, backspace, enter/submit, @trigger, ctrl+a/e/w, arrows, delete, multiline shift+enter with kitty, up/down at boundary) |
| **Toast display** | `renderables/toast-display.test.tsx` | 3 (empty, show, replace) |
| **Modeline rendering** | `renderables/modeline-render.test.tsx` | 5 (visible with keybinds, hidden filter, disabled filter, divider, no-keybind) |

**Total: 296 tests across 18 files (up from 62 tests across 4 files).**

## Gaps

- **Context picker rendering tests** — `ContextPicker` requires `RuledBox` which reads terminal dimensions; works in testRender but no dedicated test file yet. Planned for P3 when the picker is wired to real data.
- **Main screen rendering** — `MainScreen` imports `recentReportsAtom` from `@neuve/perf-agent-cli` which requires Effect runtime. A full mount test needs mock atom injection, deferred to P3 integration tests.
- **Full App mount** — requires `RuntimeProvider` which spins up the ManagedRuntime. Smoke test planned for P6 cutover.
- **Adapter perf test** — "100 synthetic events/sec for 5 seconds" (mentioned in scope doc). Deferred to P4 when the sync store is wired to real streaming.
- **captureCharFrame snapshots** — not storing snapshot files. All assertions are behavioral (content checks), matching the project's preference for behavioral over snapshot tests.
