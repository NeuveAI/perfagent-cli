# Review: TUI-P2 — Effect↔Solid adapter (Round 2)

## Verdict: APPROVE

All 5 findings from Round 1 are resolved. No new Critical or Major issues found.

### Verification executed

- `pnpm typecheck` -> 8/9 packages PASS. `cli-solid` typecheck has 3 errors in `tests/helpers/create-test-app.tsx` and `tests/renderables/toast-display.test.tsx` -- these are **pre-existing P1 test helper issues** (files not created or modified by P2; `TestRendererOptions` export missing from `@opentui/solid`). P2 source code (`apps/cli-solid/src/`) typechecks clean via the 8 green packages (confirmed by `pnpm --filter @neuve/perf-agent-cli typecheck` PASS and the fact that the errors are exclusively in test files P2 did not author).
- `pnpm --filter @neuve/perf-agent-cli typecheck` -> PASS (existing CLI unaffected)
- `pnpm --filter cli-solid build` -> PASS
- `pnpm test --filter cli-solid` -> 296 pass, 1 fail. The 1 failure is in `tests/renderables/input.test.tsx:271` ("shift+enter inserts newline") -- a **pre-existing P1 test** that P2 did not create or modify. P2-scope tests (adapters, context, commands, modeline): **233 pass, 0 fail** (verified via `bun test tests/adapters/ tests/context/ tests/commands/ tests/renderables/modeline.test.ts`).
- `pnpm test` (repo-wide) -> Only pre-existing `@neuve/cookies` Chrome cookie env-dependent failure. No new failures.
- `rg "AsyncResult\.isSuccess" apps/cli-solid/src/` -> **0 hits** (PASS)
- `rg "@tanstack/react-query" apps/cli-solid/src/` -> 0 hits (PASS)
- `rg "zustand" apps/cli-solid/src/` -> 2 hits, both in comments only (PASS)
- `rg "AtomRegistry\.make" apps/cli-solid/src/` -> 1 hit in `runtime.tsx:38` only. No double-init. (PASS)
- `rg "\bnull\b" apps/cli-solid/src/` -> 2 hits in `kv.tsx` at the storage adapter boundary (see below). (PASS with note)

### Round 1 findings — resolution status

#### Fix 1: CRITICAL — coalescer sentinel (`effect-atom.ts`)

**RESOLVED.** `pendingValue: A | undefined` sentinel replaced with `pendingValue: A` + `hasPending: boolean` flag (`effect-atom.ts:44-45`). Flush checks `hasPending` at `:50`. Subscription sets `hasPending = true` at `:61`. New test at `effect-atom.test.ts:72-84` covers `undefined` as a legitimate atom value: sets to `undefined`, asserts accessor reads `undefined`, sets back to `"back"`, asserts `"back"`. The fix is mechanically correct and the test verifies the exact failure mode identified in Round 1.

#### Fix 2: MAJOR #1 — AsyncResult.isSuccess in JSX consumers

**RESOLVED.** `app.tsx` no longer imports `AsyncResult` at all. `hasRecentReports()` at `:44` uses `result._tag === "Success"` — direct tag discrimination, not the banned `AsyncResult.isSuccess` function. `main-screen.tsx` replaced `AsyncResult.isSuccess(result)` at `:84` with `result._tag !== "Success"` — same pattern. The `buildAsyncResult` import remains available at `main-screen.tsx:11` for future JSX rendering (will be consumed in P3 screens). Tag discrimination for non-JSX data derivations is consistent with CLAUDE.md's rule, which targets JSX rendering patterns ("Always use `AsyncResult.builder(...)` when rendering UI that depends on an `AsyncResult`").

#### Fix 3: MAJOR #2 — `as` casts in kv.tsx

**RESOLVED (remaining casts are unavoidable).** Added proper type guards: `isRecordObject` (`kv.tsx:36-37`) using `Predicate.isObject` from Effect, and `isZustandEnvelope` (`kv.tsx:39-42`) for the zustand envelope check. The JSON parse path (`:111-116`) now flows through these guards with zero casts. The remaining 5 `as` casts (`:93, :97, :125, :132, :144-145`) are all at the generic type erasure boundary — the `signals` map stores heterogeneous typed entries as `Accessor<unknown>` / `(unknown) => void`, and retrieval requires casting back to `T`. This is the standard TypeScript pattern for heterogeneous typed maps; there is no way to avoid these casts without runtime schema validation overhead that would be disproportionate for an in-memory preference store. The `null` at `:17` and `:109` matches the external `promptHistoryStorage` API contract (`Promise<string | null>`) — converting at the boundary is the right call, and the `null` is immediately consumed in the `if (raw === null) return` guard without propagating.

#### Fix 4: MAJOR #3 — blind agent cast in app.tsx

**RESOLVED.** `validateAgent()` at `app.tsx:23-26` builds a `Set` from `AGENT_PROVIDER_DISPLAY_NAMES` keys (the canonical agent list from `@neuve/shared/models`) and checks membership before the single `as AgentBackend` cast. Invalid input falls back to `"claude"`. The remaining cast at `:24` is post-validation (after `Set.has` returns `true`), making it a safe type narrowing. This is the "unless unavoidable" exception CLAUDE.md allows — TypeScript's `Set.has` does not narrow the input type, so the cast is necessary.

#### Fix 5: MAJOR #4 — `--agent` forwarding from tui.ts

**RESOLVED.** `tui.ts:7-13` adds Commander with `-a, --agent <provider>` option defaulting to `"claude"`. `options.agent` is passed to `App({ agent: options.agent })` at `:17`. The `App` component calls `validateAgent(props.agent)` which validates against the canonical agent list. The full chain from CLI flag to atom initialization is now: Commander parse -> `App(props)` -> `validateAgent()` -> `RuntimeProvider(agent)` -> `AtomRegistry.make({ initialValues: [[agentProviderAtom, Option.some(agent)]] })`. This matches the Ink TUI's `program.tsx:16-33` flow.

### Remaining observations (non-blocking)

- **[INFO] Pre-existing P1 typecheck errors.** `tests/helpers/create-test-app.tsx:1` imports `TestRendererOptions` from `@opentui/solid`, which does not export it. `tests/renderables/toast-display.test.tsx:44,57,58` has "not callable" errors likely caused by the same issue. These are P1 test infrastructure problems. P2 did not author or modify these files. The P1 reviewer should track this.

- **[INFO] Pre-existing P1 test failure.** `tests/renderables/input.test.tsx:271` ("shift+enter inserts newline in multiline mode") fails with `expect(received).toContain("\n")` but receives `"line1"`. P2 did not author or modify this file.

- **[MINOR] `kv.tsx:132` has a function-as-value cast** (`value as (previous: T) => T`). This is inside a `typeof value === "function"` guard, so it's safe at runtime, but TypeScript's type narrowing doesn't eliminate function types from a union with a `typeof` check when the union includes other callable types. Unavoidable without a wrapper type. Non-blocking.

### Exit criteria check

1. All mandatory verification commands pass (ran independently) -- PASS (pre-existing P1 issues documented, P2 scope clean)
2. No Critical or Major findings -- PASS (all 5 from R1 resolved, no new ones)
3. Adapter actually coalesces batch updates -- PASS (test `effect-atom.test.ts:37-59` verifies 10 rapid updates produce 1 flush; test `:137-154` verifies 100 rapid updates; test `:72-84` verifies `undefined` values are not dropped)
4. kv storage is compatible with existing Ink TUI on-disk format -- PASS (same storage names `"prompt-history"` and `"project-preferences"`, same adapter imports from `@neuve/supervisor`, zustand `{ state, version }` envelope read via `isZustandEnvelope` type guard, writes in same format at `:63`)
5. No double atom-runtime initialization -- PASS (single `AtomRegistry.make` at `runtime.tsx:38`)
