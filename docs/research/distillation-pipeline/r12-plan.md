# R12 — Distillation pipeline data quality + capability lift

_Wave dispatched after R11 (pipeline plumbing) ships the end-to-end automation. R11 proves bytes-flow-through-without-breaking-gemma; R12 owns the actual capability lift — the LoRA does something useful. Where R11 was a 2-trace floor-only proof, R12 is the data-and-training-quality wave that makes `browsing-gemma` measurably better than `base-gemma`._

## What we're building

A bigger, cleaner training corpus + a defensible LoRA hyperparameter pick + a capability-lift gate the LoRA actually clears. Concretely: grow the strict-pass dataset from R10's 2/20 floor up to ≥ Wave-5's 15/5-task minimum threshold (engineer-documented in `docs/handover/harness-evals/diary/wave-5-distillation.md:233`), train under at least 9 hyperparameter configurations against a held-out comparison set, blend in off-task chat data to head off catastrophic narrowing, and ship a `browsing-gemma-react` lane that beats `gemma-react` on full wave-r5-ab by at least the noise band.

R12 ships behavioral lift. R11's gate 8 was "no significant regression vs base-gemma" (≥ −0.05 step-cov). R12's gate is "browsing-gemma-react step-cov ≥ base-gemma-react + 0.10" — measured on a multi-sweep distribution, not a single anchor.

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
| 5 | **Hyperparam matrix: 27 configs total, 9-config Latin-square first sweep** (RQ5) | rank ∈ {8, 16, 32}, epochs ∈ {1, 2, 3}, lr ∈ {5e-5, 1e-4, 5e-4}. Per Thinking Machines "LoRA Without Regret" (`https://thinkingmachines.ai/blog/lora/`): LoRA optimal LR is ~10× full-FT LR (so 1e-4 to 5e-4 dominates), apply LoRA to ALL layers (not attention-only), batch size <32, single-epoch usually enough on tiny data. Our 5e-5 is the conservative anchor R11 ships under; R12 sweeps both directions. Latin-square 9-of-27 gives one-axis-at-a-time signal cheaply, then Bayesian narrow on top-3 winners. |
| 6 | **Vertex defer until dataset > ~500 samples** (RQ6) | At R12 scale (50-100 traces × 3 epochs), MLX-LM on M4 finishes a single config in ~2-5 minutes; Vertex provisioning alone ($21.25/h base node + $2.93/h A100) eats 3+ minutes before training begins. 9-config Latin-square × 5 min = 45 min on M4 = $0. Same on Vertex = ~$5-10 plus 30 min provisioning overhead. Vertex flips to economical only when training time per config > ~30 min, which happens at dataset > ~500 samples or when 27-config full sweep parallelizes (Vertex can run all 27 in parallel; M4 serializes). R12 stays MLX-LM. The $300 GCP free trial credit (`https://cloud.google.com/free` — confirmed valid for new accounts April 2026) is an option for R13 if dataset crosses the threshold. |
| 7 | **Capability-lift gate: MID (+0.10 step-cov over base-gemma)** (RQ7) | Floor (+0.05) is below R7-phase-7's documented 0.07 step-cov noise band — indistinguishable from variance. Mid (+0.10) just clears noise + matches what WebLlama achieved on out-of-domain WebLINX with 100K traces (their abs-delta scaled to our metric). Stretch (≥ Pro 3) is unrealistic at 30-100 traces — student-beats-teacher requires order-of-magnitude more data than we have. Mid is the actually-meaningful, actually-achievable bar. |
| 8 | **Distribution gate, not point gate** (per `project_baseline_eval_strategy.md` 2026-04-30 update) | R10 closure widened gates to distributions because 3-run gemma sweep showed 0.307/0.321/0.372 spread (Δ=0.065). R12's gate is "mean(browsing-gemma step-cov over N≥3 runs) ≥ mean(base-gemma step-cov over the SAME N runs) + 0.10." Same-run-pair design controls for sweep-day environmental drift (rate-limiting, caching, time-of-day). Single-sample gate would re-create the R9 ≤2/20-anchored-on-one-run mistake. |
| 9 | **Same-codebase same-prompt invariant** (per `feedback_avoid_prompt_overfitting.md`) | The LoRA learns from teacher trajectories; the production system prompt (`buildLocalAgentSystemPrompt()`) does NOT change in R12. browsing-gemma must emit production-shaped envelopes against the production prompt. No prompt rewrites for "what makes the LoRA happy." Site patterns live in trajectory data. |

## Open questions for lead

- **Dataset target — 30 vs 50 vs 100 strict-pass traces?** Wave 5 engineer's "15 traces across 5 tasks" minimum is the floor. R10 strict-pass is 2/20 single-sweep. Multi-sweep × 5 runs of R10 corpus is upper-bound 10/20 (if every sweep produces independent strict-pass on different tasks; realistically ~30-50% overlap → 4-7 traces). Combining with new-task additions (P2) targeting +10-15 small-shape tasks where Pro reliably finalState=1.0 → realistic R12 dataset = 30-60 traces. Lead picks the floor target before the sweep dispatch.
- **Off-task blend ratio — 10%, 25%, or 50%?** Community signal says LoRA forgets less than full-FT, so blend ratio can be lower. Current pick: 25% (anchor; goes into hyperparam matrix). Lead can override to 10% (riskier — saves training token budget) or 50% (safer — less narrow specialization).
- **27-config full sweep, or stop at 9 + Bayesian?** Latin-square 9 gets one-axis signal. Full 27 is exhaustive but ~4× wall-clock. Stop-at-9 is the recommendation; lead can authorize full-27 if 9-results are ambiguous.
- **Behavioral floor still binding?** R11 gate 8 (≥ −0.05 vs base-gemma) is the regression-check. R12 also keeps it: if `browsing-gemma-react` lifts step-cov but introduces tail aborts or schema-invalid spikes, the floor catches it. Lead confirms R12 keeps R11's regression gate.

## Prior work to build on

| Source | What it provides |
|---|---|
| R11 — `packages/evals/scripts/distill/{export-teacher-data,build-modelfile,smoke-finetune,train,convert-gguf}.ts` | Full pipeline plumbing: export → train → convert → Modelfile → ollama create. All five CLI surfaces wired and smoke-tested. R12 calls them as primitives, doesn't reimplement. |
| R11 — `packages/evals/src/distill/filters.ts:isTraceStrictlyClean` | Strict filter (`finalState==1.0 AND stepCoverage==1.0 AND status=passed`). R12 uses verbatim. |
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

// 2. GitHub homepage confirmation
new EvalTask({
  id: "trivial-4-github-homepage",
  prompt: "Navigate to github.com and confirm the GitHub homepage loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://github\\.com/?$",
      domAssertion: "h1, [aria-label*='GitHub']",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://github\\.com/?$",
    domAssertion: "GitHub",
  },
});

// 3. Stack Overflow questions page
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

// 4. NPM package landing page (concrete URL)
new EvalTask({
  id: "trivial-6-npm-react-package",
  prompt: "Navigate to npmjs.com/package/react and confirm the React package page loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.npmjs\\.com/package/react/?$",
      domAssertion: "h1, [aria-label*='react']",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.npmjs\\.com/package/react/?$",
    domAssertion: "react",
  },
});

// 5. Vercel docs landing
new EvalTask({
  id: "trivial-7-vercel-docs-home",
  prompt: "Navigate to vercel.com/docs and confirm the Vercel documentation home loaded.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://vercel\\.com/docs/?$",
      domAssertion: "h1, main",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://vercel\\.com/docs/?$",
    domAssertion: "Vercel",
  },
});
```

**Touched**:
- 10 new files under `packages/evals/tasks/trivial-3-*.ts` through `trivial-12-*.ts` (or named by site — `trivial-mdn-homepage.ts`, etc; engineer picks).
- `packages/evals/evals/wave-r5-ab.eval.ts` — register the new tasks alongside existing 20 (R5 wave-r5-ab task list currently imports each task explicitly; new tasks added to that imports + registrations list).
- New `packages/evals/evals/wave-r12-extended.eval.ts` (alternative seam) — separate eval entry point with the union of original 20 + new 10. Lead picks which seam: extending wave-r5-ab risks confounding R10/R11 baseline comparisons (baseline reports were 20-task); a new wave-r12-extended is cleaner. Recommend the new-eval seam.
- No source changes to `packages/evals/src/runners/` — the runners consume `EvalTask` via the harness, no awareness of which set the task came from.

**Validation pass before committing tasks**:
- Pre-commit: run gemini-react against each new task with a 3-run probe (same shape as R10's reviewer variance check). If any new task produces < 2/3 finalState=1.0 across the probe, drop it from the set or rewrite the prompt. We don't ship a task to the harness if Pro 3 doesn't pass it cleanly — that's wasted teacher-capture compute.
- Probe trace dir: `evals/traces/wave-r12-task-probe/`.

**DoD — Behavior**:
- 10 new `EvalTask` files exist + registered in either `wave-r5-ab.eval.ts` or `wave-r12-extended.eval.ts` (lead-decided seam).
- Pre-commit Pro 3 probe sweep on the new tasks produces ≥ 7/10 tasks at finalState=1.0 and stepCoverage=1.0 (R10 base-rate is 2/20 = 10%; new-shape constraint should bump that to ≥ 70%).
- Existing 20-task baseline reports (R10, R11) remain comparable — the new task set is additive, not a replacement.

**Effort**: medium. Authoring 10 small EvalTasks is small; the probe-then-cull discipline adds wall-clock + cost (one extra Pro 3 run per task = ~$0.50 each = ~$5 total).

### P3 — Trajectory cleanup (truncate-at-last-STEP_DONE for over-execution recovery)

**Goal**: Recover the over-execution traces (`FAIL cov=1.0` shape — Pro hit all KeyNodes then kept tooling). Truncating the trajectory at the last `STEP_DONE` event before MAX_TOOL_ROUNDS converts these from rejected-by-strict-filter to clean training data.

**Touched**:
- New `packages/evals/src/distill/trajectory-cleanup.ts` — pure function `truncateAtLastStepDone(events: TraceEvent[]): TraceEvent[] | undefined`. Returns undefined when:
  - The trace already passed `isTraceStrictlyClean` (no truncation needed).
  - The trace has no `STEP_DONE` events (incomplete-coverage shape — not recoverable by truncation).
  - The last `STEP_DONE` is followed only by `RUN_COMPLETED:passed` (already a clean trace).
- The function emits a synthetic `RUN_COMPLETED:passed` marker after the last STEP_DONE if the original trace ended in `RUN_COMPLETED:failed` (over-execution). **This is the only place R12 manufactures status markers** — engineer surfaces this in P3 review explicitly. The synthetic marker carries an annotation `{ source: "trajectory-cleanup-synth", originalLastEvent: <event-type> }` in the metadata so downstream consumers can audit which traces were synthesized vs captured.
- `packages/evals/src/distill/teacher-data-exporter.ts` — extend to take an optional `cleanupMode: "off" | "truncate-overexec"` option. Default `off` (R11 behavior). When `truncate-overexec`, runs `truncateAtLastStepDone` on each trace before passing to `isTraceStrictlyClean`. Sidecar score recomputed against the truncated trajectory: `finalState` and `stepCoverage` reflect the truncated trace's KeyNode hits.
- `packages/evals/scripts/distill/recompute-sidecars.ts` — NEW Effect script: takes a sweep dir, runs each trace through truncation, recomputes sidecar scores via the existing scorer code path (same code that R11 P2 ships in `wave-r5-ab/build-report.ts`), writes `<runner>__<taskId>.cleanup-truncate.scores.json` next to the original sidecar.
- `packages/evals/tests/trajectory-cleanup.test.ts` — at minimum:
  1. Trace ending in `RUN_COMPLETED:passed` after final `STEP_DONE` returns undefined (already clean; no truncation).
  2. Trace ending in `RUN_COMPLETED:failed` with `STEP_DONE` reaching all KeyNodes earlier returns truncated trace ending at `RUN_COMPLETED:passed` synthetic marker.
  3. Trace with no `STEP_DONE` returns undefined (incomplete-coverage; not recoverable).
  4. Synthesized marker carries `source: "trajectory-cleanup-synth"` annotation.
  5. Live smoke against R10's `wave-r10-pro-preview/gemini-react__calibration-2-single-nav-news.ndjson` (FAIL cov=1.0 — known over-execution): runs cleanup, recomputes sidecar via the real scorer, asserts cleanup output passes `isTraceStrictlyClean`. (`it.skipIf` if R10 trace dir absent.)

**Why this is fail-closed by default**: R12's strict filter still rejects any trace that doesn't satisfy `isTraceStrictlyClean` over its sidecar. Cleanup runs BEFORE the filter — if cleanup can't recover the trace, the trace is rejected. Cleanup expanding the dataset is a positive add, not a relaxation of the filter.

**DoD — Behavior**:
- Running `pnpm --filter @neuve/evals distill:recompute-sidecars EVAL_SWEEP_DIR=evals/traces/wave-r10-pro-preview` produces `<runner>__<taskId>.cleanup-truncate.scores.json` files for each Pro 3 trace where `truncateAtLastStepDone` returned a non-undefined trajectory (expected: ~2-4 traces per sweep, the over-execution shapes).
- Running `pnpm --filter @neuve/evals distill:export EVAL_TRACE_DIR=evals/traces/wave-r10-pro-preview EVAL_DISTILL_CLEANUP=truncate-overexec` accepts ≥ 4 strict-pass traces from R10 (vs R10's 2 status-only-strict before cleanup). Cleanup recovers the over-execution shapes.
- The 5 R10 "passed-only" tasks (calibration-3, journey-6, moderate-1, moderate-2, trivial-2) remain rejected — confirmed not recoverable via truncation alone (premature + incomplete-coverage shapes).
- Synthetic markers in cleaned traces appear with `source: "trajectory-cleanup-synth"` in JSONL metadata; an exporter test asserts at least one cleaned sample carries this annotation.

**Risk flagged**: synthesizing a `RUN_COMPLETED:passed` marker is a manufactured signal. Engineer must surface this in the P3 review. The annotation tag + the audit-trail (sidecar suffix `.cleanup-truncate.scores.json` distinct from the original) preserves traceability — a reviewer or future debug pass can always identify which traces were synthesized.

**Effort**: medium. Pure function + scorer-recompute reuse + tests + synthesizing-marker discipline.

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

**Goal**: Train browsing-gemma on the winning config (full corpus, not held-out), then run the full wave-r5-ab sweep + N=3 multi-sweep variance check, to validate the capability-lift gate.

**Touched**:
- `packages/evals/scripts/distill/train.ts` — used as-is from R11; called with the winning config from P5.
- `packages/evals/scripts/distill/convert-gguf.ts` — used as-is.
- `packages/evals/scripts/distill/build-modelfile.ts` — emit `Modelfile` referencing the final adapter; create `browsing-gemma` (no config suffix) Ollama tag.
- `packages/evals/scripts/wave-r5-ab/build-report.ts` — already handles the 4-runner column shape from R11 P7. R12 reuses verbatim, runs aggregate over 3 sweep dirs.
- New `evals/traces/wave-r12-final-{1,2,3}/` — three full sweeps (gemma-react + gemini-react + gemma-oracle-plan + browsing-gemma-react × 20 tasks each = 80 traces per sweep × 3 = 240 traces).
- New `docs/handover/harness-evals/baselines/wave-r12-browsing-gemma.md` — auto-generated by build-report, hand-augmented with capability-lift gate verdict, multi-sweep variance table, off-task chat regression (manual probe — see below).

**Off-task chat regression probe**: a 10-prompt non-browsing prompt set (sample: "Explain recursion in two sentences"; "Sum 23 + 47"; "What's the capital of Brazil?"; etc). Run against `gemma4:e4b` and `browsing-gemma` via direct `/api/generate`. Score: response non-empty AND on-topic (LLM-judge or manual). Catastrophic narrowing manifests as `browsing-gemma` failing prompts that `gemma4:e4b` answers cleanly. Probe runs at end of P6, results captured in baseline report.

**DoD — Behavior**:
- After the 3-sweep capture completes, the baseline report `wave-r12-browsing-gemma.md` shows:
  - Mean over 3 runs of `browsing-gemma-react` step-cov ≥ mean over 3 runs of `gemma-react` step-cov + 0.10 (the capability-lift gate).
  - 95% confidence interval on the step-cov delta (computed from the 3-run distribution) excludes 0.05 (i.e. the lower bound of the CI is above the noise floor).
  - R8/R9/R10 invariants: empty-content 0/20 across all 3 sweeps on `gemma-react`; schema-invalid ≤ 5/20 (R9 widened gate per `project_baseline_eval_strategy.md`).
  - Off-task chat probe: ≥ 9/10 prompts pass on `browsing-gemma` (parity-or-better with `gemma4:e4b` baseline; <9/10 = catastrophic narrowing flag, ship blocked).
- Existing `gemma-react`, `gemini-react`, `gemma-oracle-plan` lanes remain within their R10 / R11 distribution bands.

**Effort**: medium-large. Three full 4-runner sweeps × 20 tasks ≈ 6+ hr each (gemma lane is the bottleneck); the off-task regression probe + report augmentation adds a small amount on top.

**Cost**: ~$50-75 in Pro 3 tokens (3 × R10's $17-25). MLX-LM training + browsing-gemma local eval = $0.

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

1. **Multi-sweep dataset growth**: aggregating sweeps 0+1+2 yields ≥ 6 strict-pass traces (R10 floor ×3, allowing for ~50% inter-sweep overlap).
2. **New task set Pro-friendly**: pre-commit Pro 3 probe on the 10 new EvalTasks produces ≥ 7/10 finalState=1.0 + stepCoverage=1.0.
3. **Trajectory cleanup recovery**: cleanup-mode `truncate-overexec` exporter run accepts ≥ 4 strict-pass traces from R10's `wave-r10-pro-preview/` (vs 2 without cleanup); no recoverable traces show synthesized markers without the audit-trail annotation.
4. **Off-task replay corpus**: blended JSONL (30 teacher + 10 off-task at ratio 0.25) decodes through `TrainingSample` schema and round-trips through the exporter without rejection; off-task samples carry `metadata.source = "ultrachat-200k"`.
5. **Hyperparam sweep numbers**: 9-config Latin-square produces 9 valid `summary.json` rows; engineer surfaces top-3 to lead with concrete step-cov deltas vs gemma-react on the held-out 7-task subset.
6. **Capability-lift gate (PRIMARY)**: full 3-sweep wave-r5-ab on the winning config produces `mean(browsing-gemma-react step-cov) ≥ mean(gemma-react step-cov) + 0.10` with the 95% CI lower bound > 0.05.
7. **No catastrophic narrowing**: 10-prompt off-task chat regression probe scores ≥ 9/10 on browsing-gemma (parity-or-better vs base-gemma).
8. **R8/R9/R10 invariants intact** on `gemma-react` lane: empty-content 0/20 each sweep, schema-invalid ≤ 5/20 each sweep.
9. **R11 behavioral floor preserved**: `browsing-gemma-react step-cov ≥ base-gemma-react step-cov − 0.05` on every individual sweep (regression check; stronger gates above subsume this but the floor catches catastrophic per-sweep drift).
10. **Reproducibility**: a fresh repo + fresh Ollama install can reconstruct `browsing-gemma` from committed artifacts via `ollama create` in < 30 seconds.

## Risk areas

1. **Multi-sweep convergence below threshold**. If sweeps 1+2 produce < 4 new strict-pass traces (heavy task overlap with sweep 0), dataset stays at ~4 traces — below the 15/5 minimum. Mitigation: P2 new-task additions are the main hedge; if both P1 and P2 underdeliver, R12 ships at "behavioral-floor only" (R11's gate, not the +0.10 gate) and lead authorizes either an additional sweep round or scope-cut.
2. **Catastrophic narrowing despite off-task blend**. Gate 7 (off-task regression probe) catches it. Mitigation: increase blend ratio in P5's sweep (one of the matrix configs is 0.50 if the lower ratios fail).
3. **Synthesized RUN_COMPLETED markers from P3 cleanup pollute training data**. Annotation tag + sidecar suffix audit trail mitigates. Reviewer must spot-check at least one cleaned trace in the P3 review. If reviewer disagrees with synthesis as a class, drop P3 and ship without cleanup (loses ~2 traces per sweep but preserves training-data purity).
4. **Held-out subset overfit**. P5's 7-task held-out is small (calibration-1..5 + trivial-1, trivial-2). The winning hyperparams might overfit to the held-out shape and underperform on full wave-r5-ab. Mitigation: P6's full sweep is the actual capability-lift validation; P5's held-out is a config-ranking signal only, not the gate. If P6 shows the P5-winner regresses on full-set, lead authorizes re-sweep over top-3 configs against the full-set.
5. **GCP free trial $300 expired** (if R13 needs Vertex). Out of R12 scope but flagged: free trial valid 90 days; if R12 work spans >90 days from initial signup, the trial may have expired by the time R13 starts. Workaround: pay-as-you-go billing kicks in automatically — Vertex pricing tables are visible to R13 planners.
6. **MLX-LM Gemma 4 LoRA-rank-32 wall-clock surprise**. R11 P4 verifies rank=8 on Gemma 4 E4B. Rank=32 has ~4× the trainable params; on M4 hardware this might push training time per config from ~5 min to ~20 min. P5's 9-config sweep wall-clock could grow to ~3 hr. If this happens, P5 falls back to rank ∈ {8, 16} only (6-config Latin-square instead of 9).
7. **Pro 3 SKU rotation**. `gemini-3-pro-preview` may rotate to a new preview SKU between P1 sweep 1 and sweep 2 (Google's preview SKUs do this). If the SKU 404s mid-sweep, the env-var override path documented in R10 closure (`PERF_AGENT_GEMINI_REACT_MODEL`) lets us swap to the next-revision SKU without code change. Engineer must detect this — eval harness logs `modelId: 'gemini-3-pro-preview'` at startup; if the underlying `modelVersion` field of `generateContent` responses changes mid-sweep, pause and reconcile.
8. **Off-task narrowing on protocol envelopes**. Even if free-text chat regression passes, browsing-gemma might lose its ability to emit Path-B-shaped `AgentTurn` envelopes when given non-browsing prompts. Out-of-distribution behavior. Mitigation: the 10-prompt probe in P6 explicitly includes 2-3 non-browsing prompts of the AgentTurn shape ("Output a JSON object with field 'reasoning' set to 'foo'") to catch envelope-emission narrowing.

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
| P1 (sweeps 1+2) | $35-50 | Pro 3 tokens (R10 baseline ×2) |
| P2 (probe sweep on 10 new tasks) | $5 | Pro 3 tokens (~$0.50 per task) |
| P3 (cleanup + recompute) | $0 | Local-only |
| P4 (UltraChat fetch + blend) | $0 | Local-only; HF datasets free tier |
| P5 (9-config Latin-square) | $0 | MLX-LM local + held-out 7-task eval is local |
| P6 (3-sweep validation) | $50-75 | Pro 3 tokens (R10 baseline ×3) |
| P7 (promotion) | $0 | Local-only |
| **Total** | **$90-130** | Conservative, dominated by Pro 3 token spend |

Within the same envelope as R10's $17-25 sweep × roughly 4-5 sweeps. No GCP / Vertex cost in R12 (deferred to R13).
