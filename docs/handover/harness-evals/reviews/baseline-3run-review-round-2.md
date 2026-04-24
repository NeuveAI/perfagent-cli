# Review: Task #5 — Round 2 re-review of v2 baseline work

**Reviewer:** reviewer (team `baseline-measurement-v2`), round 2
**Date:** 2026-04-24
**Scope:** Verify round-1 findings (MAJOR-1, MAJOR-2, MINOR-1, MINOR-2) are genuinely resolved. Out of scope: `evalite.config.ts`, `baseline-abandoned-concurrency5/`, Task #8 (already validated).

## Verdict: APPROVE

All 4 round-1 findings are genuinely resolved. Tests are well-scoped, exercise the real API surface (not mocked around), and the drain-order + per-task-isolation integration tests read back the persisted ndjson so the true invariant is guarded, not just the in-memory event stream. The dist-spawn regression guard fails-loud on all three degradation modes (no bundle, hung child, crash-on-load). No regressions in anything approved in round 1.

## Severity counts

- Critical: 0
- Major: 0
- Minor: 0
- Suggestion: 0

## Independent verification runs

| Check | Result |
|---|---|
| `git diff --stat && git status` | ✅ Scope clean. 3 new test files (`packages/shared/tests/token-usage-bus.test.ts`, `packages/evals/tests/tokenomics-getter.test.ts`, `packages/local-agent/tests/dist-spawn.test.ts`), 3 modified infra files (`packages/local-agent/package.json`, `packages/local-agent/vite.config.ts`, `packages/evals/tests/real-runner.test.ts`), 2 modified docs (diary + plan.md). No stray files. |
| `pnpm --filter @neuve/shared typecheck` | ✅ clean |
| `pnpm --filter @neuve/evals typecheck` | ❌ same 3 **pre-existing** `src/runners/gemma.ts:99,101,112` errors — task #6 tracks, not this round's regression |
| `pnpm --filter @neuve/local-agent typecheck` | ✅ clean |
| `pnpm --filter @neuve/shared test` ×2 | ✅ 127/127 both runs (+9 new tests vs round 1's 118; delta = token-usage-bus.test.ts count) |
| `pnpm --filter @neuve/evals test` ×2 | ✅ 132/132 both runs (+12 new tests vs round 1's 120; delta = 10 tokenomics-getter + 2 drain-order/isolation) |
| `pnpm --filter @neuve/local-agent test` ×2 | ✅ 2/2 both runs (new suite — dist-spawn exists-check + ACP-init smoke) |
| Total test count | **356** (baseline 333 + 23 new) — matches engineer's claim |
| `pnpm check` | ❌ same 6 pre-existing formatting failures in `packages/shared/src/{cwv-thresholds,parse-insight-detail,parse-network-requests}.ts` + 3 test files — **none engineer-touched**, same as round 1 |
| Live-API calls in tests (`createGoogleGenerativeAI`) | ✅ zero |
| Banned Effect patterns (`catchAll`/`Effect.Service`/`Context.Tag`/`mapError`) in new code | ✅ zero |
| Local-agent dist probe (manual) | ✅ `echo '{"jsonrpc":"2.0","method":"initialize",...}' \| node packages/local-agent/dist/main.js` returns `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}` as expected |
| `wc -c packages/local-agent/dist/main.js` | ✅ 23,353 bytes = 23.35 kB (matches engineer-reported post-fix size) |
| Diary CV fix | ✅ `grep -nE "7\.1\|8\.1" diary/baseline-3run-2026-04-24.md` — both occurrences (lines 64, 79) now say "8.1% CV"; zero "7.1%" remaining |
| `plan.md` residual "Gemma 3n" mentions | ✅ both remaining hits wrapped in historical-label annotation + memory pointer (see MINOR-2 below) |

## Per-finding validation

### MAJOR-1 — RESOLVED (unit tests for TokenUsageBus + tokenomics getter + drain-order + isolation)

**`packages/shared/tests/token-usage-bus.test.ts` (9 tests, read in full):**
- Tests exercise the **real** `TokenUsageBus` service via `Effect.provide(TokenUsageBus.layer{Noop,Ref})` — no mocks, no wrappers around what they claim to test. Each test yields the service, exercises `publish`/`drain`, and asserts.
- Coverage: `layerNoop` drain-empty + publish-is-noop + never-throws-under-50-publishes; `layerRef` publish-order, drain-clears-buffer, re-publish-after-drain, per-layer-build isolation (parallel + sequential), downstream composition via `Layer.provideMerge`.
- The sequential-isolation test (line 147-168) re-invokes the same `runTask` twice with different inputs and asserts each run sees only its own entries. If `layerRef` ever regresses to a module-level Ref, the second task's planner count would include the first task's 1000 — the test catches that exact mode.

**`packages/evals/tests/tokenomics-getter.test.ts` (10 tests, read in full):**
- Covers every aggregate field of `ExecutedTrace.tokenomics`: empty (all-zeros), total-sums-across-all, **peakPromptTokens is MAX not sum** (line 61-69, explicit in the assertion), **turnCount counts executor-only** (line 71-81), plannerTokens/executorTokens splits, invariant `plannerTokens + executorTokens === totalTokens` (line 103-113).
- Invariant holds by construction: `source` is `Schema.Literals(["planner", "executor"])` — a two-element literal union — and the getter iterates each entry once adding to either `plannerTokens` or `executorTokens`. Any future third source would be rejected at decode time by the schema. ✅
- Realistic-baseline test (line 115-131) encodes the exact shape observed across all 60 trajectories: 1 planner + 1 executor, `peakPromptTokens=4096`, `turnCount=1`. Regression-tight.
- Order-invariance (line 133-157) asserts the getter is commutative — protects against future "sorted-by-timestamp" refactors changing behavior.

**`packages/evals/tests/real-runner.test.ts` new tests (2 integration tests, diff read in full):**
- **Drain-order test (line 384-463 of new file):** spawns `runRealTask` under `TokenUsageBus.layerRef`, pre-seeds 3 entries (1 planner + 2 executors) via `yield* bus.publish(entry)`, runs the real task pipeline against a `scriptedAgentLayer`, then **reads back the persisted ndjson file** via `parseTraceFile(path.join(traceDir, files[0]))`, decodes each line through `decodeWireEnvelope` (so the test is file-round-tripped, not in-memory), asserts `token_usage × 3` precede `task_tokenomics × 1` precede `stream_terminated` as last line. This IS the true Wave 0.A invariant test the lead's checklist item 5 asked for — it would catch a reordered drain or a missing task_tokenomics write. ✅
- **Per-task isolation test (line 464-530 of new file):** runs `makeProgram(taskAEntries)` and `makeProgram(taskBEntries)` sequentially under separate `Effect.runPromise` calls, each with its own `Effect.provide(Layer.provideMerge(..., TokenUsageBus.layerRef))`. Asserts Task A sees only its 150 total (its own planner), Task B sees only its 2200 (its own planner+executor). Critically, the test comment explicitly states "if layerRef shared state, plannerTokens here would be 1150" — the regression mode is named and ruled out. ✅

**Classification:** MAJOR-1 fully resolved. Tests are targeted, independent, and file-round-tripped where it matters.

### MAJOR-2 — RESOLVED (local-agent dist spawn regression guard)

**`packages/local-agent/tests/dist-spawn.test.ts` (2 tests, read in full):**
- **Test 1 "has a built dist/main.js"**: `assert.isTrue(fs.existsSync(distMain), ...)` with actionable error ("Run `pnpm --filter @neuve/local-agent build` first"). **Fail-loud**, not silent-skip. Lead's checklist item 7 concern addressed. ✅
- **Test 2 "responds to an ACP initialize..."**: spawns via `child_process.spawn(process.execPath, [distMain])`, writes a valid JSON-RPC `initialize` line to stdin, listens for any `\n`-terminated stdout chunk. 5-second hard timeout via `setTimeout` + `SIGKILL`. Asserts: no timeout (would mean silent hang — the exact v1 failure), no `ERR_UNKNOWN_FILE_EXTENSION` on stderr (the exact crash the fix addresses), no `Cannot find module` on stderr (sibling bug class). Then parses first stdout line, asserts JSON-RPC envelope with `id=1`, no `error`, `result.protocolVersion=1`, `result.agentCapabilities` is an object. ✅
- Infrastructure wiring (`packages/local-agent/{package.json,vite.config.ts}`): `test` + `test:watch` scripts added, `test: { include: ["tests/**/*.test.ts"] }` block in vite config. Clean.
- **Reproduction of regression-proof:** Lead directive ("don't spend the time unless something smells wrong") respected. I verified the post-fix happy path manually via `echo '{"jsonrpc":"2.0",...}' | node packages/local-agent/dist/main.js` → returns the expected ACP response in <100 ms. The engineer's reported revert-and-rebuild procedure (pre-fix bundle 17.99 kB vs post-fix 23.35 kB; pre-fix test FAILED with `ERR_UNKNOWN_FILE_EXTENSION`; post-fix test PASSED in 198 ms) is credible — the bundle size delta (~5.4 kB) is consistent with inlining `@neuve/shared/parse-trace-output` + subpaths. I confirm the current tree's `dist/main.js` is 23,353 bytes matching the post-fix number. ✅

**Classification:** MAJOR-2 fully resolved. The three failure modes (no bundle, hang, crash) are all fail-loud.

### MINOR-1 — RESOLVED (CV arithmetic)

`docs/handover/harness-evals/diary/baseline-3run-2026-04-24.md:64` and `:79` now read "8.1% CV" in both places. Zero remaining "7.1%" in the file (verified via `grep -nE "7\.1" file` → no match). Recomputed: `100 × 367 / 4526 = 8.11%`. ✅

### MINOR-2 — RESOLVED (plan.md "Gemma 3n" historical refs)

`docs/handover/harness-evals/plan.md` lines 71 and 266 retain the two references but now wrapped in explicit historical-label annotations:
- Line 71: `"...the pre-2026-04-24 'Gemma 3n' historical label assumed — see project_target_model_gemma.md memory..."`
- Line 266: `"...a 32K ceiling under the pre-2026-04-24 'Gemma 3n E4B' historical label (corrected to Gemma 4 E4B; see project_target_model_gemma.md memory)..."`

Per engineer's round-2 framing: Option B (annotate as historical label + memory pointer) preserves narrative context for why wave-urgency was downgraded. Matches the lenient policy in checklist item 32 (memory-file rule: historical refs OK when labeled). The strict-zero bar of item 31 was an overly tight constraint for this specific narrative purpose — the annotations are now unambiguous. Acceptable. ✅

## Negative-space checks (what should NOT have happened)

- ✅ No engineer-introduced formatting failures in `pnpm check` (6 failing files are pre-existing drift, unchanged since round 1).
- ✅ No new `catchAll` / `Effect.Service` / `Context.Tag` / `mapError` patterns in any new test or modified source (`git grep` on new files — zero).
- ✅ No live-API imports (`createGoogleGenerativeAI`, real network fetches, real child spawn against a real Ollama) in new tests. The dist-spawn test spawns a local child process but doesn't require a network. The real-runner integration tests use scripted Agent + TokenUsageBus.layerRef.
- ✅ No regression in round-1-approved code: the Task #1 instrumentation files (`token-usage-bus.ts`, `plan-decomposer.ts`, `executor.ts`, `tool-loop.ts`, `real.ts` run-side, `task.ts`) are unchanged since round 1 per the diff stats.
- ✅ Tests pass deterministically across two runs with identical counts (127/127, 132/132, 2/2).

## Pre-existing issues noted (not this round's problem)

- `packages/evals/src/runners/gemma.ts:99,101,112` still typecheck-fails on HEAD (task #6 tracks).
- `packages/shared` has 6 files with pre-existing formatting drift (cwv-thresholds.ts, parse-insight-detail.ts, parse-network-requests.ts, and 3 test files) that `pnpm check` flags; none engineer-touched; orthogonal to this session.

## Next steps

APPROVE. Granular commits follow on lead side per the usual post-review cadence. I'll stay idle; no round 3 needed unless new scope is introduced.
