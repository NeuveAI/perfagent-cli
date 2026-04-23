# Review: Wave 2.A — First-class interaction tools (Round 3)

## Verdict: APPROVE

All five Round 2 blockers are genuinely resolved and backed by tests that exercise the production code path, not a mock sitting in front of it. The Critical `select` numeric bug is fixed by abandoning `evaluate_script` entirely and routing through chrome-devtools-mcp's native combobox handling via a pure AX-tree parser — an elegant fix that eliminates the DOM-projection assumption that was broken in Round 2. The four Majors (silent-swallow twin in `waitForEngineLayer`, avoidable `as WaitForState` cast, `as unknown as` double-cast, over-corrected `waitForNetworkIdle`) are each addressed with symmetric, narrow, well-scoped fixes. The three Minors are acknowledged — two fixed, one correctly punted to Wave 2.B with a diary handover note.

### Verification executed

- `pnpm --filter @neuve/devtools test` run TWICE → 9 files, 56/56 pass, deterministic.
- `pnpm --filter @neuve/devtools typecheck` → green.
- `pnpm --filter @neuve/perf-agent-cli typecheck` → green.
- `pnpm --filter cli-solid typecheck` → green.
- `pnpm --filter @neuve/devtools format:check` → clean on 175 files.
- `git diff --stat` since Round 2 → changes confined to 2.A files + diary/review docs; `packages/shared/**`, `packages/supervisor/**`, `apps/**` untouched by this wave's logic.
- `grep -n "as unknown as" packages/browser/tests/tools/` → zero hits (the two hits elsewhere are in `set-of-mark.test.ts` which is Wave 2.C territory).
- `grep -n "catchTag.*false" packages/browser/src/tools/` → zero hits.
- Verified `WaitForProbe` interface at `types.ts:84-109` — every method (`waitForSelector`, `waitForAria`, `waitForRef`) includes `InteractionError` in the error channel.
- Verified real chrome-devtools-mcp snapshot line format against `node_modules/chrome-devtools-mcp/build/src/formatters/SnapshotFormatter.js:30-60`: format is `<indent><attrs.join(' ')>` where attrs start with `uid=<id>` — matches the parser's `UID_LINE` regex and the new `selectSnapshot` test fixture.
- Verified chrome-devtools-mcp's `selectOption` handler in `node_modules/chrome-devtools-mcp/build/src/tools/input.js:142-171` uses the combobox's option children by matching `child.name === value`, so feeding the AX-tree `name` via `fill(ref, name)` reaches the correct option via the server-side uid→handle map. The Round 3 approach is architecturally correct.
- Traced `waitForNetworkIdle` pipe order: `Effect.map → Effect.catchTag → Effect.repeat → Effect.timeoutOption`. The `catchTag` is scoped to a single probe invocation per iteration, not the whole loop — correct narrowness.

### Findings (all resolved)

- **[CRITICAL → RESOLVED] `select(ref, index)` now routes through chrome-devtools-mcp's native uid resolution.** (`packages/browser/src/tools/live.ts:68-111`, `parse.ts:42-82`). The new pipeline is: take snapshot → `findOptionsForSelect(text, ref)` walks the parsed AX tree for immediate `option` children of the combobox → pick the Nth option's `name` → call `fill(ref, name)` which internally uses `textSnapshot.idToNode.get(uid)` to find the real handle. This is the cleanest possible translation — zero DOM-side assumptions. Out-of-range and no-options cases produce structured `InteractionError`s. The `live-layers.test.ts` tests at lines 91-181 feed a realistic combobox fixture (shape quoted from the SnapshotFormatter output: `uid=10 combobox "Color"\n  uid=11 option "Red" value="red"\n  ...`) and assert the exact `fill` args `{uid: "10", value: "Green"}` for `select(1)`. Numeric `select(0)` picks "Red", `select(99)` fails with "out of range", `select(0)` on a non-combobox fails with "no option children", `select("Red")` still routes to `fill` verbatim.

- **[MAJOR → RESOLVED] `waitForEngineLayer.textProbe` silent swallow.** (`live.ts:229-239`). Now `textProbe` takes a snapshot and uses `text.includes(needle)` — so "text not present" is a genuine `false` from the string method (no error involved), and a `DevToolsToolError` on `take_snapshot` correctly maps to `InteractionError(action="wait_for")`. The sibling `waitUntil` inner `catchTag` is also removed (line 205-210 now just `yield* probe()` unwrapped). Error propagation is consistent across all three probe kinds.

- **[MAJOR → RESOLVED] `as WaitForState` cast.** (`interactions.ts:214`). Replaced with `const state: WaitForState = parsed.state ?? "visible"`. Zod's `z.enum(WAIT_FOR_STATES)` with `WAIT_FOR_STATES = [...] as const` yields exactly `"visible" | "hidden" | "attached" | "detached" | undefined`, and `typecheck` is green without the cast.

- **[MAJOR → RESOLVED] `as unknown as` double-cast in `mcp-registration.test.ts`.** The test at line 29 now just does `const runtime = buildRuntime(); const { server } = createBrowserMcpServer(runtime);` — no cast. `createBrowserMcpServer`'s signature at `server.ts:87-92` accepts the full service union that `buildRuntime` provides.

- **[MAJOR → RESOLVED] `waitForNetworkIdle` over-correction.** (`helpers.ts:13-32`). Now `Effect.catchTag("InteractionError", error => Effect.logWarning("network-idle-probe-failed", { action, cause }).pipe(Effect.as(false)))` — narrow per-iteration recovery that logs with structured annotations (object, not string concat) and yields `false` so the loop ticks on. `NETWORK_IDLE_MAX_WAIT_MS` (2s) still caps total wait. Comment at lines 9-12 documents the "best-effort debounce" policy. Tool wrappers' own `InteractionError`s (from `click`, `fill`, etc.) are untouched — the catch is scoped precisely to the sampler.

- **[MINOR → RESOLVED] `satisfies DevToolsClientShape` in `live-layer-support.ts:5, 64`.** `DevToolsClientShape = ServiceMap.Service.Shape<typeof DevToolsClient>` + `} satisfies DevToolsClientShape` on the fake object. Adding a new method to `DevToolsClient` now breaks the `satisfies` at compile time — production-vs-test drift becomes a type error, exactly what the reviewer asked for.

- **[MINOR → RESOLVED] Test count correction.** Diary now reports per-file counts that I verified: parse 12, live-layers 15, mcp-registration 1, click 3, fill 3, hover 3, select 4, wait-for 5, set-of-mark 10 = 56.

- **[MINOR → HANDED OFF] `buildPerfAgentGuide` advertises only 3 tools.** Correctly deferred to Wave 2.B with an explicit handover note in the diary at line 213 listing all five new top-level MCP tools for the prompt rewrite to pick up. Wave 2.A intentionally does not touch `packages/shared/src/prompts.ts`. Acceptable scope decision.

### Residual observations (non-blocking)

- The original `snapshotFixture` in `parse.test.ts:17-22` still uses a made-up format with `[0-1] <body uid=2_0>` HTML-like tags — not the real chrome-devtools-mcp shape. The tests exercising it only invoke `snapshotContainsUid` which cares only about `\buid=X\b` anywhere in text, so the format mismatch doesn't hurt correctness. But a future reader looking at that fixture as documentation for "what chrome-devtools-mcp emits" would be misled. Suggestion (not blocking): either update to real SnapshotFormatter shape or add a comment noting the fixture is intentionally synthetic.
- The `UID_LINE` regex at `parse.ts:30` handles the common AX-tree line format well but won't match lines with the literal `[selected in the DevTools Elements panel]` suffix appended between `uid=` and end. In practice this only appears on at most one node per snapshot, and `findOptionsForSelect` would still find the unaffected `option` siblings — the resulting option would just have its `role` parsed as `[selected` if it were ever a combobox. Unlikely to bite in real usage; worth a future-follow-up comment.
- `waitForNetworkIdle`'s `Effect.logWarning` uses structured args (object), per CLAUDE.md — good. Consider also `Effect.annotateCurrentSpan` on the probe-failed path for observability parity with successful probes.

### Suggestions (non-blocking, future waves)

- When Wave 2.C lands the SOM-backed `RefResolver`, the `findOptionsForSelect` parser will work unchanged as long as SOM labels are also resolved against a real chrome-devtools-mcp uid before reaching `live.ts:80`. Worth a cross-reference comment in the diary handover.
- The `fill` tool path for `select` inherits chrome-devtools-mcp's combobox semantics which match by `name` — if a site has two `<option>` elements with the same label (e.g. "Other" twice), the first match wins. Not a 2.A concern, but worth noting in a future doc.

---

All Round 2 blockers are closed. All verification commands pass. Scope hygiene clean. DoD behavior column ("5 first-class interaction tools, MCP-registered, test-covered, with post-action snapshot and network-idle debounce") is demonstrable end-to-end through the InMemoryTransport test and the realistic-fixture live-layer tests. Approving for merge.
