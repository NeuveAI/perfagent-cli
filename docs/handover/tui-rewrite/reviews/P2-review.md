# Review: TUI-P2 — Effect↔Solid adapter (Round 1)

## Verdict: REQUEST_CHANGES

### Verification executed

- `pnpm typecheck` -> PASS (9/9 packages green, including cli-solid and @neuve/perf-agent-cli)
- `pnpm test --filter cli-solid` -> PASS (62 tests, 0 failures, 155 expect() calls)
- `pnpm --filter @neuve/perf-agent-cli typecheck` -> PASS (existing CLI unaffected)
- `pnpm --filter cli-solid build` -> PASS (build completes)
- `pnpm test` (repo-wide) -> 1 pre-existing failure in `@neuve/cookies` (Chrome cookie expiry test, environment-dependent, documented in diary as pre-existing). No new failures.
- `rg "@tanstack/react-query" apps/cli-solid/src/` -> 0 hits (PASS)
- `rg "zustand" apps/cli-solid/src/` -> 2 hits, both in comments only (`kv.tsx:7` "zustand-persist", `agent.tsx:58` "zustand store"). No import of the `zustand` package. (PASS)
- `rg "AsyncResult\.isSuccess" apps/cli-solid/src/` -> 2 hits (FAIL — see finding #2)
- `rg "\bnull\b" apps/cli-solid/src/` -> 4 hits in `kv.tsx` (see finding #4)
- `rg "\bas " apps/cli-solid/src/` -> ~12 hits in `kv.tsx` + 1 in `app.tsx` + 1 in `sync-reducer.ts` + several in imports (see finding #5)
- Grep for `AtomRegistry.make` in cli-solid/src -> exactly 1 hit in `runtime.tsx:38`. No double-init. (PASS)
- Grep for `react`, `ink`, `@effect-atom/react` in cli-solid/src -> 0 import hits. (PASS)
- Grep for `ScreenshotCaptured` in sync-reducer -> 0 hits (see finding #7)

### Findings

#### Critical

- **[CRITICAL] `atomToAccessor` batch coalescer silently drops `undefined` atom values** (`effect-atom.ts:44,49`). The `pendingValue` sentinel is typed `A | undefined` and the flush guard checks `if (pendingValue !== undefined)`. If atom `A` is `Atom<T | undefined>` (or any type where `undefined` is a valid value), an `undefined` emission is silently discarded — the signal never updates. While the atoms currently consumed (`recentReportsAtom`, `agentProviderAtom`) return `AsyncResult` / `Option` (never bare `undefined`), the adapter is generic and claims to work for any `Atom<A>`. This is a latent data-loss bug that will surface the first time someone subscribes to an atom whose value can be `undefined`. **Fix:** use a `{ value: A } | undefined` wrapper or a boolean `hasPending` flag instead of the bare sentinel.

#### Major

- **[MAJOR] `AsyncResult.isSuccess` used directly in JSX consumers — violates CLAUDE.md and P2 acceptance criteria** (`app.tsx:36`, `main-screen.tsx:86`). The scope doc section 5 states "Manual `AsyncResult.isSuccess` checks are banned (grep blocker in P2 acceptance)". The `buildAsyncResult` builder exists at `adapters/async-result.ts` but is not used in these two locations. `app.tsx:36` does `AsyncResult.isSuccess(result) && result.value.length > 0` and `main-screen.tsx:86` does `if (!AsyncResult.isSuccess(result)) return undefined`. Both must use `buildAsyncResult(...)` or the grep acceptance check fails.

- **[MAJOR] `kv.tsx` has 8+ `as` type casts** (`kv.tsx:76,90,94,100,101,112,119,130`). CLAUDE.md explicitly forbids type casts (`as`) unless unavoidable. The `kv.tsx` file has at minimum 8 casts, most of which are for generic map storage (`as Accessor<T>`, `as Record<string, unknown>`, `as T`). These are not "unavoidable" — the internal `signals` map could be typed more precisely (e.g., using a generic helper or typed wrapper), or the function could use `Schema.decode` as CLAUDE.md recommends for JSON parsing. This is a pattern violation that compounds across the file.

- **[MAJOR] `app.tsx:83` has an `as` cast for `AgentBackend`** (`app.tsx:83`). `const agent = (props.agent ?? "claude") as import("@neuve/agent").AgentBackend` — this blindly casts a string to a branded type with no validation. If `props.agent` is `"typo"`, it becomes a valid `AgentBackend` at runtime with no error. CLAUDE.md says "no type casts (`as`) unless unavoidable". This should validate via a schema or a runtime check.

- **[MAJOR] `tui.ts:6` passes no `agent` prop to `App`** (`tui.ts:6`). The render call is `App({})` but `App` reads `props.agent` and falls back to `"claude"`. This means the TUI always starts with `"claude"` regardless of what the user passed via Commander. The Ink TUI's `program.tsx:16` receives `agent: AgentBackend` as a parameter and passes it through. The Solid TUI's entry point ignores the Commander-parsed agent. This is a functional regression — users who run `perf-agent tui --agent codex` will always get claude.

#### Minor

- **[MINOR] `null` usage in `kv.tsx`** (`kv.tsx:16,85,89,93`). CLAUDE.md says "Never use null. Use `Option` from Effect or `undefined`." The `StorageAdapter` interface declares `getItem` as returning `Promise<string | null>`. This mirrors the external `promptHistoryStorage` API signature, which itself returns `null`. At the adapter boundary this is defensible (matching the external contract), but the internal checks at lines 85, 89, 93 propagate `null` through the code rather than converting to `undefined` at the boundary. Mitigation: convert `null` to `undefined` immediately after the `getItem` call.

- **[MINOR] `sync-reducer.ts:192` uses `as const`** (`sync-reducer.ts:192`). `status: "completed" as const` — this is an `as` cast. It's a common TypeScript pattern for literal narrowing and is arguably unavoidable for inline object literals in `.map()`, but worth flagging for consistency with the strict no-`as` rule.

- **[MINOR] `buildAsyncResult` eagerly evaluates instead of being reactive** (`async-result.ts:38-84`). The builder takes a plain `AsyncResult.AsyncResult<A, E>` value, not an `Accessor`. This means it evaluates once at call time. In Solid, to get reactive updates, the caller must call `buildAsyncResult(someAccessor())` inside a reactive context (like JSX). This works but is fragile — if called outside a tracking scope, the UI won't update. The opencode pattern wraps the entire builder in a reactive computation. Consider documenting this requirement prominently or accepting an `Accessor` as input.

- **[MINOR] `process.cwd()` used directly in `project.tsx:30`**. CLAUDE.md says "Never use `process.env`. Use `Config.string`." While `process.cwd()` is not `process.env`, it follows the same spirit of avoiding direct process access. The existing Ink TUI also uses `process.cwd()` for this, so this is consistent, but it should be injected as a prop/config for testability.

### Suggestions (non-blocking)

- The `atomFnToPromise` test at `effect-atom.test.ts:101-113` is essentially a no-op — it creates an `Atom.fnSync`, casts it, then has a comment saying "skip this test for fnSync". The second test at `:115-118` only checks `typeof`. Consider adding an integration test with a real `AsyncResult`-producing atom fn, or remove these placeholder tests to avoid false confidence in test counts.

- The sync reducer uses `Record<string, StepEntry>` for `steps` but `readonly StepId[]` for `stepOrder`. The `StepStarted` handler checks `state.stepOrder.includes(event.stepId)` — this is O(n) per step start. For the expected scale (~10-50 steps), this is fine, but if the scope grows, consider a Set or using the binary search utility that already exists in the file.

- The `SyncProvider`'s `flush` at `sync.tsx:60` reads `{ ...store }` into a local variable, then runs the reducer in a loop, then calls `setStore(current)`. The `{ ...store }` spread copies only top-level keys of the Solid store proxy — nested objects are still reactive proxies. The reducer treats them as plain objects (spreads them). This works because the reducer always returns new objects (immutable updates), but it's subtle. A comment clarifying this Solid store proxy interaction would prevent future confusion.

- The `SyncEvent` union does not include `ScreenshotCaptured`, which is listed in the scope doc section 5 as an event type. The decision doc `screenshot-paths-atom.md` says DELETE the atom, but the scope doc says "ScreenshotCaptured (currently dropped — pain #17)" — the reducer should at minimum have a no-op handler or the scope doc should be updated to reflect the decision. Currently the two docs are inconsistent.
