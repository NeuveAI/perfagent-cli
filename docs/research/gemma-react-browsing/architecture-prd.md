# Architecture PRD — Gemma-owns-plan + ReAct single-agent runtime

Date: 2026-04-24
Status: Draft for user review; not yet approved for team orchestration.
Companion: `research-brief.md`, `assessment.md`, `open-questions.md`.

## 1. Goal

Collapse the current Gemini-planner + Gemma-executor two-model pipeline into **a single Gemma 3n E4B agent** running a ReAct loop (Thought → Action → Observation → Thought …) that **owns plan decomposition, mid-run course correction, and termination discipline**. Frontier models (Gemini 3 Flash) stay external to the production runtime — used only for eval A:B comparisons, teacher-data generation, and LLM-as-judge scoring.

The user framing that motivates this: *"browsing is not just clicking around, it has the reasoning and goal assessment."* The production model must do the reasoning; otherwise we're shipping a frontier model's reasoning capability as a fixed pipeline and pretending it's the small model.

## 2. Non-goals

- **Not** changing the status-marker wire protocol (STEP_START / STEP_DONE / ASSERTION_FAILED / RUN_COMPLETED). Wave 1.B is load-bearing and stays.
- **Not** deleting the template decomposer or frontier planner code entirely — both retained as fallbacks / debug-only paths. Deletion is a post-A:B follow-up.
- **Not** changing the Set-of-Mark rendering (Wave 2.C), the interaction tools (Wave 2.A), the adherence gate (Wave 1.B), or the scorers.
- **Not** shipping a new LLM provider. Everything still flows through `@ai-sdk/google` (Gemini) or `@neuve/local-agent` (Ollama → Gemma).
- **Not** fine-tuning Gemma in this migration. Distillation infrastructure (Wave 5) already exists; this change produces richer teacher data for a later fine-tune run but does not perform it.
- **Not** adding a multi-agent coordination layer. One Gemma agent, one plan, one ReAct loop. (Per memory `feedback_use_teammates.md`, multi-agent is for team orchestration of development work, not for runtime agent design.)

## 3. Target end-state

### 3.1 Narrative

```
User prompt
    │
    ▼
Executor.execute(options) opens ACP session with Gemma via Ollama.
    │
    ├─ Optional: template decomposer builds a fallback plan from the prompt (for the
    │   adherence gate's "how many sub-goals remain" check). Fallback only; Gemma
    │   can and should override via PLAN_UPDATE on turn 1.
    │
    ▼
ReAct loop (Stream.mapAccumEffect, per turn):
    ┌──────────────────────────────────────────────────────────────────────────┐
    │ INPUT PROMPT (per turn, rebuilt fresh):                                  │
    │   <system>            (≤80 lines, Wave 2.B-derived, +THOUGHT/PLAN_UPDATE)│
    │   <plan>              (current ExecutedPerfPlan.steps as status list)    │
    │   <current_sub_goal>  (active step title + instruction)                  │
    │   <observed_state>    (latest SOM snapshot text + ref list)              │
    │   <trajectory>        (last N=5 turns: thought + action + result)        │
    │   <environment>       (url, branch, changed files — existing)            │
    │   <developer_request> (user prompt — existing)                           │
    └──────────────────────────────────────────────────────────────────────────┘
    │
    ▼
Gemma emits one AgentTurn (JSON-schema-constrained via Ollama format):
    { kind: "THOUGHT"|"ACTION"|"PLAN_UPDATE"|"STEP_DONE"|"ASSERTION_FAILED"|"RUN_COMPLETED",
      stepId, ...fields }
    │
    ▼
ReAct reducer in executor:
    - THOUGHT         → record into trajectory; no state change
    - ACTION          → dispatch tool call via existing @neuve/devtools;
                        result becomes next turn's <observed_state>
    - PLAN_UPDATE     → apply to ExecutedPerfPlan (insert/replace/remove step);
                        enforce cap (≤5 per run)
    - STEP_DONE       → mark step passed; advance active step
    - ASSERTION_FAILED → mark step failed; if category=abort, allow RUN_COMPLETED
                         if second consecutive failure, inject REFLECT
    - RUN_COMPLETED   → pass through existing Wave 1.B adherence gate
    │
    ▼
Stream.takeUntil(hasRunFinished)  (Wave 1.B-unchanged)
    │
    ▼
ExecutedPerfPlan → Reporter → Trace writer → Eval scorers
```

### 3.2 One-page diagram (ascii)

```
  ┌──────────────┐
  │ User prompt  │
  └───────┬──────┘
          ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ Executor.execute (ACP session opens w/ Gemma via @neuve/local-agent) │
  └───────┬──────────────────────────────────────────────────────────┘
          ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ template decomposer (fallback plan, never frontier in production)   │
  └───────┬─────────────────────────────────────────────────────────────┘
          ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │                        ReAct stream loop                        │
  │                                                                 │
  │  ┌────────────────────┐     ┌──────────────────────┐            │
  │  │ Build per-turn     │───▶│ Gemma (Ollama,       │            │
  │  │ prompt: system +   │     │ format:<AgentTurn>)  │            │
  │  │ plan + sub-goal +  │     └───────┬──────────────┘            │
  │  │ observed + last-N  │             │                           │
  │  └────────────────────┘             ▼                           │
  │          ▲                  ┌─────────────────┐                 │
  │          │                  │ AgentTurn       │                 │
  │          │                  │ (JSON)          │                 │
  │          │                  └───────┬─────────┘                 │
  │          │                          ▼                           │
  │          │     ┌────────────────────────────────────────────┐   │
  │          │     │ ReAct reducer:                             │   │
  │          │     │  THOUGHT → append trajectory               │   │
  │          │     │  ACTION  → call tool (click/fill/etc)      │   │
  │          │     │  PLAN_UPDATE → mutate plan, cap=5          │   │
  │          │     │  STEP_DONE / ASSERTION_FAILED → update plan│   │
  │          │     │  RUN_COMPLETED → Wave 1.B gate             │   │
  │          │     └─────────────────┬──────────────────────────┘   │
  │          │                       ▼                              │
  │          │            ┌──────────────────────┐                  │
  │          │            │ Tool execution       │                  │
  │          │            │ (@neuve/devtools):   │                  │
  │          │            │ click/fill/snapshot/ │                  │
  │          │            │ trace/etc            │                  │
  │          │            └──────────┬───────────┘                  │
  │          │                       │                              │
  │          └───────────────────────┘                              │
  │                                                                 │
  └───────────────────┬─────────────────────────────────────────────┘
                      ▼
             ┌────────────────────┐
             │ ExecutedPerfPlan   │
             │ (Wave 1.B gate)    │
             └────────┬───────────┘
                      ▼
                Reporter + Trace + Eval
```

### 3.3 AgentTurn schema (sketch — final in `packages/shared/src/react-envelope.ts`)

```ts
// Gemma emits one of these per turn; Ollama `format` constrains to this shape.
const AgentTurn = Schema.Union(
  Schema.TaggedStruct("THOUGHT", { stepId: Schema.String, thought: Schema.String }),
  Schema.TaggedStruct("ACTION",  { stepId: Schema.String, toolName: Schema.String, args: Schema.Unknown }),
  Schema.TaggedStruct("PLAN_UPDATE", {
    stepId: Schema.String,
    action: Schema.Literal("insert", "replace", "remove", "replace_step"),
    payload: Schema.Unknown,
  }),
  Schema.TaggedStruct("STEP_DONE", { stepId: Schema.String, summary: Schema.String }),
  Schema.TaggedStruct("ASSERTION_FAILED", {
    stepId: Schema.String,
    category: Schema.Literal("budget-violation","regression","resource-blocker","memory-leak","abort"),
    domain: Schema.Literal("design","responsive","perf","a11y","other"),
    reason: Schema.String,
    evidence: Schema.String,
    abortReason: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("RUN_COMPLETED", {
    status: Schema.Literal("passed","failed"),
    summary: Schema.String,
  }),
)
```

(Real implementation uses `Schema.TaggedClass` where appropriate; this sketch shows shape.)

### 3.4 Per-turn prompt budget

| Block | Typical tokens | Notes |
|-------|----------------|-------|
| `<system>` (static) | ≈600 | Wave 2.B-derived, +THOUGHT/PLAN_UPDATE extension |
| `<plan>` | ≈150 | Up to 12 steps |
| `<current_sub_goal>` | ≈80 | Title + instruction |
| `<observed_state>` (SOM text) | ≈1500 | Snapshot + ref list |
| SOM image | 256 | Encoded as 256 tokens on Gemma 3n |
| `<trajectory>` (last 5 turns) | ≈2000 | Thought + action + abbreviated result |
| `<environment>` + `<developer_request>` | ≈200 | Existing |
| **Total input** | **≈4800** | Well under 28K cap |
| Gemma output budget | ≈800 | One AgentTurn JSON |

## 4. Design decisions (picks + rationale; one-liners, full justification in `assessment.md`)

| # | Decision | Pick | Rationale |
|---|----------|------|-----------|
| 1 | ReAct format | Pipe-delimited envelope reusing existing markers + new THOUGHT/PLAN_UPDATE | Reuses Wave 1.B parser contract, 4B-friendly uniform syntax |
| 2 | Plan authorship | Gemma emits initial plan via PLAN_UPDATE on turn 1; template fallback if absent | Respects `feedback_avoid_prompt_overfitting`; safety net for the 4B failure case |
| 3 | Tool reliability | Ollama `format: <AgentTurn JSON Schema>` constraint | BFCL evidence Gemma needs grammar constraint; no new deps |
| 4 | Replan trigger | Reactive (2 consecutive failures) + self-triggered via PLAN_UPDATE | Cheaper than Voyager-style GPT-4-critic; matches Reflexion's post-trial pattern |
| 5 | Termination discipline | Wave 1.B gate + extra "no unresolved ASSERTION_FAILED in last 3 turns on RUN_COMPLETED=passed" rule | Premature-termination is the canonical 4B failure mode (Cemri 2025) |
| 6 | Context window | Activate Wave 4.6 now: last-5 verbatim, older rule-summarized, drop old images | Gemma's 32K context, JetBrains study endorses 10-turn sliding window |
| 7 | SOM + ReAct | THOUGHT references SOM ref + label ("I see [5] 'Build your Volvo'") | SeeAct textual-choice grounding beats raw image annotation |
| 8 | Eval runners | gemma-react (production) + gemini-react (A:B) + gemma-oracle-plan (debug ablation) | Apples-to-apples A:B, oracle ablation isolates planning vs execution failures |
| 9 | Distillation | ReAct trajectories via Gemini-react runner → JSONL teacher data for `browsing-gemma` LoRA | AgentTrek/WebLlama pattern proven at 7B–8B |
| 10 | Backward compat | Keep `--planner frontier` flag 2 releases; template fallback stays | Avoid user-visible breakage during validation phase |

## 5. Migration plan (phases)

Five phases, each a potential wave for `/team-orchestration`. Dependencies are strict — do not parallelize across phases.

### Phase R1 — Envelope + schema foundation
**Scope:**
- New `packages/shared/src/react-envelope.ts` with `AgentTurn` schema + `parseAgentTurn` via `Schema.decodeEffect`.
- Extend `packages/shared/src/models.ts` with `PlanUpdate` event + `ExecutedPerfPlan.applyPlanUpdate(event)` method.
- Golden-file tests in `packages/shared/tests/react-envelope.test.ts`.
- No runtime changes; additive.

**Dependencies:** none (additive schema).
**Effort:** 1 focused engineer, 1 day.
**DoD — Behavior:** A hand-authored JSON AgentTurn round-trips through `parseAgentTurn` with full type narrowing. `ExecutedPerfPlan.applyPlanUpdate({ action: "insert", ... })` returns a new plan with the step inserted at the correct position and does not mutate the original.

### Phase R2 — Ollama format parameter + prompt extension
**Scope:**
- `packages/local-agent/src/ollama-client.ts`: add `format` parameter to `OllamaCompletionOptions`, thread through to `response_format`.
- `packages/local-agent/src/tool-loop.ts`: replace the raw chat loop's unconstrained output with a constrained-output loop that consumes `AgentTurn` directly (no regex parsing — use `parseAgentTurn`).
- `packages/shared/src/prompts.ts` `buildExecutionSystemPrompt()`: extend from 59 → ~75 lines to add:
  - THOUGHT protocol line (1 sentence reasoning before each ACTION).
  - PLAN_UPDATE protocol block (3 lines: when and how to use it).
  - REFLECT trigger guidance (1 line).
- Update golden-file tests in `packages/shared/tests/prompts.test.ts` to pin the new shape.

**Dependencies:** R1.
**Effort:** 1 engineer, 2 days.
**DoD — Behavior:** Running Gemma 3n E4B through the local-agent tool-loop with the new prompt produces schema-valid `AgentTurn` JSON on every turn. The prompt stays ≤80 lines.

### Phase R3 — Executor ReAct reducer
**Scope:**
- New `packages/supervisor/src/react-reducer.ts` module containing the per-turn state machine (consumes `AgentTurn`, emits updated `ExecutedPerfPlan`).
- `packages/supervisor/src/executor.ts`: replace the pre-stream `planDecomposer.decompose` call for non-"none"/non-"template" modes with a ReAct loop delegated to the reducer.
- Adherence gate (`runFinishedSatisfiesGate`) extended: reject `RUN_COMPLETED=passed` if `ASSERTION_FAILED` in last 3 events without matching `STEP_DONE`.
- PLAN_UPDATE cap (≤5 per run) enforced in reducer.
- REFLECT trigger: after 2 consecutive ASSERTION_FAILED on same step-id, inject a REFLECT marker in `<observed_state>` on next turn.
- Integration tests in `packages/supervisor/tests/react-reducer.test.ts`.

**Dependencies:** R1, R2.
**Effort:** 1 engineer, 3 days.
**DoD — Behavior:**
- Volvo replay test: the Wave 0 captured trace, replayed through Gemma with ReAct, produces ≥4 sub-goals (via PLAN_UPDATE) and does not emit premature RUN_COMPLETED.
- PLAN_UPDATE cap test: 6 consecutive PLAN_UPDATEs → 6th rejected with `excessive-replanning` warning.
- REFLECT injection test: 2 ASSERTION_FAILEDs → next turn's `<observed_state>` contains the REFLECT directive.
- All Wave 1.B adherence tests still pass.

### Phase R4 — Context window rolling (Wave 4.6 activation)
**Scope:**
- `packages/shared/src/prompts.ts` `buildExecutionPrompt`: add `<trajectory>` block populated from last N=5 turns.
- `packages/supervisor/src/executor.ts`: the reducer tracks trajectory state; older turns rolled into one-line summaries (`<event>TOOL action → outcome</event>`).
- Drop old screenshots (keep SOM text for older snapshots, drop image bytes).
- Token budget monitor: warn at 20K, abort at 28K with `context-budget-exceeded`.

**Dependencies:** R3.
**Effort:** 1 engineer, 2 days.
**DoD — Behavior:**
- Long-trajectory test (20-step synthetic run): prompt stays under 28K total tokens.
- Screenshot retention: only last turn's image bytes included; older snapshots reduced to text summary.
- Abort test: synthesized 30K-token accumulation triggers `context-budget-exceeded` abort, which flows through the adherence gate as a `category=abort` RUN_COMPLETED.

### Phase R5 — Eval runners + trace schema
**Scope:**
- Extend `packages/evals/src/runners/trace-recorder.ts` `TraceEventSchema` with `plan_update` event type.
- New `packages/evals/src/runners/gemini.ts` (`makeGeminiRunner`): runs the ReAct loop with Gemini Flash 3 as the LLM via `generateObject` + `AgentTurn` schema.
- `packages/evals/src/runners/gemma.ts`: flip `DEFAULT_PLANNER_MODE` to `"gemma-react"` (new literal added to `PlannerMode`).
- New debug runner `packages/evals/src/runners/gemma-oracle-plan.ts`: runs Gemma-react but pre-populates the plan via Gemini's frontier decomposer (for ablation eval only).
- Update `packages/evals/src/distill/teacher-data-exporter.ts`: decode `plan_update` events and emit them as assistant-content lines.
- Wave 4.5-style regression run: gemma-react vs gemini-react vs gemma-oracle-plan on the full 20-task set. Report committed to `docs/handover/harness-evals/baselines/`.

**Dependencies:** R3, R4.
**Effort:** 1 engineer, 3 days + eval runtime.
**DoD — Behavior:**
- All three runners produce scoreable trace ndjson.
- Regression report shows per-task deltas across the three runners with flagged regressions.
- Teacher-data exporter correctly serializes PLAN_UPDATE events into JSONL.
- `pnpm --filter @neuve/evals test` green.
- `pnpm check` green.

### Post-Phase — Cleanup
After R5 completes AND the A:B data shows gemma-react ≥ gemini-react within 10% on the eval subset (or we accept the gap as the distillation-lift target):
- Flip CLI default from `--planner frontier` to `--planner gemma-react`.
- Optional: delete frontier planner from production path (keep oracle-plan debug runner).
- Re-run teacher-data generation on the ReAct trace format → fresh `browsing-gemma` LoRA training dataset.

## 6. Evaluation plan

### 6.1 Metrics (existing scorers, unchanged)
- `step-coverage` — fraction of key nodes reached.
- `furthest-key-node` — deepest index reached.
- `final-state` — did we reach the expected final URL / DOM?
- `tool-call-validity` — fraction of tool calls with valid schemas.

### 6.2 New ReAct-specific metrics
- `plan-authorship-quality`: compare Gemma's initial PLAN_UPDATE steps against a reference plan from the task fixture. Levenshtein on step titles OR LLM-as-judge (Wave 6+ scope).
- `replanning-rate`: average PLAN_UPDATE events per run. Target: ≤3 for passing runs.
- `premature-termination-rate`: fraction of runs where adherence gate rejected a RUN_COMPLETED. Target: ≤10% (currently ~50% pre-Wave-1.B).
- `context-budget-utilization`: mean + p95 token usage across runs. Target: p95 ≤24K.

### 6.3 Benchmark cadence
- **Per phase**: run the 5 calibration tasks + 2 trivial tasks. Smoke only.
- **Phase R5 exit**: full 20-task run for all three runners.
- **Post-cleanup**: Online-Mind2Web subset (Wave 4.A) run on gemma-react vs gemini-react. Target: gemma-react within 15% of gemini-react before we declare the distillation target achievable.

### 6.4 Manual testing (per memory `project_post_plan_continuation.md`)
- User runs the Volvo EX90 prompt manually after Phase R3.
- User runs 2-3 additional journey tasks manually after Phase R5.
- Manual results override eval numbers when they disagree (per Wave 2.B / 4.5 convention: "evals are directional, not definitive").

## 7. Open questions

See `open-questions.md` for the user-gate list. Summary:
1. Should `--planner frontier` stay as a CLI flag or be deleted after Phase R5?
2. Should PLAN_UPDATE cap be 5 (this doc), or higher for hard journeys?
3. Is Gemini Flash 3 the only frontier in scope for eval A:B, or do we also run Opus/Claude as a third lane?
4. Teacher-data distillation: re-run immediately after R5, or wait for Wave 6 explicit scheduling?

## 8. Risks + rollback

| Risk | Likelihood | Severity | Mitigation |
|------|------------|----------|-----------|
| Gemma can't emit schema-valid JSON at 4B despite Ollama `format` | Medium | High | Phase R2 includes early smoke test; fallback: prompt-only ReAct + `parseAgentTurn` tolerance for minor deviations |
| Gemma's PLAN_UPDATE quality is too low and runs regress vs current Gemini-plan | Medium | High | Oracle-plan ablation runner isolates planning vs execution quality; user manual tests; `--planner frontier` flag kept for 2 releases |
| Context window blows up on long journeys despite rolling | Low | Medium | Phase R4 monitors + aborts at 28K; Wave 4.5 baseline data already captured |
| REFLECT loops degenerate into replanning loops | Low | Medium | Cap both PLAN_UPDATE (5) and REFLECT (2) per run; log warnings |
| Constrained decoding latency regresses user TUI responsiveness | Low | Low | Ollama grammar overhead is typically 5-15%; measurable; if severe, fall back to JSON-mode-only |
| Teacher data generation cost (Gemini API $) balloons | Low | Low | Target 20 tasks × ≤15 turns × ≤5K tokens = ~1.5M tokens per full pass; Gemini Flash pricing ~$0.10/run |

### Rollback plan

If Phase R3 fails the Volvo replay test twice after debugging:
1. Revert the executor changes (keep Phase R1 + R2 schema work — they're additive).
2. Default `plannerMode` stays at `"frontier"` (current default).
3. Reopen research on whether Gemma 3n E4B needs a distilled LoRA first (inverting the plan order: distill first, ReAct second).

If Phase R5 eval shows gemma-react >30% regression vs current gemini-plans-gemma-executes:
1. Retain `gemma-react` as the default **only** for `--planner gemma-react`; keep `--planner frontier` (current hybrid) as the CLI default.
2. Use the A:B delta as the **distillation goal gap**: the LoRA training goal becomes "close the ≥30% gap."
3. Do not flip the production default until distillation closes the gap.

## 9. File-level touch list (summary)

| File | Change | Phase |
|------|--------|-------|
| `packages/shared/src/react-envelope.ts` | NEW — `AgentTurn` schema | R1 |
| `packages/shared/src/models.ts` | ADD `PlanUpdate` event + `applyPlanUpdate` method | R1 |
| `packages/shared/src/prompts.ts` | EXTEND `buildExecutionSystemPrompt` (+THOUGHT/PLAN_UPDATE/REFLECT protocol) | R2 |
| `packages/shared/tests/react-envelope.test.ts` | NEW tests | R1 |
| `packages/shared/tests/prompts.test.ts` | UPDATE golden files | R2 |
| `packages/local-agent/src/ollama-client.ts` | ADD `format` param | R2 |
| `packages/local-agent/src/tool-loop.ts` | REPLACE unconstrained loop with `AgentTurn`-constrained loop | R2 |
| `packages/supervisor/src/executor.ts` | REWIRE stream to ReAct reducer; EXTEND adherence gate | R3 |
| `packages/supervisor/src/react-reducer.ts` | NEW | R3 |
| `packages/supervisor/src/errors.ts` | ADD `gemma-react` to `PlannerMode` literal tuple | R3 |
| `packages/supervisor/tests/react-reducer.test.ts` | NEW | R3 |
| `packages/shared/src/prompts.ts` | ADD `<trajectory>` per-turn block | R4 |
| `packages/evals/src/runners/trace-recorder.ts` | ADD `plan_update` event type | R5 |
| `packages/evals/src/runners/gemma.ts` | FLIP default to `gemma-react` | R5 |
| `packages/evals/src/runners/gemini.ts` | NEW | R5 |
| `packages/evals/src/runners/gemma-oracle-plan.ts` | NEW (debug only) | R5 |
| `packages/evals/src/distill/teacher-data-exporter.ts` | HANDLE `plan_update` events | R5 |
| `apps/cli/src/stores/use-preferences.ts` | UPDATE default `plannerMode` | post-R5 |
| `apps/cli-solid/src/tui.ts` | UPDATE `--planner` default | post-R5 |

## 10. Compliance checklist (auto-run before team orchestration)

- [x] Respects `feedback_avoid_prompt_overfitting.md`: ReAct prompt teaches reasoning framework (THOUGHT + PLAN_UPDATE + SOM ref grounding), not site-specific patterns. Site specificity stays in distillation data.
- [x] Respects `feedback_types_over_regex.md`: `AgentTurn` is a Schema discriminated union, parsed via `Schema.decodeEffect`. No regex anywhere in the envelope parser.
- [x] Respects `feedback_no_test_only_injection_seams.md`: `gemma-oracle-plan` runner is explicitly a debug-only path, not shipped to production CLI.
- [x] Respects `project_target_model_gemma.md`: production model is Gemma 3n E4B. Frontier models only in eval / teacher / judge paths.
- [x] Respects Effect v4 idioms per CLAUDE.md: new services use `ServiceMap.Service`, errors use `Schema.ErrorClass`, no `Effect.mapError` / `catchAll` anywhere in the new code.
- [x] Respects `feedback_dod_behavior_vs_verification.md`: DoDs above describe runtime behavior, not "function exists".
- [x] Respects `feedback_commit_guidelines.md`: no Co-Authored-By footer; commits will be granular per wave after reviewer APPROVE.
