# Review: TT-1 — Destroy renderer on shutdown

## Verdict: APPROVE

### Verification performed

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — clean (no output). Matches diary.
- `bun test` — 559 pass / 0 fail / 1075 expect() calls across 32 files. Matches diary.
- Diff in `apps/cli-solid/src/app.tsx:1,13,67-75` matches diary exactly (added `onCleanup` import, shutdown lifecycle import, and the inline `registerCleanupHandler` + `onCleanup` block immediately after `useRenderer()`).
- `apps/cli-solid/src/lifecycle/shutdown.ts:68-76` — `runCleanupHandlers` snapshots via `[...cleanupHandlers].reverse()` then iterates, so mutations during iteration (from `unregister*` called inside handlers) do NOT affect the loop. LIFO order is correct.
- `apps/cli-solid/src/lifecycle/shutdown.ts:38-47` — `registerCleanupHandler` returns an `unregister` function that is safe to call multiple times (uses `indexOf` + splice guarded by `-1` check; a second call is a no-op).

### Review answers

1. **Ordering** — `RuntimeProvider` body runs before `AppInner` body (provider is outer, AppInner is deep child). Registration pushes: `[registry.dispose, renderer.destroy]`. Reverse iteration yields `renderer.destroy()` first, then `registry.dispose()`. That is the intended order (renderer's write path must still be alive when reset sequences emit). Confirmed in `apps/cli-solid/src/context/runtime.tsx:51-54` + `apps/cli-solid/src/app.tsx:67-69`.

2. **Double-destroy risk** — `CliRenderer.destroy()` is idempotent. Verified in `node_modules/.pnpm/@opentui+core@0.1.99_.../renderer.d.ts:140-142` (`_isDestroyed`, `_destroyPending`, `_destroyFinalized` flags) and in the runtime source at `node_modules/.pnpm/@opentui+core@0.1.99_.../index-8978gvk3.js:20348-20358`:
   ```js
   destroy() {
     if (this._isDestroyed) return;
     this._isDestroyed = true;
     ...
   }
   ```
   Second calls return immediately. The `isShuttingDown()` guard in the `onCleanup` branch additionally avoids the non-shutdown destroy when shutdown is already in flight, so the scenario is fully covered.

3. **`onCleanup` re-registration** — `AppInner` sits inside `<CommandProvider>` inside `<InputFocusProvider>` inside the other providers. In Solid, `onCleanup` inside a component body runs exactly once when the owning reactive scope disposes. `AppInner` is not wrapped in a `<Show>` or `<For>` that could unmount/remount it, so no re-registration leak in the current tree. If a future refactor put `AppInner` under dynamic mounting, the handler would re-register on each mount; not a current bug.

4. **Unregister-during-shutdown race** — `runCleanupHandlers` iterates over a frozen snapshot (`[...cleanupHandlers].reverse()`). When `renderer.destroy()` fires, it emits a `"destroy"` event handled inside `@opentui/solid`'s `mountSolidRoot` (`node_modules/.pnpm/@opentui+solid@0.1.99_.../index.js:1155`), which calls Solid's `dispose()` and in turn fires `onCleanup` for `AppInner` and `RuntimeProvider`. Each `onCleanup` calls its `unregister*` and then skips the fallback via `isShuttingDown()`. Because the snapshot was taken before the loop started, the splice has no effect on the remaining iterations — registry-dispose still runs.

5. **Sibling parity** — `RuntimeProvider` (`apps/cli-solid/src/context/runtime.tsx:51-61`) uses the identical pattern: `registerCleanupHandler` + `onCleanup` with `isShuttingDown()` guard. They cooperate: during shutdown both guards short-circuit the fallback; during non-shutdown Solid tree disposal only the outer (Runtime) fallback would run `registry.dispose()` after AppInner's fallback runs `renderer.destroy()`. The two never run on top of each other.

6. **Signal handler scope** — `installSignalHandlers()` runs in `apps/cli-solid/src/tui.ts:9` BEFORE `render()` creates the renderer, and before `AppInner` mounts. A SIGINT arriving in that narrow window triggers `initiateShutdown()` with no cleanup handlers registered, so the terminal won't be reset. This is a pre-existing condition, not introduced by TT-1, and in practice the window is tens to hundreds of ms at process startup. Flagged as INFO, not blocking.

7. **Error leaks from `destroy()`** — `runCleanupHandlers` wraps each handler in `try { await handler() } catch {}` (`apps/cli-solid/src/lifecycle/shutdown.ts:71-73`), so a throw during shutdown does not halt the rest of the cleanup. On the `onCleanup` fallback path (non-shutdown), there is no try/catch, so a throw from `renderer.destroy()` would propagate into Solid's disposal. This is acceptable per the spec ("do NOT add try/catch around destroy()") and, given `destroy()`'s early-return idempotency, a real throw is unlikely.

8. **Renderer identity** — `useRenderer()` reads from `RendererContext` (`node_modules/.pnpm/@opentui+solid@0.1.99_.../index.js:30-31`). That context is populated by `mountSolidRoot` with the same `renderer` constructed in `render()` (line 1164-1171 provides `renderer` as the context value). So the renderer in `AppInner` is the same instance from `render()` in `tui.ts`. Calling `.destroy()` hits the real renderer.

### Findings

- [INFO] Pre-existing SIGINT-before-mount window (`apps/cli-solid/src/tui.ts:9`) — handlers installed before `render()` mounts `AppInner`, so a ctrl+c during that ~startup window still leaks terminal state. Not regressed by TT-1, but worth noting if we later want to guarantee zero-leak startup. Could be addressed by calling `renderer.destroy()` directly in an `onDestroy`/shutdown hook wired closer to `render()`.
- [INFO] The `onCleanup` fallback branch in `AppInner` is defensive today — in the current tree `AppInner` only unmounts when the whole process tears down. Left in for parity with `RuntimeProvider`'s identical pattern, which is the right call.
- [MINOR] Registration-order invariant is load-bearing but undocumented at the call site. If a future refactor introduces a new provider that calls `useRenderer()` above `RuntimeProvider`, the LIFO guarantee breaks (renderer-destroy would run AFTER registry-dispose). The diary notes this but a one-line comment at `apps/cli-solid/src/app.tsx:67` saying `// HACK: must register AFTER RuntimeProvider so LIFO destroys renderer before disposing registry` would make the invariant explicit. Non-blocking.

### Suggestions (non-blocking)

- Consider moving `installSignalHandlers()` to fire AFTER `render()` resolves enough to expose the renderer, so the destroy handler is guaranteed to be registered before signals can arrive. Or register a single unconditional renderer-destroy cleanup inside `tui.ts` right after `render()` awaits (using `renderer` captured from the returned promise or via `CliRenderer` instance) to close the pre-mount window.
- Inline five-line approach is the right call over a dedicated helper file; agree with the engineer's reasoning in the diary. Matches existing `RuntimeProvider` pattern.
