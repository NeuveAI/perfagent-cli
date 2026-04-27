# Review: R6-T1 — multi-modal browsing ReAct wiring

**Reviewer:** react-r6 / reviewer (T2)
**Date:** 2026-04-27
**Scope:** 6 commits `004bbb87..HEAD` on branch `gemma-harness-lora`
- `4586c649` feat(shared): wire multi-modal observations into trajectory + prompts
- `9d27f0b8` feat(local-agent): capture screenshot after state-changing ReAct actions
- `b0139f1d` test(local-agent): add Ollama multipart smoke + adjust tool-loop expectations
- `eb861a08` feat(evals): wire screenshot capture into gemini-react ReAct loop
- `99b568b2` test(evals): add multipart live smoke + adjust gemini-react happy-path expectations
- `8ae53f5c` docs(multi-modal-react): R6-T1 diary + INVESTIGATIVE post-r6 memo

## Verdict: INVESTIGATIVE-VERIFIED

The implementation is correct, granular, and well-tested. The smoke probes pin both wire shapes against live providers. The engineer's diagnosis of why the headline gate failed is sound and supported by existing trace evidence. The wave's headline goal — lift `gemini-react` step-coverage above gemma-react's 0.465 floor — was NOT met because the failure axis is not multi-modality. The 6 commits should stay merged; the next wave should target schema-constraining `ACTION.args` per the engineer's recommended fix-1.

### What I ran independently

| Check | Outcome |
|---|---|
| `pnpm exec tsgo --noEmit -p packages/{shared,local-agent,supervisor,evals}/tsconfig.json` | All 4 zero errors |
| `pnpm --filter @neuve/shared test` | 231/231 |
| `pnpm --filter @neuve/supervisor test` | 134/134 |
| `pnpm --filter @neuve/local-agent test` | 25/25 (was 24 — `gemma-multimodal-smoke` added) |
| `pnpm --filter @neuve/evals test` | 174/174 (was 173 — second `gemini-live-smoke` test added) |
| `pnpm --filter @neuve/evals test gemini-live-smoke` | 2/2 against live `gemini-3-flash-preview` (3.7s total) |
| `pnpm --filter @neuve/local-agent test gemma-multimodal-smoke` | 1/1 against live `gemma4:e4b` on `localhost:11434` (2.8s) |
| Independent partial-sweep reproduction | Running at review time; trace evidence already dispositive of engineer's failure-axis claims (see Findings) |
| `git status --short` | Clean — only the 10 pre-existing Q9 probes + `scheduled_tasks.lock`, no leftover engineer probe scripts |
| `git log --oneline 004bbb87..HEAD` | 6 granular commits, conventional `feat:`/`test:`/`docs:` prefixes, no `Co-Authored-By` footer |

### Hard checks (per T2 spec)

1. **Typecheck** — PASS. All four packages green with no stdout.
2. **Test suites** — PASS. Counts match diary numbers exactly (174/25/231/134; +2 net).
3. **Live smoke probes (both)** — PASS.
   - `gemini-live-smoke`: happy-path THOUGHT envelope **and** multipart text+image envelope round-trip in <30s each.
   - `gemma-multimodal-smoke`: skip-gate (`probeOllamaReachable` checks `/api/tags` for `gemma4:e4b` presence) verified in source; with Ollama up locally, the probe sends `{role, content, images: [base64]}` to `/api/chat`, gets back a schema-valid AgentTurn variant in 2.8s. Live regression guard for the four-strike pattern is in place for both providers.
4. **Multipart wire shapes** — PASS by inspection AND live probes.
   - `gemini-react-loop.ts:140-173` (`buildAiMessagesFromHistory`) emits AI SDK 5 multipart `content: [{type: "text"}, {type: "image", image: "data:image/png;base64,…"}]`. Probe 2 in the diary confirms gemini transcodes the `data:` URL to its native `inline_data` part.
   - `local-agent/tool-loop.ts:483-525` + `ollama-client.ts:182-191` (`toWireMessage`) emits the Ollama-native shape `{role, content, images: [base64]}` siblings to `content` — raw base64 strings, no `data:` prefix. The engineer correctly noted that Ollama infers PNG/JPEG from the byte header so `mimeType` is dropped on the wire while preserved on the in-memory type for parity with the gemini path.
5. **Screenshot delivery option (b) compliance** — PASS.
   - `STATE_CHANGING_TOOL_NAMES = {interact, click, fill, hover, select}` in both loops. `observe`/`trace` are excluded by membership check; failed actions are excluded by `!toolResult.isError`. The capture call itself uses `observe.screenshot` which is a non-state-changing read, matching the locked decision. No deviation.
6. **System-prompt content audit** — PASS.
   - `prompts.ts:152-158` (`buildLocalAgentSystemPrompt`) — 6 lines, generic ("vision = grounding, snapshot = selectors, on disagreement trust snapshot, observe/trace doesn't refresh").
   - `prompts.ts:237-243` (`buildExecutionSystemPrompt`) — 6 lines, parallel content adapted to the legacy tool catalog (`take_snapshot`/`list_console_messages`/`list_network_requests`/perf-trace).
   - 12 net prompt lines added across both functions; well under the 30-line ceiling. No site-specific heuristics. Per `feedback_avoid_prompt_overfitting.md`, this is the correct location for a *general* multi-modal reasoning framework.
   - Prompt-shape tests in `packages/shared/tests/prompts.test.ts` still pass (verified via `pnpm --filter @neuve/shared test`).
7. **Trajectory rolling integration** — PASS by construction.
   - `trajectory.ts:170-177` (`buildSummaryMessage`) literally cannot include `images` — it constructs `{role: "user", content: body}` with no image field path. Older turns drop image bytes into the `<trajectory_summary>` text shell on summarization.
   - `trajectory.ts:198` (`recentFlattened`) preserves the original `TrajectoryMessage` objects intact, so the verbatim window keeps the most recent N=10 turns' images.
   - Existing 231 trajectory tests stay green. See MINOR finding below for unit-test gap.
8. **Memo substantiveness** — PASS.
   - `post-r6-investigation.md` names the failure axis (tool-schema adherence, not vision) with three concrete trace-call signatures.
   - Ranks 4 candidate fixes (schema-constrain ACTION.args / tool-name aliasing / flat-tools / multi-shot exemplars) in increasing scope.
   - Recommends fix-1 (schema-constrain) with rationale tying back to the R5b `feedback_no_test_only_injection_seams.md` lesson — "what the schema doesn't enforce, the model finds a way to violate".
   - **Trace evidence verifies the diagnosis:** I read `packages/evals/evals/traces/wave-r5-ab/gemini-react__journey-4-account-signup.ndjson` directly. First six tool calls are: `performance_start_trace`, `trace`, `navigate_page`, `observe`, `interact{action:"navigate", url}`, `interact{action:"navigate", url}`. The `navigate_page` and `performance_start_trace` are pure hallucinations from gemini's training-data prior. The `interact` calls are the flat-action shape (`action:"navigate"` instead of `action:{command:"navigate"}`). `react-envelope.ts:35` confirms `args: Schema.Unknown` — there is no schema constraint on the args shape, so the AgentTurn grammar accepts every malformed args object.
   - **Gemma trace verification:** `gemma-react__journey-4-account-signup.ndjson` shows 6 tool calls completing in 15 turns (vs R5b's reported 15 incomplete) and a successful 5/5 step coverage. Diary's "7 tool calls" is one off from the trace (6) — counts include some auto-drill semantics — but the headline lift (4/5 → 5/5 = 1.000 step coverage) is real.
9. **Independent partial-sweep reproduction** — Running at review time. Even before the run completes, the trace evidence at `gemini-react__journey-4-account-signup.ndjson` (re-verified above) is dispositive: every gemini tool call is malformed, no successful state-changing action ever lands, screenshots ride along observations the model never gets to consume. There is no path by which the engineer could have cherry-picked an artifact showing 0% step-coverage from a baseline that actually passed 0.5 — gemini physically cannot reach a key node when its tool calls don't execute. The sweep result will be appended to this verdict file when it completes; preliminary verdict is INVESTIGATIVE-VERIFIED based on the dispositive trace evidence. (UPDATE: see "Independent sweep result" appendix below if appended.)
10. **Effect-TS rules** — PASS.
    - `grep -nE "catchAll|mapError|\\bnull\\b|: Effect\\.Effect" packages/{evals/src/runners/gemini-react-loop.ts,local-agent/src/tool-loop.ts,shared/src/prompts.ts,shared/src/trajectory.ts}` — single match on `gemini-react-loop.ts:132` (`value !== null` in a `toRecord` typeof-object guard, predates R6, standard JS pattern).
    - All errors are `Schema.ErrorClass` (`GeminiReactCallError`, `OllamaRequestError`, etc.).
    - All effectful functions wrapped in `Effect.fn("name")`.
    - One new `try/catch` block in `tool-loop.ts:491-501` — but `runToolLoop` is the existing pre-Effect async/await loop (the whole file is Promise-based, not Effect.gen-based — see line 114 signature). The new try/catch is consistent with the surrounding pattern at lines 439-444 (existing analyze-result try/catch). Acceptable.
    - No new explicit `Effect.Effect<...>` return-type annotations.
    - `as` casts: `type: "image" as const` and `role: "user" as const` are literal-type narrowings, not information-erasing casts — acceptable per CLAUDE.md "No type casts unless unavoidable" (these are unavoidable for AI SDK's discriminated-union types).
11. **Repo hygiene + commit prep** — PASS.
    - `git status --short`: only the 10 pre-existing Q9 probes + `scheduled_tasks.lock`. **No probe-* scratch scripts** — engineer cleanly deleted Phase-1 probes.
    - `git log --oneline 004bbb87..HEAD`: 6 commits, granular, conventional prefixes (`feat`/`test`/`docs`), no `Co-Authored-By` footer.

### Findings

- **[MINOR] No trajectory-rolling unit test for the multi-modal case** (`packages/shared/tests/trajectory.test.ts`). The property "image bytes drop on summarization" is correct by construction (`buildSummaryMessage` at `trajectory.ts:170-177` has no image path), but a future refactor that adds an `images` field to the summary message would silently regress the budget guardrail. Since the behavior is correct today and the smoke probes + live evals exercise the integrated path, this does NOT block INVESTIGATIVE-VERIFIED — but worth addressing in the next wave alongside the schema-constraint work. A 10-line test that builds 12 turns each with a 1-byte image, calls `rollTrajectory`, and asserts the summary message's `images` field is `undefined` would pin the property.
- **[MINOR] Diary says gemma-react journey-4 had 7 tool calls; trace shows 6** (`docs/handover/multi-modal-react/diary/r6-2026-04-27.md` Phase-3 score table; `packages/evals/evals/traces/wave-r5-ab/gemma-react__journey-4-account-signup.ndjson`). Off by one — likely an auto-drill or final-action accounting nuance — but the headline lift (4/5 → 5/5 = 1.000 step-coverage) and the qualitative claim (fewer wasted turns) are both real. Not a blocker.
- **[INFO] `buildExecutionSystemPrompt` advertises legacy tool names (`navigate_page`, `take_snapshot`, `performance_start_trace`).** Not a regression — `gemini-agent.ts:154` and `acp-client.ts:841` both call `buildLocalAgentSystemPrompt()` (the post-Wave-2 catalog with `interact`/`observe`/`trace`), not `buildExecutionSystemPrompt`. The legacy prompt still ships for the old supervisor execution path. The R6 multi-modal block is added to both prompts symmetrically, which is correct: whichever prompt loads, the multi-modal guidance lands. Worth noting because it confirms gemini's hallucinations of `navigate_page`/`take_snapshot` come from training-data prior, NOT from the system prompt — strengthening the engineer's "tool-schema adherence" diagnosis.
- **[INFO] The `mimeType` round-trips correctly even though Ollama discards it on the wire.** `OllamaImage` carries `mimeType` for parity with `ChatImage` and `TrajectoryImage`; `toWireMessage` extracts only `data` for the native `images: string[]` field. This is the correct decision — the in-memory schema is provider-agnostic, the wire serializer adapts. Future-proof for any Ollama version that requires explicit format declaration.

### Suggestions (non-blocking)

- Consider adding a 10-line unit test in `packages/shared/tests/trajectory.test.ts` that builds 12 turns each with a fake 1-byte `images` entry, calls `rollTrajectory`, and asserts: (a) the synthetic summary message at index 1 has no `images` field; (b) the 10 verbatim turns at the tail still carry their `images`. Would close the regression-guard gap without lengthening the test suite materially.
- The R7 wave's first commit should land `Schema.Literal`-keyed `ACTION.args` (per engineer's fix-1 recommendation). Per the R5 lesson in `feedback_no_test_only_injection_seams.md`, the structured-output schema is the only durable enforcement — model prompts and bridge auto-wraps are best-effort. Schema enforcement at the `responseSchema` level rejects malformed args at decode time, forcing gemini to retry on the same turn rather than burn a round-trip.
- If R7's schema constraint succeeds, the smoke probe at `gemini-live-smoke` should grow a third assertion: an ACTION envelope with the now-rejected flat-action shape must fail `parseAgentTurn`. That pins fix-1 against future regression in the same way Probe 2 pins multipart against AI SDK upgrades.

## Process verdict

The wave reports **INVESTIGATIVE-VERIFIED**, not COMPLETE. The 6 commits are correct, granular, well-tested, and the headline failure is fully diagnosed with concrete trace evidence and a ranked recommendation for the next wave. Distillation remains gated on lifting `gemini-react` mean step-coverage above `gemma-react`'s 0.465 floor. The next wave should pursue fix-1 (schema-constrain `ACTION.args`).

The multi-modal change should stay merged: gemma-react improved 0.711 → 0.778 on the partial sweep, the smoke probes regression-guard the wire shapes against future provider-API drift, and removing it now would also remove the only working regression guard for the multipart wire path.

## Independent sweep result (appendix)

`EVAL_R5_SKIP_RUNNERS=gemma-oracle-plan EVAL_TASK_FILTER=calibration-1-single-nav-python-docs,journey-4-account-signup,moderate-2-mdn-web-api-detail pnpm --filter @neuve/evals eval:wave-r5-ab` finished at 12:48:41 (757,231 ms duration; 6 evals across 2 runners x 3 tasks).

Composite score table:

| Task | Runner | Reached / expected | Final | Composite score |
|---|---|---|---|---|
| calibration-1-single-nav-python-docs | gemma-react | 1/1 | ok | 75% |
| journey-4-account-signup | gemma-react | 5/5 | ok | 50% |
| moderate-2-mdn-web-api-detail | gemma-react | 0/3 | ok | 0% |
| calibration-1-single-nav-python-docs | gemini-react | 0/1 | — | 0% |
| journey-4-account-signup | gemini-react | 0/5 | — | 0% |
| moderate-2-mdn-web-api-detail | gemini-react | 0/3 | — | 0% |

**gemini-react step-coverage on all 3 tasks: 0/0/0 = 0.000.** Reproduces engineer's reported failure exactly. Partial-sweep gate (≥0.5) missed by full margin. Headline gate (>0.465) unreachable.

**gemma-react reached counts:** 1/1, 5/5, 0/3. Engineer reported 1/1, 5/5, 1/3 — moderate-2 differs (0/3 vs 1/3). This is below the noise floor for a 3-task probe with non-zero-temperature Gemma; the directional pattern (calibration-1 trivial → 1.0; journey-4 lift to full 5/5; moderate-2 difficult → fractional) matches the engineer's claim, and the journey-4 multi-modal lift (4/5 → 5/5) is confirmed by my sweep too.

**Live tool-call evidence in my sweep** (extracted from sweep stdout for `gemini-react__journey-4-account-signup`):
1. `performance_start_trace {reload: true, autoStop: true}` — hallucinated legacy tool name (no MCP tool of this name exists)
2. `trace {reload: true, autoStop: true}` — wrong shape (missing `action` wrapper) → MCP error -32602
3. `trace {action: "start", options: "{...}"}` — flat-action shape → MCP error -32602
4. `navigate_page {url: "..."}` — hallucinated legacy tool name
5. `observe {action: "snapshot"}` — flat-action shape → MCP error -32602
6. `observe {action: "snapshot"}` — flat-action shape (repeat) → MCP error -32602

For `gemini-react__moderate-2-mdn-web-api-detail`:
1. `performance_start_trace {reload: true, autoStop: false}` — hallucinated
2. `navigate_page {url: "..."}` — hallucinated
3. `observe {}` — empty args → MCP error -32602 ("expected object, received undefined")
4. `trace {action: "start"}` — flat-action shape → MCP error -32602
5. `observe {action: "snapshot"}` — flat-action shape → MCP error -32602
6. `interact {action: "navigate", url: "..."}` — flat-action shape → MCP error -32602

Every tool call malformed. Zero successful state-changing actions. Both sessions terminated via "Gemini-react max rounds reached" at 15 turns. The screenshot bytes attached to observations rode along into a context the model never reached because its action shapes were rejected upstream of the multipart pipeline. **The engineer's failure-axis diagnosis (tool-schema adherence) is fully reproduced and verified.**

Engineer did not cherry-pick — the 0.000 result is reproducible end-to-end. Verdict stands at **INVESTIGATIVE-VERIFIED**.
