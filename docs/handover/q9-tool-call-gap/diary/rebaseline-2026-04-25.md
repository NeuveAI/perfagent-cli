# Re-baseline post Q9 fix — 2026-04-25

**Repo state:** main @ `cf6e565e` (Q9 fix shipped). Local-agent + apps/cli rebuilt.
**Protocol:** identical to 2026-04-24 baseline — `EVAL_RUNNER=gemma`, `EVAL_GEMMA_PLANNER=oracle-plan` (was `frontier` pre-rename), `maxConcurrency=1`, 20 hand-authored tasks × 3 sweeps = 60 trajectories.

## Summary

The Q9 fix unlocks multi-turn tool-calling exactly as the post-fix probe predicted. Mean turn count moves from `1.0` (pre-fix) to `11.2` (post-fix, 3-run mean). Mean total tokens move from `7,981` to `40,325` (~5x). Tool calls fire on most tasks (avg ~30 per trajectory). **But completion count stays at 0/20 across all three runs** — for a structurally different reason than pre-fix, surfaced below.

## Per-run aggregate (from `aggregated_scores.json`)

| Run | completions | mean total | mean peak prompt | mean turn | mean planner | mean executor |
|---|---|---|---|---|---|---|
| Pre-fix run 1 (2026-04-24) | 0/20 | 9,136 | 4,096 | **1.0** | 4,714 | 4,422 |
| Pre-fix run 2 (2026-04-24) | 0/20 | 8,857 | 4,096 | **1.0** | 4,358 | 4,499 |
| Pre-fix run 3 (2026-04-24) | 0/20 | 5,949 | 4,096 | **1.0** | 1,290 | 4,658 |
| **Post-fix run 1** (2026-04-25) | 0/20 | 40,664 | 3,894 | **11.3** | 1,398 | 39,266 |
| **Post-fix run 2** (2026-04-25) | 0/20 | 38,183 | 3,895 | **10.6** | 1,256 | 36,927 |
| **Post-fix run 3** (2026-04-25) | 0/20 | 42,128 | 3,991 | **11.6** | 1,403 | 40,725 |

Stability is preserved: post-fix turn counts cluster `10.6–11.6` (vs pre-fix uniform `1.0`), executor tokens cluster `36k–41k` (vs `4.4k–4.7k`). Determinism property of the prior baseline holds.

## Tool-call distribution (3 × 20 = 60 trajectories)

```
Pre-fix:  0 tool_calls on every trajectory (60/60)
Post-fix: counts vary per task — avg ~30, max 47, min 0
```

Per task across the 3 post-fix runs (median tool_call count):

| Task | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| calibration-1-single-nav-python-docs    | 1  | 33 | 39 |
| calibration-2-single-nav-news           | 36 | 35 | 39 |
| calibration-3-two-step-docs             | 44 | 46 | 1  |
| calibration-4-two-step-ecom             | 1  | 1  | 3  |
| calibration-5-three-step-search         | 41 | 39 | 39 |
| hard-volvo-ex90-configurator            | 39 | 35 | 5  |
| journey-1-car-configurator-bmw          | 44 | 46 | 36 |
| journey-2-ecom-checkout                 | 0  | 0  | 46 |
| journey-3-flight-search                 | 43 | 38 | 41 |
| journey-4-account-signup                | 47 | 16 | 37 |
| journey-5-insurance-quote               | 47 | 0  | 26 |
| journey-6-media-streaming               | 1  | 10 | 39 |
| journey-7-dashboard-filter              | 42 | 5  | 46 |
| journey-8-help-center                   | 44 | 46 | 46 |
| journey-9-form-wizard                   | 41 | 25 | 47 |
| journey-10-marketplace-filter           | 14 | 43 | 14 |
| moderate-1-github-explore-topics        | 39 | 38 | 8  |
| moderate-2-mdn-web-api-detail           | 46 | 46 | 40 |
| trivial-1-example-homepage              | 2  | 0  | 2  |
| trivial-2-wikipedia-main-page           | 33 | 37 | 39 |

A few tasks emit very few tool calls in some runs (calibration-4 across all 3 runs; trivial-1 in run 2) — likely cases where Gemma still falls into a content-channel emission edge case the bridge hasn't handled, or where the doom-loop detector terminates early. Worth follow-up sampling.

Most tasks land in the 35–47 range, which is the auto-drill ceiling: navigate → start trace → analyze 8–10 insights → re-navigate → repeat. The auto-drill insight chain is exactly what the local system prompt teaches; Gemma is following it.

## Why completions are still 0/20

**Architectural mismatch surfaced by the fix.** Across all 60 post-fix trajectories:

- `STEP_START` markers: 0
- `STEP_DONE` markers: 0
- `ASSERTION_FAILED` markers: 0
- `RUN_COMPLETED` markers: 0
- `stream_terminated reason=stream_ended` on every trajectory

The executor's adherence gate (`executor.ts`) waits for protocol markers (`STEP_START`/`STEP_DONE`/`RUN_COMPLETED`) to score the run. Those markers come from `buildExecutionSystemPrompt` — but that prompt is OVERRIDDEN by `buildLocalAgentSystemPrompt` for the local provider, in `packages/agent/src/acp-client.ts:797-799`:

```ts
const effectiveSystemPrompt =
  adapter.provider === "local"
    ? buildLocalAgentSystemPrompt()
    : Option.getOrUndefined(systemPrompt);
```

The local-agent prompt teaches Gemma the tool catalog and workflow but does NOT mention the `STEP_START`/`STEP_DONE`/`RUN_COMPLETED` protocol. So Gemma never emits them, and the executor never sees a clean termination — it waits for `MAX_TOOL_ROUNDS=15` to elapse and the stream to end.

This is the primary completion-blocker post-Q9. Two possible answers:

1. **Teach the local prompt the executor's protocol** — extend `buildLocalAgentSystemPrompt` to include `STEP_START`/`STEP_DONE`/`RUN_COMPLETED` semantics. Cleanest if we want the harness's adherence gate to keep working under Gemma.
2. **Architecturally separate runtime vs. harness** — the harness expects the executor protocol; the runtime (Gemma owning the loop end-to-end) has different conventions. The ReAct migration's whole point is that Gemma plans + executes in a single loop, so harness adherence semantics need to be redefined for that mode anyway. Decide together with R1-R5 scope.

For the data here: completions=0 is no longer a Gemma capability ceiling, it's a protocol ceiling. The trajectories show real agentic browsing — navigation, trace recording, multi-insight analysis, occasional drift to unrelated sites — limited by `MAX_TOOL_ROUNDS=15` and prompt-protocol mismatch.

## Trajectory shape (illustrative)

`journey-4-account-signup` run 1 (47 tool calls):

```
TC interact({"command":"navigate","url":"https://www.figma.com/"})       ✓
TC trace({"command":"start","reload":true,"autoStop":true})              ✓ → CWV + insights
TC trace({"action":{"command":"analyze","insightName":"LCPBreakdown"}})  ✓
TC trace({"action":{"command":"analyze","insightName":"CLSCulprits"}})   ✓
TC trace({"action":{"command":"analyze","insightName":"RenderBlocking"}}) ✓
... 5 more analyze calls for the same insightSet ...
TC interact({"command":"navigate","url":"https://www.google.com"})       ✓  ← drift
TC trace({"command":"start","reload":true,"autoStop":true})              ✓
... google.com analyze loop ×3 cycles ...
TERM reason=stream_ended
```

Notable: Gemma emits BOTH the flat `{command, url}` shape (for navigate) AND the nested `{action: {command, ...}}` shape (for analyze) — both are accepted by the bridge's auto-wrap logic. The flat shape comes naturally; the nested shape comes because the local system prompt explicitly documents the analyze call as `{ "action": { "command": "analyze", "insightSetId": ..., "insightName": ... } }`. So Gemma follows the prompt verbatim. Mixed-shape behavior is fine; the wrapper detection at call-time normalizes both.

## peakPromptTokens=3900 anomaly — RESOLVED via Probe D

`peakPromptTokens` clusters at `3,894 / 3,895 / 3,991` across the 3 runs despite `mean_turn_count = 11.2` and `DEFAULT_NUM_CTX = 131072` baked into the local-agent bundle.

**Root cause: Ollama's `/v1/chat/completions` (OpenAI-compat) silently drops `num_ctx`.** Probe D (`docs/handover/q9-tool-call-gap/probes/probe-d-context-truncation.mjs`) confirms with three measurements:

| Probe variant | Endpoint | num_ctx position | Reported prompt_tokens for ~10K input |
|---|---|---|---|
| 1 | `/v1/chat/completions` | top-level | **4,096** (cap) |
| 2 | `/v1/chat/completions` | nested in `options` | **4,096** (cap) |
| 3 | `/api/chat` | nested in `options` | **10,028** (no cap) |

The OpenAI-compat layer accepts the body but discards `num_ctx` regardless of placement. Ollama then falls back to its server-side default of 4096 and silently truncates input over that. Native `/api/chat` respects the value.

**Fix path: switch `OllamaClient` to native `/api/chat`.** This falls out naturally with R2 anyway — Ollama's `format` parameter for JSON-Schema grammar override is a native-API feature, so R2's migration path already requires moving off the OpenAI SDK. The truncation fix and the format-grammar feature land together. No action needed before R2 unless we want to unblock context-limited tasks earlier.

This explains a chunk of the post-fix `0/20` completion rate too: even when Gemma was tool-calling correctly, multi-turn trajectories were silently losing earlier context, which is consistent with the `journey-4` trajectory's drift to google.com after analyzing figma.com — Gemma forgot the original task after a few turns.

## Conclusion

Q9 fix is validated. The 2026-04-24 baseline number `25% / turnCount=1 / 0 tool calls` was indeed an MCP-bridge schema bug, not a Gemma capability floor. Gemma 4 E4B is now doing real multi-turn agentic browsing on these tasks: navigation, trace recording, multi-insight performance analysis. The 0/20 completion rate is now bottlenecked by a different bug (prompt-protocol mismatch), and characterizing Gemma 4's actual capability requires fixing that next.

## Recommended next steps

1. **Decide protocol architecture** — extend `buildLocalAgentSystemPrompt` with the executor's status-marker protocol, OR accept that local-mode runs end at `MAX_TOOL_ROUNDS` and rework adherence scoring for the local path. This is a ReAct PRD scope question.
2. **Quick spike on peakPromptTokens** — confirm `num_ctx` is reaching Ollama and whether the model is silently truncating. 30-min probe.
3. **Investigate the few-tool-call outliers** — calibration-4 emits only 1–3 tool calls all 3 runs. Sample its trajectory; might reveal a residual content-channel emission case.
4. **Audit auto-drill termination** — current auto-drill in `tool-loop.ts:240-321` triggers on `trace stop` and walks every insight. The journey-4 example shows Gemma re-navigating to unrelated sites and repeating the cycle. Doom-loop detector at `tool-loop.ts:163-194` requires 3 IDENTICAL consecutive calls; cycle-with-different-URLs evades it. Worth a smarter loop detector or a per-task budget.

## Artifacts

- `packages/evals/evals/traces/post-q9-fix/run-{1,2,3}/` — 60 trajectories + 3 aggregated_scores.json (gitignored, local only)
- Pre-fix baseline at `packages/evals/evals/traces/baseline/run-{1,2,3}/`
- This diary: `docs/handover/q9-tool-call-gap/diary/rebaseline-2026-04-25.md`
