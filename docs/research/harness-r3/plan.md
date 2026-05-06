# harness-r3 — Structural REFLECT-injection + deterministic-stuck divergence

_Wave dispatched after harness-r2 close-out (1-line variance pin SHIPPED INVESTIGATIVE-VERIFIED 2026-05-06; P2 completion_check + P3 PLAN_UPDATE elicitation rewrites both REVERTED). harness-r2 P3 produced direct empirical evidence that the AF→REFLECT→PLAN_UPDATE retry-signal pathway is structurally dead (0/240 non-abort ASSERTION_FAILED across 4 sweeps × 60 traces; 16/240 abort-category emissions, all gemini-react, all single-shot terminations for unrecoverable infrastructure conditions). Two waves of explicit prompt teaching (R3 implicit, harness-r2 P3 explicit) couldn't move PLAN_UPDATE emission rate above 0/60. The only viable elicitation path is structural — the harness must do work the model won't do._

## What we're building

Two structural harness changes plus an investigative trace-diff, each eval-validated against the harness-r2 variance-pinned baseline:

1. **Structural REFLECT-injection probe (PRIMARY)** — harness detects shape signals (SchemaError-loop, arg-rejection-after-N-retries) on the same `stepId` and **injects a synthetic REFLECT directive into the next observation** instead of aborting via doom-loop. Bypasses the dead AF→REFLECT pathway entirely. Adjacent to existing `DOOM_LOOP_THRESHOLD = 3` detector in `packages/local-agent/src/tool-loop.ts:339` and gemini-react analog at `packages/evals/src/runners/gemini-react-loop.ts:422`.
2. **Deterministic-stuck divergence trace-diff** — investigative wave. harness-r2 P1 surfaced that under `temp=0` the gemma stack widens variance via env/DOM input deltas (`trivial-1` Δ step-cov 1.00 between two zero-code-change sweeps; `journey-6` 0.00→0.80; `journey-3` 15→3 turns). Pull 2-3 task pairs from `evals/traces/wave-harness-r2-pin-{1,2}/`, identify whether divergence source is fixable upstream of the model (e.g. `wait_for` timing, `take_snapshot` ordering, DOM settling). Prescribe a fix only if the trace-diff surfaces a concrete actionable lever; otherwise close out with structural finding for harness-r4.
3. **Engineer-selected P3 hook** — engineer picks 1 of 3 deferred candidates (AnalysisStep schema typing, tool catalog deduplication, oracle-plan capability autopsy) based on what P1 evidence surfaces. Gated on P1 raising PLAN_UPDATE emission rate above 0/60.

Each phase is an A:B sweep against the harness-r2 variance-pinned baseline (`evals/traces/wave-harness-r2-pin-2/` is the canonical anchor — most recent post-pin steady-state). No model retraining. Pure harness/code work plus targeted prompt complement to make injected REFLECT directives parseable.

## What we're explicitly NOT building

- **Continued prompt-only PLAN_UPDATE elicitation** — harness-r2 P3 proved 0/60 floor is structural. Three rounds of prompt teaching (R3 implicit, harness-r2 P3 explicit, would-be harness-r3 prompt-only) is over-investment in a dead lever.
- **Bigger reflect-threshold tightening** — harness-r2 P3 tightened 2→1 ASSERTION_FAILED with no effect because the prerequisite (model emits non-abort AF) doesn't hold. Threshold tuning is moot.
- **R12 distillation work** — R12 plan locked at `33edcc91` runs in parallel via separate team if/when dispatched. harness-r3 outputs (PLAN_UPDATE-bearing trajectories) feed R12 if R12 dispatches after this wave.
- **Alternate teachers / bigger base model** — orthogonal strategic decisions. harness-r3 stays in surgical-harness territory.
- **JUDGE temperature pin** — `JUDGE_DEFAULT_TEMPERATURE = 0.1` at `packages/evals/src/scorers/llm-judge.ts:22` excluded by harness-r2 with rationale "post-hoc scorer, not trajectory variance". Defer until scoring variance is suspected.

## Decision log (locked)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Three-phase wave (P1 structural REFLECT-injection → P2 divergence trace-diff → P3 engineer-pick)** | P1 is the highest-confidence direct-evidence intervention from harness-r2. P2 is investigative — could yield a concrete fix or could close out as "no upstream lever". P3 is gated on P1 to surface dependent fix paths. |
| 2 | **Distribution-form gates per `project_baseline_eval_strategy.md`** | All gates expressed as median/p90 across N≥1 post-change sweep vs harness-r2 pin-2 anchor (1 zero-code-change sweep) + harness-r2 pin-1 anchor for 2-sample variance. No single-sample point gates. |
| 3 | **A:B test pattern per phase** | Each phase: pre-change baseline = harness-r2 pin-2 trace dir (already on disk); post-change sweep at HEAD-after-change. Compare distributions. Phase passes ONLY if direction-of-effect preserved within harness-r2 variance-pinned floor (gemini-react Δ ≤ 0.04, gemma-react Δ ≤ 0.10). |
| 4 | **Structural injection over prompt teaching** per harness-r2 P3 evidence | 0/240 non-abort AF emissions across 4 sweeps proves prompt-level retry-signal teaching cannot work. Harness owns the detection + injection. The system prompt gets a small complement (1-line REFLECT directive shape spec) so the model knows how to parse the injection — NOT how to emit it. |
| 5 | **Detect on shape, not envelope-type** per harness-r2 finding #2 | SchemaError-loops and arg-rejection-after-N-retries are direct trace evidence of the BMW capability gap (R3 v3 + harness-r2 P3 journey-1-bmw persistence). The model emits `interact{uid:"1_182"}` (no command) → SchemaError → retries with same shape. That's the detection signal. |
| 6 | **Reuse doom-loop seam** | `DOOM_LOOP_THRESHOLD = 3` already in `tool-loop.ts:25` and `GEMINI_REACT_DOOM_LOOP_THRESHOLD` analog. New `REFLECT_INJECTION_THRESHOLD = 2` (one less than doom-loop) detects N-1 consecutive SchemaErrors on same stepId → inject REFLECT instead of waiting for the 3rd to abort. The new threshold strictly precedes the existing abort threshold. |
| 7 | **wave-r5-ab as the validation seam** | Same eval used for R8/R9/R10/R11/harness-r2 baselines. Preserves comparability. `wave-r5-ab.eval.ts` byte-identical to harness-r2 ship (sha `fccbddd03930a1e9f51b1357a779181d5c465f76`). |
| 8 | **Real services for live smokes** per `feedback_no_test_only_injection_seams.md` | Each phase's A:B sweep uses real Ollama (gemma-react), real Gemini Pro 3 (gemini-react), real plan decomposer. No `MockLanguageModelV4`. Unit tests for the injection detector use fixture-based shape-matching against canonical `journey-1-bmw` ndjson. |
| 9 | **Granular commits, no Co-Authored-By, no `--no-verify`** per `feedback_commit_guidelines.md` and `feedback_reviewer_never_stash.md` | Per-file commits for detector + injection-formatter + prompt complement; revert-clean if any phase regresses. |

## Prior work to build on

| Source | What it provides |
|---|---|
| `packages/local-agent/src/tool-loop.ts:25,339` | `DOOM_LOOP_THRESHOLD = 3` constant + 3-identical-ACTION-envelope detector seam. Adjacent code to host new `REFLECT_INJECTION_THRESHOLD` detector. |
| `packages/local-agent/src/tool-loop.ts:355-364` | Existing `connection.sessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: ... } })` injection point — same shape used for doom-loop abort message. New REFLECT injection uses identical pattern with non-aborting `text:` content. |
| `packages/evals/src/runners/gemini-react-loop.ts:26,422` | `GEMINI_REACT_DOOM_LOOP_THRESHOLD` analog + identical doom-loop detection pattern. Mirror new `REFLECT_INJECTION_THRESHOLD` here. |
| `packages/evals/src/runners/gemini-react-loop.ts:391-395` | Existing AF→observation injection pattern: `history.push({ role: "user", content: "<observation>(ASSERTION_FAILED recorded for ${stepId} — choose between retry, replan via PLAN_UPDATE, or RUN_COMPLETED.)</observation>" })`. New REFLECT injection follows identical shape with REFLECT-directive content. |
| `evals/traces/wave-harness-r2-plan-update/gemma-react__journey-1-car-configurator-bmw.ndjson` | **Canonical input fixture for P1 detector unit tests.** R3 BMW pattern persisted: `<thought>` recognizes prerequisite gap → `interact{uid:"1_182"}` (no `command` field) → SchemaError → repeats same shape. This is the exact trace shape the detector must catch. |
| `evals/traces/wave-harness-r2-pin-{1,2}/` | Trace-diff inputs for P2 deterministic-stuck divergence investigation. Pairs: `trivial-1` (Δ step-cov 1.00), `journey-6` (0.00→0.80), `journey-3` (15→3 turns). |
| `packages/shared/src/prompts.ts:86-156` | `buildLocalAgentSystemPrompt` — needs a 1-line REFLECT-directive parsing complement so the model knows what to do when it sees an injected REFLECT. NOT a teaching block; a parsing rule. |
| `packages/shared/src/react-envelope.ts:411-415` | `PlanUpdate` Schema.TaggedClass with `payload: Schema.Unknown` — P3 candidate (AnalysisStep schema typing) lives here, gated on P1 raising PLAN_UPDATE rate. |
| `packages/evals/evals/wave-r5-ab.eval.ts` | 20-task A:B suite — all 4 runner lanes. Byte-identical to R11 ship. |
| `docs/handover/harness-r2/diary/r0-2026-05-01.md` §P3 | Direct empirical evidence for the structural-injection hypothesis. Diary §P4 finding #2 is the root rationale for this wave. |
| `docs/handover/harness-r2/reviews/r0-strict-critique-2026-05-06.md` lines 50-52 | Reviewer-verified BMW persistence: model emits `<thought>` "page has cookie banner that needs to be dismissed before proceeding" → `interact{uid:"1_182"}` (no command) → SchemaError → harness abort. Direct verification of the trigger pattern. |
| `docs/handover/harness-evals/baselines/wave-harness-r2.md` | Variance-pinned anchor numbers: gemini-react step-cov 0.465-0.505 (Δ 0.040), gemma-react 0.271-0.361 (Δ 0.090), strict-pass 4/20 max, schema-invalid 5/20 floor, empty-content 0/20. |
| `project_react_migration_plan.md` | R1-R11 narrative for capability-gap context. |
| `project_baseline_eval_strategy.md` | Distribution-form gate guidance. |

## Phases

### P1 — Structural REFLECT-injection probe

**Goal**: detect SchemaError-loops or arg-rejection-after-N-retries on the same `stepId` → inject synthetic REFLECT directive into next observation. Targets the BMW pattern: model recognizes the gap in `<thought>` but doesn't emit PLAN_UPDATE.

**Touched**:

- `packages/local-agent/src/constants.ts` (or `tool-loop.ts` if no constants file) — add `REFLECT_INJECTION_THRESHOLD = 2`. Strictly less than `DOOM_LOOP_THRESHOLD = 3` so injection precedes abort.
- `packages/local-agent/src/tool-loop.ts` — extend the `recentCalls` tracking with a parallel `recentSchemaErrors: { stepId, errorShape }[]` array. Detection logic (proposed; engineer refines):
  - On SchemaError result OR isError=true tool result with `args` shape rejection: append `{ stepId, errorShape: <stable-hash-of-error-message> }`.
  - When 2 consecutive entries match (same stepId + same errorShape): inject REFLECT directive via `connection.sessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "<observation>REFLECT: The current step is failing in the same shape twice in a row. Re-examine the plan: is this step's tool the right one? Are required prerequisites missing? Emit PLAN_UPDATE with action=replace (corrected step), action=insert (missing prerequisite), or action=remove (now-redundant step). Do not retry the same args again.</observation>" } })`.
  - Reset the tracking array on PLAN_UPDATE emission OR step transition.
  - Existing doom-loop detector unchanged — fires at threshold=3 if model still doesn't emit PLAN_UPDATE after REFLECT injection.
- `packages/evals/src/runners/gemini-react-loop.ts` — mirror the same detection + injection logic adjacent to existing `GEMINI_REACT_DOOM_LOOP_THRESHOLD` block. Use `history.push({ role: "user", content: "<observation>REFLECT: ..." })` injection shape (matches existing AF→observation pattern at lines 391-395).
- `packages/shared/src/prompts.ts` — add 1-2 line REFLECT-parsing complement to `buildLocalAgentSystemPrompt` AND `buildExecutionSystemPrompt`. Proposed (engineer refines, density+proximity per `feedback_prompt_design_for_small_models.md`):
  ```
  <reflect_directive>
  When an observation begins with REFLECT: the harness has detected your current approach is failing in the same shape. The next envelope MUST be a PLAN_UPDATE with action=replace, insert, or remove. Do not emit another ACTION until you've emitted PLAN_UPDATE.
  </reflect_directive>
  ```
- Unit tests: `packages/local-agent/src/tool-loop.test.ts` (or new file) — fixture-based test using extracted shape from `evals/traces/wave-harness-r2-plan-update/gemma-react__journey-1-car-configurator-bmw.ndjson`. Two consecutive SchemaErrors on same stepId → REFLECT directive injected. Real Ollama not needed for unit; integration coverage comes from the A:B sweep.
- Granular commits:
  1. `feat(local-agent): structural REFLECT-injection on SchemaError-loop`
  2. `feat(evals): mirror REFLECT-injection in gemini-react-loop`
  3. `feat(prompts): add REFLECT-directive parsing rule for harness-injected directives`
  4. (optional) `test(local-agent): fixture-based REFLECT-injection detector tests`
- `pnpm --filter @neuve/local-agent build` before sweep (per `project_eval_build_cache_trap.md`).
- Run 1 sweep post-change:
  - `EVAL_TRACE_DIR=evals/traces/wave-harness-r3-reflect-injection pnpm --filter @neuve/evals eval:wave-r5-ab`
- Categorize each gemma-react + gemini-react run by injection behavior:
  - **REFLECT-triggered**: harness injected at least 1 REFLECT directive (count via grep on agent_message_chunk text)
  - **Post-REFLECT PLAN_UPDATE**: REFLECT injection followed by a PLAN_UPDATE envelope from the model
  - **Post-PLAN_UPDATE recovery**: PLAN_UPDATE was followed by a successful step (final-state or step-cov gain on the previously-stuck stepId)
  - **Stuck-loop avoidance**: tasks that pre-fix hit doom-loop abort but post-fix recovered via REFLECT→PLAN_UPDATE
  - **No-trigger control**: tasks where detector didn't fire (validates detector specificity — should NOT fire on healthy trajectories)
- Capture distributions in diary §P1.

**Verifiable** (Gate 1):
- **REFLECT-injection rate**: ≥ 5/60 across all 3 runners on tasks where pre-fix BMW-shape patterns existed (gemma-react journey-1-bmw is the canonical anchor; tracker also: any task where pre-fix sweep had ≥ 2 consecutive SchemaErrors). Lower bound — primary purpose is to validate the detector fires when expected.
- **Post-REFLECT PLAN_UPDATE rate**: ≥ 3/(REFLECT-injection count) — i.e., when the harness injects, the model emits PLAN_UPDATE in response at least 50% of the time. Validates the prompt-complement is sufficient.
- **Post-PLAN_UPDATE recovery rate**: ≥ 1 task where REFLECT→PLAN_UPDATE→successful step is observable in the trace. Qualitative; trace inspection.
- **Specificity**: REFLECT-injection rate on healthy trajectories (no SchemaError-loop pre-fix) is 0 — detector must not fire spuriously.
- **Regression safety**: gemma-react step-cov within harness-r2 variance-pinned band (Δ ≤ 0.10 vs pin-2 anchor); gemini-react Δ ≤ 0.04. Empty-content 0/20. Schema-invalid ≤ 5/20.
- **journey-1-bmw specifically**: trace shows REFLECT injection after the second `interact{uid, no command}` SchemaError; subsequent envelope is PLAN_UPDATE (action=insert for cookie-banner step OR action=replace with corrected `interact.command` shape).

**Risk**: model receives REFLECT but still doesn't emit PLAN_UPDATE — the capability gap may be deeper than prompt-readability. Mitigation: doom-loop detector still fires at threshold=3 (one more attempt after REFLECT), so trajectory still terminates cleanly. If post-REFLECT PLAN_UPDATE rate < 50%, the wave still ships P1 as INFO-finding (detector validated; capability gap quantified) and P3 escalates to oracle-plan capability autopsy.

**Effort**: medium (detector + tests + prompt complement + 1 sweep). Sweep cost ~$10-15.

### P2 — Deterministic-stuck divergence trace-diff

**Goal**: investigative wave. Pull 2-3 task pairs from `wave-harness-r2-pin-{1,2}` traces. Identify whether divergence source is fixable upstream of the model. Output: either a concrete fix (P2 ships fix) or a structural finding (P2 ships diagnostic + harness-r4 hook).

**Touched**:

- `docs/handover/harness-r3/diary/r0-2026-05-XX.md` §P2 — engineer's trace-diff analysis. Cover at minimum:
  - `trivial-1`: pin-1 navigated `http://`, stale title, cov 0.00. pin-2 navigated `https://`, full coverage, cov 1.00. **Hypothesis**: URL scheme handling in `navigate_page` tool or first-observation snapshot timing. Inspect raw observations between sweeps for the same task.
  - `journey-6`: pin-1 cov 0.00 (turns 6, early termination). pin-2 cov 0.80 (turns 15, near-completion). **Hypothesis**: `wait_for` timing or `take_snapshot` ordering after navigation.
  - `journey-3`: pin-1 turns 15 (MAX_TOOL_ROUNDS). pin-2 turns 3 (early bail). **Hypothesis**: divergent first-observation content drove different plans.
- For each pair, extract: first 5 observations (raw), first 5 model-emitted envelopes (raw), divergence point (turn N where trajectories first differ), root-cause classification (env-input variance / DOM settling / tool implementation / model-stochasticity-residual).
- If a concrete actionable lever surfaces (e.g. `wait_for` should retry, `take_snapshot` should wait for `networkidle`, `navigate_page` should normalize URL scheme):
  - Implement fix in `packages/browser/src/` or `packages/evals/src/runners/`.
  - 1 granular commit per fix: `fix(browser): normalize URL scheme in navigate_page` (or similar).
  - Re-run trace-diff post-fix on the same 3 task pairs to verify divergence collapses.
- If no concrete lever surfaces: close P2 as diagnostic-only with structural finding for harness-r4.
- 1 sweep IF a fix was implemented:
  - `EVAL_TRACE_DIR=evals/traces/wave-harness-r3-divergence-fix pnpm --filter @neuve/evals eval:wave-r5-ab`

**Verifiable** (Gate 2):
- **If fix landed**: 2-run zero-code-change variance band (re-run pin-1+pin-2 protocol post-fix) shows median Δ step-cov gemma-stack < 0.07 (tighter than harness-r2's 0.090). Direction-of-effect preserved on the 3 canonical task pairs (`trivial-1`, `journey-6`, `journey-3`).
- **If no fix landed**: diary §P2 captures root-cause classification per task pair + a concrete harness-r4 candidate (e.g. "DOM settling: implement `wait_for_network_idle` wrapper around tool calls" with file pointers).
- **Either way**: regression safety — if a fix landed, gemma-react step-cov ≥ pin-2 anchor (no negative direction-of-effect).

**Risk**: variance source may be irreducible at the harness layer (e.g. real network conditions, real CDN response timing, real CAPTCHA randomization). Mitigation: P2 explicitly accepts diagnostic-only outcome. Don't force a fix that adds complexity without measurable variance reduction.

**Effort**: small-to-medium (trace-diff is ~3-4 hour investigation; fix + sweep is ~1.5 hour wall-clock if a lever surfaces).

### P3 — Engineer-selected hook

**Goal**: engineer picks 1 of 3 deferred candidates based on P1 evidence. Decision happens AFTER P1 sweep completes. Surface to lead before committing to scope.

**Candidates**:

| Candidate | Trigger condition (P1 evidence) | Scope |
|---|---|---|
| **AnalysisStep schema typing** | If P1 raised PLAN_UPDATE rate above 0/60 | Tighten `PlanUpdate.payload` from `Schema.Unknown` to typed `AnalysisStep` schema in `packages/shared/src/react-envelope.ts:411-415`. Catches malformed PLAN_UPDATE payloads at parse time. Single granular commit: `feat(shared): tighten PlanUpdate.payload to AnalysisStep schema`. |
| **Tool catalog deduplication** | If P1 surfaced `interact.command="click"` AND flat `click` tool both in trace, OR if SchemaError-loop dominantly clusters around `interact` dispatcher | Investigation probe: which tool name does the model emit more often? If clear winner, drop the loser. File: `packages/shared/src/react-envelope.ts:373-403`. Single granular commit: `refactor(shared): deduplicate tool catalog (drop {winner-or-loser})`. |
| **Oracle-plan capability autopsy** | If P1's post-REFLECT PLAN_UPDATE rate < 50% (capability gap deeper than parsing) | Diagnostic-only. Pull 5-10 gemma-oracle-plan traces (final-state 0.000 with Pro 3's plans) → identify why a perfect plan doesn't help gemma execute final-state. Output: structural finding. Likely escalates to harness-r4 or R12 plan revision. No code change. |

**Touched** (depends on engineer's pick):
- AnalysisStep typing: `react-envelope.ts` + parse-error tests + 1 sweep to verify no false-positive parse rejections.
- Tool dedup: `react-envelope.ts` (ToolName union) + tool dispatcher in `tool-loop.ts` + 1 sweep to verify no regression.
- Oracle-plan autopsy: diary §P3 only.

**Verifiable** (Gate 3):
- AnalysisStep typing: post-sweep PLAN_UPDATE-parse-error count = 0/N where N = REFLECT-triggered traces from P1.
- Tool dedup: post-sweep step-cov within harness-r2 variance-pinned band; SchemaError-on-deprecated-tool-name count = 0.
- Oracle-plan autopsy: diary captures ≥ 5 trace classifications with root-cause per trace.

**Effort**: small (any of the three).

### P4 — Wave close-out + comparison report

**Goal**: aggregate P1+P2+P3 results into a wave-harness-r3 baseline document. Surface gate verdicts. Capture lessons for harness-r4 hooks (or close out if harness work has reached diminishing returns).

**Touched**:
- `docs/handover/harness-evals/baselines/wave-harness-r3.md` — auto-generated via `pnpm wave-r5-ab:report` against post-P3 trace dir, then hand-augmented with:
  - Per-phase gate verdicts (Gate 1, 2, 3)
  - Pre-vs-post-fix delta tables: REFLECT-injection rate, post-REFLECT PLAN_UPDATE rate, post-PLAN_UPDATE recovery rate, step-cov, schema-invalid, empty-content
  - Variance-band comparison: harness-r2 pin-2 anchor vs harness-r3 post-P1/P2 anchor
  - R8/R9/R10/R11/harness-r2 invariant rows
  - Recommendations for harness-r4 (or close-out if diminishing returns)
- `docs/handover/harness-r3/diary/r0-2026-05-XX.md` — engineer's per-phase diary closure with commit hashes + sweep numbers + decision rationale + canonical journey-1-bmw before/after trace excerpts.
- Memory updates after reviewer APPROVE: `MEMORY.md` + `project_react_migration_plan.md` + new `project_harness_r3.md` with harness-r3 SHIPPED narrative.

**Verifiable** (Gate 4 — process):
- Diary captures all 3 phase gate verdicts
- Baseline report has 4 runner columns + delta vs harness-r2/R11/R10
- Memory updated post-APPROVE
- All commits granular, no Co-Authored-By, no `--no-verify`

**Effort**: small (aggregation + writeup; no code).

## Wave gates / DoD

1. **P1 structural REFLECT-injection** —
   - REFLECT-injection rate ≥ 5/60 (cross-runner) on tasks with pre-fix BMW-shape patterns
   - Post-REFLECT PLAN_UPDATE rate ≥ 50% (i.e., ≥ 3/(REFLECT-injection count))
   - Post-PLAN_UPDATE recovery: ≥ 1 task observable
   - Detector specificity: 0 false-fire on healthy trajectories
   - Regression safety: gemma-react Δ ≤ 0.10 / gemini-react Δ ≤ 0.04 vs harness-r2 pin-2 anchor; empty-content 0/20; schema-invalid ≤ 5/20
   - journey-1-bmw specifically: REFLECT injected after 2nd SchemaError; subsequent envelope is PLAN_UPDATE
2. **P2 deterministic-stuck divergence** —
   - If fix landed: 2-run gemma-stack variance band Δ ≤ 0.07 (tighter than harness-r2's 0.090); 3 canonical task pairs show divergence collapse
   - If no fix landed: diary captures root-cause classification per task pair + concrete harness-r4 candidate with file pointers
3. **P3 engineer-selected hook** — gate-of-the-pick (one of three above) clears
4. **Process** — granular commits, no Co-Authored-By, no `--no-verify`, no force-push, diary captures phase evidence + commit hashes
5. **R8/R9/R10/R11/harness-r2 invariants** — empty-content 0/20, schema-invalid ≤ 5/20 across post-P3 sweep on gemma-react lane
6. **Comparability** — `wave-r5-ab.eval.ts` byte-identical to harness-r2 ship (sha `fccbddd03930a1e9f51b1357a779181d5c465f76`); harness-r3 baseline diff-comparable to R8-R11/harness-r2 history

## Risk areas

1. **Capability gap deeper than parsing** — if model receives REFLECT but still doesn't emit PLAN_UPDATE, P1 ships as detector-validated INFO and P3 pivots to oracle-plan autopsy. Already captured as risk-mitigation path.
2. **Detector false-positive on flaky observations** — e.g. transient `wait_for` timeout interpreted as SchemaError-loop. Mitigation: detector requires same `errorShape` (stable hash of error message), not any error; transient timeouts produce different shapes. Specificity gate (Gate 1.4) catches this.
3. **REFLECT injection over-triggers and turns sweep into PLAN_UPDATE-spam** — analogous to harness-r2 P3 risk. Mitigation: existing 5-cap on PLAN_UPDATE markers per run forces abort beyond cap; doom-loop detector still fires at threshold=3 SchemaErrors.
4. **P2 yields no actionable lever** — variance source irreducible at harness layer. Mitigation: P2 explicitly accepts diagnostic-only outcome; engineer surfaces and lead approves close-out.
5. **Sweep cost** — 1-2 sweeps × ~$10-15 each = ~$10-30. Within prior wave budgets (harness-r2 burned ~$54-74 total across 4 sweeps).
6. **Prompt-complement misclassified as overfitting** — the 1-line `<reflect_directive>` parsing rule is structural (parse this directive when you see it), not site-specific. Per `feedback_avoid_prompt_overfitting.md` this is reasoning-framework territory. Engineer surfaces if uncertain.
7. **Catastrophic narrowing on previously-working tasks** — even structural changes can break previously-working tasks (e.g. detector fires spuriously and disrupts a working trajectory). Distribution-form gates catch this; per-task spot-checks in the post-sweep report.

## Out of scope (harness-r4 hooks)

harness-r3 does NOT solve, harness-r4 (or close-out if diminishing returns) owns:

- **Continued harness work past P3** if P1+P2+P3 yields aggregate ≥ 0.05 step-cov lift, harness work continues. If aggregate lift < 0.05, harness-r4 is gated on a fresh ROI analysis (R12 distillation may overtake).
- **JUDGE temperature pin** if scoring variance detected post-harness-r3.
- **Bigger base model exploration** (Gemma 4 12B locally) — separate strategic wave; harness-r3 outcome informs cost-benefit.
- **Alternate teacher exploration** (Sonnet 4.6 / GPT-5 / Llama 4 70B) — orthogonal; harness-r3 outcome informs whether teacher-quality is the bottleneck.
- **PLAN_UPDATE-driven distillation** — once P1 raises emission rate, the trajectories become useful as teacher data for browsing-gemma. Folds into R12 if R12 dispatches after harness-r3.
- **Continued schema tightening** beyond AnalysisStep — `args` field schemas could tighten further (e.g. `wait_for{text:[]}` non-empty constraint). Defer until current 5/20 schema-invalid floor is understood.
- **Tool-call gap fix landed but not validated** (q9 probes pre-existing) — separate stream.

## Process invariants

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`, `Effect.fn` with descriptive spans, no `catchAll`/`mapError`/`null`/`as`-casts (per `CLAUDE.md`).
- No `Co-Authored-By` footer. Granular commits after reviewer APPROVE per `feedback_commit_guidelines.md`.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push` per `feedback_reviewer_never_stash.md`.
- Real services for live smokes per `feedback_no_test_only_injection_seams.md`. No `MockLanguageModelV4` for any A:B sweep. Unit tests use ndjson fixtures from real harness-r2 traces.
- `pnpm --filter @neuve/local-agent build` before any sweep that exercises new local-agent source per `project_eval_build_cache_trap.md`. P1 touches local-agent source — rebuild required. P2 may or may not touch local-agent (depends on lever location). P3 candidates touch shared/local-agent — rebuild as needed.
- No prompt overfitting per `feedback_avoid_prompt_overfitting.md`. The `<reflect_directive>` parsing rule is structural (parse this directive when injected), not a site-specific heuristic.
- Density+proximity per `feedback_prompt_design_for_small_models.md` for any prompt addition.
- Always read prior work in full before drafting per `feedback_always_read_prior_work.md`. Engineer reads R3 BMW v3 finding + harness-r2 P3 evidence + journey-1-bmw canonical trace before drafting detector.
- Hacking tone per `feedback_hacking_tone.md` — no day estimates, no corporate framing, effort labels or nothing.
- Distribution-form gates per `project_baseline_eval_strategy.md` — never anchor on single-sample observations.

## Team structure

`harness-r3` team with engineer + reviewer per `feedback_use_teammates.md`.

- **T1 (engineer)**: P1 + P2 + P3 + P4 — REFLECT-injection probe, divergence trace-diff, engineer-selected hook, close-out diary. Surface to lead at end of each phase with sweep numbers + commit hashes for intermediate verification (lead may dispatch reviewer mid-wave for early checkpoints if any phase regresses or if P3 candidate-selection requires lead concurrence).
- **T2 (reviewer, antagonistic, final)**: end-of-wave audit. Verify gates 1-6, spot-check journey-1-bmw before/after trace, confirm detector specificity (0 false-fire on healthy trajectories), audit the wave-harness-r3 baseline report's methodology + distribution-form gate verdicts. Apply `/strict-critique` workflow (vertical skill loading, evidence-first audit, merge-blocking severity rules). Block ship until APPROVE.

Single review at wave-end (not intermediate). Reviewer can pull individual phase commits via `git show` if needed.

## Diary location

`docs/handover/harness-r3/diary/r0-2026-05-XX.md` — engineer captures per-phase evidence (detector unit-test outputs, REFLECT-injection rate distributions, divergence trace-diff classifications, sweep wall-clocks + costs, commit SHAs, gate verdicts, journey-1-bmw before/after trace excerpts).

## Cost analysis

| Item | Estimate |
|---|---|
| P1 structural REFLECT-injection sweep (1 sweep × 20 tasks × 4 runners) | ~$10-15 (Pro 3 lane) + ~1.5 hr |
| P2 divergence trace-diff investigation | $0 (read-only); +$10-15 if fix sweep runs |
| P3 engineer-selected hook | $0 if oracle-plan autopsy (read-only); +$10-15 if AnalysisStep typing or tool dedup runs a verification sweep |
| Engineer time (3 phases of detector + investigation + hook + diary closure) | medium effort |
| **Total** | ~$20-45, ~3-5 hr sweep wall-clock, well within harness-r2's $54-74 envelope |
