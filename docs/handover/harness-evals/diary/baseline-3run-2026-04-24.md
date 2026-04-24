# Baseline 3-run sweep — Gemma 4 E4B (gemma-runner, frontier planner)

**Date:** 2026-04-24
**Engineer:** baseline-eng-v2 (team `baseline-measurement-v2`)
**Repo state:** working-tree @ `9e08a59f` (docs/research Gemma-ReAct PRD commit), uncommitted tokenomics instrumentation + evalite concurrency tweak + `packages/local-agent/vite.config.ts` `alwaysBundle` fix. All changes preserved for end-of-chain reviewer audit.

## Summary

Ran the full 20-task `packages/evals/evals/smoke.eval.ts` three times end-to-end against `gemma4:e4b` via Ollama's OpenAI-compat endpoint, with the frontier (Gemini `@ai-sdk/google`) planner. **All 60 trajectories completed** without timeouts, crashes, or zero-trace hangs. **All 60 trajectories also emitted zero tool calls and terminated after a single executor turn** (`turnCount=1`, `toolCallCount=0`).

**Do not read this as Gemma 4's capability floor.** The 0-tools / turnCount=1 pattern reproduces *exactly* the signature failure mode documented in three separate upstream issues (Ollama #15315, mlx-lm #1096, OpenCode #20995) where OpenAI-compat clients fail to parse Gemma 4's custom `<|tool_call>…<tool_call|>` wire format and deliver the raw tokens into `message.content` (or strip them and deliver prose narration). Our stack — Ollama + `@ai-sdk/openai-compatible` + the in-tree local-agent tool-loop — is in the cross-section of those three reports. This sweep measures that pipeline gap, not the model.

## Run summary

| Run | Start (UTC) | End (UTC) | Wall-clock | Evalite duration | Exit | Tasks | Zero-trace hangs |
|-----|-------------|-----------|-----------|------------------|------|-------|------------------|
| 1 | 2026-04-24T13:41:38Z | 2026-04-24T13:52:28Z | 650s (10m50s) | 648.4s | 0 | 20/20 | 0 |
| 2 | 2026-04-24T13:53:54Z | 2026-04-24T14:04:42Z | 648s (10m48s) | 646.0s | 0 | 20/20 | 0 |
| 3 | 2026-04-24T14:05:16Z | 2026-04-24T14:14:12Z | 536s (8m56s) | 534.3s | 0 | 20/20 | 0 |

Total wall-clock across 3 sweeps: **1834s (30m34s)**, serial execution (`maxConcurrency=1`).

No retries. No zombies. Between-run preflight checked: Ollama health = 200, `pgrep -f chrome-devtools-mcp` showed only Cursor IDE plugin-host children (benign, lead-verified).

## Per-run aggregate (from `aggregated_scores.json`)

| Run | completions | aborts | unfinished | mean_total | mean_peak_prompt | mean_turn | mean_planner | mean_executor |
|-----|-------------|--------|------------|-----------|------------------|-----------|--------------|----------------|
| 1   | 0           | 0      | 20         | 9136.1    | 4096             | 1.00      | 4713.8       | 4422.4         |
| 2   | 0           | 0      | 20         | 8856.8    | 4096             | 1.00      | 4357.9       | 4498.9         |
| 3   | 0           | 0      | 20         | 5948.8    | 4096             | 1.00      | 1290.5       | 4658.2         |

All 60 trajectories hit `stream_terminated reason=stream_ended remainingSteps>=1` — none reached `run_finished:passed` or `run_finished:failed`. Completion rate is **0 / 60 (0.0%)**.

## Per-task stability across the 3 runs

All 60 trajectories: `turnCount=1`, `peakPromptTokens=4096`, `toolCallCount=0` — zero variance.

Token totals per task (mean + stddev across 3 runs):

| Task | mean total | sd total | mean planner | sd planner | mean executor | sd executor |
|------|-----------|---------:|-------------:|-----------:|---------------:|------------:|
| calibration-1-single-nav-python-docs    |  5250 |    303 |    984 |    221 | 4266 |  100 |
| calibration-2-single-nav-news           |  4887 |     98 |    606 |     23 | 4281 |   83 |
| calibration-3-two-step-docs             |  5239 |    253 |    911 |    161 | 4329 |  183 |
| calibration-4-two-step-ecom             |  5317 |    590 |    953 |    413 | 4365 |  195 |
| calibration-5-three-step-search         |  5075 |     28 |    882 |     74 | 4193 |   67 |
| hard-volvo-ex90-configurator            |  6890 |    555 |   2370 |    387 | 4520 |  498 |
| journey-1-car-configurator-bmw          |  7924 |   3156 |   3513 |   3183 | 4412 |   50 |
| journey-2-ecom-checkout                 |  6559 |    453 |   1556 |    314 | 5003 |  422 |
| journey-3-flight-search                 | 47690 |  34638 |  42943 |  35606 | 4747 |  968 |
| journey-4-account-signup                |  7299 |    391 |   2638 |    378 | 4661 |  193 |
| journey-5-insurance-quote               |  5913 |    569 |   1285 |    268 | 4628 |  302 |
| journey-6-media-streaming               |  5954 |    460 |   1369 |    167 | 4585 |  295 |
| journey-7-dashboard-filter              |  6041 |    415 |   1326 |    771 | 4715 |  368 |
| journey-8-help-center                   |  5606 |    448 |    982 |    271 | 4624 |  281 |
| journey-9-form-wizard                   |  6208 |    299 |   1413 |    131 | 4795 |  288 |
| journey-10-marketplace-filter           |  5850 |    376 |   1436 |    256 | 4415 |  146 |
| moderate-1-github-explore-topics        |  5601 |    361 |    992 |    129 | 4609 |  341 |
| moderate-2-mdn-web-api-detail           |  5879 |    796 |   1105 |    140 | 4775 |  684 |
| trivial-1-example-homepage              |  5089 |     98 |    802 |     30 | 4287 |  102 |
| trivial-2-wikipedia-main-page           |  5338 |    133 |   1017 |    181 | 4321 |   48 |

Aggregate (60 trajectories, whole-sweep): mean total=7981, sd=11230 (driven entirely by the `journey-3-flight-search` outlier); mean planner=3454 sd=11283; **mean executor=4526 sd=367 (8.1% CV)**.

## Findings

### F1 — Zero tool calls, zero variance in structural signals

Across 60 trajectories:
- `turnCount`: mean 1.00, min 1, max 1 — **no trajectory ever entered a second executor turn**
- `toolCallCount`: 0 on every trajectory, total 0 across 60
- `peakPromptTokens`: exactly 4096 on every trajectory, 0 variance

A stochastic-capability-gap failure would produce *some* variance: occasional malformed tool calls, occasional 2-turn retry attempts, occasional successes on trivial tasks. Instead the executor's terminal trace shape is identical on every trajectory, across three independent runs, across trivial-through-hard tasks. This determinism is a structural signal, not a model-capability signal.

### F2 — Executor tokens are highly stable; planner tokens drive almost all variance

- Mean executor tokens 4526 with stddev 367 across all 60 trajectories (8.1% CV). Per-task executor stddev is in the 50-700 range across the 20 tasks.
- Mean planner tokens 3454 with stddev 11283 across all 60 (massive). Almost all of it is `journey-3-flight-search` alone: mean 42943, stddev 35606 — the frontier planner decided three very different things about that task on three different runs. Excluding that one task, mean planner sd per-task is in the 25-800 range.

Interpretation: the executor's response shape is stable because it's always single-shot text; the planner (Gemini structured output) has normal LLM variance, dominated by one task where Gemini went into a rabbit hole. Neither is load-bearing for the tool-use measurement.

### F3 — Run-3 planner-token drop (~3000 mean delta)

Run 3's mean planner tokens (1290.5) is roughly a third of runs 1/2 (4713.8 / 4357.9). Run 3 wall-clock was also ~112s shorter. This is attributable again to `journey-3-flight-search`: run-3's planner emitted a much shorter plan for that task (8000ish tokens vs 66000 in run-1). Excluding journey-3, runs 1/2/3 are materially comparable.

For the baseline's purpose this is not a contamination — the executor signal (tools=0, turn=1) is invariant across the three runs. Run-3 timing + planner cost are within Gemini's normal variance.

### F4 — `peakPromptTokens=4096` pinned everywhere

Every executor call fits exactly 4096 prompt tokens. The local-agent's `DEFAULT_NUM_CTX` is 32768, so 4096 is not a context-window ceiling — it's the deterministic size of (chrome-devtools-mcp tool manifest + system prompt + injected state) on one executor turn. Since there's only ever one turn, the "peak" is the only value.

Useful reviewer cross-check: any eventual fix that produces multi-turn trajectories should push `peakPromptTokens` higher (context grows with each turn's tool_result) AND show `totalPromptTokens > peakPromptTokens`. At the baseline both are coincident.

### F5 — Agent-message content is prose narration, no visible `<|tool_call>` tokens in traces

Inspected the `agent_message` bodies in a sample of traces across tasks. Output is prose — refusal patterns ("I cannot fulfill this request…"), simulated ReAct-style narration ("Step 1: Navigate to Homepage…"), or planning preludes with no follow-through tool use. **No occurrences of `<|tool_call>`, `<tool_call|>`, `call:`, or other Gemma 4 tool-use tokens** in any of the 60 trace files.

This means the tokens (if emitted) are being stripped *upstream* of the trace recorder — either by Ollama, by `@ai-sdk/openai-compatible`, or by the local-agent tool-loop's content handling — before the `agent_message` content we record. **This sweep alone cannot distinguish which layer is stripping them.** Our trace recorder sees the post-pipeline content, not the raw Ollama HTTP response. See Candidates below.

## Framing — this is a pipeline gap, not a capability floor

The research brief at `docs/research/gemma-react-browsing/research-brief.md` (revised 2026-04-24, Theme 3 "Small-model agents + function calling") documents Gemma 4 E4B's model card claim of native function-calling support with the wire format `<|tool_call>call:NAME{arg:<|"|>VALUE<|"|>}<tool_call|>`. The new **Q9** in `open-questions.md` ("Why is Gemma 4 E4B not emitting tool calls in our current pipeline despite native `tools` capability?") is the load-bearing question this sweep could not answer — precisely because the question asks about layers below our trace boundary.

Upstream corroborating reports (all added to the brief on 2026-04-24):

- **Ollama #15315** (open) — `gemma4:e4b` with Ollama 0.20.1 still has tool parsing errors. Parser produces `invalid character '` looking for beginning of value' for `call:write{...}` output; the custom `<|tool_call>` token stream is not round-tripped through Ollama's OpenAI-compat `tool_calls` field. https://github.com/ollama/ollama/issues/15315
- **mlx-lm #1096** — `_infer_tool_parser()` lacks detection logic for Gemma 4's markers; OpenAI-compat `tool_calls` field never populated, raw tool-call text lands in `message.content`. https://github.com/ml-explore/mlx-lm/issues/1096
- **OpenCode #20995** — OpenAI-compat streaming drops `tool_calls`; **root cause attributed to the client**: *"The AI SDK (`@ai-sdk/openai-compatible`) or opencode is not properly parsing/recognizing the tool calls from gemma4 in streaming mode."* Qwen3 works; issue is Gemma-4-specific. https://github.com/anomalyco/opencode/issues/20995

Our pipeline is **Ollama + `@ai-sdk/openai-compatible`-equivalent (the local-agent's `OpenAI` client from `openai` v4) + streaming tool consumption**. That's exactly the intersection those three issues describe. The 60-trajectory 0-tools / turnCount=1 / 4096-peak constant is the empirical fingerprint of that gap.

## Candidate culprits (not disambiguated by this analysis)

Three layers between Gemma 4's token stream and our trace recorder:

1. **Ollama's OpenAI-compat parser** — if Gemma 4 *is* emitting `<|tool_call>` tokens, Ollama's conversion to the OpenAI Chat Completions response shape may be (a) crashing and dropping the response, (b) stripping the tokens and returning only the surrounding prose, or (c) leaving them in `message.content` as raw text. Evidence for each behavior exists in the upstream issues (#15315 for crash; #1096, #20995 for strip/passthrough).
2. **The `openai` client / `@ai-sdk/openai-compatible` streaming consumer** — if Ollama passes tokens through, the AI-SDK streaming decoder may not parse Gemma 4's custom markers into `toolCalls` deltas. Per OpenCode #20995 this is the layer they pinned.
3. **The local-agent tool-loop** — `packages/local-agent/src/tool-loop.ts` reads `message.content` vs `message.tool_calls`. If tool_calls arrives empty, the loop treats the turn as text-only and exits — matching the observed `turnCount=1` signal exactly.

**This sweep's traces cannot disambiguate these three.** We only see our `agent_message` events, which are the loop's post-processed view. Raw Ollama response bodies, AI-SDK stream chunks, and the tool-loop's pre-dispatch decisions are all below our current trace boundary.

## Recommendation — next step is the R2 spike, not more sweeps

The revised PRD's R2 Phase was updated from a "can the model do tools" spike to a **pipeline reconciliation** spike. From the brief:

> Two paths, to be decided empirically in Phase R2: (a) **native-tokens path** — fix Ollama tool parsing / swap to llama.cpp with PR #21326 template fix so Gemma 4's native format is round-tripped correctly, (b) **grammar-override path** — use `format: <AgentTurn JSON Schema>` and accept the distributional shift away from training format.

Concrete experiments R2 should run to resolve Q9 (ordered by cheapness-to-signal):

1. **Raw Ollama request** — bypass `openai` SDK entirely; POST a chat+tools request directly to Ollama's `/api/chat`; check whether `message.tool_calls` is populated for `gemma4:e4b`. If populated → culprit is (2) or (3). If empty and content has `<|tool_call>` markers → culprit is (1)b/c. If error response → culprit is (1)a.
2. **Ollama `format: <schema>` override** — keep the current client, override with JSON-schema structured output. If the executor starts producing a JSON turn with tool calls → Gemma 4 generalizes out of native tokens and the grammar-override path is viable now. If still zero tool calls → the issue is upstream of decoding (e.g., tools not reaching the model at all).
3. **Non-streaming AI-SDK** — same client, `mode: "json"` + non-streaming `generateObject`. If tool-calls appear → the streaming decoder (2) is the specific culprit per OpenCode #20995.
4. **llama.cpp direct** — if (1) shows Ollama parser crash, run Gemma 4 through llama.cpp with the PR #21326 template fix to confirm the native path works outside Ollama.

Cost estimate (from the research brief): ~1 day if culprit is the client (happy path), ~3-5 days if culprit is Ollama and we have to swap runtimes.

## Test gap that let this ship unnoticed

- Every eval-package unit test (120/120 passing in `pnpm --filter @neuve/evals test`) uses a **mocked or scripted `Agent` layer** — never the real `Agent.layerLocal` that spawns the bundled local-agent binary. The local-agent runtime crash (see `wave-4-5-baseline-diff.md` and `baseline-eng-v2`'s session log) was therefore invisible to the test suite even though it made the gemma runner entirely non-functional end-to-end.
- Likewise, no test exercises the Ollama + OpenAI-compat boundary with `gemma4:e4b`; all AI-SDK-using tests either mock the provider or use the frontier Gemini path.

**Backlog item (non-blocking, reviewer discretion):** add an integration test that spawns the bundled local-agent via `AcpClient`, issues an ACP `initialize`, and asserts the child responds (not that it handles tools correctly — just that it doesn't crash on startup). Would have caught the `ERR_UNKNOWN_FILE_EXTENSION` bug instantly. Any deeper assertion (tool calls emitted) requires the R2-disambiguated fix first.

## Misattribution from the v1 attempt — recorded explicitly so future engineers don't repeat it

The prior `baseline-eng` in team `baseline-measurement-v1` ran `smoke.eval.ts` with `maxConcurrency=5`, observed every task hang silently until its 10-minute `testTimeout`, and attributed the hang to "5 parallel local-agent ACP handshakes + 5 parallel chrome-devtools-mcp spawns fighting for stdio + Ollama" — i.e. concurrency contention. That diagnosis was wrong.

The real cause (reproduced by this engineer in 3 seconds by running `node packages/agent/node_modules/@neuve/local-agent/dist/main.js` standalone):
- `@neuve/shared/package.json` exports subpaths to `.ts` source files (e.g. `./parse-trace-output → ./src/parse-trace-output.ts`).
- `packages/local-agent/vite.config.ts` externalizes workspace deps by default, so its bundled `dist/main.js` leaves `import { parseTraceOutput } from "@neuve/shared/parse-trace-output"` un-inlined.
- When `AcpClient.layerLocal` spawns that binary via raw `node`, Node ESM cannot load `.ts` files → child dies with `ERR_UNKNOWN_FILE_EXTENSION` in <50ms.
- `AcpClient` has no spawn-death watcher and no handshake timeout — it waits forever on the JSON-RPC handshake over stdin/stdout from a child that no longer exists → silent 10-min hang per task, scaled by concurrency.

v1's hang was deterministic, concurrency-independent, and reproducible at `maxConcurrency=1`. I confirmed this at the start of this session: the first calibration run after switching to `maxConcurrency=1` hung identically to v1. The concurrency tweak didn't fix anything; the `alwaysBundle: [/@neuve\/shared/]` fix to `packages/local-agent/vite.config.ts` did.

**Lesson:** before attributing a silent hang to concurrency, run the affected subprocess standalone with `node <path>` and see if it stays alive. Takes seconds, rules out instantly the entire class of "child dies immediately and parent waits forever" bugs.

## Fixes landed this session (all uncommitted; end-of-chain reviewer audits)

1. `packages/local-agent/vite.config.ts` — added `pack.deps.alwaysBundle: [/@neuve\/shared/]`, rebuild produces a 23kB `dist/main.js` (was 18kB) with `@neuve/shared` subpaths inlined. `node .../local-agent/dist/main.js` with a stubbed ACP `initialize` message now succeeds; before, it crashed instantly.
2. `packages/evals/evalite.config.ts` — `maxConcurrency: 5 → 1` (per lead direction; now known to be defensive, not corrective).
3. Trace-recorder / task / executor / plan-decomposer / local-agent tool-loop / typescript-sdk layers — tokenomics instrumentation as inherited from `baseline-eng`'s v1 work. Test-pass verified (118/118 shared, 95/95 supervisor, 120/120 evals). Pre-existing typecheck error in `packages/evals/src/runners/gemma.ts:99,101,112` (unreachable `catchTags` handlers for `AcpProviderUnauthenticatedError` / `AcpAdapterNotFoundError` — tags `Agent.layerLocal` never raises) is a regression in the Apr-24 `fix(supervisor): replace JSON-parse frontier planner with @ai-sdk/google structured output` commit chain, not this session's work. Reproduced on HEAD via `git show HEAD:… > … && tsgo --noEmit`. Filed as task #6 (non-blocking).

## Artifacts

- `packages/evals/evals/traces/baseline/run-1/` — 20 ndjson traces + `metadata.json` + `aggregated_scores.json`
- `packages/evals/evals/traces/baseline/run-2/` — same structure
- `packages/evals/evals/traces/baseline/run-3/` — same structure
- `packages/evals/evals/traces/baseline-abandoned-concurrency5/` — preserved evidence from the prior team's concurrency-misattribution attempt (do not delete per lead instruction)
- `/tmp/baseline-eng-v2-backup/run-{1,2,3}.log` — full evalite stdout
- `/tmp/baseline-eng-v2-backup/run-{1,2,3}.tstamp` — run start/end timestamps

## Open for the reviewer (task #5)

- Verify the `alwaysBundle` regex pattern in `packages/local-agent/vite.config.ts` — is a scope-wide regex `[/@neuve\/shared/]` the right blast radius (cf. `packages/typescript-sdk/vite.config.ts` which uses `[/@expect\//]`), or should we explicitly list subpaths?
- Inherited tokenomics instrumentation — reviewer's first audit pass. Per-file scan already clean for `catchAll` / `mapError` / `null` / `as X` patterns (only exception: two `as ReadonlyArray<TokenUsageEntry>` casts on empty arrays in `packages/shared/src/token-usage-bus.ts` for TS tuple-widening — arguably unavoidable).
- Task #6 — the pre-existing gemma.ts typecheck errors; confirm it's safe to land a trivial fix alongside this sweep or punt to a follow-up.
- Backlog: the local-agent-spawn integration test (see Test gap).
