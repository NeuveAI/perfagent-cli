# harness-r2 — Variance pin + stopping-criterion + PLAN_UPDATE elicitation

_Wave dispatched after R11 close-out (distillation pipeline plumbing INVESTIGATIVE-VERIFIED 2026-05-01) surfaced that browsing-gemma at -0.07 step-cov vs base-gemma is data-scarcity-bound, not pipeline-bound. R12 (locked at `33edcc91`) addresses data quality. harness-r2 attacks the orthogonal axis: surgical prompt/schema interventions that have historically yielded our highest-ROI investments (R8 6/20 → 0/20 empty-content, R9 10/20 → 2/20 schema-invalid, R10 +0.166 teacher delta — all small surgical changes with durable wins)._

## What we're building

Three surgical eval-validated interventions, each A:B-tested against a freshly-pinned variance baseline:

1. **Variance pin** — temperature audit + zero-code-change baseline that establishes a measurement floor under the current 0.07 step-cov noise band. Without this, we can't reliably measure +0.05 changes.
2. **Stopping-criterion completion-verification** — prompt addition forcing the model to verify final-state criteria before emitting RUN_COMPLETED. Targets Pro 3's 13/20 premature-completion AND gemma's drop-out-early pattern. Strategic side-effect: increases R10-style strict-pass yield (currently 2/20 from the gemini-react lane), directly unblocking R12 distillation.
3. **PLAN_UPDATE elicitation** — rewrite of the under-taught `<plan_update_protocol>` block with explicit trigger conditions, concrete `AnalysisStep` example, and tightened reflect threshold. Targets the 0/60 PLAN_UPDATE emission rate across all runners (R5 finding) — capability gap that distillation can't close (Pro 3 doesn't emit either).

Each phase is a prompt change + 1 A:B sweep against the variance-pinned baseline. No new infrastructure. No model retraining. Pure prompt/harness work.

## What we're explicitly NOT building

- **`AnalysisStep` schema typing** (`PlanUpdate.payload` is `Schema.Unknown` at `react-envelope.ts:414`) — only meaningful AFTER P3 raises emission rate above 0/60. Deferred to harness-r3.
- **Tool catalog deduplication** (`ToolName` literal union has both `interact` dispatcher AND flat `click`/`fill`/`hover`/`select` tools — duplicate names with structural ambiguity per `react-envelope.ts:373-403`). Needs investigation probe before committing to a fix path. Deferred to harness-r3.
- **Oracle-plan capability autopsy** (gemma-oracle-plan at 0.258 step-cov / 0.000 final-state — Pro 3's plans don't help gemma execute final-state). Diagnostic-only investigation; could yield separate fix candidates. Deferred to harness-r3 OR a parallel diagnostic mini-wave.
- **Alternate teachers** (Sonnet 4.6 / GPT-5 / Llama 4 70B). Cost + integration overhead; premature without first establishing whether prompt changes alone close the stopping-criterion gap.
- **Bigger base model** (Gemma 4 12B locally). Pivots scope away from harness/prompt work. Belongs in a separate strategic wave.
- **Continued distillation work** — R12 plan locked at `33edcc91` runs in parallel via separate team if/when dispatched.

## Decision log (locked)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Three-phase wave (P1 variance pin → P2 stopping-criterion → P3 PLAN_UPDATE)** | Highest-ROI signals from research surface. P1 must come first — without variance reduction, P2/P3 measurements sit inside the 0.07 noise band. |
| 2 | **Distribution-form gates per `project_baseline_eval_strategy.md`** | R10 closure proved single-sample point gates fail (R9 ≤2/20 anchor revealed as 2-5/20 actual band). All harness-r2 gates expressed as median/p90 across N≥2 zero-code-change sweeps. |
| 3 | **A:B test pattern per phase** | Each phase: pin → sweep at HEAD-pre-change → apply prompt change → sweep at HEAD-post-change. Compare distributions. Phase passes ONLY if direction-of-effect preserved with the variance-pinned floor. |
| 4 | **Pure prompt/harness work — no model retraining** | Distillation is R11+R12's territory. harness-r2 is the orthogonal axis. Commits touch `packages/shared/src/prompts.ts` and possibly `react-envelope.ts`; no `peft_train.py` or LoRA adapters. |
| 5 | **No prompt overfitting** per `feedback_avoid_prompt_overfitting.md` | Prompts teach reasoning frameworks; site-specific patterns live in distillation data. Stopping-criterion + PLAN_UPDATE protocols are reasoning-framework changes (general). No site-specific examples in prompts. |
| 6 | **wave-r5-ab as the validation seam** | Same eval used for R8/R9/R10/R11 baselines. Preserves comparability — harness-r2 baseline is comparable to R8-R11 history. `wave-r12-extended` separate file (R12 territory). |
| 7 | **Real services for live smokes** per `feedback_no_test_only_injection_seams.md` | Each phase's A:B sweep uses real Ollama (gemma-react), real Gemini Pro 3 (gemini-react), real plan decomposer. No `MockLanguageModelV4`. |

## Prior work to build on

| Source | What it provides |
|---|---|
| `packages/shared/src/prompts.ts:86-156` | `buildLocalAgentSystemPrompt` — the production system prompt for both Ollama and llama-server runtimes |
| `packages/shared/src/react-envelope.ts:411-415` | `PlanUpdate` Schema.TaggedClass with `payload: Schema.Unknown` (typed in harness-r3, not now) |
| `packages/evals/evals/wave-r5-ab.eval.ts` | 20-task A:B suite — gemma-react / gemini-react / gemma-oracle-plan / browsing-gemma-react (post-R11) lanes |
| `packages/evals/scripts/wave-r5-ab/build-report.ts` | Aggregator + delta report builder (handles 4 runner columns post-R11) |
| `docs/handover/teacher-viability/diary/r10-2026-04-30.md` lines 142-146 | R10 closure note: Pro 3 stopping-criterion problem two-shape (premature 13/20 + over-execution); the strict-filter rationale |
| `docs/handover/react-migration/diary/r3-2026-04-25.md` | BMW v3 finding: "Gemma iterates tool args 5+ times under MCP `interact` arg-shape rejection but never emits PLAN_UPDATE" — origin of the canonical PLAN_UPDATE capability gap |
| `docs/handover/schema-invalid-reconciliation/diary/r9-2026-04-30.md` | R9 surgical pattern: prompt density+proximity > section-organized clarity for small-model literal-readers; v3 catalog + Rule 1 bridge |
| `docs/handover/harness-evals/baselines/wave-r10-pro-preview.md` | R10 baseline + Resolution postscript with the variance-band table (0.307-0.372 across 3 runs) |
| `project_baseline_eval_strategy.md` | Distribution-form gate guidance (post-R10 update) |
| `project_react_migration_plan.md` | R1-R11 narrative for capability-gap context |

## Phases

### P1 — Variance pin + baseline establishment

**Goal**: pin model temperature across all runners; run 2-run zero-code-change baseline; verify the noise floor shrinks below the current 0.07 step-cov / 2-5/20 schema-invalid band.

**Touched**:
- Audit `temperature` settings:
  - `packages/local-agent/src/ollama-client.ts` — Ollama `chat()` request body. Search for `temperature`. Pin to 0 if not set.
  - `packages/evals/src/runners/gemini-react-loop.ts` — Gemini `generateObject` call. Verify `temperature: 0` is in the model config.
  - `packages/evals/src/runners/llama-server-client.ts` (post-R11) — llama-server OpenAI-compat `temperature: 0` in request payload. Verify.
  - `packages/evals/src/planning/planner-prompt.ts` — Plan decomposer (Flash 3) `temperature: 0`. Verify.
- Single granular commit if any change needed: `fix(evals): pin temperature=0 across all runners for variance reduction`. May be no-op if all already pinned.
- Run 2 zero-code-change sweeps post-pin, separated by ≥1 hour to surface time-of-day variance:
  - `EVAL_TRACE_DIR=evals/traces/wave-harness-r2-pin-1 pnpm --filter @neuve/evals eval:wave-r5-ab`
  - `EVAL_TRACE_DIR=evals/traces/wave-harness-r2-pin-2 pnpm --filter @neuve/evals eval:wave-r5-ab`
- Build comparison via `pnpm wave-r5-ab:report` for each, capture step-cov + schema-invalid counts in diary §P1.

**Verifiable** (Gate 1):
- 2-run step-cov band: median Δ ≤ 0.04 (target — half of R10's 0.07)
- 2-run schema-invalid band: max ≤ 4/20 (slight tightening from R10's 2-5/20)
- Empty-content count: 0/20 across both runs (R8 invariant intact)

**Effort**: small (audit + 2 sweeps × ~60-90 min wall-clock). Sweep cost ~$10-20 each in Pro 3 calls (gemini-react lane).

### P2 — Stopping-criterion completion-verification

**Goal**: add a `<completion_check>` block to `buildLocalAgentSystemPrompt` AND `buildExecutionSystemPrompt` requiring the model to emit a per-step `STEP_DONE`-or-`ASSERTION_FAILED` audit before emitting `RUN_COMPLETED`. Targets premature-completion (Pro 3 13/20) and over-execution (Pro 3 calibration-2 type — runs to MAX_TOOL_ROUNDS past success).

**Touched**:
- `packages/shared/src/prompts.ts` — add new `<completion_check>` block before `<rules>` in both `buildLocalAgentSystemPrompt` and `buildExecutionSystemPrompt`. Content (proposed; engineer refines):
  ```
  <completion_check>
  Before RUN_COMPLETED|passed: emit STEP_DONE for every plan step that's still pending — verify each one's success criteria is satisfied by the most recent observation. If any plan step's criteria are unsatisfied, EITHER continue executing OR emit ASSERTION_FAILED with category=abort.
  Before RUN_COMPLETED|failed: emit ASSERTION_FAILED with concrete evidence for the failing plan step. Do not emit RUN_COMPLETED|failed without a preceding ASSERTION_FAILED on the unsatisfied step.
  Once all plan steps reach a terminal status (STEP_DONE or ASSERTION_FAILED), the run is complete — emit RUN_COMPLETED|passed (all STEP_DONE) or RUN_COMPLETED|failed (any ASSERTION_FAILED) and stop. Do not emit additional ACTION envelopes after RUN_COMPLETED.
  </completion_check>
  ```
- Update `<rules>` block to remove the now-redundant single-line completion rule.
- Single granular commit: `feat(prompts): completion-verification block before RUN_COMPLETED for stopping-criterion fix`.
- Run 1 sweep post-change:
  - `EVAL_TRACE_DIR=evals/traces/wave-harness-r2-stopping pnpm --filter @neuve/evals eval:wave-r5-ab`
- Categorize each gemini-react + gemma-react run by stopping-shape:
  - **Premature**: RUN_COMPLETED:passed AND finalState < 1.0 (pre-fix Pro 3 = 13/20)
  - **Over-execution**: RUN_COMPLETED:passed AND finalState == 1.0 AND step-coverage > 1.0 (impossible per current scoring; treat as MAX_TOOL_ROUNDS-without-completion-after-all-STEP_DONEs)
  - **Honest pass**: RUN_COMPLETED:passed AND finalState == 1.0 AND step-coverage == 1.0 (R10 strict-pass criterion)
  - **Honest abort**: RUN_COMPLETED:failed with ASSERTION_FAILED preceding
- Capture distributions in diary §P2.

**Verifiable** (Gate 2):
- **Premature-completion drop**: median Pro 3 premature count drops by ≥ 3/20 from pre-fix baseline (so 13/20 → ≤10/20). Gemma drop also tracked but less load-bearing.
- **Strict-pass count rise**: median gemini-react strict-pass count rises from 2/20 → ≥ 5/20. **Strategic gate** — directly grows R12 teacher dataset.
- **Regression safety**: gemma-react step-cov within P1 variance-pinned band (no negative direction-of-effect; harness change is above the gemma path so should be neutral or positive).
- **Over-execution drop**: at least 1 of (calibration-2, moderate-2) Pro 3 traces no longer hits MAX_TOOL_ROUNDS past success (qualitative spot-check; not a hard gate).

**Risk**: prompt addition might make abort harder if model interprets "verify each plan step's success criteria" as license to retry indefinitely. Mitigation: explicit "OR emit ASSERTION_FAILED with category=abort" branch in the prompt.

**Effort**: small (prompt addition + 1 sweep × ~60-90 min wall-clock + sweep cost ~$10-20).

### P3 — PLAN_UPDATE elicitation rewrite

**Goal**: rewrite `<plan_update_protocol>` in both system prompts with explicit trigger conditions, a concrete `AnalysisStep` shape example, and a tightened reflect threshold. Targets the 0/60 PLAN_UPDATE emission rate.

**Touched**:
- `packages/shared/src/prompts.ts` — replace the existing 4-line `<plan_update_protocol>` and adjacent `<reflect_trigger>` with denser content (proposed; engineer refines following R9's density+proximity principle):
  ```
  <plan_update_protocol>
  Emit PLAN_UPDATE when the current plan no longer reflects what you've learned from observations. Concrete triggers:
  - The current step's tool keeps rejecting your args after retry (the args are right but the step is wrong) — emit `replace` with a corrected step.
  - You discovered a missing prerequisite step (e.g. login required before checkout) — emit `insert` with the prerequisite step before the current one.
  - The current step is now redundant (a side-effect of an earlier action already accomplished it) — emit `remove`.
  AnalysisStep shape: { id: "<step-id>", title: "<short-imperative>", instruction: "<what-to-do>", expectedOutcome: "<what-success-looks-like>" }.
  Example: PLAN_UPDATE { "_tag":"PLAN_UPDATE","stepId":"step-3","action":"insert","payload":{"id":"step-3a","title":"Accept cookie banner","instruction":"Click the cookie-banner accept button before proceeding","expectedOutcome":"Banner removed; subsequent clicks reach intended targets"} }
  Cap: 5 PLAN_UPDATE markers per run. Beyond that, abort.
  </plan_update_protocol>
  
  <reflect_trigger>
  After 1 ASSERTION_FAILED on the same stepId, the next observation contains a REFLECT directive — read it and emit PLAN_UPDATE before retrying the action. Two ASSERTION_FAILEDs without an intervening PLAN_UPDATE force abort.
  </reflect_trigger>
  ```
- Single granular commit: `feat(prompts): PLAN_UPDATE elicitation rewrite — explicit trigger + AnalysisStep example + tightened reflect threshold`.
- Run 1 sweep post-change:
  - `EVAL_TRACE_DIR=evals/traces/wave-harness-r2-plan-update pnpm --filter @neuve/evals eval:wave-r5-ab`
- Categorize each run by PLAN_UPDATE behavior:
  - **Emitted PLAN_UPDATE**: at least one PLAN_UPDATE envelope in the trace
  - **Recovery via PLAN_UPDATE**: PLAN_UPDATE was followed by a successful step that the original plan didn't have
  - **Stuck-loop avoidance**: tasks that pre-fix hit MAX_TOOL_ROUNDS but post-fix recovered via PLAN_UPDATE
- Capture distributions in diary §P3.

**Verifiable** (Gate 3):
- **PLAN_UPDATE emission rate**: median ≥ 5/60 across all 3 runners on the wave-r5-ab task suite (currently 0/60).
- **Recovery signal**: at least 2 tasks across the sweep show post-PLAN_UPDATE successful step execution (qualitative; trace inspection).
- **Reflect-trigger tightening**: median 1-fail-then-PLAN_UPDATE pattern observed at least 3x across the sweep.
- **Regression safety**: step-cov within P2 variance-pinned band; no negative direction-of-effect.

**Risk**: tighter reflect threshold (2 → 1 ASSERTION_FAILED) might over-trigger PLAN_UPDATE on transient noise (e.g. flaky observation). Mitigation: monitor PLAN_UPDATE count distribution; if median > 5/run, the cap kicks in and forces abort, which is the designed safety net.

**Effort**: small (prompt rewrite + 1 sweep × ~60-90 min wall-clock + sweep cost ~$10-20).

### P4 — Wave close-out + comparison report

**Goal**: aggregate P1+P2+P3 results into a wave-harness-r2 baseline document. Surface gate verdicts. Capture lessons for harness-r3 hooks.

**Touched**:
- `docs/handover/harness-evals/baselines/wave-harness-r2.md` — auto-generated via existing `pnpm wave-r5-ab:report` against the post-P3 trace dir, then hand-augmented with:
  - Per-phase gate verdicts (Gate 1, 2, 3)
  - Pre-vs-post-fix delta tables for premature-completion, strict-pass count, PLAN_UPDATE emission rate
  - Variance-band comparison (R10 0.307-0.372 vs harness-r2 pinned band)
  - R8/R9/R10/R11 invariant rows (empty-content, schema-invalid)
  - Recommendations for harness-r3 (deferred AnalysisStep typing, tool catalog dedup, oracle-plan autopsy)
- `docs/handover/harness-r2/diary/r0-2026-05-01.md` (or appropriate date) — engineer's per-phase diary closure with commit hashes + sweep numbers + decision rationale.
- Memory updates after reviewer APPROVE: `MEMORY.md` + `project_react_migration_plan.md` with harness-r2 SHIPPED narrative (similar shape to R8/R9/R10 entries).

**Verifiable** (Gate 4 — process):
- Diary captures all 3 phase gate verdicts
- Baseline report has 4 runner columns + delta vs R10/R11
- Memory updated post-APPROVE
- All commits granular, no Co-Authored-By, no `--no-verify`

**Effort**: small (aggregation + writeup; no code).

## Wave gates / DoD

1. **P1 variance pin** — 2-run zero-code-change band median Δ step-cov ≤ 0.04 AND max schema-invalid ≤ 4/20 AND empty-content 0/20.
2. **P2 stopping-criterion** — Pro 3 premature-completion drops by ≥ 3/20 AND gemini-react strict-pass count rises to ≥ 5/20 AND gemma-react step-cov within P1 variance-pinned band.
3. **P3 PLAN_UPDATE elicitation** — emission rate rises to ≥ 5/60 across runners AND at least 2 tasks show post-PLAN_UPDATE recovery AND step-cov within P1 variance-pinned band.
4. **Process** — granular commits, no Co-Authored-By, no `--no-verify`, no force-push, diary captures phase evidence + commit hashes.
5. **R8/R9/R10/R11 invariants** — empty-content 0/20, schema-invalid ≤ 5/20 across post-P3 sweep on gemma-react lane.
6. **Comparability** — `wave-r5-ab.eval.ts` byte-identical to R11-shipped; harness-r2 baseline diff-comparable to R8-R11 history.

## Risk areas

1. **Variance pin might already be in place** — if all runners are already `temperature: 0`, P1 is no-op and the noise band is genuinely 0.07. Mitigation: P1 audit captures current state + proceeds to P2/P3 even if no pin needed; the 2-run baseline establishes the floor regardless.
2. **P2 prompt change might over-tighten and cause runs to hang** — if model interprets "verify each plan step" as license to retry indefinitely, sweep wall-clock balloons. Mitigation: explicit abort branch in prompt; sweep timeout per task; engineer surfaces if any task exceeds 10 min wall-clock.
3. **P3 prompt change might over-trigger PLAN_UPDATE** — tighter reflect threshold (2→1 ASSERTION_FAILED) on transient noise could spam PLAN_UPDATE. Mitigation: 5-cap is the safety net; monitor distribution.
4. **Gemini Pro 3 might react differently to P2/P3 than gemma** — these prompts are read by both runners. Pro 3's reasoning capacity might let it correctly verify; gemma's smaller context might not. A:B sweep surfaces per-runner deltas explicitly.
5. **Catastrophic narrowing in unexpected places** — even prompt-only changes can break previously-working tasks (e.g. if completion-check makes calibration-1 over-cautious). Distribution-form gates catch this; per-task spot-checks in the post-sweep report.
6. **Sweep cost** — 3 sweeps × ~$15 each = ~$45 in Pro 3 calls. Within prior wave budgets ($30-60 plan; R10 burned $17-25, R11 burned ~$8-15 for the partial sweep).
7. **Variance pin can hide capability gaps** — pinning temperature reduces flake but also reduces the natural diversity that surfaces edge cases. Tradeoff accepted for measurement reliability; harness-r3 can revisit.

## Out of scope (harness-r3 hooks)

harness-r2 does NOT solve, harness-r3 (or parallel diagnostic mini-wave) owns:
- `AnalysisStep` schema typing (`PlanUpdate.payload` from `Schema.Unknown` to typed). Only meaningful AFTER P3 raises emission rate above 0/60.
- Tool catalog deduplication — investigation probe whether `interact.command="click"` AND flat `click` tool are both used at runtime; if not, drop one to reduce schema branches.
- Oracle-plan capability autopsy — gemma-oracle-plan at 0.000 final-state with Pro 3's plans; trace inspection to identify why a perfect plan doesn't help gemma execute.
- Alternate teacher exploration (Sonnet 4.6 / GPT-5 / Llama 4 70B) — only after stopping-criterion + PLAN_UPDATE wins are quantified; cost-benefit math depends on what harness-r2 leaves on the table.
- Bigger base model exploration (Gemma 4 12B locally) — separate strategic wave if harness-r2 + R12 don't deliver sufficient lift.
- PLAN_UPDATE-driven distillation — once emission rate rises (P3), the trajectories become useful as teacher data for browsing-gemma. Folds into R12 if R12 dispatches after harness-r2.
- Continued schema tightening — `args` field schemas could be tightened further (e.g. `wait_for{text:[]}` non-empty constraint). Defer until current 2-5/20 schema-invalid floor is understood.

## Process invariants

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`, `Effect.fn` with descriptive spans, no `catchAll`/`mapError`/`null`/`as`-casts (per `CLAUDE.md`).
- No `Co-Authored-By` footer. Granular commits after reviewer APPROVE per `feedback_commit_guidelines.md`.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push` per `feedback_reviewer_never_stash.md`.
- Real services for live smokes per `feedback_no_test_only_injection_seams.md`. No `MockLanguageModelV4` for any A:B sweep.
- `pnpm --filter @neuve/local-agent build` before any sweep that exercises new local-agent source per `project_eval_build_cache_trap.md`. P1 likely no-op; P2/P3 are prompt-only (in `@neuve/shared`) so local-agent rebuild may still be needed if shared is consumed by it.
- No prompt overfitting per `feedback_avoid_prompt_overfitting.md`. Stopping-criterion + PLAN_UPDATE protocols are reasoning-framework changes (general), not site-specific patterns. NO github.com / vercel.com / any specific-site language in prompts.
- Always read prior work in full before drafting new sub-plans per `feedback_always_read_prior_work.md`. Engineer reads R3 BMW finding + R10 closure + R9 v3 catalog evidence + R8 empty-content fix narrative before drafting prompt changes.
- Hacking tone per `feedback_hacking_tone.md` — no day estimates, no corporate framing, effort labels or nothing.
- Distribution-form gates per `project_baseline_eval_strategy.md` — never anchor on single-sample observations.

## Team structure

`harness-r2` team with engineer + reviewer per `feedback_use_teammates.md`.

- **T1 (engineer)**: P1 + P2 + P3 + P4 — variance pin, stopping-criterion fix, PLAN_UPDATE elicitation, close-out diary. Surface to lead at end of each phase with sweep numbers + commit hashes for intermediate verification (lead may dispatch reviewer mid-wave for early checkpoints if any phase regresses).
- **T2 (reviewer, antagonistic, final)**: end-of-wave audit. Verify gates 1-6, spot-check per-task delta tables, confirm no test-only seams, audit the wave-harness-r2 baseline report's methodology + distribution-form gate verdicts. Apply `/strict-critique` workflow (vertical skill loading, evidence-first audit, merge-blocking severity rules per skill spec). Block ship until APPROVE.

Single review at wave-end (not intermediate) — phases are bounded prompt changes with eval-validated DoD; intermediate review adds friction without proportional safety. Reviewer can pull individual phase commits via `git show` if needed.

## Diary location

`docs/handover/harness-r2/diary/r0-2026-05-01.md` — engineer captures per-phase evidence (variance-pinned baseline numbers, prompt diff + before/after delta tables, sweep wall-clocks + costs, commit SHAs, gate verdicts).

## Cost analysis

| Item | Estimate |
|---|---|
| P1 variance baseline (2 sweeps × 20 tasks × 3 runners) | ~$20-30 (Pro 3 lane) + ~3 hr wall-clock |
| P2 stopping-criterion sweep (1 sweep × 20 tasks × 3 runners) | ~$10-15 + ~1.5 hr |
| P3 PLAN_UPDATE sweep (1 sweep × 20 tasks × 3 runners) | ~$10-15 + ~1.5 hr |
| Engineer time (3 phases of prompt work + diary closure) | small-to-medium effort |
| **Total** | ~$40-60, ~6 hr sweep wall-clock, well within R10's $17-25/sweep envelope and the $30-60/wave budget |

If P1 variance pin is no-op (all already pinned), P1 cost drops to a single re-run (~$10-15) and the 2-run band is established from existing R10 traces.
