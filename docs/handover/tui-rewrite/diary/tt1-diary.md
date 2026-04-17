# TT-1 — Terminal teardown fix

## Summary

After `ctrl+q` / `ctrl+c` the Solid TUI exited without calling `CliRenderer.destroy()`, so the Kitty keyboard protocol and alternate-screen mode stayed enabled in the parent shell. Subsequent keystrokes like `ctrl+k` printed raw escape fragments (`7;5u`). Fix: register a cleanup handler that calls `renderer.destroy()` inside `AppInner`, after `useRenderer()`.

## What changed

File: `apps/cli-solid/src/app.tsx`

1. `app.tsx:1` — added `onCleanup` to the solid-js import.
2. `app.tsx:13` — added `import { registerCleanupHandler, isShuttingDown } from "./lifecycle/shutdown";`.
3. `app.tsx:67-75` — inside `AppInner`, directly after `const renderer = useRenderer();`:

   ```ts
   const unregisterRendererCleanup = registerCleanupHandler(() => {
     renderer.destroy();
   });

   onCleanup(() => {
     unregisterRendererCleanup();
     if (isShuttingDown()) return;
     renderer.destroy();
   });
   ```

No other files touched. No new files created. No `try/catch` around `destroy()` (spec explicitly forbids unless destroy can be shown to throw).

## Approach: inline in AppInner (not a helper file)

I picked the **inline** approach over creating `lifecycle/renderer-cleanup.ts`.

Why:
- It's five lines of code, used in exactly one place. A dedicated helper file for five lines with no reuse is extra indirection without payoff.
- The pattern mirrors exactly what `RuntimeProvider` already does (`apps/cli-solid/src/context/runtime.tsx:51-61`): `registerCleanupHandler` + `onCleanup` with an `isShuttingDown()` guard. Consistency with the existing codebase.
- `AppInner` already calls `useRenderer()` on the existing line (was line 62, now line 63) — we need the renderer there anyway to wire `clearScreen` into `createGlobalCommands`.

## Ordering / design constraint

`runCleanupHandlers()` iterates in REVERSE order (`shutdown.ts:69`). The registration order is:

1. `RuntimeProvider` body runs first (outermost React/Solid provider) → pushes `unmountReports(); registry.dispose();`.
2. `AppInner` body runs later (it's the deepest child) → pushes `renderer.destroy();`.

Reversed on teardown, `renderer.destroy()` runs BEFORE `registry.dispose()`. That's what we want: the terminal write path must still be alive when reset sequences are emitted. Verified by reading both component bodies and the reverse-iteration loop in `shutdown.ts`.

The Solid-tree-disposed-without-shutdown branch (`onCleanup` with the `isShuttingDown()` guard) also calls `renderer.destroy()` so we don't leak terminal state if the tree is torn down outside the shutdown path. This mirrors `RuntimeProvider` exactly.

## Verification

### TypeScript

```
$ bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
(no output — clean)
```

### Tests

```
$ cd apps/cli-solid && bun test
bun test v1.3.11 (af24e281)

 559 pass
 0 fail
 1075 expect() calls
Ran 559 tests across 32 files. [6.88s]
```

All 559 tests pass (unchanged from baseline).

### Manual smoke test

Not performed in this session — the teammate environment doesn't have an interactive shell with Kitty keyboard support for me to verify `ctrl+k` printing `7;5u` fragments before/after. Per the overlays-plan spec (`overlays-plan.md:57`): "Manual verification only — cannot be unit-tested because it depends on real stdout." The lead or user should:

1. `cd apps/cli-solid && bun run build`
2. `bun dist/tui.js tui -a local`
3. Press `ctrl+q` to exit.
4. In the shell afterward, type `ctrl+k` — should be a normal shell keystroke, NOT print `7;5u`.

## Notes for reviewer

- `renderer.destroy()` is `void` in the opentui type definitions (`@opentui/core/renderer.d.ts:375`) — per the spec we do not wrap it in `try/catch`. If it throws in practice, we want to see that failure loudly.
- Registration order depends on Solid component mount order: `RuntimeProvider` (outer) → `AppInner` (inner). If a future refactor moves `useRenderer()` usage into a provider that mounts BEFORE `RuntimeProvider`, the reverse-order guarantee breaks and `destroy` would run AFTER `registry.dispose`. No known risk today, but worth noting.
- The `onCleanup` fallback destroys the renderer even outside the shutdown path. In the current tree `AppInner` only unmounts when the entire tree tears down, so in practice the `onCleanup` branch is defensive — but again, mirrors `RuntimeProvider`'s pattern.
