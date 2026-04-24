# Assessment — Gemma-owns-plan + ReAct, applied to perf-agent-cli

Date: 2026-04-24
Companion docs: `research-brief.md` (citations), `architecture-prd.md` (proposal), `open-questions.md` (user gates).

This doc answers the ten assessment dimensions in the task scope. Each section gives **Recommendation + Evidence + Tradeoffs + Risks**. Citations are short-form; full sources in `research-brief.md`.

---

## 1. ReAct prompt format for Gemma 3n E4B

### Recommendation
Use a **lightweight, pipe-delimited ReAct envelope that piggy-backs on the existing status-marker parser**. Specifically: per turn, Gemma emits **one** of the following shapes, exactly as today's status markers do, parseable by a schema-validated transformer:

```
THOUGHT|<step-id>|<one sentence about what to do next and why>
ACTION|<step-id>|<tool_name>|<json-args>         ← triggers tool call
PLAN_UPDATE|<step-id>|<action=insert|replace|remove>|<json-payload>
STEP_DONE|<step-id>|<short-summary>               ← preserved from today
ASSERTION_FAILED|<step-id>|category=...|...       ← preserved from today
RUN_COMPLETED|passed|<summary>                    ← preserved from today
```

Rather than inventing a second parallel ReAct prompt, **extend the Wave 2.B 59-line prompt** to add:
- A 3-line explanation of THOUGHT (before any ACTION, write one sentence of reasoning).
- A 3-line explanation of PLAN_UPDATE (when an observation surprises you and the remaining plan looks wrong, emit a PLAN_UPDATE).
- The plan block (`<plan>`) stays. The current_sub_goal block stays.
- Observations are the existing tool_result content — reinjected per turn into `<observed_state>` as we already do for Wave 2.B's per-turn re-injection.

Target line-count for the extended system prompt: **≤80 lines**, the same budget the Wave 2.B rewrite committed to.

### Evidence
- ReAct paper (Yao 2023) uses `Thought: … / Action: … / Observation: …` literally; the interleaving is the feature, not the prefix wording. The paper's few-shot examples are plain text. Pipe-delimited variants preserve the interleaving contract while matching our existing `parseMarker` in `models.ts:719-755`.
- Wave 2.B diary notes: the prompt is already 59 lines; 4B models are sensitive to dilution past ~80 lines (`docs/handover/harness-evals/diary/wave-2-B-prompt-rewrite.md`). A ReAct extension fits.
- Memory `feedback_types_over_regex.md` mandates schema-backed parsing. The pipe-delimited form already has `parseMarker` + `parseAssertionTokens` as the schema surface. A new `parseReActEnvelope` lives next to them.
- Focused ReAct (see research brief Theme 3 / small-model row): reiterating the sub-goal at the top of each turn + early-stop heuristics improves 3.8B–8B models' tool-use accuracy. We already reiterate the sub-goal via `<current_sub_goal>`.

### Tradeoffs
- **Verbalized thought costs tokens** (~20–40 per turn). On a 10-step journey this is ~400 tokens of overhead. Acceptable within Gemma's 32K context.
- The pipe-delimited envelope is less "natural" for Gemma than Markdown ReAct. But uniformity with today's markers is worth more than stylistic parity with the ReAct paper, and small models benefit from **consistent syntax across all emitted content** (mixed English + structured markers degrade parser reliability).

### Risks
- Gemma might emit THOUGHT and ACTION on the same line or merge them. Mitigation: golden-file tests in `packages/shared/tests/prompts.test.ts` and parser robustness to whitespace; the Wave 1.B parser already tolerates `;`-separated tokens in any order.
- Gemma might skip THOUGHT entirely and go straight to ACTION. Mitigation: the adherence gate (Wave 1.B) is at the RUN_COMPLETED boundary, not per-turn. If THOUGHT is missing we lose observability but the tool call still happens — acceptable. We should NOT block a turn on missing THOUGHT; the reasoning is for traceability and distillation data, not a runtime correctness invariant.

---

## 2. Plan representation

### Recommendation
**Keep a plan, but let Gemma author and mutate it.** Specifically:
1. On first turn, Gemma emits a `PLAN_UPDATE|action=replace|payload={ steps: [...] }` as part of its initial response. This replaces the current frontier-Gemini pre-plan.
2. Subsequent turns can emit `PLAN_UPDATE|action=insert` (add a step before current), `action=remove` (drop a pending step), or `action=replace_step` (rewrite a single step).
3. If Gemma emits NO plan, the template decomposer (`splitByConnectives` from Wave 1.A) provides a fallback so the adherence gate has something to check against.

### Evidence
- Pure ReAct (no plan) works at frontier scale (ReAct paper's HotpotQA experiments) but fails on long-horizon: the ALFWorld experiments in the same paper needed hand-authored few-shots that implicitly scaffolded the plan.
- AutoWebGLM (Lai 2024) explicitly uses curriculum learning to teach ChatGLM-6B to decompose tasks; even at 6B scale, plan decomposition is a learned skill, not a zero-shot one.
- The Wave 0 harness-diagnosis diary nails this: with NO plan, Gemma collapsed 9 sub-goals into 1. With a Gemini pre-plan, it mostly respects the plan — so **having a plan is load-bearing**. What we're changing is who authors it.
- Plan-and-Execute limitation highlighted in the LangChain blog: no mid-run replanning. Our proposed `PLAN_UPDATE` is exactly the Joiner-equivalent the blog says vanilla PxE lacks.

### Tradeoffs
- Gemma authoring its own plan is LESS reliable than Gemini Flash authoring it. We need the template fallback as a safety net, and we need to measure the Wave 4.5-style A:B delta (frontier-plan vs gemma-plan) before we rip out the frontier planner.
- PLAN_UPDATE adds parsing complexity. Mitigate via a tight Schema and a `DOOM_LOOP_THRESHOLD`-style cap on the number of PLAN_UPDATE ops per run (e.g. 5).

### Risks
- Gemma may over-replan and never finish a step. Mitigation: cap PLAN_UPDATE frequency (max 1 per N=3 actions) and log `excessive-replanning` warnings.
- Gemma may under-plan (single 1-step plan for multi-step task). Mitigation: template decomposer runs in parallel, and when Gemma's plan has fewer steps than the template would produce, emit a warning + fall back. This is a conservative "stop regression" posture.

---

## 3. Tool-use reliability at 4B

### Recommendation
**Constrain the agent's tool-call output with Ollama's `format` schema parameter** (JSON-Schema-to-GBNF). Define a single `AgentTurn` schema that encodes the ReAct envelope as a discriminated union (THOUGHT, ACTION, PLAN_UPDATE, STEP_DONE, ASSERTION_FAILED, RUN_COMPLETED) and pass it on every Ollama completion. Keep the Wave 2.A interaction tools (click, fill, hover, select, wait_for) as the named tools inside the ACTION variant.

Currently `packages/local-agent/src/ollama-client.ts` uses the OpenAI-compat `/v1/chat/completions` endpoint. We have two options:
- **(A)** Keep the OpenAI-compat endpoint, pass `format` through the `response_format` parameter (Ollama maps it).
- **(B)** Switch to Ollama's native `/api/chat` endpoint directly, which has first-class `format` support.

Pick **(B)** for production reliability; keep (A) as a fallback behind a config flag for eval parity with `gemini` (A:B) runs which use OpenAI-compat.

### Evidence
- Gemma 3n E4B model card does not mention function calling. It was trained for multimodal text/image/audio generation, not agent use (research-brief Theme 3).
- Gemma 3 1B scored **~31% on BFCL**; FunctionGemma (270M, specifically tuned) scored 58% → 85% post-finetune (FunctionGemma blog). Direct evidence that **base Gemma is unreliable at tool calls without grammar constraints or fine-tuning**.
- Qwen2.5-Coder-7B has open tool-call-hallucination reports (HuggingFace discussion thread cited in research brief). Small models routinely emit tool calls in wrong XML/JSON shapes without constraints.
- Ollama supports structured outputs via JSON Schema since v0.5 (Ollama blog). No new dep required.

### Tradeoffs
- Constrained decoding adds ~5–15% latency per turn depending on schema depth (see Outlines vs llama.cpp benchmarks in research brief).
- Schema-constrained output **cannot produce free-form English for THOUGHT**. Mitigation: THOUGHT is a string field inside the JSON, not free prose. Acceptable.
- Tight schema means introducing a new tool requires a schema update. This is actually a feature: it forces the agent interface to stay thin.

### Risks
- Ollama's grammar engine has historically had bugs on recursive schemas (research brief, Outlines note). Our `AgentTurn` schema is flat (no recursion) so this shouldn't bite, but test early.
- Different Ollama versions diverge on `format` behavior. Mitigation: pin Ollama version in `.specs/` and CI.

---

## 4. Course-correction trigger

### Recommendation
**Hybrid: reactive (failure-driven) + self-reflection (turn-driven, lightweight)**. Specifically:
1. **Reactive trigger**: after 2 consecutive `ASSERTION_FAILED` events without a `STEP_DONE` in between, insert a "REFLECT" turn before the next action. The REFLECT turn's tool_catalog is a no-op; Gemma emits a `THOUGHT` and a `PLAN_UPDATE` or the existing abort channel (ASSERTION_FAILED|...|category=abort).
2. **Self-reflection trigger**: optional `REVISE` marker Gemma can emit at any turn (`PLAN_UPDATE|action=replace|...`). The prompt teaches: *"If your last Observation contradicts the plan's expected_state for the current step, emit PLAN_UPDATE before your next ACTION."*

### Evidence
- Reflexion (Shinn 2023) demonstrates post-trial reflection closes ~20-40% of gaps on ALFWorld-style benchmarks. A lightweight in-run version is cheaper.
- Voyager (Wang 2023) bakes self-verification into every iteration with GPT-4-as-critic. Too expensive for us at 4B (would double token cost); the reactive fallback is a cheaper approximation.
- Replanning-trigger survey (Oswald 2025 via EmergentMind) notes event-triggered approaches reliably outperform periodic replanning on robotics tasks. Web-nav is analogous: pages change, failures are information.
- Our Wave 1.B adherence gate is fundamentally a terminal-state verifier — NOT a mid-run corrector. The gate stops you from lying about RUN_COMPLETED; it doesn't help you get unstuck. The REFLECT trigger fills that gap.

### Tradeoffs
- REFLECT turns cost tokens and latency. Budget: ≤N=2 REFLECT injections per run (hard cap enforced in executor).
- Self-reflection adds implementation surface: a new counter in `ExecutorAccumState`, a new event type, new prompt guidance.

### Risks
- Gemma may misuse REFLECT to replan excessively. Mitigation: the hard cap + `excessive-reflection` warning + the `PLAN_UPDATE` frequency cap from dimension 2.
- REFLECT may catastrophically rewrite a plan that was actually 1 action away from success. Mitigation: only trigger after **2** consecutive failures, not 1. This matches the replanning-trigger survey's 2-strike heuristic.

---

## 5. Termination discipline

### Recommendation
Keep the Wave 1.B adherence gate verbatim. **Add two layers on top**:

1. **Per-sub-goal self-verify THOUGHT**: before emitting `STEP_DONE`, the prompt teaches Gemma to include a 1-sentence verification in its THOUGHT (*"The observed state shows [evidence]; the sub-goal is met."*). This is prompt-only — no code enforcement, it's a training signal for distillation.
2. **Adherence gate extension**: reject `RUN_COMPLETED|passed` if any `STEP_DONE` in the last 3 turns was preceded by `ASSERTION_FAILED` on the same step-id (i.e., Gemma self-recovered but the failure is still in the log; a passed run shouldn't contain unresolved assertion failures). This is new code in `runFinishedSatisfiesGate`.

### Evidence
- Premature termination = 6.2% of multi-agent LLM failures (Cemri 2025). This was literally the Wave 0 bug.
- Weaker models produce more self-validation false positives (same paper). Gemma at 4B is exactly "weaker" in this sense.
- Voyager's self-verification via a second GPT-4 instance is the canonical fix. We can't afford 2x Gemma; our cheaper approximation is a prompt-taught THOUGHT check + the adherence gate + external scorers at eval time.

### Tradeoffs
- The THOUGHT self-verify is unverifiable at runtime. It only helps at eval time (LLM-as-judge scoring on the THOUGHT content) and at distillation time (teacher data quality).

### Risks
- Gemma may learn to emit THOUGHTs that claim verification without actually checking. Classic trust-but-verify problem. Only solvable via scorers comparing THOUGHT claims to observed state — a Wave 6+ task.

---

## 6. Context window strategy

### Recommendation
Wave 4.6 (dormant) **activates now**. Specifically:
- **Always keep**: system prompt (≤80 lines), current `<plan>` block, current `<current_sub_goal>`, current `<observed_state>` (latest snapshot text only).
- **Rolling**: last **N=5 agent turns verbatim** (thoughts + action args + tool results).
- **Summarize**: older turns compressed to `<event>TOOL ACTION → short-outcome</event>` one-liners (rule-based, no LLM summarizer in v1).
- **Drop**: all screenshot image bytes except the most recent (keep alt-text / snapshot text for older ones).
- **Cap**: warn at 20K token budget (62.5% of Gemma's 32K), abort with `context-budget-exceeded` assertion at 28K (87.5%).

### Evidence
- Gemma 3n E4B has a **32K combined input + output context** (HuggingFace model card). That's less than appears — a 4K output reserve leaves 28K for input.
- SOM screenshots at 768px JPEG q70 serialize to ≈50-80KB = 50-80K chars on base64, but images are **encoded at 256 tokens each** on Gemma 3n. So screenshots themselves aren't the blowup — tool-result text (snapshots are usually 2K-10K tokens as text) is.
- JetBrains context management study: 10-turn sliding window beat summarization for coding agents; when summarizing, 21-older + 10-latest was optimal. Our 5-latest verbatim + rule-based one-line older is a conservative subset of that.
- Cemri 2025 notes "infinite loops" and "context overflow" as adjacent failure modes to premature termination — the same class of bugs.

### Tradeoffs
- Rule-based older-turn summary loses detail. If Gemma needs to revisit an old observation (rare), it can't. Acceptable loss for 32K budget.
- Dropping older screenshots breaks visual-grounding-by-recall ("the image from 4 turns ago showed the menu"). Acceptable: SOM refs are ephemeral anyway (Wave 2.C `RefStaleError` contract).

### Risks
- Rule-based summaries may drop a tool_result that contained the key navigation token. Mitigation: always preserve tool_result for `performance_stop_trace` (CWV payload = the deliverable) and for navigate_page (URL state).

---

## 7. Screenshot-based grounding (Set-of-Mark + ReAct)

### Recommendation
**Teach Gemma to verbalize what it sees, referencing SOM refs, BEFORE acting**. Extend THOUGHT's format guidance: *"THOUGHT references the SOM ref if known (e.g., 'I see element [5] labeled Build your Volvo; I will click it to enter the configurator')."*

Do NOT change the SOM rendering pipeline (Wave 2.C's module is correct). The change is purely in the prompt and in the teacher-data shape — the teacher's THOUGHT should cite refs.

### Evidence
- SeeAct (Zheng 2024) found **textual-choice grounding** (the agent picks from a shortlist of candidate elements) outperformed raw image annotation for web agents. Our SOM overlay is the image-annotation variant; the prompt can add a textual-choice layer by including the SOM ref→accessibleName list in the `<observed_state>`.
- WebLlama (Llama-3-8B-Web) explicitly uses structured snapshots, not raw pixels; beats GPT-4V zero-shot by 18% on WebLINX. Confirms text-over-pixels for small models.
- Our Wave 2.C SOM module already returns `SomRef { id, role, accessibleName, selector, bounds }` per element. We can expose the ref list as text without changing the module.

### Tradeoffs
- More text in `<observed_state>` = more context consumed. Cap: ≤25 refs per snapshot (truncate closest-to-viewport-top); Wave 2.C diary already flagged this as a potential knob.
- Image bytes still need to be attached for multimodal grounding on Gemma 3n E4B. Yes — but we already cap at 768px JPEG q70 (SOM module constant). Encoding stays at 256 tokens per image on Gemma.

### Risks
- Verbalizing ref + label adds latency. Acceptable — it's one sentence.
- Gemma's multimodal grounding at 4B on dense menus may still hallucinate ref→label mappings (SeeAct found this even with GPT-4V). Mitigation: the `RefResolver` is authoritative; when `click(ref)` fails with `RefStaleError`, the adherence gate triggers the REFLECT path from dimension 4.

---

## 8. Eval implications

### Recommendation
**Two-runner eval stance**:

- **Production runner (Gemma)**: `makeGemmaRunner` in `packages/evals/src/runners/gemma.ts` runs the full ReAct loop end-to-end. Plan authored by Gemma. This is the "real" benchmark we optimize against.
- **Frontier runner (Gemini)**: `makeGeminiRunner` (new) runs the **same ReAct loop** with Gemini as the backing LLM. NOT the old hybrid where Gemini plans and Gemma executes. This gives us an **apples-to-apples** A:B on the same runtime protocol.

Separately, preserve `frontier-as-oracle-plan` as a **diagnostic runner** (not a production mode): takes the Gemini-generated plan from today's pre-planner and threads it in as the first `PLAN_UPDATE` to Gemma's loop. Used only for eval ablations ("does a better plan fix Gemma's failures?").

### Evidence
- Wave 4.5 regression report (already committed) establishes the baseline comparison format. We extend it to a 3-way ablation: gemma-react / gemini-react / gemma-with-gemini-oracle-plan.
- Memory `project_target_model_gemma.md` says Gemini Flash 3 is the A:B, not Claude. We keep that.
- Memory `project_post_plan_continuation.md` post-plan sequence: A:B vs Gemini Flash 3 → cleanup → distill. The new Gemini ReAct runner slots exactly here.

### Tradeoffs
- Two runners = more infra. But `makeGeminiRunner` shares `runRealTask` with `makeGemmaRunner` — only the backing LLM differs.
- Running Gemini on every eval costs API $. Mitigation: Gemini runs only on eval commit gates, not on every dev iteration.

### Risks
- Gemini may implicitly plan differently than Gemma (frontier model, bigger context, different RLHF bias). This is OK — the A:B shows the ceiling our Gemma can approach via distillation.
- The oracle-plan runner is a debugging tool; don't ship it as a production mode. Memory `feedback_no_test_only_injection_seams.md` warns against test-only paths shipping to production.

---

## 9. Distillation implications

### Recommendation
**Change the teacher-data shape from "plan + execution traces" to "full ReAct trajectories including PLAN_UPDATE events"**. The existing `teacher-data-exporter.ts` already consumes trace events; we add the ReAct-envelope events (THOUGHT, PLAN_UPDATE) to the schema and they flow through to JSONL as assistant messages.

Specifically:
1. Extend `TraceEvent` in `packages/evals/src/runners/trace-recorder.ts` with `agent_turn: { thought, action, planUpdate, statusMarker }` events — one per Gemma turn.
2. Teacher data generation: run **Gemini in ReAct mode** on the 20 tasks → capture trajectories → JSONL. (Currently the trace-recorder records tool_call + agent_message pairs; the ReAct envelope is already embedded inside agent_message. The schema just needs to decode it.)
3. Training sample shape stays OpenAI-style chat messages (per Wave 5 diary — compatibility with Ollama create is load-bearing). The THOUGHT/PLAN_UPDATE content just lives inside the `role: assistant, content: <markers>` field.

### Evidence
- AutoWebGLM (Lai 2024) uses curriculum learning from single-step → multi-step → long-horizon. Our calibration / moderate / journey / hard task split already matches this staging (`packages/evals/tasks/`).
- AgentTrek (Xu 2025) shows that frontier VLM as teacher → Qwen student works at ~$0.55/trajectory cost. Our Gemini Flash pricing is in the same order of magnitude.
- WebLlama (Llama-3-8B-Web) proves 8B finetuned on browsing traces beats GPT-4V zero-shot on WebLINX OOD by 18%. Directly analogous to our `browsing-gemma` hypothesis.
- Current `teacher-data-exporter.ts:199-253` (`eventsToMessages`) just passes through `tool_call`, `tool_result`, `agent_message`, `status_marker`. Adding THOUGHT as an agent_message and PLAN_UPDATE as a new marker type is additive — no breaking change.

### Tradeoffs
- Teacher traces are longer (more tokens per sample) because THOUGHT adds verbosity. Sample count may matter less than quality per AutoWebGLM's curriculum findings.
- Re-running teacher generation on the full task set is a one-time cost (~$100-500 estimated based on AgentTrek pricing).

### Risks
- Gemini ReAct traces may be stylistically different from what Gemma can emit at 4B. Mitigation: run Gemma ReAct on the same tasks, compare failure categories, filter teacher traces to ones Gemma at least partially follows (alignment filter in the existing `filters.ts`).

---

## 10. Migration plan (stays / changes / deleted)

### Stays (unchanged)
- `packages/supervisor/src/executor.ts` adherence gate (Wave 1.B): retained verbatim.
- `packages/supervisor/src/plan-decomposer.ts` **template mode**: retained as fallback when Gemma fails to emit any PLAN_UPDATE.
- `packages/browser/src/set-of-mark.ts` (Wave 2.C): unchanged.
- `packages/browser/src/tools/*` interaction tools (Wave 2.A): unchanged.
- `packages/evals/src/scorers/*`: unchanged (scoring off trace events; new ReAct events just feed in).
- `packages/evals/src/distill/teacher-data-exporter.ts` core logic: unchanged.
- `packages/shared/src/models.ts` `parseMarker`, `parseAssertionTokens`, `RunFinished`, `StepFailed`, `ExecutedPerfPlan` (Wave 1.B additions all retained).

### Changes
- `packages/shared/src/prompts.ts` `buildExecutionSystemPrompt`: extend from 59 → ~75 lines to add THOUGHT/PLAN_UPDATE/REFLECT protocol. Budget ≤80 lines. Wave 2.B golden-file tests updated.
- `packages/shared/src/prompts.ts` `buildExecutionPrompt`: add `<observed_state>` with SOM ref list textual rendering; add `<trajectory>` (last 5 turns summary block).
- `packages/shared/src/models.ts`: add `PlanUpdate` event schema (insert/replace/remove action tag) + `parsePlanUpdate` parser + `ExecutedPerfPlan.applyPlanUpdate()` method.
- `packages/supervisor/src/plan-decomposer.ts` **frontier mode**: retained for eval-only `oracle-plan` debugger runner, but **removed from default production runtime path**. Currently `plannerMode: "frontier"` is the default for the TUI; new default becomes `"gemma-react"` (a new mode literal).
- `packages/supervisor/src/executor.ts`: replace the pre-stream `planDecomposer.decompose` call with a per-turn ReAct loop. The `Stream.mapAccumEffect` reducer gains PLAN_UPDATE handling. The adherence gate is unchanged.
- `packages/evals/src/runners/gemma.ts`: update `DEFAULT_PLANNER_MODE` from `"template"` to `"gemma-react"`. Wire through the new planner mode literal.
- `packages/evals/src/runners/trace-recorder.ts`: add `agent_turn` / `plan_update` event types to `TraceEventSchema`.
- `packages/evals/src/distill/types.ts`: add `planUpdate` optional field on `TrainingMessage`.

### New
- `packages/shared/src/react-envelope.ts`: `AgentTurn` Schema discriminated union (THOUGHT / ACTION / PLAN_UPDATE / STEP_DONE / ASSERTION_FAILED / RUN_COMPLETED) + `parseAgentTurn` (schema-validated, not regex).
- `packages/supervisor/src/react-reducer.ts`: the per-turn state machine — consumes `AgentTurn` from the LLM stream, emits updated `ExecutedPerfPlan`, enforces REFLECT / PLAN_UPDATE caps.
- `packages/local-agent/src/ollama-client.ts`: add `format` parameter to `OllamaCompletionOptions`, pass through as `response_format`. Schema comes from `AgentTurn`.
- `packages/evals/src/runners/gemini.ts`: new — runs Gemini Flash 3 through the same ReAct loop protocol as Gemma (ai-sdk `generateObject` with `AgentTurn` schema).
- `docs/research/gemma-react-browsing/architecture-prd.md`: the proposal doc (companion).
- `docs/research/gemma-react-browsing/open-questions.md`: user gates (companion).

### Deleted (or demoted)
- `packages/supervisor/src/planner-prompt.ts`: demoted — kept in tree for the `oracle-plan` debug runner but no longer in production path. If the eval ablation shows the frontier planner provides zero lift over gemma-react, delete entirely in a follow-up.
- `apps/cli/src/stores/use-preferences.ts` `plannerMode` default: flip from `"frontier"` to `"gemma-react"`. Legacy modes still accepted but deprecated.
- `apps/cli-solid/src/tui.ts` `--planner` flag: same flip.

### Risks of the migration
- Flipping the default `plannerMode` is user-visible. Mitigate: keep `--planner frontier` as an escape hatch for 2 releases before deletion.
- `packages/supervisor/src/errors.ts` `DecomposeError` is tied to the pre-planning path. Retain in the union — ReAct mode can still `DecomposeError` if the template fallback fires on an empty prompt.
- Wave 5 distillation pipeline (`teacher-data-exporter.ts`) was built against today's trace format. The additive event types preserve backward compat — existing traces still export. New ReAct traces export richer data.
