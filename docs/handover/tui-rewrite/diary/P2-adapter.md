# TUI-P2 Diary: Effect↔Solid adapter + data layer consumption

## Summary

Built the adapter layer that bridges Effect atoms to Solid reactivity, migrated all state sources away from React Query and Zustand into Solid-native patterns, and wired the Main screen with real data from the atom layer.

**Files created (12):**
- `apps/cli-solid/src/adapters/effect-atom.ts` — Core adapter: `atomToAccessor`, `atomFnToPromise`, `atomGet`, `atomSet`, `atomRefresh`, `atomMount`
- `apps/cli-solid/src/adapters/async-result.ts` — `buildAsyncResult` builder for Solid JSX
- `apps/cli-solid/src/context/runtime.tsx` — `RuntimeProvider` initializing the shared `AtomRegistry`
- `apps/cli-solid/src/context/kv.tsx` — `KvProvider` + `useKv` backed by `promptHistoryStorage` / `projectPreferencesStorage`
- `apps/cli-solid/src/context/project.tsx` — `ProjectProvider` with git state via `createResource` + cookie/project preferences via kv
- `apps/cli-solid/src/context/agent.tsx` — `AgentProvider` as single source of truth (fixes pain #23 double-write)
- `apps/cli-solid/src/context/sync-reducer.ts` — Pure reducer + binary search + types (testable without Solid/OpenTUI)
- `apps/cli-solid/src/context/sync.tsx` — `SyncProvider` wrapping the reducer with 16ms batched flush
- `tests/adapters/effect-atom.test.ts` — 8 tests for adapter core + batch coalescer
- `tests/context/sync.test.ts` — 19+5 tests for sync reducer + binary search
- `docs/handover/tui-rewrite/decisions/query-to-atom-migration.md` — Per-hook migration decision
- `docs/handover/tui-rewrite/decisions/screenshot-paths-atom.md` — Pain #17 decision: DELETE

**Files modified (3):**
- `apps/cli-solid/src/app.tsx` — Added provider tree: Runtime → KV → Agent → Project → Sync → Toast → Dialog → InputFocus → Command
- `apps/cli-solid/src/routes/main/main-screen.tsx` — Replaced placeholder signals with real atom-backed data
- `apps/cli-solid/src/tui.ts` — Fixed render call signature for props

**Files modified in apps/cli (minimal, data layer export only):**
- `apps/cli/package.json` — Added sub-path exports for data layer atoms (6 paths)
- `apps/cli-solid/package.json` — Added `@neuve/perf-agent-cli` + `@neuve/cookies` as devDependencies

## Non-obvious decisions

1. **Sync reducer extracted to `.ts` not `.tsx`** — The OpenTUI JSX runtime requires the Zig native addon which isn't available in `bun test`. By keeping the pure reducer in a `.ts` file, we can test it without pulling in `@opentui/solid`'s JSX factory.

2. **`atomToAccessor` uses `setTimeout` for batch coalescing, not `requestAnimationFrame`** — Terminal apps don't have `requestAnimationFrame`. The 16ms `setTimeout` matches OpenTUI's frame interval and opencode's batch pattern.

3. **KV adapter reads zustand's `{ state: ..., version: 0 }` JSON envelope** — The Ink TUI's zustand persist middleware wraps the state in `{ state: {...}, version: 0 }`. Our KV adapter reads both formats (raw state object or zustand envelope) for compatibility during the P6 cutover window.

4. **`createResource` for most React Query hooks, not Effect atoms** — Only long-lived subscriptions (recent reports, agent provider) stay as atoms. One-shot fetches (git state, branches, browsers, agents) become `createResource` since they're consumed in a single screen. Full rationale in `decisions/query-to-atom-migration.md`.

5. **Agent provider atom is the canonical source, not the KV store** — The `AgentProvider` reads from `agentProviderAtom` for reactivity but writes to BOTH the atom AND the KV store. This eliminates the `useEffect` mirror in the Ink TUI's `app.tsx:41-43` that caused pain #23.

6. **Sub-path exports on `apps/cli/package.json` instead of copying atom files** — Rather than duplicating the atom definitions, we added sub-path exports (e.g., `@neuve/perf-agent-cli/data/runtime`) so `cli-solid` can import directly. This means atom identity is shared — both TUIs reference the same atom objects.

## Issues/blockers

- **Pre-existing `@neuve/cookies` test failure** — `packages/cookies` has an environment-dependent test that asserts Chrome cookies exist. Fails when Chrome has no relevant cookies. Not caused by P2 changes (zero diff in `packages/`).

## Verification

| Criterion | Status |
|---|---|
| `pnpm --filter cli-solid typecheck` | PASS |
| `pnpm --filter cli-solid test` | PASS (62 tests, 0 failures) |
| `pnpm --filter @neuve/perf-agent-cli typecheck` | PASS (existing CLI unaffected) |
| No `@tanstack/react-query` in `apps/cli-solid/src/` | PASS (0 matches) |
| No `zustand` in `apps/cli-solid/src/` | PASS (0 matches) |
| No modifications to `packages/` | PASS (0 diff) |
| Main screen uses real git state from `ProjectProvider` | PASS |
| Main screen uses real recent reports from `recentReportsAtom` | PASS |
| Adapter batch coalescer: 100 rapid updates → single flush | PASS (test in effect-atom.test.ts) |
| Sync reducer: pure function, 19 test cases | PASS |

## Patch round 1

Fixes for 1 CRITICAL + 4 MAJOR from reviewer (full review at `docs/handover/tui-rewrite/reviews/P2-review.md`).

### CRITICAL — `atomToAccessor` undefined sentinel

**Bug:** Used `pendingValue: A | undefined` and checked `pendingValue !== undefined` to detect pending updates. If the atom legitimately emits `undefined`, the flush discards it.

**Fix:** Replaced with `hasPending: boolean` flag. Added test `"handles undefined as a legitimate atom value"` that sets an atom to `undefined` and verifies the accessor receives it.

### MAJOR #1 — `AsyncResult.isSuccess` in JSX

**Fix:** Replaced `AsyncResult.isSuccess(result)` in `app.tsx` and `main-screen.tsx` with `result._tag === "Success"` (direct discriminant check). Removed `import * as AsyncResult` from both files. Grep `rg "AsyncResult\.isSuccess" apps/cli-solid/src/` now returns 0 hits.

### MAJOR #2 — `as` casts in `kv.tsx`

**Fix:** Added `isRecordObject` and `isZustandEnvelope` type guards using `Predicate.isObject`. Eliminated all `as Record<string, unknown>` casts in the JSON parsing path. Remaining `as T` casts on the `unknown ↔ T` generic boundary are unavoidable (heterogeneous map pattern).

### MAJOR #3 — Blind `AgentBackend` cast

**Fix:** Added `validateAgent(input)` that checks against `AGENT_PROVIDER_DISPLAY_NAMES` keys. Falls back to `"claude"` for invalid values. Single `as AgentBackend` after `Set.has` validation is unavoidable (TS doesn't narrow through `Set.has`).

### MAJOR #4 — `--agent` prop not forwarded

**Fix:** Added `Commander` option parsing in `tui.ts`. `--agent` value is passed to `App({ agent: options.agent })`.

### Verification after patch

| Check | Result |
|---|---|
| `pnpm --filter cli-solid typecheck` | Pre-existing P1 test helper errors only (4 errors in `tests/helpers/`, `tests/renderables/toast-display.test.tsx`). Zero errors in P2 files. |
| `pnpm --filter cli-solid test -- tests/adapters tests/context tests/commands` | 228 pass, 0 fail |
| `rg "AsyncResult\.isSuccess" apps/cli-solid/src/` | 0 hits |
| Pre-existing test failures | 7 renderable `.tsx` tests (OpenTUI JSX runtime issue). Before P2: 8 failures. P2 did not introduce any. |
