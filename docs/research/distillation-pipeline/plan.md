# R11 — Distillation pipeline plumbing

_Wave dispatched after R10 (teacher-viability ladder INVESTIGATIVE-VERIFIED 2026-04-30) proved `gemini-3-pro-preview` is a viable teacher (+0.166 step-cov, gate cleared even on worst-case +0.101 vs R9 best gemma). R11 builds pipeline plumbing on top of Wave 5's feature-complete distillation foundation; R12 (separate wave) tackles data quality + capability lift._

## What we're building

End-to-end automation from teacher trace capture → strict-filtered training data → MLX-LM LoRA training → GGUF adapter → Ollama deployment → eval comparison. Goal: prove the pipeline works end-to-end with verifiable outcomes, lay the groundwork for R12 to focus exclusively on data-quality work.

R11 ships infrastructure value independent of capability lift. Distillation-on-distillation collapse and the data-scarcity ceiling (2/20 strict-pass traces from R10) mean **R11 must NOT promise a behavioral lift** — only that the pipeline runs end-to-end without breaking the existing gemma path.

## What we're explicitly NOT building

- **Vertex AI training backend.** Cost analysis (`docs/research/distillation-pipeline/cost-analysis-vertex.md` — to be captured in R11 P4 diary) showed Vertex isn't faster than MLX-LM at our R11 scale (≤20 examples × 1 epoch — provisioning overhead dominates 100-second training jobs). Revisit in R12 if dataset growth crosses ~30 traces and parallelization becomes useful.
- **Path A native `<|tool_call>` token format.** Our production ReAct stack post-R7 uses Path B (grammar-override JSON envelope via Ollama `format`). Training browsing-gemma to emit Path A would fork from runtime; deferred to R13 (or never, depending on Ollama upstream parser fix landing).
- **Capability lift over base-gemma.** Data-scarcity-bound — 2 clean traces, both trivial-shape. R11's behavioral floor is "no significant regression vs base-gemma." R12 owns capability lift.
- **Beating Pro 3.1 on journey-* tasks.** We don't have clean journey-* training data; the intersection of "Pro wins" and "strict-filter pass" is empty under R10 traces.
- **Hyperparameter exploration.** R11 runs ONE conservative configuration (rank 8, 1 epoch, lr 5e-5). Sweeps belong in R12 once dataset has signal.
- **Multi-sweep capture, trajectory cleanup, oracle-plan trajectory mixing.** All R12.
- **Vision/audio Gemma 4 modalities, DPO/GRPO preference learning, multi-task distillation beyond `wave-r5-ab` task set.**

## Decision log (locked)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Two-wave split: R11 plumbing + R12 data quality** | R10 strict filter yields 2/20 clean traces — too few for capability lift. Shipping plumbing first lets us prove infrastructure independent of data-quality bottleneck. |
| 2 | **Build on Wave 5 distillation pipeline** (don't rebuild) | Wave 5 (`docs/handover/harness-evals/diary/wave-5-distillation.md`) is feature-complete with reviewer APPROVE round 2 + 117 tests. R11 retrofits — strict filter, identity rename, training driver, GGUF convert, eval automation. |
| 3 | **Path B (grammar-override JSON envelope) for tool-call format** | Matches our production ReAct runtime (R7-R10 stabilized this). Training the LoRA to emit Path A would fork from runtime parser. Path A revisit deferred to R13 if Ollama tool-parsing lands clean. |
| 4 | **MLX-LM local as the training stack** | At R11 scale (≤20 examples × 1 epoch) Vertex provisioning overhead negates speedup. MLX-LM is $0 and comparable wall-clock. Vertex backend deferred. |
| 5 | **`browsing-gemma` is the canonical name** | Per `project_lora_name.md` (locked 2026-04-24). Wave 5 code currently uses `gemma4-perfagent`; R11 P1 reconciles. |
| 6 | **Strict R10 filter: `RUN_COMPLETED:passed AND finalState == 1.0 AND stepCoverage == 1.0`** | R10 closure note. Yields 2/20 traces; both at trivial-shape. Status-only filter would let Pro's two-shape stopping-criterion problem (premature + over-execution) pollute training data. |
| 7 | **Behavioral floor only for R11 DoD** | Data-scarcity-bound. "browsing-gemma step-cov ≥ base-gemma step-cov − 0.05" proves the pipeline doesn't break gemma. Lift is R12 work. |
| 8 | **Conservative hyperparams for R11 training** | rank 8, 1 epoch, lr 5e-5 (lower than Unsloth's "default 2e-4" — Gemma 4 E4B is already distilled, double-distillation collapse risk per April 2026 community signal). Hyperparam exploration is R12. |

## Prior work to build on (already shipped)

| Source | What it provides |
|---|---|
| `packages/evals/src/distill/teacher-data-exporter.ts` | Effect service producing `TrainingSample[]` JSONL from ndjson traces |
| `packages/evals/src/distill/filters.ts` | `isTraceSuccessful` (status-only, R11 retrofits to strict) + `redactSensitiveKeys` |
| `packages/evals/src/distill/jsonl-writer.ts` | Pure renderer + scoped writer |
| `packages/evals/src/distill/modelfile-builder.ts` | FROM/ADAPTER/SYSTEM/MESSAGE Modelfile emitter, 11 tests |
| `packages/evals/src/distill/modelfile-messages.ts` | OpenAI chat → Modelfile MESSAGE conversion (drops system, inlines tool into assistant via `<tool_result>`) |
| `packages/evals/scripts/distill/{export-teacher-data,build-modelfile,smoke-finetune}.ts` | CLI surfaces, all wired |
| `packages/evals/src/redaction.ts` | `REDACTED_KEY_PATTERN` single source of truth |
| `packages/evals/data/distill/examples/` | Two synthetic traces + sample JSONL + Modelfile (reproducible artifacts) |
| `packages/evals/tests/{teacher-data-exporter,modelfile-builder}.test.ts` | 22 tests covering filter + exporter + Modelfile grammar |
| `docs/handover/harness-evals/diary/wave-5-distillation.md` | Design narrative + handover recipe at lines 235-263 |
| `docs/handover/harness-evals/reviews/wave-5-review-round-{1,2}.md` | Reviewer feedback (round 2 APPROVE — all C1, C2, M1-M5 resolved) |
| `docs/research/gemma-react-browsing/architecture-prd.md` | Distillation §9 + curriculum learning + tool-call format paths |

## Phases

### P1 — Identity reconciliation (`gemma4-perfagent` → `browsing-gemma`)

**Goal**: rename the LoRA identity across distill code paths so the canonical name from `project_lora_name.md` matches what the code uses.

**Touched**:
- `packages/evals/scripts/distill/build-modelfile.ts:13,16` — `EVAL_DISTILL_BASE_MODEL` defaults stay `gemma4:e4b`; `EVAL_DISTILL_ADAPTER` default `./adapters/gemma4-perfagent.gguf` → `./adapters/browsing-gemma.gguf`
- `packages/evals/scripts/distill/smoke-finetune.ts:40` — model-name constant `perfagent-smoke-finetune` → `browsing-gemma-smoke`
- `packages/evals/data/distill/examples/Modelfile` — regenerate with new adapter path
- `docs/handover/harness-evals/diary/wave-5-distillation.md:257-263` — update recipe (or note that R11 supersedes via reference link)

**Verifiable**: `grep -rn 'gemma4-perfagent\|perfagent-smoke' packages/evals/` returns zero. `pnpm --filter @neuve/evals distill:smoke-finetune` creates+removes `browsing-gemma-smoke` model successfully (existing test passes with new name).

**Effort**: small (single-line edits + smoke verification + Modelfile regeneration).

### P2 — Strict-filter retrofit (`finalState == 1.0 AND stepCoverage == 1.0`)

**Goal**: extend `isTraceSuccessful` to enforce R10's tri-criterion. Scores live in `ExecutedTrace` (computed at evalite time), not in ndjson — need sidecar score files.

**Touched**:
- `packages/evals/src/runners/trace-recorder.ts` OR `packages/evals/scripts/wave-r5-ab/build-report.ts` — emit per-trace `<runner>__<taskId>.scores.json` sidecar at run time, containing `{ status, finalState, stepCoverage }`. Pick the single closest seam — likely the report builder since it already computes these scores.
- `packages/evals/src/distill/filters.ts` — extend `isTraceSuccessful(events)` → `isTraceSuccessful(events, scoresFile?)` reading sidecar; both new args required for strict mode (false if missing).
- `packages/evals/src/distill/teacher-data-exporter.ts` — pass sidecar path alongside ndjson path through the exporter pipeline.
- `packages/evals/tests/teacher-data-exporter.test.ts` — add 3 tests:
  1. Strict filter accepts `passed + finalState=1.0 + stepCoverage=1.0` (calibration-1, trivial-1 from R10)
  2. Strict filter rejects `passed + finalState=0.5 + stepCoverage=1.0` (premature pattern: trivial-2, journey-6)
  3. Strict filter rejects `passed + finalState=1.0 + stepCoverage=0.5` (over-execution pattern: synthetic case for now)

**Decision (intra-phase)**: at filter level, gate on missing sidecar. Old traces without sidecars get rejected (fail-closed). This avoids accidental fallback to status-only filtering on legacy traces.

**Verifiable**: 22 prior tests still pass. 3 new strict-filter tests pass. Running `pnpm --filter @neuve/evals distill:export EVAL_TRACE_DIR=evals/traces/wave-r10-pro-preview EVAL_DISTILL_OUTPUT=...` against R10's existing traces (after sidecar generation) accepts exactly **2/20** gemini-react traces (calibration-1, trivial-1) per R10 closure note.

**Effort**: medium (sidecar emission seam decision + filter extension + tests + retroactive sidecar generation for R10 traces).

### P3 — Tool-call format alignment (Path B grammar-override conformance)

**Goal**: pin the existing exporter output as Path B JSON envelope shape (matches R7-R10 runtime parser at `packages/shared/src/react-envelope.ts`). Add unit test so format drift is caught at PR time.

**Touched**:
- `packages/evals/tests/teacher-data-exporter.test.ts` — new test: parse the emitted JSONL `assistant.toolCalls[].arguments` JSON-string through the production runtime parser (`packages/shared/src/react-envelope.ts AgentTurn`); assert decode succeeds.

**Verifiable**: New test passes against the existing 2 synthetic traces. R10 strict-pass traces (calibration-1, trivial-1) export cleanly under the strict filter from P2 and round-trip through `parseAgentTurn`.

**Note**: Per Wave 5 diary lines 53-87 + assessment §9, the existing exporter already emits Path B shape (`assistant.content` carries marker text + `assistant.toolCalls[]` carries tool args as JSON string). This phase's purpose is regression protection, not behavior change.

**Effort**: small (single test + verification).

### P4 — MLX-LM training driver (`distill:train`)

**Goal**: new script that consumes the JSONL produced by `distill:export` and produces a Safetensors LoRA adapter via `mlx_lm.lora`.

**Touched**:
- New `packages/evals/scripts/distill/train.ts` — Effect-based wrapper that:
  - Reads env: `EVAL_DISTILL_INPUT` (JSONL path), `EVAL_DISTILL_TRAIN_OUTPUT` (adapter dir), `EVAL_DISTILL_BASE_MODEL_PATH` (HF model path or `gemma-4-e4b-it`), `EVAL_DISTILL_TRAIN_RANK` (default 8), `EVAL_DISTILL_TRAIN_EPOCHS` (default 1), `EVAL_DISTILL_TRAIN_LR` (default 5e-5)
  - Validates `mlx_lm.lora` is on PATH (`which mlx_lm.lora`)
  - Validates JSONL conforms (decode each line via `Schema.decodeUnknownEffect(TrainingSample)`)
  - Spawns `mlx_lm.lora --model <model-path> --train --data <input-dir> --iters <calc-from-epochs> --rank <rank> --learning-rate <lr> --adapter-path <output>` via `Effect.tryPromise` + `child_process.spawn`
  - Tagged errors: `MLXLMUnavailableError`, `MLXLMTrainFailedError`, `JsonlValidationError`, `AdapterArtifactMissingError`
  - On success: verifies adapter file exists at expected path, returns adapter path + summary stats
- New `packages/evals/tests/distill-train.test.ts` — at least:
  - Unit: error if `mlx_lm.lora` not on PATH (skip-if-present pattern)
  - Live smoke: full end-to-end with the 2 synthetic R10 strict-pass traces, asserting adapter file exists and is non-empty (`it.skipIf` when MLX-LM unreachable; live-only path per `feedback_no_test_only_injection_seams.md`)
- `packages/evals/package.json` — add `distill:train` script

**Hyperparams (defaults locked for R11)**:
- LoRA rank: **8** (conservative; community signal flags rank 16+ for harder narrow tasks but Gemma 4 E4B is already distilled — start small)
- Epochs: **1** (small dataset overfits past 3-5 epochs)
- Learning rate: **5e-5** (lower than Unsloth's "default 2e-4"; double-distillation risk mitigation)
- Validation split: 0% (only 2 traces — can't hold out; R12 reassesses when dataset > 5)

**Verifiable**: `pnpm --filter @neuve/evals distill:train` against the 2-trace dataset exits 0 with adapter file at `<output>/adapters.safetensors`. Live smoke test passes when MLX-LM is on PATH.

**Effort**: medium (Effect wrapping + spawn + tests; MLX-LM is the unknown — first-time integration).

### P5 — GGUF conversion (`distill:convert-gguf`)

**Goal**: convert MLX-LM Safetensors adapter to GGUF format Ollama can load via `ADAPTER` directive.

**Touched**:
- New `packages/evals/scripts/distill/convert-gguf.ts` — Effect wrapper around llama.cpp's `convert_lora_to_gguf.py`:
  - Reads env: `EVAL_DISTILL_ADAPTER_INPUT` (Safetensors dir from P4), `EVAL_DISTILL_ADAPTER_OUTPUT` (`.gguf` path), `EVAL_DISTILL_LLAMA_CPP_PATH` (path to llama.cpp checkout)
  - Validates `convert_lora_to_gguf.py` exists at expected llama.cpp path
  - Spawns `python convert_lora_to_gguf.py --base <base-model-gguf> --outfile <out.gguf> <adapter-input-dir>` via `Effect.tryPromise`
  - Tagged errors: `LlamaCppUnavailableError`, `GgufConvertFailedError`, `BaseModelGgufMissingError`
  - On success: verifies output `.gguf` exists, returns path + size
- Extend `packages/evals/scripts/distill/smoke-finetune.ts` (existing script): add a new code path activated by `EVAL_DISTILL_USE_ADAPTER=1` that builds the Modelfile WITH the `ADAPTER` directive (current smoke explicitly omits it), creates `browsing-gemma-smoke-adapter`, runs same generate probe, cleans up.
- New `packages/evals/tests/distill-convert-gguf.test.ts`:
  - Unit: error if llama.cpp path missing
  - Live smoke: convert the P4 output adapter, assert `.gguf` exists, assert `ollama create browsing-gemma-smoke-adapter -f <Modelfile-with-ADAPTER>` succeeds (`it.skipIf` when llama.cpp unreachable)
- `packages/evals/package.json` — add `distill:convert-gguf` script

**Verifiable**: `.gguf` file produced; existing `smoke-finetune.ts` test extended to load adapter via `ADAPTER` directive succeeds with non-empty response (proves the wired-up adapter affects generation, even if minimally on a 2-trace LoRA).

**Risk flagged**: Per Apr 2026 web research, Ollama's Safetensor adapter support matrix doesn't list Gemma 4 — GGUF is the required path. If llama.cpp's `convert_lora_to_gguf.py` doesn't yet handle Gemma 4 LoRA shapes, this phase blocks. Engineer should validate compatibility as a P5 sub-probe-zero before committing the wrapper.

**Effort**: medium (similar shape to P4 — Effect spawn wrapper + tests; conversion script behavior is the unknown).

### P6 — Eval-runner browsing-gemma lane

**Goal**: extend `wave-r5-ab.eval.ts` to run a fourth runner (`browsing-gemma-react`) alongside gemma-react / gemini-react / gemma-oracle-plan.

**Touched**:
- `packages/evals/src/runners/runner-names.ts` — add `BROWSING_GEMMA_REACT_RUNNER_NAME = "browsing-gemma-react"`
- `packages/evals/src/runners/gemma.ts` — `makeGemmaRunner` already accepts a model name via `GemmaRunnerOptions.model`. Verify: passing `browsing-gemma` (the Ollama-created model name from P1+P5) routes through the existing local-agent path. If yes, no new runner file needed — just a registration in `wave-r5-ab.eval.ts`.
- `packages/evals/evals/wave-r5-ab.eval.ts` — register the new runner with `model: "browsing-gemma"` (Ollama model name post-P5 deployment). Skip via `EVAL_R5_SKIP_RUNNERS=browsing-gemma-react` when LoRA isn't built yet.
- `packages/evals/scripts/wave-r5-ab/build-report.ts` — handle new runner column in aggregator.

**Verifiable**: After P1+P4+P5 land + `ollama create browsing-gemma -f <Modelfile>` succeeds, running `pnpm --filter @neuve/evals eval:wave-r5-ab` produces 80 trace files (20 tasks × 4 runners) including 20 `browsing-gemma-react__*.ndjson`. Aggregator shows browsing-gemma column.

**Effort**: small-to-medium (mostly registration + aggregator extension; the gemma runner already handles arbitrary Ollama model names).

### P7 — Automated comparison report

**Goal**: extend the existing `wave-r5-ab:report` script to emit a comparison report with browsing-gemma deltas vs base-gemma vs Pro 3.1 vs oracle-plan.

**Touched**:
- `packages/evals/scripts/wave-r5-ab/build-report.ts` — extend per-task table + aggregate scoreboard with browsing-gemma column. Compute deltas: browsing-gemma vs base-gemma (the regression check), browsing-gemma vs Pro (the lift ceiling).
- `docs/handover/harness-evals/baselines/wave-r11-browsing-gemma.md` — auto-generated artifact path (mirrors `wave-r10-pro-preview.md` structure).

**Verifiable**: After P6 produces traces, `pnpm --filter @neuve/evals wave-r5-ab:report` outputs `wave-r11-browsing-gemma.md` with per-task win/tie/loss vs base-gemma + aggregate step-cov delta + R8/R9/R10 invariant rows (empty-content, schema-invalid, premature-completion counts).

**Effort**: small (additive report extension).

## Wave gates / DoD

1. **Identity reconciliation**: `grep -rn 'gemma4-perfagent\|perfagent-smoke' packages/evals/` returns zero. `browsing-gemma` is the canonical name.
2. **Strict-filter correctness**: 22 prior tests pass + 3 new strict-filter tests pass. Running exporter against R10 traces accepts exactly 2/20 gemini-react traces (calibration-1, trivial-1).
3. **Path B format conformance**: new test pins exporter output decodes through production `parseAgentTurn`.
4. **MLX-LM training driver**: `distill:train` produces Safetensors adapter on the 2-trace dataset; live smoke test passes.
5. **GGUF conversion + adapter load**: `distill:convert-gguf` produces loadable `.gguf`; extended smoke creates Ollama model with `ADAPTER` directive and gets non-empty response.
6. **End-to-end local pipeline (single command sequence)**: 
   ```
   pnpm distill:export → distill:train → distill:convert-gguf → distill:build-modelfile && ollama create browsing-gemma -f <Modelfile>
   ```
   exits 0 from start to finish.
7. **Eval lane**: `pnpm eval:wave-r5-ab` produces 4 runner columns including `browsing-gemma-react`; aggregator emits `wave-r11-browsing-gemma.md`.
8. **Behavioral floor (no significant regression)**: `browsing-gemma-react` mean step-coverage ≥ `gemma-react` mean step-coverage − 0.05 on full 20-task sweep. (Tighter regression band — given training data is 2 trivial traces, anything worse than -0.05 means the LoRA broke the base-gemma capability rather than just adding nothing.)
9. **R8/R9/R10 invariants intact** on `gemma-react` lane: empty-content 0/20, schema-invalid ≤5/20.

## Risk areas

1. **Data scarcity dominates**: training a LoRA on 2 trivial traces will at best teach "navigate to X, confirm DOM" — that's it. Gate 8 (no-regression) is the only meaningful behavioral test. Don't over-promise.
2. **Distillation-on-distillation collapse** (April 2026 community signal): Gemma 4 E4B is itself distilled (4.5B effective from 8B via MatFormer). Fine-tuning with ≤20 examples either no-ops or overfits hard. Conservative hyperparams (rank 8, 1 epoch, lr 5e-5) mitigate; behavioral-floor gate catches catastrophic narrowing.
3. **GGUF conversion compatibility for Gemma 4 LoRA adapters**: April 2026 web research flagged Gemma 4 not yet on Ollama's Safetensor matrix. P5's sub-probe-zero is "verify llama.cpp `convert_lora_to_gguf.py` handles Gemma 4 shapes" — if it doesn't, this phase blocks until upstream lands support.
4. **Catastrophic narrowing**: fine-tuning may make browsing-gemma WORSE at off-task behavior (the LoRA over-specializes on the 2 trivial-shape traces). Behavioral floor catches the worst cases on harness tasks; off-task degradation isn't measured here (would need a separate eval out of R11 scope).
5. **MLX-LM Gemma 4 first-time integration**: web research says MLX-LM supports Gemma 4 (per Apple `mlx_lm.lora` docs), but our team hasn't run it. P4 sub-probe-zero verifies on a known-good HF base model checkpoint before wiring full pipeline.
6. **Sidecar score-file backfill**: P2's strict filter requires sidecars on existing R10 traces. The sidecar emission seam in eval runners must also retroactively populate the 60 traces in `evals/traces/wave-r10-pro-preview/` and any other archives we want exported. Engineer must decide: (a) one-shot retrobackfill script or (b) require re-eval, accepting we lose access to R10 traces until re-run. Lean: (a), retroactive script reading existing trace ndjson + the report builder's score logic.

## Out of scope (R12 hooks)

R11 does NOT solve, R12 owns:
- Multi-sweep capture to grow strict-pass dataset above engineer's 15/5 threshold
- Trajectory cleanup (truncate-at-success-state for over-execution, recover-finalState for premature) to recover the 5 "passed-only" stragglers
- New task set authoring (smaller-grained journey-* tasks where Pro reliably reaches finalState=1.0)
- Hyperparam exploration (rank, epochs, lr sweeps; possibly higher rank per Thinking Machines "LoRA Without Regret" guidance)
- Off-task chat data augmentation to mitigate catastrophic narrowing
- Vertex AI training backend (revisit when dataset > 30 traces)
- Path A native `<|tool_call>` token format migration (defer to R13 conditional on Ollama upstream parser fix)
- Production deployment beyond local Ollama
- Capability-lift gates (browsing-gemma > base-gemma or > Pro 3.1)

## Process invariants

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`, `Effect.fn` with descriptive spans, `Effect.acquireRelease` for resource lifecycle, no `catchAll`/`mapError`/`null`/`as`-casts (per `CLAUDE.md`).
- No `Co-Authored-By` footer. Granular commits after reviewer APPROVE per `feedback_commit_guidelines.md`.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push` per `feedback_reviewer_never_stash.md`.
- Real services for all live smoke tests: real MLX-LM (skip-if-unavailable), real Ollama (skip-if-unavailable), real llama.cpp `convert_lora_to_gguf.py`. No `MockLanguageModelV4` per `feedback_no_test_only_injection_seams.md`.
- `pnpm --filter @neuve/local-agent build` before any sweep that exercises new local-agent source per `project_eval_build_cache_trap.md`. R11 P6 doesn't currently expect to touch local-agent (P6 only registers a new model id — local-agent's existing Ollama plumbing handles arbitrary names) but the discipline holds if any seam needs touching.
- No prompt overfitting per `feedback_avoid_prompt_overfitting.md`. The Modelfile SYSTEM directive uses `buildLocalAgentSystemPrompt()` unchanged — same prompt as production runtime. browsing-gemma learns from trajectories, not prompts.
- Always read prior work in full before drafting new sub-plans per `feedback_always_read_prior_work.md`.

## Team structure

`react-r11` with engineer + reviewer per `feedback_use_teammates.md`.

- **T1 (engineer)**: P1 + P2 + P3 — identity rename, strict-filter retrofit, Path B alignment test. Surface to lead at end of P3 for intermediate review (these are pure infra-correctness phases).
- **T2 (reviewer, antagonistic, intermediate)**: audit P1-P3 work. Verify rename completeness, sidecar emission seam choice, filter-test correctness, Path B conformance. Block T3 until APPROVE.
- **T3 (engineer)**: P4 + P5 + P6 + P7 — MLX-LM driver, GGUF convert, eval lane, comparison report. The hard phases. Surface to lead at end of P7 with full sweep numbers.
- **T4 (reviewer, antagonistic, final)**: end-of-wave audit. Verify gates 1-9, spot-check the browsing-gemma-react traces, confirm no test-only seams in P4/P5 wrappers, audit the wave-r11 baseline report's methodology. Block ship until APPROVE.

## Diary location

`docs/handover/distillation-pipeline/diary/r11-2026-04-30.md` — engineer captures per-phase evidence, sub-probe outcomes, MLX-LM + llama.cpp version pins, the sidecar emission seam decision rationale, hyperparam config used, behavioral-floor sweep numbers.

## Cost analysis reference

R11 training cost: **$0** (MLX-LM local). Reference web research summary captured in this plan's "What we're explicitly NOT building" section above (Vertex deferred to R12 conditional). Full cost analysis (Vertex pricing tables, RunPod alternatives, GCP free trial details, hardware speedup math) lives in the team-research artifacts and is not reproduced here to keep this plan tight.
