# Open Questions — Gemma-owns-plan + ReAct pivot

User gates. Resolve these before spinning up team orchestration for execution. Ordered roughly by how much they change the architecture.

**Model-correction note (2026-04-24).** Target model corrected Gemma 3n E4B → Gemma 4 E4B. This reshuffles the question set: Q1 has changed premise (Gemma 4 DOES advertise native tools), Q6 urgency has dropped (128K context not 32K), Q8 has a configurable image budget. A new **Q9** now captures the most load-bearing unresolved risk exposed by the 2026-04-24 calibration.

## Q1 — Gemma 4 E4B advertises native function-calling (model card: "native function-calling support"). Does the R2 capability spike still matter?

**Context (revised):** The original question assumed Gemma 3n E4B with no documented function-calling support. Gemma 4 E4B's model card explicitly advertises native tool use with a specific wire format (`<|tool_call>call:NAME{arg:<|"|>VALUE<|"|>}<tool_call|>`). However, the 2026-04-24 calibration on `gemma4:e4b` via our current Ollama + OpenAI-compat pipeline showed zero tool calls and text-only responses at `turnCount=1` across all three calibration tasks. Across three upstream bug reports (Ollama #15315, mlx-lm #1096, OpenCode #20995) this is the signature of OpenAI-compat clients dropping Gemma 4's custom tool-call tokens into `content`. The spike is therefore no longer a "can the model do tools" spike — it's a **pipeline reconciliation** spike (see Q9).

**What the revised R2 spike must measure:**
- Variant A: Gemma 4 native `<|tool_call>` tokens via Ollama `/api/chat` with `tools` param, or llama.cpp fallback with PR #21326.
- Variant B: Grammar override via Ollama `format: <AgentTurn JSON Schema>`.
- Outcome: head-to-head on 3 calibration + 2 trivial tasks; pick whichever produces higher tool-call rate and schema-validity.

**Default if user doesn't answer:** do the R2 spike (path-A vs path-B).

## Q2 — Should `--planner frontier` stay as a user-visible CLI flag after Phase R5, or be deleted?

**Context:** `assessment.md` recommends keeping it 2 releases for user escape hatch. But memory `feedback_no_test_only_injection_seams.md` warns against test-only paths shipping to production. The frontier planner is NOT test-only — it's a production path today — but flipping defaults while keeping it alive creates config-divergence risk.

**Options:**
- (a) Keep `--planner frontier` alive 2 releases, documented as deprecated.
- (b) Delete immediately after R5 if the regression report shows gemma-react within 15% of the current hybrid.
- (c) Keep permanently as a "hybrid mode" for users who want frontier planning quality.

**Default:** (a) — 2 releases, then re-evaluate.

## Q3 — PLAN_UPDATE cap: 5 per run feels right for the Volvo journey. Is there a hard journey coming up where we need higher?

**Context:** The architecture proposes a cap of 5 PLAN_UPDATE events per run. The Volvo EX90 journey has ~9 sub-goals; 5 plan mutations allows significant replanning. But for Online-Mind2Web's "hard" tier (74 tasks), some tasks might need more.

**If higher is needed:** we can bump per-task via `EvalTask.maxPlanUpdates`, or just lift the global cap. The cap is a logged warning, not a hard failure — can be tuned post-hoc.

**Default:** ship with 5, revisit post-Wave-4.B.

## Q4 — Is Gemini Flash 3 the only frontier in scope for eval A:B, or do we also run Opus/Claude as a third lane?

**Context:** Memory `project_target_model_gemma.md` says Gemini Flash 3 is THE A:B target, not Claude. But for distillation teacher data we could use a stronger model for higher-quality traces (AgentTrek uses Gemini 3 Pro as teacher).

**Options:**
- (a) A:B = Gemma vs Gemini Flash 3 only. Teacher data from Gemini Flash 3 too. Simpler.
- (b) A:B = Gemma vs Gemini Flash 3. Teacher data = Opus/Gemini Pro for higher fidelity.
- (c) Three-way eval: Gemma vs Gemini Flash 3 vs Opus.

**Default:** (a) — stay aligned with memory; escalate to Opus teacher only if A:B delta is too wide.

## Q5 — Should teacher-data regeneration run immediately after Phase R5, or wait for explicit Wave 6 scheduling?

**Context:** Memory `project_post_plan_continuation.md` says post-plan sequence is: baseline → manual test → A:B vs Gemini Flash 3 → cleanup → distill. Phase R5 completes the A:B. Teacher regeneration could run as part of post-R5 cleanup OR as a separate distill wave.

**Default:** keep them separate — R5 exits on A:B report; teacher regeneration is a follow-up wave that builds on the new ReAct trace format.

## Q6 — Priority of Wave 4.6 drops significantly under Gemma 4's 128K context. Still worth R4, or can we defer?

**Context (revised):** The original question was sharper under the Gemma 3n E4B / 32K premise — at 32K, ReAct's ~15–30% per-turn token overhead would tip the context ceiling on medium journeys. Under **Gemma 4 E4B's 128K context**, per-turn token cost is trivial relative to the ceiling (per-turn budget ≈7K; 128K ceiling; 18× headroom). Wave 4.6's defensive value shifts from "prevent overflow" to "reduce per-turn inference cost on long trajectories" (fewer tokens = faster turns on local Gemma inference).

**Revised options:**
- (a) Build R4's trajectory plumbing as scoped — cheap, defense-in-depth, gives us per-turn latency wins on long journeys, required for clean `<|channel>thought>` stripping in multi-turn.
- (b) Defer R4 entirely; ship R1–R3 + R5 first, measure context usage, come back to R4 only if long-journey runs regress.

**Default (revised):** (a) — still build R4, just de-prioritize the warn/abort thresholds. The `<|channel>thought>` stripping from historical turns (Gemma 4 multi-turn rule) is required regardless of context pressure, and R4 is where it lives.

## Q7 — Do we keep the `gemma-oracle-plan` debug runner permanently, or is it a one-shot eval tool we delete after the ablation?

**Context:** `assessment.md` positions it as a debug-only runner to isolate planning vs execution failures. Running it once produces a data point; running it across every wave produces a regression signal. But it technically has a "production" code path (Gemini decomposer + Gemma ReAct) that's not a supported user mode.

**Options:**
- (a) Temporary: build it for R5 ablation, delete after.
- (b) Permanent eval-only runner, gated behind `EVAL_ORACLE_PLAN=1`.

**Default:** (a) — minimize surface area.

## Q8 — Gemma 4 E4B image token budget is configurable (70/140/280/560/1120). Which default do we pick, and when do we vary it?

**Context (revised):** Gemma 3n's 256-token-per-image encoding was fixed. Gemma 4 E4B exposes a **per-call configurable** image budget among 70, 140, 280, 560, 1120 tokens — per the model card: lower for classification/captioning, higher for OCR/document parsing. SOM overlays sit between these two extremes — boxes are visually salient but labels can be small.

**Options:**
- (a) Default **280** tokens per SOM snapshot (slightly richer than 256; balances the Gemma-3n-era assumption with Gemma 4's head). Bump to 560 per-call if R2 spike shows click-accuracy regressions on dense menus; drop to 140 for known-simple pages (adaptive).
- (b) Flat **560** tokens everywhere — max fidelity, higher per-turn cost but click accuracy prioritized.
- (c) Flat **140** tokens — cost-optimized; rely on the textual ref list for the actual grounding and use the image only for page-shape context.

**Fallback if weak (unchanged):** SeeAct-style textual-choice grounding — pass the ref list as text only, drop the image entirely. Gemma 4 E4B's text model is cheaper and doesn't depend on the multimodal head's SOM fidelity.

**Default (revised):** (a) — ship with 280 default + per-call adaptivity; log image-grounding failures; if >30% of clicks fail with `RefStaleError`, cut to text-only (or bump to 560 on the failing task class; R4 data will inform).

## Q9 — NEW — Why is Gemma 4 E4B not emitting tool calls in our current pipeline despite native `tools` capability? Is Ollama's OpenAI-compat parser, our AI SDK consumer, or the tool-loop the culprit?

**Context (2026-04-24 calibration surprise):** `ollama show gemma4:e4b` advertises `tools, thinking, vision, audio`. Model card advertises "native function-calling support" via `<|tool_call>…<tool_call|>` tokens. Yet our 3-task wave-4-5-subset calibration on this environment returned 0 tool calls, 25% scores, `turnCount=1` on every task. Three separate upstream reports (Ollama #15315, mlx-lm #1096, OpenCode #20995) describe the exact failure mode: OpenAI-compat clients don't recognize Gemma 4's custom tool-call tokens → `tool_calls` array arrives empty, raw tokens leak into `message.content`.

Our pipeline: `packages/local-agent/src/tool-loop.ts` uses AI SDK's OpenAI-compat provider against Ollama's `/v1/chat/completions` → handshake via ACP. Three candidates for the bug:

- (a) **Ollama 0.20.x tool-call parser** (issue #15315 open): Gemma 4's native `<|tool_call>` tokens are not being round-tripped into the OpenAI-compat `tool_calls` JSON field. Happens in Ollama itself.
- (b) **AI SDK `@ai-sdk/openai-compatible` streaming decoder** (OpenCode #20995): even when Ollama sends `tool_calls` correctly in non-streaming mode, the streaming decoder doesn't reassemble the Gemma-4-specific shape. Our tool-loop uses streaming.
- (c) **`tool-loop.ts` consumer**: how we iterate the ACP stream events; possibly we bail at the first text-only turn before tool calls arrive.

**What the R2 spike must produce (in addition to its A/B decision):** an annotated diary entry naming the exact failing layer. Likely deliverable: a minimal repro script that hits `/api/chat` non-streaming vs `/v1/chat/completions` streaming and compares `tool_calls` presence.

**Default if user doesn't answer:** the R2 spike will debug this directly by instrumenting the ACP stream and comparing Ollama's raw response to what `tool-loop.ts` consumes. If (a) is the culprit and Ollama upstream is slow to fix, swap to llama.cpp with PR #21326. If (b), ship a Gemma-4-aware streaming tool-call decoder. If (c), fix the iterator.

**Why this is Q9 and not a side note:** if this question is "the model doesn't actually do tools well at 4B," that's the whole ReAct pivot's premise collapsing. If it's "our pipeline silently drops the tokens," the Gemma 4 capability premise is intact and R2 is a ~1-day fix that likely unblocks most of the calibration regression on its own. These are architecturally different worlds and we do not yet know which one we're in.
