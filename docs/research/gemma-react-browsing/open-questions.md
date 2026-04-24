# Open Questions — Gemma-owns-plan + ReAct pivot

User gates. Resolve these before spinning up team orchestration for execution. Ordered roughly by how much they change the architecture.

## Q1 — Gemma 3n E4B has no documented function-calling support. Are we comfortable betting on Ollama's constrained decoding + prompt engineering, or do we want a capability validation spike first?

**Context:** Gemma 3n E4B's HuggingFace model card explicitly does NOT mention function calling; Gemma 3 1B scored ~31% on BFCL; FunctionGemma (270M specialized) needed fine-tuning to hit 85%. The plan bets that Ollama's `format` schema constraint + our Wave 2.A tool surface is sufficient. 

**Fallback if not:** spike Phase R2 for 1 day against the calibration tasks (`trivial-1`, `trivial-2`) before committing to Phase R3.

**Default if user doesn't answer:** do the spike.

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

## Q6 — The Wave 4.6 context rolling is currently "dormant." Activating it is part of Phase R4. Is the user OK pulling it forward, or should we still gate on Wave 4.5 data?

**Context:** Wave 4.6 was designed to activate **only if** Wave 4.5 baseline showed context blowup on Gemma. The ReAct pivot introduces verbalized thoughts per turn, which increases per-turn tokens ~15-30%. This tips the balance toward activating 4.6 regardless. But if the user believes we should stay data-driven, we'd gate R4 on a fresh measurement.

**Default:** activate in R4 (the data will say more once ReAct is on; a measurement pass beforehand delays the real signal).

## Q7 — Do we keep the `gemma-oracle-plan` debug runner permanently, or is it a one-shot eval tool we delete after the ablation?

**Context:** `assessment.md` positions it as a debug-only runner to isolate planning vs execution failures. Running it once produces a data point; running it across every wave produces a regression signal. But it technically has a "production" code path (Gemini decomposer + Gemma ReAct) that's not a supported user mode.

**Options:**
- (a) Temporary: build it for R5 ablation, delete after.
- (b) Permanent eval-only runner, gated behind `EVAL_ORACLE_PLAN=1`.

**Default:** (a) — minimize surface area.

## Q8 — Screenshot image budget on Gemma 3n E4B. The model card says images encode to 256 tokens; Wave 2.C caps at 768px JPEG q70. Are we confident one image per turn is sustainable?

**Context:** Per-turn prompt budget in the PRD includes 1 SOM image = 256 tokens. For 20-turn journeys that's 5120 image tokens. Rolling window keeps only the latest image; older ones drop to text. This should work, but it relies on Gemma 3n's multimodal understanding at 256-token image encoding being sufficient for Set-of-Mark grounding — which is unverified.

**Fallback if weak:** SeeAct-style textual-choice grounding — pass the ref list as text only, drop the image entirely. Gemma's text model is cheaper and doesn't depend on the multimodal head's SOM fidelity.

**Default:** ship with image + text; log image-grounding failures; if >30% of clicks fail with `RefStaleError`, cut to text-only grounding.
