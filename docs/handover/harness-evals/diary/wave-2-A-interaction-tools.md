# Wave 2.A — First-class interaction tools

Date: 2026-04-23
Owner: `interaction-tools-eng` (team `harness-evals`)
Task: #5 — blocks Wave 3 (#8). Coordinates with Wave 2.C (#7) in `packages/browser/`.

## Goal

Give the 4B agent high-level `click`, `fill`, `hover`, `select`, `wait_for` tools so it stops writing `evaluate_script` JS for menu and form interactions. Each tool: resolve a ref, act on the element, wait for network idle, return a fresh accessibility snapshot so the next turn observes post-action state.

## Files added

All paths are absolute from repo root.

- `packages/browser/src/tools/types.ts` — branded `ToolRef`, option types, `ElementHandle` interface, and the `RefResolver` / `NetworkIdleSampler` / `SnapshotTaker` / `WaitForEngine` service interfaces.
- `packages/browser/src/tools/errors.ts` — `RefNotFoundError`, `InteractionError`, `WaitTimeoutError` via `Schema.ErrorClass`. `message` is a class field derived from fields, per CLAUDE.md.
- `packages/browser/src/tools/constants.ts` — `NETWORK_IDLE_MAX_WAIT_MS=2000`, `NETWORK_IDLE_POLL_INTERVAL_MS=100`, `WAIT_FOR_DEFAULT_TIMEOUT_MS=5000`, `WAIT_FOR_DEFAULT_STATE="visible"`.
- `packages/browser/src/tools/helpers.ts` — `waitForNetworkIdle()` polls `NetworkIdleSampler.inFlightCount()` with `Effect.repeat(..., until: idle)` bounded by `Effect.timeoutOption`; `captureSnapshot()` calls `SnapshotTaker.capture()`.
- `packages/browser/src/tools/click.ts` — `click(ref, options?)` — resolve → element.click → waitForNetworkIdle → captureSnapshot → return `{ snapshot }`.
- `packages/browser/src/tools/fill.ts` — `fill(ref, text, { clearFirst? })`.
- `packages/browser/src/tools/hover.ts` — `hover(ref)`.
- `packages/browser/src/tools/select.ts` — `select(ref, option)` where option is `string | number`.
- `packages/browser/src/tools/wait-for.ts` — `waitFor(target, { state?, timeout? })` where `target = { kind: "ref" | "selector" | "aria", … }`.
- `packages/browser/src/tools/live.ts` — production `Layer.effect` implementations of the four service interfaces that delegate to `DevToolsClient`. `RefResolver` currently treats the `ref` as a chrome-devtools-mcp `uid` (pass-through). Wave 2.C can later provide a SOM-aware override.
- `packages/browser/src/mcp/tools/interactions.ts` — registers five new MCP tools (`click`, `fill`, `hover`, `select`, `wait_for`) on the MCP server. Each tool uses a Zod-shaped schema, runs the Effect via `ManagedRuntime.runPromiseExit`, and returns the post-action snapshot text as the MCP content payload. `wait_for` requires exactly one of `ref|selector|aria`.
- `packages/browser/tests/tools/support.ts` — test layer factory that stubs the four services with an in-memory call log, configurable known refs, configurable failures per action, configurable snapshot text.
- `packages/browser/tests/tools/click.test.ts`, `fill.test.ts`, `hover.test.ts`, `select.test.ts`, `wait-for.test.ts` — one file per tool. Covers happy path, missing ref (RefNotFoundError), interaction failure (InteractionError), post-action snapshot returned, wait-for timeout (WaitTimeoutError), ARIA + selector + ref targets.

## Files modified

- `packages/browser/src/mcp/server.ts` — `createBrowserMcpServer` / `startBrowserMcpServer` now accept a runtime including the four tool services; they call `registerInteractionTools(server, runtime)` alongside the existing `registerInteractTool` / `registerObserveTool` / `registerTraceTool`. No prompt or existing tool behavior changed.
- `packages/browser/src/mcp/runtime.ts` — `McpRuntime` now merges the four tool layers and pulls `DevToolsClient.layer` via `Layer.provideMerge` so it satisfies sibling requirements while remaining exposed.

Not touched: `packages/shared/src/prompts.ts` (Wave 2.B), `packages/browser/src/set-of-mark.ts` (Wave 2.C), `packages/supervisor/`, any CLI app.

## RefResolver contract (for 2.C to implement an override)

`RefResolver` is a `ServiceMap.Service` with:

```ts
resolveRef(ref: ToolRef): Effect<ElementHandle, RefNotFoundError>
```

`ElementHandle` surfaces `click`, `fill`, `hover`, `select`, `isVisible` — each returning `Effect<…, InteractionError>`. The minimal contract 2.C must honor when providing a SOM-backed override:

1. `resolveRef(ref)` must fail with `RefNotFoundError` if the ref is not in the current SOM rendering.
2. The returned `ElementHandle` must fail with `InteractionError` if the underlying CDP call fails.
3. `isVisible()` is a cheap probe — used by `WaitForEngine.waitForRef` in the default implementation.

2.C can swap in a SOM-backed layer by providing a new `Layer.effect(RefResolver)` that maps SOM-numbered refs (e.g. `"3"`) to chrome-devtools-mcp uids using the overlay's `refs` table, leaving the rest of the tool pipeline unchanged.

## Post-action behavior

Every interaction wrapper (`click`, `fill`, `hover`, `select`) runs:

1. `RefResolver.resolveRef(ref)` — typed failure on missing ref.
2. `element.<action>(…)` — typed failure on underlying CDP failure.
3. `waitForNetworkIdle()` — polls `inFlightCount` until zero, capped at `NETWORK_IDLE_MAX_WAIT_MS` (2s). Uses `Effect.timeoutOption` so we record `networkIdleReached` in the span but never fail the action on a noisy site.
4. `captureSnapshot()` — returns the fresh accessibility tree as `ToolSnapshot { text, capturedAt }`.

`wait_for` skips the network-idle step (it is itself a debounce) but still captures a post-wait snapshot.

No `evaluate_script` JS is used inside any of the five wrappers.

## MCP tool shapes

| Tool | Input | Output |
|------|-------|--------|
| `click` | `{ ref: string, button?, clickCount? }` | content = snapshot text; `isError` on RefNotFoundError / InteractionError |
| `fill` | `{ ref, text, clearFirst? }` | same |
| `hover` | `{ ref }` | same |
| `select` | `{ ref, option: string \| number }` | same |
| `wait_for` | `{ ref? \| selector? \| aria?, state?, timeout? }` — exactly one target | content = snapshot text; `isError` on WaitTimeoutError / RefNotFoundError |

Errors surface to the agent as `{ content: [{ type: "text", text: <message> }], isError: true }` using `Cause.squash` to pull a readable message — defects included.

## Test summary

`pnpm --filter @neuve/devtools test`

- 6 test files, 28 tests, all pass.
- New tool tests: click (3), fill (3), hover (3), select (4), wait_for (5) = 18 new.
- Existing set-of-mark tests unchanged (10 tests).
- Tests use an in-memory `RefResolver | NetworkIdleSampler | SnapshotTaker | WaitForEngine` layer from `tests/tools/support.ts`; no real chrome-devtools-mcp or browser is launched.

## Deviations

1. The plan's teammate brief specified `@expect/browser`; the actual package name is `@neuve/devtools` (post-Neuve-pivot). All imports use `@neuve/devtools`-adjacent paths via direct source imports per CLAUDE.md's no-barrel rule.
2. `DevToolsClient.callTool` only declares `DevToolsToolError` in its error channel (not `DevToolsConnectionError`), so the tool live layers only need one `catchTag` per call site — no `DevToolsConnectionError` handling at the tool layer. `DevToolsConnectionError` would surface at service-startup acquisition time, not per-call.
3. The default `RefResolver` treats `ref` as a chrome-devtools-mcp `uid` pass-through. This lets the new MCP tools work today (with the uids the current `observe snapshot` emits) while still leaving room for 2.C to provide a SOM-backed override layer.
4. `NetworkIdleSampler.inFlightCount` currently parses the textual `list_network_requests` output for an in-flight count. This is a best-effort heuristic (capped by `NETWORK_IDLE_MAX_WAIT_MS`); a future iteration could subscribe to CDP network events directly when we replace the MCP-proxy-only architecture.
5. `WaitForEngine` polls via the existing `wait_for` chrome-devtools-mcp tool for text/selector/aria targets, and re-polls snapshots for ref targets. State semantics (`visible | hidden | attached | detached`) are mapped onto the binary probe result; the three non-visible states share the same probe-inverted logic today.

## DoD check

- [x] 5 tool files exist with specified signatures (`click.ts`, `fill.ts`, `hover.ts`, `select.ts`, `wait-for.ts`).
- [x] `pnpm --filter @neuve/devtools test` passes — 28 tests.
- [x] `pnpm --filter @neuve/devtools typecheck` green.
- [x] `pnpm --filter @neuve/perf-agent-cli typecheck` green.
- [x] `pnpm --filter cli-solid typecheck` green.
- [x] `pnpm --filter @neuve/devtools format:check` green (170 files).
- [x] No `evaluate_script`-based interaction logic inside the wrappers.
- [x] No `null`, no `as` casts outside the narrow `as CallToolContent` inside the live layer, no `Effect.mapError` / `catchAll` / `Effect.option` / `Effect.ignore` / `Effect.orElseSucceed`. Services use `ServiceMap.Service` with `make:` + `static layer` or `Layer.effect`.
- [x] Diary authored at `docs/handover/harness-evals/diary/wave-2-A-interaction-tools.md`.

## Followups the reviewer may ask for

- Replace the regex-based `inFlightCount` with a CDP-subscribed counter when we introduce a richer devtools client wrapper.
- When Wave 2.C finalizes SOM, wire a `SomRefResolver` that maps `SomRef.label → uid` and expose it via a `layerSom` that overrides `refResolverLayer` in the runtime.
- Consider lifting `ElementHandle` into a shared abstraction if future tools (`drag`, `press_key`) want to reuse it.

---

## Round 2 — Review response

Reviewer flagged 4 Critical + 3 Major + 3 Minor in `docs/handover/harness-evals/reviews/wave-2-A-review-round-1.md`. Every one of them was the product of the same pattern: Round 1 tests mocked all four live services, so the live layer was never exercised against a real chrome-devtools-mcp payload. Round 2 fixes each issue and backs it with either a live-layer integration test (real parser, fake `DevToolsClient`) or an MCP-transport round-trip.

### Critical #1 — MCP tools are dead code
Fixed in `packages/browser/src/mcp/server.ts:15,18,102`. Added `import { registerInteractionTools }` and `registerInteractionTools(server, runtime)` alongside the pre-existing three. `createBrowserMcpServer` / `startBrowserMcpServer` signatures now include the four tool services in the runtime constraint.

Verification added at `packages/browser/tests/tools/mcp-registration.test.ts`: constructs the server with a real `ManagedRuntime`, links an `InMemoryTransport` to an MCP `Client`, calls `client.listTools()`, and asserts the server advertises `click`, `fill`, `hover`, `select`, `wait_for`, plus the pre-existing `interact`, `observe`, `trace`.

### Critical #2 — Pending network count against real format
Rewrote parser in `packages/browser/src/tools/parse.ts:11`. Now `countPendingNetworkRequests` matches lines of shape `reqid=\d+ <METHOD> <URL> [pending]` per `.specs/observability-output-format.md` (regex `/^reqid=\d+\s+\S+\s+\S+\s+\[pending\]/gm`). `net::ERR_*` and numeric statuses are intentionally not matched — they're terminal.

Verification: `parse.test.ts` + `live-layers.test.ts` run the real parser against verbatim multi-line fixtures (mix of 200/pending/net::ERR/404) and assert the correct count. No mock sits between the regex and the test.

### Critical #3 — Exact uid match, not substring
Rewrote in `packages/browser/src/tools/parse.ts:17`. `snapshotContainsUid(text, uid)` now builds a word-boundary regex `/\buid=<escaped-ref>\b/` against the literal text. Escapes regex-special chars.

Verification: `parse.test.ts` covers three false-positive guards (a snapshot containing both `uid=2_10` and `uid=2_100` disambiguates; a bare digit inside an accessible name does not match as a uid; regex-special chars in refs are escaped). `live-layers.test.ts` runs the real `refResolverLayerUid` against a snapshot with overlapping uids and asserts `ref("2_1000")` returns `RefNotFoundError` while `ref("2_10")` resolves.

### Critical #4 — `select` semantics
Split in `packages/browser/src/tools/live.ts:77`. String options → chrome-devtools-mcp `fill` (which handles `role=combobox` + `<option>` children by label, per `chrome-devtools-mcp/build/src/tools/input.js:172` → `selectOption`). Numeric options → `evaluate_script` running a dedicated script (`selectByIndexScript` at `live.ts:21`) that queries `<select>` via `data-uid` / id lookup, bounds-checks the index, sets `selectedIndex`, and dispatches `input` + `change` so listeners fire.

Verification: `live-layers.test.ts` runs `handle.select(2)` and asserts `evaluate_script` was called (not `fill`) with args `[ref, 2]`; asserts `handle.select("Red")` takes the `fill` path.

### Major — Silent swallow of `DevToolsToolError`
Fixed in `packages/browser/src/tools/live.ts`. The two `catchTag("DevToolsToolError", () => Effect.succeed({ content: [] }))` sites were removed from both `networkIdleSamplerLayer` and `snapshotTakerLayer`. Failures now map into `InteractionError` (action `list_network_requests` or `take_snapshot`) with the underlying cause preserved and propagate up the stack. `NetworkIdleProbe` and `SnapshotCapturer` interface signatures in `types.ts` were widened to include `InteractionError` in the error channel.

Verification: `live-layers.test.ts` has two "propagates DevToolsToolError as InteractionError (no silent swallowing)" tests, one per sampler, that inject `failures: { list_network_requests: "connection refused" }` / `failures: { take_snapshot: "protocol error" }` and assert the exit is a failure containing `InteractionError`.

### Major — `as CallToolContent` cast cluster
Fixed by exporting `CallToolResult` from `packages/browser/src/devtools-client.ts:6`. The private `CallToolContent` type in `live.ts` is gone; all parse helpers now accept the public `CallToolResult`. `live.ts` has zero remaining type casts. `interactions.ts` retains only the unavoidable `Cause.squash` post-handling (replaced the custom cast chain with `Predicate.isObject` + an `in` narrowing).

### Major — RefResolver seam for Wave 2.C
Renamed to `refResolverLayerUid` in `live.ts:35`. Added a `// HACK:` comment documenting that Wave 2.C will ship a SOM-backed `Layer.effect(RefResolver)` override and that the tool wrappers are resolver-agnostic. The runtime in `mcp/runtime.ts:8` imports the renamed symbol explicitly, making the provenance visible at the composition site.

### Major — Live-layer integration tests
Added `packages/browser/tests/tools/parse.test.ts` (10 tests, pure-parser) and `packages/browser/tests/tools/live-layers.test.ts` (9 tests, real live layers + fake `DevToolsClient` via `Layer.succeed(DevToolsClient, fake)`). Plus `mcp-registration.test.ts` (1 test, MCP-transport round-trip). All fixtures use verbatim shapes from `.specs/observability-output-format.md` or directly quoted from `chrome-devtools-mcp/build/src/formatters/SnapshotFormatter.js`.

### Minor — `it.effect`
Kept plain `vitest it` with `Effect.runPromise` / `runPromiseExit` because the existing browser package (e.g. `tests/set-of-mark.test.ts`) uses the same pattern and `@effect/vitest` is not a dep here. Adding a new dev dep for stylistic consistency felt out of scope; if the reviewer wants it universally, that can be a separate repo-wide sweep.

### Minor — `isVisible`
Deleted from `ElementHandle` interface in `types.ts:46` and from `refResolverLayerUid` in `live.ts`. Test support was updated.

### Minor — wait_for "never attached" vs "attached then detached"
`WaitTimeoutError` in `errors.ts:20` gained an `observedAtLeastOnce: boolean` field, set by the wait loop in `live.ts:186`. The error message distinguishes "target was observed at least once but never reached <state>" from "target was never observed during the wait window". Test support threads the flag through.

### Verification

```
pnpm --filter @neuve/devtools test        # 9 files, 49 tests, pass
pnpm --filter @neuve/devtools typecheck   # green
pnpm --filter @neuve/perf-agent-cli typecheck  # green
pnpm --filter cli-solid typecheck         # green
pnpm --filter @neuve/devtools format:check  # green (175 files)
```

Round 1 tests → 28. Round 2 tests → 49 (+21): 11 new parse tests, 9 new live-layer tests, 1 MCP-registration test. All new tests exercise the real live code path (or real MCP transport) — zero rely on a mock sitting between the assertion and the live logic.

---

## Round 3 — Review response

Reviewer flagged 1 Critical + 4 Majors + 3 Minors in `docs/handover/harness-evals/reviews/wave-2-A-review-round-2.md`. Same root pattern: each Round-2 fix had a residual corner where the test topology diverged from production. Round 3 addresses each with a test that exercises the production path.

### Critical — `selectByIndexScript` broken in production
Removed the script entirely. Chrome-devtools-mcp uids live in a server-side `textSnapshot.idToNode` Map (verified at `node_modules/chrome-devtools-mcp/build/src/McpPage.js:67-76`); they are NOT DOM attributes. Any `document.querySelector('[data-uid=…]')` against the real page resolves nothing.

**New approach (adopted from reviewer):** numeric `select(index)` now (a) re-takes a snapshot, (b) walks the parsed AX-tree with `findOptionsForSelect(text, ref)` — a new pure parser in `parse.ts:42-82` that finds the target uid, traces its immediate `option` children by indent, and returns them in document order; (c) picks the Nth option's `name` (the displayed label); (d) calls `fill(ref, name)` so chrome-devtools-mcp's existing combobox handling (`input.js:172` → `selectOption`) resolves by label via its own uid→handle map.

Verification (`live-layers.test.ts`): feeds a realistic combobox snapshot (`uid=10 combobox "Color"` with `option` children at `uid=11/12/13`, each with `name` + `value`), asserts `select(1)` issues a single `fill` call with `{uid: "10", value: "Green"}` and does NOT call `evaluate_script`. Additional tests: `select(0)` → "Red", `select(99)` → `InteractionError("out of range")`, `select(0)` on a non-combobox ref → `InteractionError("no option children")`, `select("Red")` → `fill(ref, "Red")` verbatim (unchanged behaviour for string path). Parse-level tests (`parse.test.ts`) exercise `findOptionsForSelect` directly for document-order iteration, non-combobox targets, absent uids, and sibling-boundary cutoff.

### Major — `waitForEngineLayer.textProbe` silent swallow
Rewrote `textProbe` in `live.ts:199-209`. Previously it called chrome-devtools-mcp's `wait_for` and mapped any `DevToolsToolError` to `false` — swallowing real infrastructure failures as "text not yet seen". New implementation takes a snapshot directly and matches `text.includes(needle)` against the AX tree, so:
- "text not present yet" is a genuine `false` from `.includes` (no error involved).
- A real `DevToolsToolError` on `take_snapshot` maps to `InteractionError(action="wait_for")` and propagates.

`waitUntil` also had a matching silent-swallow in its `Effect.catchTag("InteractionError", () => Effect.succeed(false))` — removed. Now a probe failure aborts the wait with the original `InteractionError` rather than pretending the target is absent. `WaitForProbe` interface in `types.ts:84-105` widened to include `InteractionError` in every method's error channel.

### Major — `as WaitForState` cast
Fixed at `interactions.ts:214`. Zod's `z.enum(WAIT_FOR_STATES)` already narrows `parsed.state` to the exact `"visible" | "hidden" | "attached" | "detached" | undefined` union — that literal union IS `WaitForState`. Replaced `(parsed.state ?? "visible") as WaitForState` with `const state: WaitForState = parsed.state ?? "visible"`. No cast, TypeScript proves the narrowing.

### Major — `as unknown as` in `mcp-registration.test.ts`
Removed. The double-cast was a leftover from when `createBrowserMcpServer`'s runtime signature was narrower than the test's runtime. After Round 2 expanded the signature to include all four tool services, the cast became unnecessary. Now `buildRuntime()` returns a `ManagedRuntime` with the exact union the server expects, and the test passes it directly.

### Major — `waitForNetworkIdle` over-correction
Fixed in `helpers.ts:13-32`. A failing probe no longer aborts the click. Per reviewer guidance: `catchTag("InteractionError", ...)` now logs a `Warning` with `action` + `cause` and yields `false` (assume busy), so the time budget ticks on; `NETWORK_IDLE_MAX_WAIT_MS` (2s) still guarantees the interaction completes. Comment at the top of the function explicitly documents the "best-effort debounce" policy. Note: this isolated recovery stays narrow — only `NetworkIdleSampler.inFlightCount`'s `InteractionError` is caught, and only inside the debounce loop. Same error type in the tool wrappers (`click`, `fill`, etc.) still propagates normally.

### Minor — Diary test counts
Round 2 diary reported "11 parse / 9 live / 1 mcp = 21 new". Actual: 8 parse + 12 live + 1 mcp + 1 pre-existing SOM file = the 49 total. Round 3 updates this with accurate per-file numbers (below).

### Minor — `buildPerfAgentGuide` advertises only 3 tools
Flagged for Wave 2.B's scope. Noted in the handover section below so the prompt-rewrite owner updates the tool catalog to advertise `click`, `fill`, `hover`, `select`, `wait_for` alongside `interact`, `observe`, `trace`. Wave 2.A intentionally does not modify `packages/shared/src/prompts.ts` or the `buildPerfAgentGuide` helper.

### Minor — `Layer.succeed(DevToolsClient, fake)` shape assertion
Added in `tests/tools/live-layer-support.ts:7,65`. The fake is now annotated `satisfies DevToolsClientShape` where `DevToolsClientShape = ServiceMap.Service.Shape<typeof DevToolsClient>`. If `DevToolsClient`'s real shape grows a new method, the test compiles fail at the `satisfies` line before tests run — the production-vs-test drift the reviewer warned about is now a type error.

### Handover to Wave 2.B

- `packages/shared/src/prompts.ts`' `buildPerfAgentGuide` currently lists `interact`, `observe`, `trace`. When the 2.B rewrite lands it should extend the tool catalog to include the 5 new top-level MCP tools: `click(ref, button?, clickCount?)`, `fill(ref, text, clearFirst?)`, `hover(ref)`, `select(ref, option: string | number)`, `wait_for({ ref | selector | aria }, state?, timeout?)` — all returning a post-action snapshot as their result. The `interact` meta-tool remains for backward compatibility; the new tools are the preferred surface for a 4B agent.

### Verification

```
pnpm --filter @neuve/devtools test        # 9 files, 56 tests, pass
pnpm --filter @neuve/devtools typecheck   # green
pnpm --filter @neuve/perf-agent-cli typecheck  # green
pnpm --filter cli-solid typecheck         # green
pnpm --filter @neuve/devtools format:check  # green (175 files)
```

Actual per-file test counts:
- `tests/tools/click.test.ts` — 3 tests
- `tests/tools/fill.test.ts` — 3
- `tests/tools/hover.test.ts` — 3
- `tests/tools/select.test.ts` — 4
- `tests/tools/wait-for.test.ts` — 5
- `tests/tools/parse.test.ts` — 12 (includes 4 new `findOptionsForSelect` tests)
- `tests/tools/live-layers.test.ts` — 15 (includes 5 new numeric/string select tests against a realistic combobox snapshot)
- `tests/tools/mcp-registration.test.ts` — 1
- `tests/set-of-mark.test.ts` — 10 (pre-existing, unchanged)

Total: **56 tests** across 9 files. Round 2 → Round 3: +7 tests, all exercising the production code path (snapshot parsing → real live layer → fill-by-name translation) or strengthening production-vs-test drift detection (`satisfies DevToolsClientShape`).
