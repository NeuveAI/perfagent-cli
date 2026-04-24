# Review: Task #5 — Antagonistic audit of baseline-measurement-v2 chain

**Reviewer:** reviewer (team `baseline-measurement-v2`), round 1
**Date:** 2026-04-24
**Scope:** Tasks #1 (tokenomics), #3 (3-run sweep), #4 (analysis), #7 (local-agent fix), #8 (PRD correction). Lead-committed config change out of scope.

## Verdict: REQUEST_CHANGES

Two Major findings block. Both are test-coverage gaps on newly introduced / newly-fixed production code paths. The correctness of the current work is strongly supported by end-to-end evidence (60 successful baseline traces + manual dist probe) — but the regression guard is missing.

## Severity counts

- Critical: 0
- Major: 2
- Minor: 2
- Suggestion: 3

## Independent verification runs (all passed unless noted)

| Check | Result |
|---|---|
| `pnpm --filter @neuve/shared typecheck` | ✅ clean |
| `pnpm --filter @neuve/supervisor typecheck` | ✅ clean |
| `pnpm --filter @neuve/evals typecheck` | ❌ fails on **pre-existing** `src/runners/gemma.ts:99,101,112` (unreachable `catchTags` for `AcpProviderUnauthenticatedError`/`AcpAdapterNotFoundError`) — reproduced on HEAD via `git show HEAD:packages/evals/src/runners/gemma.ts`, confirmed not introduced by this session; task #6 tracks the fix |
| `pnpm --filter @neuve/local-agent typecheck` | ✅ clean |
| `pnpm --filter @neuve/shared test` ×2 | ✅ 118/118 both runs |
| `pnpm --filter @neuve/supervisor test` ×2 | ✅ 95/95 both runs |
| `pnpm --filter @neuve/evals test` ×2 | ✅ 120/120 both runs |
| `pnpm check` | ❌ 6 formatting failures in `packages/shared/src/{cwv-thresholds.ts,parse-insight-detail.ts,parse-network-requests.ts}` + 3 test files — **none are engineer-touched**; pre-existing drift |
| Local-agent dist spawn | ✅ `echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}},"id":1}' \| node packages/local-agent/dist/main.js` returns a valid ACP response in <100 ms (pre-fix would crash with `ERR_UNKNOWN_FILE_EXTENSION`) |
| Dist inlining | ✅ `grep -c parseTraceOutput packages/local-agent/dist/main.js` = 2 (inlined); 0 residual `@neuve/shared` imports |
| Trace file count (20 tasks × 3 runs) | ✅ 20 ndjson per run-1/run-2/run-3 |
| Last-line invariant | ✅ sampled 3 traces (run-1/calibration-1, run-2/journey-3, run-3/trivial-2) — all end `agent_message`→`token_usage`→`token_usage`→`task_tokenomics`→`stream_terminated` |
| Trace mtimes vs metadata | ✅ sequential, no cross-run overlap |
| Stddev claims | `jq` over 60 trajectories: `mean_total=7980.5, sd_total=11229.6` (diary 7981/11230 ✓); `mean_planner=3454.1, sd_planner=11283.3` (diary 3454/11283 ✓); `mean_executor=4526.5, sd_executor=366.9` (diary 4526/367 ✓) |
| `<\|tool_call>` tokens in any of the 60 traces | ✅ zero matches (F5 empirical claim verified) |
| Banned Effect patterns (`catchAll`, `Effect.Service`, `Context.Tag`, `mapError`) in touched code | ✅ zero occurrences |
| Live-API imports in tests (`createGoogleGenerativeAI`) | ✅ zero |

## Findings

### MAJOR-1 — No unit tests for the new `TokenUsageBus` service or the `ExecutedTrace.tokenomics` getter

**File/line:** `packages/shared/src/token-usage-bus.ts:1-59`, `packages/evals/src/task.ts:60-96`, `packages/evals/src/runners/real.ts:289-346`

**Why it matters:** This session introduces a new public `@neuve/shared/token-usage-bus` surface (60 LOC), extends `ExecutedTrace` with a `tokenUsages: TokenUsageEntry[]` schema field, and adds a `tokenomics` getter that encodes every aggregate the baseline analysis is built on (`totalPromptTokens`, `peakPromptTokens`, `turnCount`, `plannerTokens`, `executorTokens`). The drain order in `real.ts` (`token_usage` events → `task_tokenomics` → `stream_terminated`) is load-bearing for the Wave 0.A "stream_terminated is always the last line" invariant and is currently enforced only by imperative sequencing — no assertion guards it.

Test diff across the 6 modified test files shows **only fixture updates** (`TokenUsageBus.layerNoop` added to test layer stacks, `tokenUsages: []` added to `ExecutedTrace` fixtures). Zero new tests cover:

1. `TokenUsageBus.layerRef` publish/drain round-trip (a single scenario proving `publish(A); publish(B); drain` yields `[A,B]` and then empty)
2. `ExecutedTrace.tokenomics` aggregation math (especially `peakPromptTokens` as max-not-sum, `turnCount` counting only `source=executor`)
3. Drain-order invariant (regression guard that something between `runFold` end and `stream_terminated` write doesn't get reordered)
4. Per-task `Ref` isolation (two sequential tasks don't share a buffer — reviewer checklist item 8)

The 60 end-to-end baseline traces prove the current wiring works, but a single refactor can break any of the four above silently (e.g. someone promoting `layerRef` to a process-level `Layer.memoize`, or reordering the drain to happen after `stream_terminated`, or changing `peakPromptTokens` to a sum), and **no test will fail**.

The engineer explicitly flagged this in the diary ("engineer claims tests unchanged") and the lead's seed prompt asked reviewer to classify. Classification: Major. The new code is service-layer Effect code with real branching logic, and the Effect testing guide in CLAUDE.md specifies `it.effect` + provided layers for exactly this case.

**Requested fix:** Add `packages/shared/tests/token-usage-bus.test.ts` (publish/drain round-trip + `layerNoop` no-op), `packages/evals/tests/executed-trace-tokenomics.test.ts` (getter math: planner+executor split, peak, turnCount), and extend the existing `real-runner.test.ts` with a scripted two-`usage_update` executor path asserting the resulting trace file ends `token_usage`×2 → `task_tokenomics` → `stream_terminated` in that order.

### MAJOR-2 — No regression test for the `@neuve/local-agent` dist spawn boot

**File/line:** `packages/local-agent/vite.config.ts:22-24`, no test file exists

**Why it matters:** The v1 team lost **30 minutes per task × 20 tasks = ~10 hours** to a silent hang whose root cause was this exact code path: the vite bundle externalized `@neuve/shared` subpaths (which `package.json` resolves to `.ts` source), the spawned `node dist/main.js` child died in <50 ms with `ERR_UNKNOWN_FILE_EXTENSION`, and `AcpClient` had no spawn-death watcher so it waited forever on stdio. The engineer diagnosed, fixed, and verified manually. However, the fix has **zero automated test**: the engineer filed the integration test as "non-blocking backlog" per the diary's Test-gap section.

This is the exact pattern memory `feedback_no_test_only_injection_seams.md` warns about — a production-only code path with no test. A future change to `vite.config.ts` (e.g. someone adding a new external dep, removing `alwaysBundle`, or migrating off `vite-plus`) will silently reintroduce the hang with zero test-suite signal. The test is trivial: spawn `node packages/local-agent/dist/main.js`, pipe a JSON-RPC `initialize` request, assert a valid response arrives within 1 s. That is strictly weaker than asserting tool-use works (which needs R2 disambiguation first); it only asserts non-crash on startup.

The class-of-bug reproducibility is high: the team's **entire prior session** was wasted on this, and the underlying runtime assumption (`vite-plus` externalizes workspace deps by default) persists. "Non-blocking" is not the right framing when the exact bug just cost a full team-session.

**Requested fix:** Add `packages/local-agent/tests/dist-boot.test.ts` that spawns the built dist via `child_process.spawn("node", [dist])`, writes an ACP `initialize` NDJSON line to stdin, waits ≤1 s for a `result` on stdout, asserts no `ERR_UNKNOWN_FILE_EXTENSION` on stderr. `vitest.setup` or similar can gate on `existsSync(dist)` so a fresh checkout without a build skips gracefully (or rebuilds).

### MINOR-1 — CV arithmetic error in the diary's aggregate claim

**File/line:** `docs/handover/harness-evals/diary/baseline-3run-2026-04-24.md:64`

Diary writes: `mean executor=4526 sd=367 (7.1% CV)`. Actual `367 / 4526 = 0.0811 ≈ 8.1%`, not 7.1%. Verified via `jq -s '[.[] | .tasks[] | .tokenomics.executorTokens] ...'` across all three aggregated_scores.json files: sd=366.9, mean=4526.5, CV=8.1%.

Doesn't change the qualitative conclusion (executor token count IS tight), but the written percentage is wrong and will propagate to anyone quoting this diary. Suggest correcting to "8.1% CV" or similar.

### MINOR-2 — `plan.md` retains two historical-context "Gemma 3n" references where reviewer checklist specified zero

**File/line:** `docs/handover/harness-evals/plan.md:71` and `:266`

Lead's review checklist item 31: `git grep "Gemma 3n" docs/handover/harness-evals/plan.md` should return zero. It returns two matches — both in correction-context ("the original 4.6 urgency assumed Gemma 3n E4B's 32K ceiling" and "not the 32K that Gemma 3n assumed"). These are legitimate historical references per the more lenient checklist item 32 (memory files may reference "3n" as historical) but conflict with the strict item 31.

Recommended resolution: either rewrite both references to anonymized phrasing ("the former target's 32K ceiling") to hit the strict-zero bar, or (lead's choice) amend the checklist's item 31 to match item 32's "historical references OK" policy.

### SUGGESTION-1 — Diary's "determinism supports pipeline-gap" framing is hedged but could be sharper

**File/line:** `docs/handover/harness-evals/diary/baseline-3run-2026-04-24.md:68-75,96-100`

F1 argues that low variance across 60 trajectories in `turnCount/tools/peak` implies a **structural** (pipeline) gap rather than a stochastic capability gap. Counter-hypothesis: "the model simply emits no tool calls under our current prompts" also predicts deterministic zero-tool output — both hypotheses fit the same data. The diary does acknowledge at line 100 "This sweep alone cannot distinguish which layer is stripping them" and the candidate-culprit list is hedged correctly at lines 116-122, so this is framed properly — but the connection "low structural variance → pipeline gap" at F1 could more explicitly state that the real disambiguator is the three upstream bug fingerprints matching, not the determinism per se. Non-blocking; pointing it out only so R2's experiments don't under-test the "prompt/model simply isn't requesting tools" hypothesis.

### SUGGESTION-2 — Trace-event `turn` field semantics are inconsistent across event types

**File/line:** `packages/evals/src/runners/real.ts:148-217,289-310`, `packages/evals/src/runners/trace-recorder.ts:17-84`

`agent_message.turn` increments per `AgentText`/`AgentThinking` event (i.e. counts agent messages). `token_usage.turn` increments only for `source === "executor"` entries, keeping `source === "planner"` entries at `turn=0`. Sampled trace `run-1/gemma__calibration-1...ndjson` shows `agent_message.turn=1, agent_message.turn=2, token_usage(planner).turn=0, token_usage(executor).turn=1, task_tokenomics.turnCount=1` — this is internally consistent but the semantic mismatch (2 agent messages, 1 executor turn) is subtle. The mismatch is caused by the local-agent's banner message "Starting local inference with gemma4:e4b..." emitted before the Ollama call. Worth adding a brief comment to `trace-recorder.ts` or the traces README explaining the two-different-`turn`-meanings so downstream analysis doesn't conflate them. Non-blocking.

### SUGGESTION-3 — Diary's "Ollama `prompt_eval_count` + `eval_count`" phrasing doesn't match the actual field names used

**File/line:** `docs/handover/harness-evals/diary/baseline-3run-2026-04-24.md:5` (implicitly referenced by the tokenomics description)

The tool-loop reads `completion.usage.prompt_tokens`, `completion.usage.completion_tokens`, `completion.usage.total_tokens` — these are the **OpenAI-compat** field names returned by Ollama's `/v1/chat/completions` endpoint (which `OllamaClient` wraps). Ollama's native `/api/chat` returns `prompt_eval_count` / `eval_count`, but that's not what we read. The checklist item 7 referenced Ollama-native names; the code is correct, the diary's mental model is slightly off. Cosmetic. Worth noting for the R2 spike plan — if the spike hits `/api/chat` directly, it will see the native names and should decode both shapes.

## Positive confirmations (explicit, per major area)

**Instrumentation (Task #1):**
- `TokenUsageBus` uses `ServiceMap.Service` (not `Effect.Service`), `Effect.fn` with descriptive span names, explicit `static layerNoop`/`static layerRef`. Two `as ReadonlyArray<TokenUsageEntry>` casts on empty arrays are for TypeScript tuple-widening — unavoidable per Effect v4 typing. [✅]
- `plan-decomposer.ts:233-245` reads `result.usage.{inputTokens,outputTokens,totalTokens}` from `@ai-sdk/google`'s typed `generateObject` return shape — no regex, no ad-hoc property inspection. Consistent with memory `feedback_types_over_regex.md`. [✅]
- `executor.ts:284-308` taps the stream on `usage_update` session updates, reads via `AcpUsageUpdate.promptTokens/completionTokens/totalTokens` getters that derive from the `_meta` schema field — schema-decoded at the ACP boundary, not property-checked. [✅]
- `tool-loop.ts:97-116` populates the ACP `_meta` extensibility channel with `prompt_tokens`/`completion_tokens`/`total_tokens` from the OpenAI SDK's typed `CompletionUsage` return — types come from the `openai` package, not string inspection. [✅]
- Per-task `TokenUsageBus.layerRef` isolation: `real.ts:393-396` builds the runtime layer once per runner construction; each `evalite` task is a separate `Effect.runPromise(runner.run(task))` call, which builds a fresh runtime scope, which re-runs `Layer.effect(this)(this.make)` — the `Ref` is fresh per task. Verified structurally (not via test — see MAJOR-1). [✅]
- Drain order invariant (`real.ts:289-346`): token_usage entries → task_tokenomics → stream_terminated. Verified via `tail -5 | jq -c '.type'` across 3 sampled traces, 60 total traces conform by construction. [✅]
- `ExecutedTrace.tokenomics` getter (`task.ts:60-96`) is a pure derivation from the `tokenUsages` array — no side effects, deterministic math. [✅]
- Production CLI wiring: `typescript-sdk/src/layers.ts:19` provides `TokenUsageBus.layerNoop` — zero runtime overhead in production, publish/drain sites are no-ops. [✅]

**Local-agent fix (Task #7):**
- `vite.config.ts:22-24` uses `pack.deps.alwaysBundle: [/@neuve\/shared/]` — a regex pattern that matches the full `@neuve/shared` scope. The sibling `packages/typescript-sdk/vite.config.ts` uses `[/@expect\//]` (broader pattern), so scope-wide regexes are the project convention. No need to list individual subpaths. [✅]
- Post-fix `dist/main.js` is 23kB (up from 18kB per diary), contains 2 inlined `parseTraceOutput` references and zero `@neuve/shared` import residuals. [✅]
- Post-fix spawn probe: `echo '{"jsonrpc":"2.0","method":"initialize",...}' | node packages/local-agent/dist/main.js` returns `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}` within ~100 ms. Pre-fix this crashed with `ERR_UNKNOWN_FILE_EXTENSION`. [✅]

**Sweep methodology (Task #3):**
- 3 run directories `run-1/2/3`, each with 20 ndjson files + `metadata.json` + `aggregated_scores.json`. Metadata captures `gitHead`, `gitBranch`, `workingTreeClean=false` with explicit notes, runner config, evalite config, env-load method, start/finish timestamps, wall-clock seconds, evalite-reported duration, exit code, retries (empty), notes. [✅]
- Trace file mtimes are strictly sequential and non-overlapping across run-1 (15:43-15:52), run-2 (15:55-16:04), run-3 (16:07-16:14). No cross-run append. [✅]
- Statistical claims verified: mean_total 7981 / sd 11230, mean_planner 3454 / sd 11283, mean_executor 4526 / sd 367. [✅]
- Run-3 planner-token drop (mean 1290 vs runs 1/2 ~4700) is driven entirely by `journey-3-flight-search` (run-1 planner=63507, run-3 much lower) — inspected `aggregated_scores.json` per task. Planner variance is Gemini-sampling variance on a pathological structured-output task; not a bug or retry artifact. [✅]
- Zero `<|tool_call>` / `<tool_call|>` / `call:` tokens in any of 60 traces. F5 claim verified. [✅]

**Analysis framing (Task #4):**
- F1/F2/F3/F4/F5 claims all independently verified (see "Independent verification runs" table).
- Candidate-culprit list (lines 116-122) enumerates 3 layers explicitly and flags the sweep cannot disambiguate — correct epistemic framing.
- R2 experiment list (lines 130-135) is ordered by cheapness-to-signal and each experiment tests a distinct layer: (1) raw Ollama `/api/chat` isolates layer 1, (2) Ollama `format:schema` override isolates tokens-reach-model question, (3) non-streaming AI-SDK isolates layer 2, (4) llama.cpp direct isolates Ollama-vs-runtime. Reasonable disambiguation; item 25 of checklist ✓.
- v1 misattribution record (lines 147-158) is thorough, includes reproduction evidence, and the "Lesson" at line 158 is actionable for future engineers. [✅]

**PRD correction (Task #8):**
- All 4 `docs/research/gemma-react-browsing/*.md` files carry a dated model-correction banner at the top. `research-brief.md:99-110` is the authoritative Gemma 4 E4B spec: architecture (dense hybrid-attention, 42 layers, sliding-window 512 tokens interleaved with global attention, final layer always global), 128K context, configurable image budget 70/140/280/560/1120 tokens, explicit "no 'not suitable' section prohibits web browsing" (contrasted with Gemma 3n). [✅]
- 3 upstream bug citations (Ollama #15315, mlx-lm #1096, OpenCode #20995) — URLs well-formed. The quoted passage in the diary ("The AI SDK or opencode is not properly parsing/recognizing the tool calls from gemma4 in streaming mode") is attributed to OpenCode #20995 at line 110 which matches the investigation framing. [✅]
- Q9 is well-scoped with 3 explicit candidate layers (Ollama parser / AI-SDK streaming decoder / tool-loop consumer), each with a concrete disambiguation path. [✅]
- `plan.md`: 4 references updated (see MINOR-2 for the 2 residual historical-context mentions). [~]
- 3 memory files updated with historical-correction framing only; no stale guidance in active text. [✅]
- Remaining "Gemma 3n" grep outside diaries/reviews: restricted to the 4 research docs (correction banners + historical-context paragraphs) and the 3 memory files (historical-context only). No stale label in code, prompts, schemas, or active plan-guidance text. [✅]

## Pre-existing issues noted but not in scope

- `packages/evals/src/runners/gemma.ts:99,101,112` typecheck errors exist on HEAD (`git show HEAD:packages/evals/src/runners/gemma.ts` reproduces). Not introduced by this session. Task #6 tracks the fix.
- `pnpm check` formatting drift in 6 `packages/shared` files the engineer didn't touch. Not blocking; orthogonal to this session's work.
- `packages/supervisor/src/executor.ts:354` uses `Stream.mapError((reason) => new ExecutionError({ reason }))` — this is pre-existing (`git diff` confirms no change to line 354) and the error channel is already type-constrained to a union of specific errors, so the mapping is structural not blind-swallow. Flagging for awareness; not actionable in this review.

## Next steps

REQUEST_CHANGES — patch engineer should:

1. Address MAJOR-1 by adding targeted unit tests for `TokenUsageBus` (publish/drain round-trip + `layerNoop` is a no-op), `ExecutedTrace.tokenomics` (aggregation math for mixed planner+executor + peak-not-sum + turnCount-executor-only), and a regression guard for the drain order in `real.ts` (write at least one `token_usage` sequence to a captured trace file and assert the last 5 lines are `token_usage`/`token_usage`/`task_tokenomics`/`stream_terminated`).
2. Address MAJOR-2 by adding `packages/local-agent/tests/dist-boot.test.ts` that spawns `node dist/main.js`, pipes an ACP `initialize` NDJSON line, and asserts a valid response arrives within 1 s. Gate on `existsSync(dist)` so the test skips cleanly when the bundle hasn't been built.
3. Address MINOR-1 by correcting the CV figure in the baseline diary (7.1% → 8.1%).
4. Address MINOR-2 per the lead's preference (rewrite the two residual "Gemma 3n" historical-context references in plan.md, or amend the checklist item 31 to acknowledge correction-context is acceptable).

Suggestions (non-blocking) may be left for a follow-up.

I remain available for a patch-engineer spawn. Will re-review on round 2.
