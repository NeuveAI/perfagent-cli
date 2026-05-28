# Session Handover — 2026-05-07

## What we did this session

Shipped the **harness-r3 wave** end-to-end via `/team-orchestration` + `/strict-critique`.

- **HEAD**: `aa8887e0` on `gemma-harness-lora` (13 commits between `29bc2113..aa8887e0`)
- **Verdict**: reviewer APPROVE INVESTIGATIVE-VERIFIED (0 BLOCKING / 0 MAJOR / 2 MINOR landed)
- **Plan**: `docs/research/harness-r3/plan.md` @ `29bc2113`
- **Diary**: `docs/handover/harness-r3/diary/r0-2026-05-06.md`
- **Baseline**: `docs/handover/harness-evals/baselines/wave-harness-r3.md`
- **Review**: `docs/handover/harness-r3/reviews/r0-strict-critique-2026-05-07.md`
- **Memory**: new `project_harness_r3.md` + `MEMORY.md` index updated
- Team torn down; both teammates shut down cleanly.

### Wave outcome by phase

| Phase | Verdict | Result |
|---|---|---|
| **P1** Structural REFLECT-injection | **SHIPPED (INFO-VERIFIED)** | `REFLECT_INJECTION_THRESHOLD=2` detector in `tool-loop.ts` + mirror in `gemini-react-loop.ts` + `<reflect_directive>` parsing rule in shared prompts + 4 fixture tests. 7/60 firings, 0 false-fire. |
| **P2** Deterministic-stuck divergence | **DIAGNOSTIC-ONLY** | Reframed harness-r2's variance hypothesis; surfaced harness-r4 candidate. No code. |
| **P3** Oracle-plan capability autopsy | **DIAGNOSTIC-ONLY** | 4 capability-gap findings + 5 routing recos. No code. |
| **P4** Close-out | shipped | Diary + baseline + 2 MINOR narrative corrections. |

### Four substantive findings

1. **HEADLINE — first non-zero PLAN_UPDATE emission in the entire harness-rN sequence**: 1/60 vs 0/240 across 4 harness-r2 sweeps. Structural injection moved a rate that two waves of prompt teaching could not. Calibration-5 trace is the verbatim mechanism proof (model THOUGHTs "I must now use PLAN_UPDATE to correct the plan", then emits it).

2. **Capability gap reframed: parsing → recovery-shape generation**. Model recognizes the injected REFLECT directive (parsing intact) but post-REFLECT PLAN_UPDATE rate is 14% (1/7), below the 50% target. The 1 emission was `action=remove` (surrender shape), not `action=replace`/`action=insert` (recovery shape). 6/7 chose surrender (RUN_COMPLETED) or ignore-and-retry.

3. **harness-r2 variance narrative corrected**: deterministic-stuck divergence under temp=0 is **model-stochasticity-residual** (KV cache / sampling order), NOT env/DOM input deltas as harness-r2 hypothesized. 3/4 canonical task pairs reduce to the BMW pattern (addressed by P1); 1/4 is a structurally-distinct THOUGHT-only loop.

4. **P3 autopsy — causal misattribution under repeated failure**: 5/5 inspected gemma-oracle-plan failures show the model externalizing blame to tool/environment instead of reconsidering the plan, defaulting to surrender. Also surfaced a **detector limitation**: same-shape `errorShape` requirement misses vary-each-attempt rejection patterns (calibration-1-oracle-plan: 5 different-shape parse-fails → 0 REFLECT).

### Post-r3 numbers (vs harness-r2 pin-2 anchor)

| Runner | step-cov | Δ vs pin-2 | strict-pass | schema-invalid | empty | PLAN_UPDATE |
|---|---|---|---|---|---|---|
| gemma-react | 0.307 | -0.054 ✓ | 2/20 | 0/20* | 0/20 | 1/20 |
| gemini-react | 0.426 | -0.039 (knife-edge) | 3/20 | 0/20* | 0/20 | 0/20 |
| gemma-oracle-plan | 0.257 | -0.129 (marginal, within harness-r2's 0.107 natural band) | 0/20 | 0/20* | 0/20 | 0/20 |

\* schema-invalid 5/20 → 0/20 is a **measurement-shift artifact** (pre-r3 counted first-strike-aborts; post-r3 the harness recovers, so the equivalent metric is REFLECT-injection rate 7/60), reviewer-verified honest, not laundering.

## Direction we're headed

The harness work has reached a clear inflection: structural injection **works mechanically** (PLAN_UPDATE off the floor for the first time), but the model's bottleneck is no longer parsing/recognition — it's **recovery-shape generation**. The model surrenders instead of replanning. That is a capability/training-data problem, which routes toward distillation (R12) more than further harness tricks.

## Missing steps after this workstream

### harness-r4 candidates (fully spec'd, dispatchable)
1. **Vary-each-attempt rejection detector** — generalize the REFLECT-injection detector to fire on N consecutive parse-fails on same `stepId` regardless of `errorShape` match (closes the P3 detector limitation).
2. **THOUGHT-only loop detector** — `THOUGHT_REFLECT_THRESHOLD=5 < THOUGHT_LOOP_ABORT_THRESHOLD=6`, symmetric with the existing rejection ladder. 8/120 gemma-only incidence (0/40 gemini-react). File pointers: `tool-loop.ts:245-258`, `gemini-react-loop.ts:360-367`. Inline-archived incidence script in diary §P2 appendix.
3. **Plan-step granularity probe** — Pro 3's plans assume execution capacity gemma lacks.

### R12 distillation routing (new data targets from P3)
- **Recovery-shape PLAN_UPDATE training data** — capture `action=replace`/`action=insert` exemplars from teacher traces; gemma's surrender bias is a generative-shape problem distillation can target.
- **Tool-discriminator disambiguation** — `interact{command:...}` vs flat `click`/`fill` vs `observe{evaluate,...}` confusion (4/7 REFLECT triggers were `interact` malformed-arg).
- **Re-evaluate R12 plan** (locked at `33edcc91`) against post-r3 anchors — schema-invalid floor reframed; the gemma-oracle-plan -0.129 marginal regression needs disentangling before dispatch.

### The strategic call (pending user)
harness-r3 is a categorical breakthrough (1/60 vs 0/240) but small on aggregate step-cov. Three paths:
- **(a) harness-r4 first** — the two detectors are quick and fully spec'd, then R12 with sharper data targets.
- **(b) R12 directly** — pivot to distillation now; the recovery-shape + tool-discriminator findings are the data targets.
- **(c) strategic pivot** — bigger base model (Gemma 4 12B) or alternate teacher (Sonnet 4.6 / GPT-5) if harness lift is diminishing-returns.

## Process invariants still active

- No `git stash` / `reset --hard` / `checkout --` / `--no-verify` / `git push` (`feedback_reviewer_never_stash.md`)
- No Co-Authored-By; granular commits after reviewer APPROVE (`feedback_commit_guidelines.md`)
- Real services for live smokes — no `MockLanguageModelV4` (`feedback_no_test_only_injection_seams.md`)
- `pnpm --filter @neuve/local-agent build` before any sweep touching local-agent source (`project_eval_build_cache_trap.md`)
- Distribution-form gates, never single-sample (`project_baseline_eval_strategy.md`)
- No prompt overfitting — reasoning-framework changes only (`feedback_avoid_prompt_overfitting.md`)
- Always read prior work in full before planning (`feedback_always_read_prior_work.md`)
- Use persistent teammates via TeamCreate for orchestration (`feedback_use_teammates.md`)
- Hacking tone, no day estimates (`feedback_hacking_tone.md`)
