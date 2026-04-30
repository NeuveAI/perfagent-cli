# R12 — Distillation pipeline data quality + capability lift

_Wave dispatched after R11 (pipeline plumbing) ships the end-to-end automation. R11 proves bytes-flow-through-without-breaking-gemma; R12 owns the actual capability lift — the LoRA does something useful. Where R11 was a 2-trace floor-only proof, R12 is the data-and-training-quality wave that makes `browsing-gemma` measurably better than `base-gemma`._

## What we're building

A bigger, cleaner training corpus + a defensible LoRA hyperparameter pick + a capability-lift gate the LoRA actually clears. Concretely: grow the strict-pass dataset from R10's 2/20 floor up to ≥ Wave-5's 15/5-task minimum threshold (engineer-documented in `docs/handover/harness-evals/diary/wave-5-distillation.md:233`), train under at least 9 hyperparameter configurations against a held-out comparison set, blend in off-task chat data to head off catastrophic narrowing, and ship a `browsing-gemma-react` lane that beats `gemma-react` on full wave-r5-ab by at least the noise band.

R12 ships behavioral lift. R11's gate 8 was "no significant regression vs base-gemma" (≥ −0.05 step-cov). R12's headline gate is `median Δstep-cov ≥ +0.10` across N≥2 zero-code-change sweeps **measured on the original 20-task `wave-r5-ab.eval.ts`** (R10/R11-comparable baseline) — distribution-form, not single-sample anchor. R11's floor stays in force as a conjunctive safety net (ships only if both hold). Dataset target: 50 traces, ship floor: 30. Two eval entry points serve two distinct purposes: `wave-r12-extended.eval.ts` for teacher capture (30 tasks: 20 original + 10 new Pro-friendly), `wave-r5-ab.eval.ts` for capability-lift validation (20 original, bit-identical to R11).

## What we're explicitly NOT building

- **Production hosting beyond local Ollama.** Vertex/Cloud Run/Modal serving deferred to R13. The browsing-gemma adapter ships as a local Modelfile + GGUF + Ollama tag, same shape as R11's deployment seam.
- **Vision/audio Gemma 4 modalities.** The R10 trace corpus is text+SOM only; image-token + audio-token training requires a different teacher capture path. R13 conditional.
- **Multi-task distillation beyond `wave-r5-ab` task set.** The LoRA learns to be better at the same 20-task harness (plus the new R12 task additions). Cross-domain generalization (BFCL function-calling, WebVoyager, Online-Mind2Web) is R13.
- **DPO / GRPO / RLAIF / preference learning.** SFT-only. Preference-pair construction needs paired good/bad trajectories per task; we don't have them yet.
- **Path A native `<|tool_call>` token format migration.** Same status as R11 — Path B (grammar-override JSON envelope) stays the production format. Path A is R13 conditional on Ollama upstream parser fix.
- **Capability lift over Gemini Pro 3 (the teacher).** WebLlama beat its frontier teacher on out-of-domain (Llama-3-8B-Web vs GPT-4V on WebLINX, +18.3 absolute), but that took 100K+ trajectories. With our 30-100 trace dataset, matching Pro 3 (`browsing-gemma step-cov ≥ Pro 3 step-cov`) is a stretch outcome, not a gate.
- **New eval harness scorers or new sites.** R12 reuses the existing wave-r5-ab harness + scorers + KeyNode/finalState assertions. New tasks in P2 follow the existing `EvalTask` schema (`packages/evals/src/task.ts:25`).

## Decision log (locked)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Multi-sweep capture is viable** (RQ1 verified via existing traces) | Sampled Pro 3's `gemini-react__trivial-1`, `journey-2`, `journey-7` etc. across 4 trace dirs (`wave-r10-pro-preview`, `wave-r10-postflip-partial`, `wave-r10-postflip-smoke`, `wave-r10-smoke-pro`) — same task across runs produces materially different trajectories. trivial-1 had 2/2/3/4 tool calls across 4 runs with different command sequences (snapshot vs evaluate); journey-2 ran 5 vs 15 tool calls; journey-7 ran 3 vs 15. Pro 3 is non-deterministic enough on the same task that sweep N=3-5 produces independent training samples. Multi-sweep capture is the primary lever. |
| 2 | **Trajectory cleanup partial-recovery only** (RQ2 verified) | Inspecting R10 traces: the FAIL-cov=1.0 cases (`calibration-2`, `journey-8`) are over-execution and ARE recoverable via "truncate at last STEP_DONE." The OK-cov=1.0-finalState=0 cases (`trivial-2`, `journey-6`) are premature completion — cov=1.0 but finalState scorer disagrees post-RUN_COMPLETED — NOT recoverable via truncation alone (would need replay). Incomplete-coverage cases (`moderate-1` 0.33, `moderate-2` 0.33, `calibration-3` 0.5) are fundamentally incomplete and not recoverable. Cleanup yields ~+2 traces per sweep on R10 shape; primary growth is multi-sweep, secondary is cleanup. |
| 3 | **New small-shape task set targets single-leg navigation + DOM-confirm** (RQ3) | The task shapes Pro 3 reliably finalState=1.0-passes are trivial-1 / calibration-1 — single navigation + assertion. Multi-leg journey-* tasks trip the two-shape stopping problem (premature OR over-execution). New tasks follow the trivial-1 mold: one URL, one DOM target, one RUN_COMPLETED gate. |
| 4 | **UltraChat 200k SFT split as off-task replay data** (RQ4) | HuggingFaceH4/ultrachat_200k (`https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k`) — 207,865 multi-turn chat samples in OpenAI-shape JSONL, MIT license, used to train Zephyr-7B-β. Schema matches our `TrainingSample` (messages array with role+content). Sample 200-500 random conversations as the off-task replay set; final blend ratio chosen from the hyperparam sweep (anchor: 25% off-task per the LoRA-Learns-Less-and-Forgets-Less arXiv:2405.09673 community signal). |
| 5 | **Hyperparam matrix: full grid 81 (3×3×3×3 with blend ratio as 4th axis); Latin-9 holds blend at 0.25 anchor; Bayesian narrow on top-3 varies blend** (RQ5; corrected per critic round 1) | rank ∈ {8, 16, 32}, epochs ∈ {1, 2, 3}, lr ∈ {5e-5, 1e-4, 5e-4}, blend ∈ {0.10, 0.25, 0.50} = 81 full-grid configs. Per Thinking Machines "LoRA Without Regret" (`https://thinkingmachines.ai/blog/lora/`): LoRA optimal LR is ~10× full-FT LR (so 1e-4 to 5e-4 dominates), apply LoRA to ALL layers (not attention-only), batch size <32, single-epoch usually enough on tiny data. Our 5e-5 is the conservative anchor R11 ships under; R12 sweeps both directions. The Latin-square 9-config first sweep holds blend ratio FIXED at 0.25 (Decision 11 anchor) — varies rank × epochs × lr balanced one-axis-at-a-time. Bayesian narrow on top-3 then varies blend to characterize the rank/epoch/lr × blend interaction near the winners. Skip the full 81-config grid (and the 27-config grid that ignores the blend axis). |
| 6 | **Vertex defer until dataset > ~500 samples** (RQ6) | At R12 scale (50-100 traces × 3 epochs), MLX-LM on M4 finishes a single config in ~2-5 minutes; Vertex provisioning alone ($21.25/h base node + $2.93/h A100) eats 3+ minutes before training begins. 9-config Latin-square × 5 min = 45 min on M4 = $0. Same on Vertex = ~$5-10 plus 30 min provisioning overhead. Vertex flips to economical only when training time per config > ~30 min, which happens at dataset > ~500 samples or when 27-config full sweep parallelizes (Vertex can run all 27 in parallel; M4 serializes). R12 stays MLX-LM. The $300 GCP free trial credit (`https://cloud.google.com/free` — confirmed valid for new accounts April 2026) is an option for R13 if dataset crosses the threshold. |
| 7 | **Capability-lift gate: MID (+0.10 step-cov over base-gemma), distribution-form** (RQ7 + lead directive 1) | Floor (+0.05) is below R7-phase-7's documented 0.07 step-cov noise band — indistinguishable from variance. Mid (+0.10) just clears noise + matches what WebLlama achieved on out-of-domain WebLINX with 100K traces (their abs-delta scaled to our metric). Stretch (≥ Pro 3) is unrealistic at 30-100 traces — student-beats-teacher requires order-of-magnitude more data than we have. Mid is the actually-meaningful, actually-achievable bar. **Gate form (per lead directive 2026-04-30, anchored on `project_baseline_eval_strategy.md` "don't anchor wave gates on single-sample observations")**: `median Δstep-cov ≥ +0.10 across N≥2 zero-code-change sweeps, with R10's 2-5/20 schema-invalid band as the variance-floor reference.` Same-run-pair design (each sweep runs all four lanes — gemma-react, gemini-react, gemma-oracle-plan, browsing-gemma-react — against the same task set on the same day) controls for sweep-day environmental drift (rate-limiting, caching, time-of-day). |
| 8 | **R11 floor + R12 mid-gate apply as conjunction** (lead directive 2026-04-30) | R12 ships only if BOTH gates hold simultaneously: (a) R11 floor `median(browsing-gemma step-cov) ≥ median(base-gemma step-cov) − 0.05` across N≥2 sweeps (catches catastrophic narrowing — browsing-gemma lifts step-cov on some tasks but tails-abort on others, net delta could be positive while real capability regressed); AND (b) R12 mid-gate `median Δstep-cov ≥ +0.10` across the same N≥2 sweeps (lift target). Floor is the safety net, mid-gate is the lift target. Distribution-form on both. |
| 9 | **Same-codebase same-prompt invariant** (per `feedback_avoid_prompt_overfitting.md`) | The LoRA learns from teacher trajectories; the production system prompt (`buildLocalAgentSystemPrompt()`) does NOT change in R12. browsing-gemma must emit production-shaped envelopes against the production prompt. No prompt rewrites for "what makes the LoRA happy." Site patterns live in trajectory data. |
| 10 | **Dataset target: 50 traces target, 30 traces floor** (lead directive 2026-04-30) | 3× Wave 5 engineer's 15/5-task minimum (`docs/handover/harness-evals/diary/wave-5-distillation.md:233`). Explicitly small-data regime — the whole point of small-LM distillation is sample efficiency. R12 ships if dataset reaches the 30-trace floor; 50 is the target where the +0.10 mid-gate becomes plausibly defensible. P1 multi-sweep + P2 new-task additions + P3 cleanup recovery target the 50; lead authorizes ship at 30 if the gate holds. |
| 11 | **Off-task blend ratio: 25% anchor with 10%/50% in matrix** (lead directive 2026-04-30) | Anchor at 25% (LoRA-Learns-Less-and-Forgets-Less community signal). Hyperparam matrix carries 10% (less narrowing protection, frees training-token budget) and 50% (heavier protection, slower task-specialization) as additional configs to characterize the trade-off curve. P5 reports per-blend step-cov delta; winning config picks the empirically-best blend, not the anchor. |
| 12 | **Hyperparam sweep: Latin-9 (blend held at 0.25) + Bayesian narrow on top-3 (blend varies)** (lead directive 2026-04-30; corrected per critic round 1) | Stop at the 9-config Latin-square balanced over rank × epochs × lr (blend held FIXED at 0.25 anchor). Engineer surfaces top-3 to lead; lead authorizes a Bayesian narrow (~6-9 additional configs centered on top-3 with blend ∈ {0.10, 0.50} swept to characterize the blend-axis effect at the winning rank/epoch/lr neighborhoods). Skip the full 81-config grid. |
| 13 | **Trajectory cleanup: bounded synthesis + per-record provenance** (lead directive 2026-04-30) | P3's `truncateAtLastStepDone` is authorized with three locked constraints: **(a)** truncate only at honest STEP_DONE boundaries — never fabricate STEP_DONE markers; **(b)** synthesize `RUN_COMPLETED:passed` only when the truncated trace's STEP_DONE set covers ALL KeyNodes from the source `EvalTask` (`packages/evals/src/task.ts:25` `EvalTask.keyNodes`); when STEP_DONE coverage is partial, the trace is rejected (no synthesis); **(c)** every emitted `TrainingSample` derived from a synthesized RUN_COMPLETED carries `metadata._synthesized: true` AND `metadata._origin: "trajectory-cleanup-v1"` so we can A/B-train with-vs-without and reviewer can audit which samples were derived. Annotation-on-the-marker alone (the original P3 plan) was not enough — synthesis must be bounded by the source EvalTask's KeyNode definition. |
| 14 | **Eval seam split: `wave-r12-extended` for TEACHER CAPTURE, `wave-r5-ab` for CAPABILITY-LIFT VALIDATION** (lead directive 2026-04-30; revised per critic round 1, item #1 critical) | Two distinct eval entry points serve two distinct purposes — never confused. (a) **Teacher capture (`wave-r12-extended.eval.ts`)**: the 30-task union (20 original + 10 new Pro-friendly) is where Pro 3 runs to PRODUCE clean strict-pass training trajectories. The 10 new tasks exist specifically to feed teacher capture with Pro-friendly shapes. (b) **Capability-lift validation (`wave-r5-ab.eval.ts`)**: the original 20-task harness, BIT-IDENTICAL to R11's shipped version, is where the LoRA's lift over base-gemma is measured. Validation on the original 20 tasks is the held-out signal — the LoRA was trained on Pro traces from `wave-r12-extended` (which includes those 20 + the 10 new), but capability-lift validation against `wave-r5-ab` (the 20 only) measures generalization rather than circular validation. **Validation does NOT run on the new-task subset alone** — that would be circular (LoRA trained on Pro traces from those new tasks AND validated on them). Optional informational metric on the new-task-subset-only is allowed in the report (no ship-gate, no go/no-go decision). |
| 15 | **Validation comparability over reach: PRIMARY gate on `wave-r5-ab` (original 20)** (critic round 1, item #1) | The R12 mid-gate + R11-floor conjunction (Decision 7+8) is measured on `wave-r5-ab` exclusively — same harness as R10 and R11 baselines, same 20 tasks. This preserves three-way comparability: R10 (Pro 3 teacher viability), R11 (no-regression floor), R12 (lift). The held-out-from-training-data property holds because Pro traces drove training but those Pro traces were captured against the SAME 20 tasks plus 10 new ones — the 20 alone are not held-out in the strict sense, but the comparability-of-baselines property dominates. Secondary informational metric on the 10-new-task subset of `wave-r12-extended` may appear in the baseline report under "Exploratory transfer signal" but does not influence ship/no-ship. |

## Prior work to build on

| Source | What it provides |
|---|---|
| R11 — `packages/evals/scripts/distill/{export-teacher-data,build-modelfile,smoke-finetune,train,convert-gguf}.ts` | Full pipeline plumbing: export → train → convert → Modelfile → ollama create. All five CLI surfaces wired and smoke-tested. R12 calls them as primitives, doesn't reimplement. |
| R11 — `packages/evals/src/distill/filters.ts:isTraceStrictlyClean` | Strict filter (`finalState==1.0 AND stepCoverage==1.0 AND status=passed`). R12 uses verbatim. **Naming note (per critic round 1, item #3)**: R11 P2 implementation kept `isTraceSuccessful` untouched (Wave 5 backward compat — 22 prior tests pass) and added `isTraceStrictlyClean(events, sidecar)` as a sibling function, NOT a rename of the original. The R11 plan said "extend `isTraceSuccessful`" which the implementation reified as the sibling-function pattern instead. R12 builds on the new strict function. R11 plan text stays as-is (historical record). |
| R11 — `wave-r11-browsing-gemma.md` baseline report | Aggregator handles the 4-runner column shape (gemma-react, gemini-react, gemma-oracle-plan, browsing-gemma-react). R12 swaps adapter inputs, runs same aggregator. |
| R10 — `evals/traces/wave-r10-pro-preview/` | 60 existing traces. Pro 3 lane: 20 traces for first sweep round of multi-sweep capture (Sweep 0). |
| R10 — `evals/traces/wave-r10-postflip-{partial,smoke}/` | Existing additional Pro 3 runs on overlapping tasks — already-captured Sweep 1 fragments for trivial-1 / calibration-1 / calibration-2 / journey-2 / journey-7. R12 P1 Sweep 1 only captures the 15 tasks NOT in the postflip-partial set. |
| R10 closure note (`docs/handover/teacher-viability/diary/r10-2026-04-30.md` lines 142-147) | The two-shape stopping problem characterization → drives P3 cleanup heuristics. |
| R10 baseline (`docs/handover/harness-evals/baselines/wave-r10-pro-preview.md`) | Per-task win/tie/loss table — feeds P2's task-shape classification (which tasks Pro reliably finalState=1.0-passes vs which trip the two-shape problem). |
| Wave 5 — `packages/evals/src/distill/teacher-data-exporter.ts` | OpenAI-chat JSONL emitter with redaction + dedup (sha256 per canonical `(role, content, toolCall name+args, toolCallId)` tuple). R12 multi-sweep dataset will dedupe automatically — same-trajectory re-captures collapse to one sample. |
| Wave 5 diary line 233 (`docs/handover/harness-evals/diary/wave-5-distillation.md:233`) | Engineer's "≥15 successful traces across ≥5 distinct tasks" minimum threshold. R12 P1 + P2 target this. |
| Architecture PRD §9 (`docs/research/gemma-react-browsing/architecture-prd.md` line 198) | "Distillation: ReAct trajectories via Gemini-react runner → JSONL teacher data for `browsing-gemma` LoRA. AgentTrek/WebLlama pattern proven at 7B-8B." Locked design pattern. |
| Research-brief Theme 2 (`docs/research/gemma-react-browsing/research-brief.md` lines 69-77) | WebLlama (Llama-3-8B-Web): 18.3% absolute lift vs GPT-4V on WebLINX out-of-domain — small-model-trained-on-trajectories beats frontier zero-shot. AutoWebGLM curriculum staging (single-step → multi-step → long-horizon → RL) is the curriculum reference. |
| Thinking Machines "LoRA Without Regret" (`https://thinkingmachines.ai/blog/lora/`) | Hyperparam guidance synthesized into Decision 5: apply to all layers, LoRA LR = 10× full-FT LR, batch size <32, single-epoch usually fine. |
| `feedback_avoid_prompt_overfitting.md` | Distillation = where site patterns live. R12 prompt is the production prompt, unchanged. |
| `project_baseline_eval_strategy.md` (2026-04-30 update) | Distribution gates not point gates; multi-sample variance check. R12 D8 follows this directly. |

## Phases

### P1 — Multi-sweep teacher capture (Pro 3, N=3 sweeps × 20 tasks)

**Goal**: Grow the strict-pass dataset by re-capturing R10's Pro 3 lane two more times. Pro 3 is non-deterministic on the same task (Decision 1 verified) — independent runs produce independent strict-pass candidates. Sweep 0 is R10's existing capture; Sweep 1 + Sweep 2 are R12 work.

**Touched**:
- New trace dir `evals/traces/wave-r12-pro-sweep-{1,2}/` — 20 gemini-react traces each via the existing eval harness (R11's eval-runner browsing-gemma lane is irrelevant to capture; we're hitting Pro 3, not running browsing-gemma). Existing command shape:
  ```
  EVAL_R5_SKIP_RUNNERS=gemma-react,gemma-oracle-plan,browsing-gemma-react \
  EVAL_TRACE_DIR=evals/traces/wave-r12-pro-sweep-1 \
  pnpm --filter @neuve/evals eval:wave-r5-ab
  ```
- Sidecar score files (`<runner>__<taskId>.scores.json`) emitted by R11 P2's seam — existing, no new code. (R11 P2 chose the seam that emits sidecars for every eval run; R12 inherits.)
- `packages/evals/scripts/distill/aggregate-sweeps.ts` — NEW Effect script that reads N sweep dirs + their sidecars, emits per-task `{ sweepIndex, status, finalState, stepCoverage }` rollup, drives downstream cleanup + export.
- `packages/evals/tests/aggregate-sweeps.test.ts` — unit test on synthetic 3-sweep input asserting the rollup shape; live smoke against `wave-r10-pro-preview` + `wave-r12-pro-sweep-1` + `wave-r12-pro-sweep-2` once captured (`it.skipIf` when sweep dirs absent).

**Sweep 1 + Sweep 2 cost estimate**: R10 sweep cost ~$17-25 for 20 gemini-react traces. ×2 sweeps = $35-50. Comfortably within the lead-authorized R10 budget headroom.

**DoD — Behavior**:
- After P1 completes, `evals/traces/wave-r12-pro-sweep-1/` and `wave-r12-pro-sweep-2/` each contain 20 `gemini-react__*.ndjson` files plus matching `*.scores.json` sidecars.
- Running `pnpm --filter @neuve/evals distill:aggregate-sweeps EVAL_SWEEP_DIRS=wave-r10-pro-preview,wave-r12-pro-sweep-1,wave-r12-pro-sweep-2` emits a per-task table reporting how many of the N=3 sweeps produced `status==passed AND finalState==1.0 AND stepCoverage==1.0`.
- Running `distill:export` against the union of three sweep dirs (with sidecars) accepts ≥ 6 strict-pass traces (R10 baseline 2 × ~3 if multi-sweep upper-bound holds; lower-bound 3 if heavy overlap). Multi-sweep dataset growth is the verifiable behavior.

**Effort**: medium. Sweep wall-clock ~4 hours (2× R10 sweep at 2 hr each). Aggregate script + test is small. Cost is the main constraint.

### P2 — New small-shape task additions (10 new EvalTasks where Pro reliably hits finalState=1.0)

**Goal**: Add tasks Pro 3 reliably finalState=1.0-passes — single-leg navigation + DOM-confirm shape, like trivial-1 / calibration-1. These tasks work AROUND the two-shape stopping problem rather than fighting it.

**Task design constraints (locked)**:
- Single concrete URL target (no "find the X page" open-ended search).
- Single DOM-assertion target on the landing page (h1 / role=heading / aria-label).
- KeyNodes: 1-2 max (vs journey-* 3-7).
- Prompt: imperative + concrete + measurable. "Navigate to X and confirm Y is visible."
- Verifiable Pro-friendliness: prompt mirror-checks against trivial-1 (Pro 3 run-passed cov=1.0 finalState=1.0 in R10) — same shape = same probability of clean trace.

**Sketch (3-5 example shapes — full set authored in P2)**:

```ts
// 1. MDN homepage confirmation
new EvalTask({
  id: "trivial-3-mdn-homepage",
  prompt: "Navigate to developer.mozilla.org and confirm the MDN Web Docs homepage loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://developer\\.mozilla\\.org/(en-US/?)?$",
      domAssertion: "h1, [role='heading']",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://developer\\.mozilla\\.org/(en-US/?)?$",
    domAssertion: "MDN",
  },
});

// 2. Python docs landing (replaces github.com — Cloudflare/WAF risk per critic round 1)
new EvalTask({
  id: "trivial-4-python-docs-tutorial",
  prompt: "Navigate to docs.python.org/3/tutorial/index.html and confirm the Python tutorial index loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://docs\\.python\\.org/3/tutorial/index\\.html$",
      domAssertion: "h1",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://docs\\.python\\.org/3/tutorial/index\\.html$",
    domAssertion: "Python Tutorial",
  },
});

// 3. Stack Overflow questions page (read-only; bot-tolerant)
new EvalTask({
  id: "trivial-5-stackoverflow-questions",
  prompt: "Navigate to stackoverflow.com/questions and confirm the questions list page loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://stackoverflow\\.com/questions/?$",
      domAssertion: "h1, .js-gps-track",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://stackoverflow\\.com/questions/?$",
    domAssertion: "Questions",
  },
});

// 4. W3.org HTML spec landing (replaces npmjs.com — bot-tolerant, public W3C standard)
new EvalTask({
  id: "trivial-6-w3-html-spec",
  prompt: "Navigate to www.w3.org/TR/html52/ and confirm the HTML 5.2 W3C Recommendation page loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.w3\\.org/TR/html52/?$",
      domAssertion: "h1",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.w3\\.org/TR/html52/?$",
    domAssertion: "HTML",
  },
});

// 5. Wikipedia article landing (replaces vercel.com — Wikipedia explicit bot-friendly per robots.txt)
new EvalTask({
  id: "trivial-7-wikipedia-typescript-article",
  prompt: "Navigate to en.wikipedia.org/wiki/TypeScript and confirm the TypeScript article loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://en\\.wikipedia\\.org/wiki/TypeScript/?$",
      domAssertion: "h1#firstHeading",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://en\\.wikipedia\\.org/wiki/TypeScript/?$",
    domAssertion: "TypeScript",
  },
});
```

**Bot-detection mitigation (per critic round 1, item #4)**: original sketches included github.com, npmjs.com, vercel.com — varying Cloudflare/WAF aggressiveness, similar shape to R10's `hard-volvo-ex90-configurator` which 403'd on Volvo's WAF. WAF failures aren't a Pro 3 reasoning failure — they tank the 7/10 finalState gate without signal. Swapped to bot-tolerant alternatives: docs.python.org (static, public docs), w3.org (standards body, no commerce), en.wikipedia.org (explicit `User-agent: *` allow). MDN + Stack Overflow read-only kept (both bot-tolerant). The 5 unsketched task slots (engineer authors in P2) follow the same bot-tolerance rule: prefer docs sites, public-data sites, standards bodies, government sites; avoid e-commerce, corporate landing pages, social platforms, anything fronting a Cloudflare challenge.

**Touched**:
- 10 new files under `packages/evals/tasks/trivial-3-*.ts` through `trivial-12-*.ts` (or named by site — `trivial-mdn-homepage.ts`, etc; engineer picks).
- New `packages/evals/evals/wave-r12-extended.eval.ts` (LOCKED per Decision 14) — separate eval entry point with the union of original 20 + new 10. **Purpose: TEACHER CAPTURE only** — Pro 3 runs against `wave-r12-extended` to produce strict-pass training trajectories on the new Pro-friendly tasks. **Do NOT extend `wave-r5-ab.eval.ts`** — extending it would confound R10/R11 baseline comparisons AND `wave-r5-ab` is reserved for capability-lift validation per Decision 15.
- No source changes to `packages/evals/src/runners/` — the runners consume `EvalTask` via the harness, no awareness of which set the task came from.

**Validation pass before committing tasks**:
- Pre-commit: run gemini-react against each new task with a 3-run probe (same shape as R10's reviewer variance check). If any new task produces < 2/3 finalState=1.0 across the probe, drop it from the set or rewrite the prompt. We don't ship a task to the harness if Pro 3 doesn't pass it cleanly — that's wasted teacher-capture compute.
- Probe trace dir: `evals/traces/wave-r12-task-probe/`.

**DoD — Behavior**:
- 10 new `EvalTask` files exist + registered in `wave-r12-extended.eval.ts` (LOCKED seam per Decision 14 — capture-only).
- `wave-r5-ab.eval.ts` is byte-identical to the R11-shipped version — confirms R10/R11 baseline preservation AND validation-seam reservation per Decision 15.
- Pre-commit Pro 3 probe sweep on the new tasks produces ≥ 7/10 tasks at finalState=1.0 and stepCoverage=1.0 (R10 base-rate is 2/20 = 10%; new-shape + bot-tolerance constraints should bump that to ≥ 70%).
- All 10 new task URLs target bot-tolerant sites (docs / standards / Wikipedia / public-data / read-only) — no Cloudflare/WAF-fronted commerce, social, or corporate landing pages.
- Running `pnpm --filter @neuve/evals eval:wave-r12-extended` produces 30-task × N-runner trace files per sweep (N depends on which lanes the capture invocation enables; teacher capture uses gemini-react only).

**Effort**: medium. Authoring 10 small EvalTasks is small; the probe-then-cull discipline adds wall-clock + cost (one extra Pro 3 run per task = ~$0.50 each = ~$5 total).

### P3 — Trajectory cleanup (bounded truncate + KeyNode-coverage-gated synthesis)

**Goal**: Recover over-execution traces (`FAIL cov=1.0` shape — Pro hit all KeyNodes then kept tooling) by truncating at the last honest STEP_DONE boundary. **Synthesis of `RUN_COMPLETED:passed` is gated on the truncated trace's STEP_DONE set covering ALL KeyNodes from the source `EvalTask`** — synthesis is bounded by the source EvalTask's own KeyNode definition, not by the trace's internal markers (per lead directive 2026-04-30, Decision 13).

**Touched**:
- New `packages/evals/src/distill/trajectory-cleanup.ts` — pure function `truncateAtLastStepDone(events: TraceEvent[], task: EvalTask): TraceEvent[] | undefined`.
  - **(Constraint a — honest boundaries)**: identifies the last `STEP_DONE` marker in the original trace; truncates at that marker. Never fabricates STEP_DONE markers — only uses ones the agent actually emitted.
  - **(Constraint b — KeyNode-coverage-gated synthesis)**: after truncation, computes the set of KeyNodes covered by the truncated trace's `key_node_reached` events (existing `TraceEventSchema` event type). Synthesizes `RUN_COMPLETED:passed` ONLY when the covered set equals `task.keyNodes` (full coverage). Partial-coverage truncation returns undefined (rejected, no synthesis).
  - Returns undefined when:
    - The trace already passed `isTraceStrictlyClean` (no truncation needed).
    - The trace has no `STEP_DONE` events (incomplete-coverage shape — not recoverable by truncation).
    - The last `STEP_DONE` is followed only by `RUN_COMPLETED:passed` (already a clean trace).
    - Truncation produces partial KeyNode coverage (synthesis not authorized — Constraint b).
  - The synthesized `RUN_COMPLETED:passed` marker carries an annotation `{ source: "trajectory-cleanup-synth", originalLastEvent: <event-type>, coveredKeyNodes: <count>/<total> }` in payload metadata.
- `packages/evals/src/distill/teacher-data-exporter.ts` — extend to take an optional `cleanupMode: "off" | "truncate-overexec"` option. Default `off` (R11 behavior). When `truncate-overexec`, runs `truncateAtLastStepDone(events, task)` on each trace before passing to `isTraceStrictlyClean`. Sidecar score recomputed against the truncated trajectory: `finalState` and `stepCoverage` reflect the truncated trace's KeyNode hits.
- **(Constraint c — per-record provenance metadata)**: when the exporter emits a `TrainingSample` derived from a synthesized RUN_COMPLETED, the sample's `metadata` object carries `_synthesized: true` AND `_origin: "trajectory-cleanup-v1"`. Captured-as-emitted samples carry `_synthesized: false` (or omit the key — engineer picks; tests assert presence on synthesized, absence/false on captured). This enables A/B-train with-vs-without synthesized data + reviewer audit.
- `packages/evals/src/distill/types.ts` — `TrainingSample.metadata` schema extended with optional `_synthesized: Schema.optional(Schema.Boolean)` + `_origin: Schema.optional(Schema.String)` fields.
- `packages/evals/scripts/distill/recompute-sidecars.ts` — NEW Effect script: takes a sweep dir, runs each trace through truncation against its source `EvalTask` (looked up via the existing `task-registry.ts:allEvalTasks` map; this is the seam that gives cleanup access to KeyNode definitions), recomputes sidecar scores via the existing scorer code path (same code that R11 P2 ships in `wave-r5-ab/build-report.ts`), writes `<runner>__<taskId>.cleanup-truncate.scores.json` next to the original sidecar.
- `packages/evals/tests/trajectory-cleanup.test.ts` — at minimum:
  1. Trace ending in `RUN_COMPLETED:passed` after final `STEP_DONE` returns undefined (already clean; no truncation).
  2. Trace ending in `RUN_COMPLETED:failed` with STEP_DONE set covering all `task.keyNodes` returns truncated trace + synthesized `RUN_COMPLETED:passed` (full-coverage synthesis authorized).
  3. **(Constraint b regression)** Trace ending in `RUN_COMPLETED:failed` with STEP_DONE set covering only 1/2 KeyNodes returns undefined (synthesis NOT authorized on partial coverage).
  4. Trace with no `STEP_DONE` returns undefined (incomplete-coverage; not recoverable).
  5. Synthesized marker payload contains `source: "trajectory-cleanup-synth"` AND `coveredKeyNodes: N/N` annotation.
  6. **(Constraint c regression)** `TrainingSample` derived from a synthesized RUN_COMPLETED carries `metadata._synthesized: true` AND `metadata._origin: "trajectory-cleanup-v1"`; sample derived from a captured RUN_COMPLETED does NOT.
  7. Live smoke against R10's `wave-r10-pro-preview/gemini-react__calibration-2-single-nav-news.ndjson` (FAIL cov=1.0 — known over-execution, single KeyNode `^https://www\.bbc\.co\.uk/news/?$`): runs cleanup against the source EvalTask, asserts STEP_DONE coverage = 1/1, asserts cleanup output passes `isTraceStrictlyClean`, asserts emitted `TrainingSample.metadata._synthesized === true`. (`it.skipIf` if R10 trace dir absent.)

**Why this is fail-closed by default + bounded by EvalTask definition**: R12's strict filter still rejects any trace that doesn't satisfy `isTraceStrictlyClean` over its sidecar. Cleanup runs BEFORE the filter — if cleanup can't recover the trace, the trace is rejected. Synthesis bounded by `task.keyNodes` set means the LoRA never learns to declare done on a trajectory that didn't actually cover the source task's KeyNodes — the source EvalTask is the ground-truth definition of "done", not the agent's emitted markers.

**A/B-train hook (Decision 13 constraint c)**: P5's hyperparam matrix can include a "synthesized-data on/off" axis as a future variant. R12 P5 doesn't sweep it explicitly (we have 27 configs already), but lead-or-engineer can split the corpus by `metadata._synthesized` flag for ablation analysis post-P6.

**DoD — Behavior**:
- Running `pnpm --filter @neuve/evals distill:recompute-sidecars EVAL_SWEEP_DIR=evals/traces/wave-r10-pro-preview` produces `<runner>__<taskId>.cleanup-truncate.scores.json` files for each Pro 3 trace where `truncateAtLastStepDone` returned a non-undefined trajectory (expected: ~2-4 traces per sweep, the over-execution shapes that also satisfy KeyNode-full-coverage).
- Running `pnpm --filter @neuve/evals distill:export EVAL_TRACE_DIR=evals/traces/wave-r10-pro-preview EVAL_DISTILL_CLEANUP=truncate-overexec` accepts ≥ 4 strict-pass traces from R10 (vs R10's 2 status-only-strict before cleanup). Cleanup recovers the over-execution shapes.
- The 5 R10 "passed-only" tasks (calibration-3 cov=0.50, journey-6 cov=1.0 finalState=0, moderate-1 cov=0.33, moderate-2 cov=0.33, trivial-2 cov=1.0 finalState=0) remain rejected — confirmed not recoverable via truncation alone (premature + incomplete-coverage shapes).
- Every emitted `TrainingSample` derived from a synthesized RUN_COMPLETED carries `metadata._synthesized: true` AND `metadata._origin: "trajectory-cleanup-v1"`. An exporter test asserts presence on synthesized, absence/false on captured.
- Running the exporter with `EVAL_DISTILL_CLEANUP=truncate-overexec` on a synthetic 1-KeyNode task whose trace's STEP_DONE set covers 0/1 KeyNodes returns 0 accepted samples (Constraint b enforced).

**Risk flagged**: synthesizing a `RUN_COMPLETED:passed` marker is a manufactured signal. Bounded by Constraint b (full KeyNode coverage in the source EvalTask) + Constraint c (per-record provenance) per lead directive. Reviewer must spot-check at least one cleaned trace + verify the `_synthesized` metadata flag flows through to the JSONL output. Audit trail is the sidecar suffix `.cleanup-truncate.scores.json` distinct from the original — a reviewer or future debug pass can always identify which traces were synthesized.

**Effort**: medium. Pure function + scorer-recompute reuse + tests + synthesizing-marker discipline + KeyNode-coverage gate.

### P4 — Off-task replay blend (UltraChat 200k, configurable ratio)

**Goal**: Mix off-task chat data into the training corpus to head off catastrophic narrowing. R11 plan §"Risk areas" called out distillation-on-distillation collapse; off-task replay is the standard mitigation per LoRA-Learns-Less-and-Forgets-Less (arXiv:2405.09673) and the broader fine-tuning-without-catastrophic-forgetting literature.

**Touched**:
- New `packages/evals/scripts/distill/fetch-ultrachat.ts` — Effect script that downloads HuggingFaceH4/ultrachat_200k via the HF datasets API, samples N random conversations from `train_sft`, redacts via `redactSensitiveKeys` (defense-in-depth), writes `data/distill/off-task/ultrachat-sample-<size>.jsonl`. Tagged errors `UltraChatFetchError`, `UltraChatSampleEmptyError`. Scoped temp directory; cleaned via `Effect.acquireRelease`. The fetched JSONL conforms to our `TrainingSample` schema directly (UltraChat ships in OpenAI-shape multi-turn arrays — see `https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k`).
- New `packages/evals/scripts/distill/blend-corpus.ts` — Effect script that reads a teacher JSONL + an off-task JSONL + a target ratio, emits a blended JSONL with shuffled-interleave at the specified ratio. Schema: `EVAL_DISTILL_TEACHER_INPUT`, `EVAL_DISTILL_OFFTASK_INPUT`, `EVAL_DISTILL_BLEND_RATIO` (0.0-1.0; default 0.25), `EVAL_DISTILL_BLEND_OUTPUT`.
- `packages/evals/tests/blend-corpus.test.ts` — synthetic 10-teacher + 100-off-task input at ratio 0.25 → 33 samples (~25% off-task ratio in output, 8 off-task + 25 derived if 0.25 means off-task=25% of total → 33 total = 25 teacher + 8 off-task). Tests validate the ratio math and the shuffle determinism (seed fixed).
- New `packages/evals/tests/fetch-ultrachat-smoke.test.ts` — `it.skipIf` when no network or no `HF_TOKEN`; otherwise live fetch of 10 samples from UltraChat, asserts 10 valid TrainingSamples decode.
- `packages/evals/package.json` — `distill:fetch-ultrachat`, `distill:blend-corpus` scripts added.

**Blend ratio (locked anchor for P5 sweep)**: 25% off-task, 75% teacher. Hyperparam matrix in P5 includes ratio in {0.10, 0.25, 0.50} as the fourth axis.

**DoD — Behavior**:
- Running `pnpm --filter @neuve/evals distill:fetch-ultrachat EVAL_DISTILL_OFFTASK_SIZE=200` writes `data/distill/off-task/ultrachat-sample-200.jsonl` containing 200 valid `TrainingSample` records (each with `messages[]` in OpenAI shape, `metadata.source = "ultrachat-200k"`).
- Running `distill:blend-corpus` against a 30-teacher input + 200-off-task input at ratio 0.25 emits 40 blended samples (30 teacher + 10 off-task = 40, where 10/40 = 0.25). The blended JSONL passes the same `TrainingSample` schema decode that the exporter writes.
- Off-task sample metadata carries `source: "ultrachat-200k"` in the `metadata` field so downstream training reports can audit the blend ratio retroactively.

**Effort**: medium. HF dataset fetch + sample + JSONL conversion is straightforward; the blend math + shuffle determinism is the test focus.

### P5 — Hyperparameter exploration (9-config Latin-square + Bayesian top-3)

**Goal**: Sweep the rank/epoch/lr/blend-ratio matrix at lower cost than full 27-config grid; pick the winning config based on browsing-gemma-react vs base-gemma-react step-cov delta on the held-out comparison set.

**Touched**:
- `packages/evals/scripts/distill/hyperparam-sweep.ts` — NEW orchestration script. Reads a config matrix from a JSON file (committed at `packages/evals/data/distill/hyperparam-matrix.json`), drives:
  1. For each config, build the blended corpus (P4 output from a fixed seed).
  2. Run R11's `distill:train` with the config's rank/epochs/lr.
  3. Run R11's `distill:convert-gguf` on the resulting adapter.
  4. Run R11's `distill:build-modelfile` + `ollama create browsing-gemma-config-<N>`.
  5. Run wave-r5-ab eval for the browsing-gemma-config-<N> runner against a held-out subset (the 5 calibration tasks + trivial-1 + trivial-2 — same set as R10's postflip-partial validation, fast and cheap).
  6. Emit `<config-N>.summary.json` with step-cov + finalState delta vs base-gemma.
- 9 configs locked into `packages/evals/data/distill/hyperparam-matrix.json` as the Latin-square: 9 of the 27-config space, balanced one-axis-at-a-time. Concrete starting matrix:

| # | rank | epochs | lr | blend |
|---|---|---|---|---|
| 1 | 8  | 1 | 5e-5 | 0.25 |
| 2 | 8  | 2 | 1e-4 | 0.25 |
| 3 | 8  | 3 | 5e-4 | 0.25 |
| 4 | 16 | 1 | 1e-4 | 0.25 |
| 5 | 16 | 2 | 5e-4 | 0.25 |
| 6 | 16 | 3 | 5e-5 | 0.25 |
| 7 | 32 | 1 | 5e-4 | 0.25 |
| 8 | 32 | 2 | 5e-5 | 0.25 |
| 9 | 32 | 3 | 1e-4 | 0.25 |

Latin-square constraint: each rank value paired with each epochs value exactly once across the 9 configs; same for rank × lr and epochs × lr. This isolates one-axis effects with 1/3 the compute of the full 27-grid.

- After the 9-config sweep produces summaries, engineer surfaces the top-3 configs to lead. Lead authorizes a Bayesian narrow: 6-9 additional configs centered on the top-3, varying blend-ratio (0.10 / 0.50) and one held-out axis. R12 ships the winner of the narrow.
- `packages/evals/tests/hyperparam-sweep.test.ts` — orchestration test on a 2-config mock matrix. Live smoke optional.

**Why Latin-square not random-9**: the matrix is small (3×3×3=27); random subsetting risks pairing rank=8 with all three epochs values (no rank-effect signal). Latin-square balances axes by construction.

**DoD — Behavior**:
- Running `pnpm --filter @neuve/evals distill:hyperparam-sweep EVAL_DISTILL_MATRIX=data/distill/hyperparam-matrix.json` produces 9 `summary.json` files (one per config) with step-cov + finalState delta on the 7-task held-out subset.
- Each config's adapter file (`adapters/browsing-gemma-config-<N>.gguf`) and Ollama tag (`browsing-gemma-config-<N>`) exist in the local Ollama registry.
- Engineer's surface message to lead identifies the top-3 configs by step-cov delta.
- Sweep wall-clock target: < 60 minutes total on M4 (each config ~5-7 min train + ~5 min held-out eval = 9 × ~12 min ÷ no parallelism = ~108 min worst case; lead can authorize parallel 3-config bursts if Ollama daemon handles it).

**Cost**: $0 (MLX-LM local) + 0 GPU spend.

**Effort**: medium-large. Orchestration script wraps R11's primitives but introduces multi-stage state; cleanup of failed configs (incomplete adapter files, leftover Ollama tags) is the engineering tedium.

### P6 — Final config train + capability-lift validation sweep

**Goal**: Train browsing-gemma on the winning config (full corpus, not held-out), then run N≥2 full multi-sweep zero-code-change validation **against `wave-r5-ab.eval.ts` (the original 20-task harness, R10/R11-comparable)** to validate the gate-conjunction (Decision 8). Validation seam locked per Decision 15. Optional secondary informational metric on the 10-new-task subset only — exploratory transfer signal, no ship-gate.

**Touched**:
- `packages/evals/scripts/distill/train.ts` — used as-is from R11; called with the winning config from P5.
- `packages/evals/scripts/distill/convert-gguf.ts` — used as-is.
- `packages/evals/scripts/distill/build-modelfile.ts` — emit `Modelfile` referencing the final adapter; create `browsing-gemma` (no config suffix) Ollama tag.
- `packages/evals/scripts/wave-r5-ab/build-report.ts` — already handles the 4-runner column shape from R11 P7. R12 reuses the report logic against `wave-r5-ab` traces. Aggregate runs over N sweep dirs.
- New `evals/traces/wave-r12-final-{1,2}/` (N=2 ship floor) or `wave-r12-final-{1,2,3}/` (N=3 lead-recommended) — full sweeps against `wave-r5-ab.eval.ts` (20 tasks × 4 runners = 80 traces per sweep × N sweeps).
- Optional secondary capture: `evals/traces/wave-r12-extended-explore-{1,2}/` — N≥2 sweeps of `wave-r12-extended` for the new-task-subset transfer signal. Explicitly informational only.
- New `docs/handover/harness-evals/baselines/wave-r12-browsing-gemma.md` — auto-generated by build-report against `wave-r5-ab` traces, hand-augmented with: (a) PRIMARY gate-conjunction verdict on `wave-r5-ab` (mid-gate AND R11-floor both holding); (b) multi-sweep median table; (c) R10-2-5/20 schema-invalid variance-floor reference; (d) off-task chat regression (manual probe — see below); (e) OPTIONAL "Exploratory transfer signal" section on `wave-r12-extended` new-task subset (10 tasks only) clearly marked as no-go-no-stop informational.

**Off-task chat regression probe**: a 10-prompt non-browsing prompt set (sample: "Explain recursion in two sentences"; "Sum 23 + 47"; "What's the capital of Brazil?"; etc). Run against `gemma4:e4b` and `browsing-gemma` via direct `/api/generate`. Score: response non-empty AND on-topic (LLM-judge or manual). Catastrophic narrowing manifests as `browsing-gemma` failing prompts that `gemma4:e4b` answers cleanly. Probe runs at end of P6, results captured in baseline report.

**DoD — Behavior** (gate conjunction per Decision 8, validation seam per Decision 15):
- After the N≥2-sweep capture against `wave-r5-ab` completes (N=3 recommended; floor N=2 if budget cuts), the baseline report `wave-r12-browsing-gemma.md` shows BOTH PRIMARY gates simultaneously holding ON `wave-r5-ab`:
  - **R12 mid-gate** (lift target, Decision 7): `median(browsing-gemma-react step-cov on wave-r5-ab) − median(gemma-react step-cov on wave-r5-ab) ≥ +0.10` across the N sweeps. R10's 2-5/20 schema-invalid band is the variance-floor reference for what counts as zero-code-change drift.
  - **R11 floor** (catastrophic-narrowing safety net, Decision 8): `median(browsing-gemma-react step-cov on wave-r5-ab) − median(gemma-react step-cov on wave-r5-ab) ≥ −0.05` across the same N sweeps.
  - R8/R9/R10 invariants per sweep on `wave-r5-ab`: empty-content 0/20 each sweep on `gemma-react`; schema-invalid ≤ 5/20 each sweep (R9 widened gate per `project_baseline_eval_strategy.md`).
  - Off-task chat probe: ≥ 9/10 prompts pass on `browsing-gemma` (parity-or-better with `gemma4:e4b` baseline; <9/10 = catastrophic narrowing flag, ship blocked).
- Existing `gemma-react`, `gemini-react`, `gemma-oracle-plan` lanes remain within their R10 / R11 distribution bands.
- Report includes per-sweep delta + median-of-N + same-day-pair design assertion (each sweep ran all four lanes against the same task set on the same day, controlling for sweep-day environmental drift).
- OPTIONAL: secondary "Exploratory transfer signal" section reports browsing-gemma vs gemma deltas on the 10-new-task subset of `wave-r12-extended`. Section header explicitly states "informational only — does not influence ship/no-ship." This catches the circular-validation reading risk per Decision 14 + Decision 15.

**Effort**: medium-large. N≥2 full 4-runner sweeps × 20 tasks (`wave-r5-ab`) ≈ 5-6 hr each (gemma lane is the bottleneck — same as R10 sweep wall-clock); the off-task regression probe + report augmentation adds a small amount on top. Optional `wave-r12-extended` informational sweep adds ~50% wall-clock if captured.

**Cost**: ~$35-50 (N=2) or $50-75 (N=3) in Pro 3 tokens — scaled to R10's 20-task baseline (gemini-react lane only; gemma-react/oracle-plan/browsing-gemma-react are local-only). Optional `wave-r12-extended` exploratory sweep adds ~$25-50 on top per sweep round if captured.

### P7 — Promotion + capability-lift sign-off

**Goal**: Ship the validated browsing-gemma adapter. No production wiring (per "What we're explicitly NOT building"); the sign-off is "evidence-based gate cleared, R13 may now wire production deployment."

**Touched**:
- `packages/evals/data/distill/adapters/browsing-gemma.gguf` — the validated GGUF artifact, committed to repo (size budget: tens of MB for rank-8/16/32 LoRA on Gemma 4 E4B; LFS-tracked if needed).
- `packages/evals/data/distill/Modelfile` — the validated Modelfile referencing the GGUF + production prompt.
- `docs/handover/distillation-pipeline/diary/r12-2026-04-XX.md` — wave diary with config-by-config sweep numbers, the chosen winner, the capability-lift gate verdict, the off-task regression probe results.
- `MEMORY.md` — `project_lora_name.md` doesn't change. Add a R12-shipped entry to `project_react_migration_plan.md` referencing R12 status.

**DoD — Behavior**:
- The committed `browsing-gemma.gguf` + `Modelfile` artifacts can be loaded via:
  ```
  ollama create browsing-gemma -f packages/evals/data/distill/Modelfile
  ```
  in a fresh Ollama install + clean repo clone, in under 30 seconds.
- The new `browsing-gemma` model answers `pnpm --filter @neuve/evals distill:smoke-finetune EVAL_DISTILL_MODEL=browsing-gemma` (existing R11 smoke against the production tag, not the smoke-suffix model) with non-empty schema-valid envelope output.
- Reviewer-verifiable claim: "browsing-gemma-react step-cov beats base-gemma-react step-cov by ≥ 0.10 on full wave-r5-ab, on a 3-run distribution." Backed by the baseline report numbers.

**Effort**: small. Most of the effort is in P6's report augmentation; P7 is artifact promotion + diary write-up.

## Wave gates / DoD

0. **Corpus-floor pre-P5 gate (NEW per critic round 1, item #2)**: After P1 (multi-sweep capture) + P2 (new tasks captured by Pro 3) + P3 (cleanup-recovered) complete, the combined strict-pass training corpus reaches **≥ 30 strict-pass `TrainingSample` records** (Decision 10 floor) BEFORE P5 hyperparam sweep begins. Verifiable: `pnpm --filter @neuve/evals distill:export EVAL_TRACE_DIR=...union-of-all-sweep-dirs... EVAL_DISTILL_CLEANUP=truncate-overexec EVAL_DISTILL_OUTPUT=data/distill/out/r12-corpus.jsonl` writes a JSONL with ≥ 30 lines. **Halt-and-surface behavior**: if corpus < 30, halt before P5; engineer surfaces to lead for additional sweep round (P1 sweep 3+) or scope-cut decision. No implicit fall-through to training on undersized corpus — the +0.10 mid-gate becomes meaningless if the LoRA was trained on ~10 traces and "passed" by noise.
1. **Multi-sweep dataset growth**: aggregating sweeps 0+1+2 yields ≥ 6 strict-pass traces (R10 floor ×3, allowing for ~50% inter-sweep overlap). Combined with P2 + P3 contributions, the full R12 dataset reaches the 30-trace ship-floor (Decision 10) and ideally the 50-trace target.
2. **New task set Pro-friendly**: pre-commit Pro 3 probe on the 10 new EvalTasks produces ≥ 7/10 finalState=1.0 + stepCoverage=1.0; tasks registered in `wave-r12-extended.eval.ts` (NOT `wave-r5-ab.eval.ts` per Decision 14); R10/R11 baselines on `wave-r5-ab` remain bit-identical.
3. **Trajectory cleanup recovery**: cleanup-mode `truncate-overexec` exporter run accepts ≥ 4 strict-pass traces from R10's `wave-r10-pro-preview/` (vs 2 without cleanup); every emitted `TrainingSample` derived from a synthesized RUN_COMPLETED carries `metadata._synthesized: true` AND `metadata._origin: "trajectory-cleanup-v1"` (Decision 13 constraint c); partial-KeyNode-coverage traces are rejected, not synthesized (Decision 13 constraint b).
4. **Off-task replay corpus**: blended JSONL (e.g. 30 teacher + 10 off-task at ratio 0.25) decodes through `TrainingSample` schema and round-trips through the exporter without rejection; off-task samples carry `metadata.source = "ultrachat-200k"`. Matrix carries 10% / 25% / 50% blend axes per Decision 11.
5. **Hyperparam sweep numbers**: 9-config Latin-square produces 9 valid `summary.json` rows; engineer surfaces top-3 to lead; lead authorizes Bayesian narrow on top-3 (Decision 12). Skip full 27-config grid.
6. **Capability-lift gate conjunction (PRIMARY, distribution-form per Decisions 7+8, validation seam per Decision 15)**: across N≥2 zero-code-change full sweeps **of `wave-r5-ab` (the original 20-task harness, R10/R11-comparable, validation seam locked per Decision 15)** on the winning config, BOTH must hold:
   - `median(browsing-gemma-react step-cov on wave-r5-ab) − median(gemma-react step-cov on wave-r5-ab) ≥ +0.10` (mid-gate / lift target).
   - `median(browsing-gemma-react step-cov on wave-r5-ab) − median(gemma-react step-cov on wave-r5-ab) ≥ −0.05` (R11 floor / safety net).
   The conjunction is the ship gate. Ship at N=2 if both hold; lead can authorize N=3 for tighter variance characterization. Validation does NOT run on `wave-r12-extended` for the ship-gate decision — the new tasks fed teacher capture, validating on them would be circular. Optional secondary informational metric on the new-task subset is allowed in the report but does not influence ship/no-ship.
7. **No catastrophic narrowing**: 10-prompt off-task chat regression probe scores ≥ 9/10 on browsing-gemma (parity-or-better vs base-gemma). Probe includes 2-3 AgentTurn-shape envelope-emission prompts to catch protocol-narrowing.
8. **R8/R9/R10 invariants intact** on `gemma-react` lane: empty-content 0/20 each sweep, schema-invalid ≤ 5/20 each sweep (R9 widened-to-distribution gate).
9. **Reproducibility**: a fresh repo + fresh Ollama install can reconstruct `browsing-gemma` from committed artifacts via `ollama create` in < 30 seconds.
10. **R5 baseline preservation**: `packages/evals/evals/wave-r5-ab.eval.ts` is byte-identical to the R11-shipped version; R10/R11 baseline reports remain comparable to any future R12+ wave-r5-ab run.

## Risk areas

1. **Multi-sweep convergence below threshold**. If sweeps 1+2 produce < 4 new strict-pass traces (heavy task overlap with sweep 0), dataset stays at ~4 traces — below the 15/5 minimum. Mitigation: P2 new-task additions are the main hedge; if both P1 and P2 underdeliver, R12 ships at "behavioral-floor only" (R11's gate, not the +0.10 gate) and lead authorizes either an additional sweep round or scope-cut.
2. **Catastrophic narrowing despite off-task blend**. Gate 7 (off-task regression probe) catches it. Mitigation: increase blend ratio in P5's sweep (one of the matrix configs is 0.50 if the lower ratios fail).
3. **Synthesized RUN_COMPLETED markers from P3 cleanup pollute training data**. Three locked constraints (Decision 13) bound the risk: (a) honest STEP_DONE boundaries only — no fabricated markers; (b) synthesis gated on full KeyNode coverage from the source `EvalTask` definition — partial-coverage truncation is rejected; (c) per-record provenance metadata (`_synthesized: true`, `_origin: "trajectory-cleanup-v1"`) on every derived `TrainingSample`. Reviewer must spot-check at least one cleaned trace in the P3 review + verify the metadata flag flows through to JSONL output. The provenance metadata also enables A/B-train ablation (split corpus by `_synthesized` flag) post-P6 if synthesis quality is questioned. If reviewer disagrees with synthesis as a class even with the constraints, drop P3 and ship without cleanup (loses ~2 traces per sweep but preserves training-data purity).
4. **Held-out subset overfit**. P5's 7-task held-out is small (calibration-1..5 + trivial-1, trivial-2). The winning hyperparams might overfit to the held-out shape and underperform on full wave-r5-ab. Mitigation: P6's full sweep is the actual capability-lift validation; P5's held-out is a config-ranking signal only, not the gate. If P6 shows the P5-winner regresses on full-set, lead authorizes re-sweep over top-3 configs against the full-set.
5. **GCP free trial $300 expired** (if R13 needs Vertex). Out of R12 scope but flagged: free trial valid 90 days; if R12 work spans >90 days from initial signup, the trial may have expired by the time R13 starts. Workaround: pay-as-you-go billing kicks in automatically — Vertex pricing tables are visible to R13 planners.
6. **MLX-LM Gemma 4 LoRA-rank-32 wall-clock surprise**. R11 P4 verifies rank=8 on Gemma 4 E4B. Rank=32 has ~4× the trainable params; on M4 hardware this might push training time per config from ~5 min to ~20 min. P5's 9-config sweep wall-clock could grow to ~3 hr. If this happens, P5 falls back to rank ∈ {8, 16} only (6-config Latin-square instead of 9).
7. **Pro 3 SKU rotation**. `gemini-3-pro-preview` may rotate to a new preview SKU between P1 sweep 1 and sweep 2 (Google's preview SKUs do this). If the SKU 404s mid-sweep, the env-var override path documented in R10 closure (`PERF_AGENT_GEMINI_REACT_MODEL`) lets us swap to the next-revision SKU without code change. Engineer must detect this — eval harness logs `modelId: 'gemini-3-pro-preview'` at startup; if the underlying `modelVersion` field of `generateContent` responses changes mid-sweep, pause and reconcile.
8. **Off-task narrowing on protocol envelopes**. Even if free-text chat regression passes, browsing-gemma might lose its ability to emit Path-B-shaped `AgentTurn` envelopes when given non-browsing prompts. Out-of-distribution behavior. Mitigation: the 10-prompt probe in P6 explicitly includes 2-3 non-browsing prompts of the AgentTurn shape ("Output a JSON object with field 'reasoning' set to 'foo'") to catch envelope-emission narrowing.
9. **Bot-detection / WAF aggression on new task targets** (per critic round 1, item #4). R10's `hard-volvo-ex90-configurator` 403'd on Volvo's WAF — that's not a Pro 3 reasoning failure, it's an environmental tank. New tasks risk the same shape if URL targets front Cloudflare/Imperva/Akamai. Original P2 sketches (github.com / npmjs.com / vercel.com) were flagged by the critic and swapped to bot-tolerant alternatives (docs.python.org / w3.org / en.wikipedia.org). MDN + Stack Overflow read-only retained. **Locked rule for the 5 unsketched task slots**: prefer docs sites, public-data sites, standards bodies, Wikipedia, government sites. Avoid e-commerce, corporate landing pages, social platforms, anything fronting a Cloudflare challenge. Pre-commit Pro 3 probe (Gate 2) is the empirical guard — any task that 403s or fails to load on Pro 3's first nav-interact pair gets dropped from the new-task set, NOT counted toward the 7/10 finalState target.

## Out of scope (R13 hooks)

R12 does NOT solve, R13 owns:
- **Production hosting beyond local Ollama**. Cloud Run + Modal + Vertex serving paths.
- **Vertex training backend**. Will become economical at dataset > ~500 samples (per RQ6 math); R13 plan flips this.
- **Vision/audio Gemma 4 modalities**. Image-token + audio-token training requires teacher capture in those modalities.
- **DPO / GRPO / preference learning**. Needs paired good/bad trajectories per task.
- **Path A native `<|tool_call>` token format**. Conditional on Ollama upstream parser fix landing.
- **Cross-domain generalization**. BFCL, WebVoyager, Online-Mind2Web evaluation.
- **Larger Gemma 4 sizes (26B-A4B MoE, 31B dense)**. browsing-gemma is the E4B-only adapter; bigger model adapters need their own training pipeline.
- **Online learning / continuous fine-tune from production traces**. R12 is offline batch-only.

## Process invariants

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`, `Effect.fn` with descriptive spans, `Effect.acquireRelease` for resource lifecycle, no `catchAll`/`mapError`/`null`/`as`-casts (per `CLAUDE.md`).
- No `Co-Authored-By` footer. Granular commits after reviewer APPROVE per `feedback_commit_guidelines.md`.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push` per `feedback_reviewer_never_stash.md`.
- Real services for all live smoke tests: real MLX-LM (skip-if-unavailable), real Ollama (skip-if-unavailable), real llama.cpp `convert_lora_to_gguf.py`, real HF datasets API for UltraChat fetch (`it.skipIf` no `HF_TOKEN`). No `MockLanguageModelV4` or test-only injection seams per `feedback_no_test_only_injection_seams.md`.
- `pnpm --filter @neuve/local-agent build` before any sweep that exercises new local-agent source per `project_eval_build_cache_trap.md`. R12 doesn't currently expect to touch local-agent.
- No prompt overfitting per `feedback_avoid_prompt_overfitting.md`. Production prompt unchanged across R12. Site patterns live in trajectory data + new EvalTasks.
- DoDs describe runtime behavior, not "function exists" per `feedback_dod_behavior_vs_verification.md`.
- Always read prior diaries / reviews / PRDs in full before drafting sub-plans per `feedback_always_read_prior_work.md`.
- No day estimates per `feedback_hacking_tone.md` — effort labels (small / medium / medium-large / large) only.
- Distribution gates not point gates per `project_baseline_eval_strategy.md` — multi-sample variance check is the validation discipline.

## Team structure

`react-r12` with engineer + reviewer per `feedback_use_teammates.md`.

- **T1 (engineer)**: P1 + P2 + P3 — multi-sweep capture, new task authoring + Pro-friendliness probe, trajectory cleanup. Surface to lead at end of P3 for intermediate review (these are pure data-side phases; training comes after).
- **T2 (reviewer, antagonistic, intermediate)**: audit P1-P3 work. Verify multi-sweep aggregation correctness, Pro-friendliness probe methodology (no leakage from probe into training), trajectory cleanup synthesis-marker discipline (annotation present, audit trail intact, no spurious truncation). Block T3 until APPROVE.
- **T3 (engineer)**: P4 + P5 + P6 + P7 — off-task replay blend, hyperparam sweep, final train + capability-lift validation, promotion. The behavioral-lift phases. Surface to lead at end of P6 with the multi-sweep numbers and the gate verdict.
- **T4 (reviewer, antagonistic, final)**: end-of-wave audit. Verify gates 1-10, spot-check at least 3 configs from the hyperparam sweep, audit the off-task regression probe methodology + results, verify the 95% CI computation on capability-lift delta, confirm no test-only seams in P4/P5/P6 wrappers, audit the wave-r12 baseline report's methodology. Block ship until APPROVE.

## Diary location

`docs/handover/distillation-pipeline/diary/r12-2026-04-XX.md` — engineer captures per-phase evidence:
- P1 sweep numbers + cost actuals.
- P2 task-shape design rationale + pre-commit probe pass-rates.
- P3 cleanup-recovered trace count + spot-check of synthesized markers.
- P4 UltraChat sample seed + blend-ratio anchor + off-task sample audit.
- P5 9-config sweep results table + top-3 selection reasoning.
- P6 multi-sweep numbers + capability-lift CI computation + off-task regression probe results.
- Final config: rank, epochs, lr, blend-ratio.
- R8/R9/R10 invariant counts per sweep.

## Cost estimate

| Phase | Cost | Source |
|---|---|---|
| P1 (sweeps 1+2 on 20-task wave-r5-ab gemini-only lane) | $35-50 | Pro 3 tokens (R10 baseline ×2) |
| P2 (probe sweep on 10 new tasks) | $5 | Pro 3 tokens (~$0.50 per task) |
| P3 (cleanup + recompute) | $0 | Local-only |
| P4 (UltraChat fetch + blend) | $0 | Local-only; HF datasets free tier |
| P5 (9-config Latin-square + Bayesian narrow on top-3) | $0 | MLX-LM local + held-out 7-task eval is local |
| P6 (N=2 ship-floor validation; or N=3 lead-recommended) on 30-task wave-r12-extended | $35-75 | Pro 3 tokens (range covers N=2 to N=3) |
| P7 (promotion) | $0 | Local-only |
| **Total** | **$75-130** | Conservative; dominated by Pro 3 token spend; floor-N=2 lower bound, recommended-N=3 upper bound |

Within the same envelope as R10's $17-25 sweep × roughly 3-5 sweeps. No GCP / Vertex cost in R12 (deferred to R13).
