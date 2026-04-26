# Wave R6 — Multi-modal browsing ReAct

**Status:** PLANNED 2026-04-26 (post-compact pickup point).
**Predecessor:** R5b SHIPPED 2026-04-26 (HEAD `2b024e21`, branch `gemma-harness-lora` 159 ahead of `origin/main`, pushed).
**Owner:** team-lead (post-compact session resumes here).

## Why

Live 60-eval A:B baseline (`docs/handover/harness-evals/baselines/wave-r5-ab.md`) shows the production model beating the frontier baseline:

| Runner | Pass | Mean step-coverage | Mean turns |
|---|---|---|---|
| gemma-react (production) | 4 | **0.465** | 10.1 |
| gemini-react (frontier baseline) | 2* | **0.000** | 14.4 |
| gemma-oracle-plan (ablation) | 0 | 0.346 | 9.6 |

\* Both gemini-react `OK` terminals have step-coverage=0.000 — Gemini hallucinates `RUN_COMPLETED:passed` without progress.

This blocks distillation. Distilling 0%-coverage trajectories into Gemma teaches the student to also hallucinate completion. Before training `browsing-gemma`, we need a teacher worth distilling — either by getting Gemini Flash 3 above gemma-react's score, or by switching the teacher to a different model.

**Hypothesis:** the failure axis is multi-modality. Most successful OSS browser harnesses (`browser-use`, `WebVoyager`) feed screenshots + DOM/snapshot to the model. Our `chrome-devtools-mcp` tools support both (`observe.screenshot` + `observe.snapshot`) but the agent loop currently only emits the snapshot text — screenshots are pull-via-tool-call only, and Gemini doesn't reach for them. Gemini Flash 3 is vision-capable; under our text-only feed it may be reasoning under the assumption it can "see" pixels it never gets, then guessing element identity.

## Goal

Lift `gemini-react` mean step-coverage **above 0.465** (current gemma-react production score) by wiring screenshots + snapshots into the per-turn observation pipeline. Both runners get the change so the A:B remains apples-to-apples. Gemma 4 E4B is also multi-modal — expect a lift on gemma-react too.

If multi-modality alone doesn't move gemini-react materially, the failure is elsewhere (action-space granularity, prompt structure, scoring disagreement) and we pivot to investigation. Wave R6 is gated on the partial-sweep probe (see Verification below) before committing to the full re-run.

## Scope (in)

1. **Per-turn observation augmentation** in both loops:
   - `packages/evals/src/runners/gemini-react-loop.ts`
   - `packages/local-agent/src/tool-loop.ts`
   When the agent emits an `ACTION` envelope that calls `interact` or `navigate`-style commands (state-changing actions), the corresponding observation includes the resulting page screenshot AND accessibility-tree snapshot. `observe`-style and `trace` calls return their existing text-only payloads (no fresh screenshot push).
2. **Multipart message content.** Switch from text-only `messages: [{role, content: string}]` to multipart `content: [{type: "text", text}, {type: "image", image}]` shape supported by the AI SDK. Verify both `@ai-sdk/google` `generateObject` and Ollama `/api/chat` accept the shape for `gemini-3-flash-preview` and `gemma4:e4b` respectively.
3. **System-prompt updates** in `packages/shared/src/prompts.ts` (and `buildLocalAgentSystemPrompt`):
   - Teach the model: each post-action observation includes a screenshot + an accessibility-tree snapshot.
   - Tell the model to use the screenshot for visual grounding (where elements are) and the snapshot for selectors/ARIA roles.
   - Explicit guidance on coordinate-vs-selector reasoning — model should prefer snapshot selectors over visual coordinate clicks when both are available.
4. **Live smoke probe extended.** `packages/evals/tests/gemini-live-smoke.test.ts` adds a multipart-message round-trip assertion: send a synthetic prior-turn observation with a base64 image + text, assert `generateObject` returns a valid `AgentTurn`. Run live against `gemini-3-flash-preview`. Same probe for Ollama via a new `packages/local-agent/tests/gemma-multimodal-smoke.test.ts` (skips when Ollama isn't running).
5. **Decision gate via partial-sweep.** Before full re-run: run a 3-task partial sweep (calibration-1, journey-4, moderate-2) for both runners. Pass condition: gemini-react mean step-coverage on those 3 ≥ 0.5. If pass → full sweep. If fail → engineer files a follow-up memo describing the next-most-likely failure axis and the wave pauses for user direction.
6. **Full re-run + regression report.** `EVAL_R5_SKIP_RUNNERS=gemma-oracle-plan pnpm --filter @neuve/evals eval:wave-r5-ab` (oracle-plan unchanged — it's the ablation baseline). New report at `docs/handover/harness-evals/baselines/wave-r6-multimodal.md`. Compare side-by-side with the R5b A:B baseline.

## Scope (out)

- **Debugging-mode tasks** (the user's "Volvo + Amazon + Etsy + eBay + Tradera" list). Parked until browsing scores well AND `browsing-gemma` LoRA is trained. Adding debugging tasks now would dilute the A:B signal and delay the distillation gate.
- **New scorers.** `stepCoverage` / `furthestKeyNode` / `finalState` / `toolCallValidity` stay as-is. The R6 hypothesis is testable under the existing scoring system; new scorers come with debugging-mode work.
- **New MCP tools.** `observe.screenshot` already exists at `packages/browser/src/mcp/tools/observe.ts`. No new tool surface.
- **Action-space changes.** We're not adding fine-grained tools (`click_element_by_index`, `scroll_down`, etc.). The hypothesis under test is multi-modality alone; if it fails the partial-sweep gate, action-space is the next hypothesis.
- **Prompt-overfitting.** Per memory `feedback_avoid_prompt_overfitting.md`, the system prompt update teaches a *general* multi-modal reasoning framework (use vision for grounding, use snapshot for selectors). It does NOT include site-specific heuristics like "on volvocars.com look for the 'Buy' menu first."
- **LoRA training.** Gated on partial-sweep gate passing AND full-sweep mean step-coverage > 0.465 for gemini-react. Separate wave.

## Locked decisions

1. **Screenshot delivery: option (b) — push after state-changing actions only.** Trigger: every successful `interact` (any command) and every successful `navigate`-equivalent action. Skip: `observe` calls (no state change), `trace` calls (different purpose), failed actions (state didn't actually change). Rationale: viewport-grounding when state actually changed, balanced against token cost. The R4 budget guardrails (warn=96K, abort=120K) constrain a ~15-turn trajectory; full-trajectory PNG screenshots would blow that budget for long tasks. Pivot to option (a) — push every turn — only if the partial-sweep probe shows the model is missing context at non-action turns.
2. **Image format: PNG, viewport-only, base64-inlined.** `fullPage: false`. Same shape across both providers. Roughly ~50–200 KB per screenshot at viewport 1280×800, ~100–500 image tokens per provider depending on tokenizer.
3. **Both runners get the change in one wave.** A:B comparison stays apples-to-apples; doing gemini-react first and gemma-react second creates two A:B reports we'd have to reconcile.
4. **Snapshot delivery: unchanged.** Accessibility-tree snapshot already lands in the observation text. We're only ADDING the screenshot, not changing how snapshot text flows.
5. **Smoke-probe expansion is non-optional.** Per `feedback_no_test_only_injection_seams.md` (now a four-strike pattern), every wire-shape change touching the live API gets a credentialed smoke probe before merge. Gemma-multimodal probe also non-optional — it's the first time we send multipart content to Ollama.

## Open probes for the engineer (T1 must answer before wiring)

1. **Ollama `/api/chat` multipart shape** — write a 30-line tsx probe (delete after) that POSTs a single multipart message (one text part + one base64 PNG part) to Ollama's native `/api/chat` for `gemma4:e4b`, assert response is valid. If the wire shape differs from `@ai-sdk/google`, the loops need provider-specific message construction. Expected per Ollama docs: `{role: "user", content: "...", images: ["base64..."]}` — different from the AI SDK's multipart-content style.
2. **AI SDK 4 multipart shape for `generateObject`** — verify the exact key/value shape the SDK accepts. Likely `content: [{type: "text", text}, {type: "image", image}]` with `image` being a base64 data URL or `Uint8Array` or `URL`. Probe with the real schema (`AGENT_TURN_RESPONSE_SCHEMA` from R5b) so we know the multipart path round-trips through schema validation, not just plain text.
3. **Screenshot dimensions and compression** — `observe.screenshot` defaults: viewport vs full-page, png vs jpeg vs webp. Pick one that's small enough not to blow the budget (target ≤200 KB per shot, ~150 image tokens) but large enough that the model can read text in it. Likely PNG at viewport 1280×800.
4. **Trajectory rolling integration** (R4 wave): when older turns get "rolled" to summary form, do their screenshots get dropped or kept? Recommendation: drop in summarization (image bytes are not summarizable; only the most recent N turns retain raw screenshots). Engineer should verify `packages/shared/src/trajectory.ts` doesn't blow up on multipart content.

## Verification gates (T1's done definition)

1. `pnpm exec tsgo --noEmit` green across `@neuve/shared`, `@neuve/local-agent`, `@neuve/supervisor`, `@neuve/evals`.
2. `pnpm --filter @neuve/evals test && pnpm --filter @neuve/local-agent test && pnpm --filter @neuve/shared test && pnpm --filter @neuve/supervisor test` — all pass. Test count strictly increases (smoke + multimodal probes).
3. Live smoke probes pass: `pnpm --filter @neuve/evals test gemini-live-smoke` AND `pnpm --filter @neuve/local-agent test gemma-multimodal-smoke` (the latter skips gracefully when Ollama isn't reachable).
4. **Partial-sweep gate.** Run 3-task probe: `EVAL_R5_SKIP_RUNNERS=gemma-oracle-plan EVAL_TASK_FILTER=calibration-1-single-nav-python-docs,journey-4-account-signup,moderate-2-mdn-web-api-detail pnpm --filter @neuve/evals eval:wave-r5-ab`. Pass condition: gemini-react mean step-coverage on those 3 ≥ 0.5. Document outcome in diary regardless. Multi-comma EVAL_TASK_FILTER may need a small enhancement to the existing single-task knob — engineer tightens scope if needed.
5. Full sweep only after gate (4) passes. New report at `docs/handover/harness-evals/baselines/wave-r6-multimodal.md`.
6. **Headline gate for wave success:** mean gemini-react step-coverage > 0.465. If full sweep falls short, engineer files a follow-up memo (no more code) and the wave reports as INVESTIGATIVE rather than COMPLETE — the user decides next direction.

## Risk areas

- **Gemini Flash 3 multi-modal context handling.** The model accepts multipart messages but its `generateObject`-with-`responseSchema` path may struggle with long multi-modal histories. R5b proved Gemini already produces invalid envelopes under text-only multi-turn pressure. Adding images may help (better grounding) or hurt (longer context, more confusion). Outcome is empirical.
- **Gemma 4 E4B multi-modal regression.** gemma-react is currently 0.465. Adding screenshots may LOWER its score if the model latches onto visual noise instead of the snapshot's structured selectors. The partial-sweep gate catches this — if gemma-react regresses below ~0.4 on the 3-task probe, the wave pauses.
- **Token budget.** R4 has warn=96K / abort=120K. A ~15-turn trajectory with 200 KB PNGs and ~150 image tokens each adds ~2.2K tokens — manageable. But a misconfigured screenshot (full-page on a long page) could blow up. Engineer must lock the dimensions.
- **Doom-loop sensitivity.** The R5b doom-loop detector keys on `(toolName, argsHash)`. Multi-modal observations don't change the action shape, so the detector should still work. Verify with a unit test.

## How the post-compact agent picks this up

1. **Read this plan file in full.** Open `docs/research/multi-modal-react/plan.md`.
2. **Read memory pointers** (in order):
   - `MEMORY.md` (auto-loaded into context)
   - `project_react_migration_plan.md` (R5b SHIPPED state + headline numbers)
   - `project_post_plan_continuation.md` (full sequence + parked follow-ups)
   - `feedback_no_test_only_injection_seams.md` (four-strike pattern that wave R6 must respect)
   - `feedback_use_teammates.md` + `feedback_commit_guidelines.md` (process)
3. **Verify state:**
   - `git log --oneline -3` — HEAD should be at `2b024e21` (R5b A:B baseline report) on branch `gemma-harness-lora`. Pushed to origin.
   - `git status --short` — should be clean except 10 pre-existing untracked Q9 probes + scheduled_tasks.lock.
4. **The team `react-r6` should already exist** with T1 (engineer) and T2 (reviewer) tasks defined by this plan. If not, `TeamCreate(team_name: "react-r6")` first.
5. **Spawn engineer** with the seed prompt below (already in T1). Engineer reads this plan, runs Open probes 1-4, implements per locked decisions, hits verification gates, writes diary at `docs/handover/multi-modal-react/diary/r6-2026-04-XX.md`.
6. **Spawn reviewer** with the seed prompt in T2. Antagonistic posture. Hard-check the partial-sweep gate independently — runs the probe themselves, doesn't trust the diary numbers.
7. **Iterate APPROVE** loop. Granular commits per `feedback_commit_guidelines.md`, no `Co-Authored-By` footer, no `git push` until user authorizes.
8. **Full sweep + report only after partial-sweep gate passes.** Build `wave-r6-multimodal.md`. Compare side-by-side with `wave-r5-ab.md` to attribute gain to multi-modality (or pivot to next-hypothesis if no gain).

## What success unlocks

- **Distillation pipeline (post-R6).** If gemini-react mean step-coverage > 0.465, its trajectories become teacher data for `browsing-gemma` LoRA. `pnpm --filter @neuve/evals distill:export` already wired in R5-T4.
- **Debugging-mode wave (post-LoRA).** With browsing scoring well and `browsing-gemma` shipped, extend the harness with debugging-mode tasks (Volvo perf-only, Amazon PDP cold-load, Etsy search render, eBay auction-detail, Tradera homepage). New scorers: `cwvAccuracy`, `insightIdentification`, `budgetGate`. Mode-aware via `EVAL_MODE=browsing|debugging|both`.
- **PLAN_UPDATE emission.** Wave R6 doesn't directly target PLAN_UPDATE rate (still 0/60 in R5b baseline) — that's for distillation training data construction. But better grounding may produce trajectories that naturally include PLAN_UPDATEs when the model recognizes it's stuck on a stale plan.
