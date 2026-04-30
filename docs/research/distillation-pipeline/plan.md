# R11 — Distillation pipeline plumbing

_Wave dispatched after R10 (teacher-viability ladder INVESTIGATIVE-VERIFIED 2026-04-30) proved `gemini-3-pro-preview` is a viable teacher (+0.166 step-cov, gate cleared even on worst-case +0.101 vs R9 best gemma). R11 builds pipeline plumbing on top of Wave 5's feature-complete distillation foundation; R12 (separate wave) tackles data quality + capability lift._

## What we're building

End-to-end automation from teacher trace capture → strict-filtered training data → HF transformers + peft LoRA training → GGUF adapter → llama-server runtime → eval comparison. Goal: prove the pipeline works end-to-end with verifiable outcomes, lay the groundwork for R12 to focus exclusively on data-quality work.

R11 ships infrastructure value independent of capability lift. Distillation-on-distillation collapse and the data-scarcity ceiling (2/20 strict-pass traces from R10) mean **R11 must NOT promise a behavioral lift** — only that the pipeline runs end-to-end without breaking the existing gemma path.

## What we're explicitly NOT building

- **Vertex AI training backend.** Cost analysis (`docs/research/distillation-pipeline/cost-analysis-vertex.md` — to be captured in R11 P4 diary) showed Vertex isn't faster than local HF+peft at our R11 scale (≤20 examples × 1 epoch — provisioning overhead dominates 100-second training jobs). Revisit in R12 if dataset growth crosses ~30 traces and parallelization becomes useful.
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
| 4 | **HF transformers + peft as the training stack** (was MLX-LM only; flipped 2026-04-30 mid-R11) | MLX-LM 0.31.3 cannot load `mlx-community/gemma-4-e4b-it-bf16` — 54 redundant K/V weights for kv-shared layers reject the strict loader (per probe `docs/handover/distillation-pipeline/probes/p4-mlx-lm-gemma4-incompat.md`). HF transformers tolerates the same checkpoint cleanly; peft 0.19+ wraps Gemma 4 attention via regex target_modules. Probe verified end-to-end Gemma 4 → peft Safetensors → llama.cpp `convert_lora_to_gguf.py` → GGUF (per `docs/handover/distillation-pipeline/probes/p4-pathE-hf-peft-results.md`). Revisit MLX-LM when upstream lands the kv-shared K/V loader fix. Vertex AI training stays out of scope at R11 dataset size. |
| 5 | **`browsing-gemma` is the canonical name** | Per `project_lora_name.md` (locked 2026-04-24). Wave 5 code currently uses `gemma4-perfagent`; R11 P1 reconciles. |
| 6 | **Strict R10 filter: `RUN_COMPLETED:passed AND finalState == 1.0 AND stepCoverage == 1.0`** | R10 closure note. Yields 2/20 traces; both at trivial-shape. Status-only filter would let Pro's two-shape stopping-criterion problem (premature + over-execution) pollute training data. |
| 7 | **Behavioral floor only for R11 DoD** | Data-scarcity-bound. "browsing-gemma step-cov ≥ base-gemma step-cov − 0.05" proves the pipeline doesn't break gemma. Lift is R12 work. |
| 8 | **Conservative hyperparams for R11 training** | rank 8, 1 epoch, lr 5e-5 (lower than Unsloth's "default 2e-4" — Gemma 4 E4B is already distilled, double-distillation collapse risk per April 2026 community signal). Hyperparam exploration is R12. |
| 9 | **Runtime fork: browsing-gemma-react routes to `llama-server --lora`** (decided 2026-04-30 mid-R11) | Ollama 0.22.0 does not yet implement LoRA inference (`Error: 500 ... loras are not yet implemented` on `ollama run` despite `ollama create` accepting the GGUF; per probe `p4-pathE-hf-peft-results.md` Step 6). Generic Ollama gap, not Gemma 4 specific. llama.cpp's `llama-server` (homebrew 8980+) supports `--lora <gguf>` natively at the OpenAI-compatible `/v1/chat/completions` endpoint. R11 forks: `gemma-react`, `gemini-react`, `gemma-oracle-plan` keep Ollama; `browsing-gemma-react` uses `llama-server`. Reconverge browsing-gemma-react onto Ollama when Ollama upstream lands LoRA inference. |

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

### P4 — HF transformers + peft training driver (`distill:train`)

**Sub-probe-zero outcome (run 2026-04-30, see `docs/handover/distillation-pipeline/probes/p4-pathE-hf-peft-results.md`)**:
- `transformers 5.7.0` + `peft 0.19.1` + `torch 2.11.0` (MPS) loaded `google/gemma-4-e4b-it` cleanly (no K/V loader rejection; full 7.94B params).
- `LoraConfig(r=8, target_modules=r"model\.language_model\.layers\.\d+\.self_attn\.(q|k|v|o)_proj$")` wraps the language-model branch only — vision_tower + audio_tower stay frozen. Trainable: 4.5M / 7.94B (0.057%).
- Single forward+backward+optimizer-step on MPS in 110s; LoRA delta non-zero; `peft_model.save_pretrained` produces 18.2 MB `adapter_model.safetensors` + `adapter_config.json`.

**Goal**: productize the probe as `packages/evals/scripts/distill/train.ts` Effect wrapper around a Python `peft_train.py` script. Consumes the JSONL produced by `distill:export`, produces a Safetensors LoRA adapter ready for P5 GGUF conversion.

**Touched**:
- New `packages/evals/scripts/distill/peft_train.py` — Python script that:
  - Args: `--input <jsonl>`, `--output <adapter-dir>`, `--base-model <hf-id>`, `--rank <n>`, `--epochs <n>`, `--lr <float>`, `--batch-size <n>`, `--max-seq-length <n>`, `--device <mps|cpu>`.
  - Loads via `AutoModelForCausalLM.from_pretrained(base_model, dtype=torch.bfloat16).to(device)` + `peft.get_peft_model` with the language-model regex target_modules.
  - Iterates JSONL lines, applies tokenizer chat template, computes loss + backward + step. `epochs × ceil(samples / batch_size)` total iterations.
  - `peft_model.save_pretrained(output, safe_serialization=True)` at the end.
  - Exits 0 on success with adapter at `<output>/adapter_model.safetensors`.
- New `packages/evals/scripts/distill/train.ts` — Effect-based wrapper that:
  - Reads env: `EVAL_DISTILL_INPUT` (JSONL path), `EVAL_DISTILL_TRAIN_OUTPUT` (adapter dir), `EVAL_DISTILL_BASE_MODEL_PATH` (HF id or local path; default `google/gemma-4-e4b-it`), `EVAL_DISTILL_TRAIN_RANK` (default 8), `EVAL_DISTILL_TRAIN_EPOCHS` (default 1), `EVAL_DISTILL_TRAIN_LR` (default 5e-5), `EVAL_DISTILL_TRAIN_PYTHON` (path to venv python; default `python3`).
  - Validates the venv's `python` import path includes `peft` + `transformers` + `torch` (single subprocess `python -c "import peft, transformers, torch"`).
  - Validates JSONL conforms (decode each line via `Schema.decodeUnknownEffect(TrainingSample)`).
  - Spawns `python peft_train.py --input ... --output ...` via `Effect.tryPromise` + `child_process.spawn` (streams stdout/stderr live).
  - Tagged errors: `HFPeftUnavailableError`, `HFPeftTrainFailedError`, `JsonlValidationError`, `AdapterArtifactMissingError`.
  - On success: verifies adapter file exists at `<output>/adapter_model.safetensors`, returns path + size.
- New `packages/evals/tests/distill-train.test.ts`:
  - Unit (always-on): structured error path fires before peft_train.py spawn when input JSONL is missing.
  - Live smoke (`it.skipIf` on peft/MPS unavailable): full end-to-end against `mlx-community/Qwen2.5-0.5B-Instruct-bf16` (tiny, fast) — adapter exists + non-empty. Production default base model (Gemma 4 E4B, ~16 GB cache) is exercised by the manual end-to-end pipeline run captured in the diary, not in CI.
- `packages/evals/package.json` — add `distill:train` script.

**Hyperparams (defaults locked for R11)**:
- LoRA rank: **8**.
- Epochs: **1** (small dataset overfits past 3-5 epochs).
- Learning rate: **5e-5**.
- Validation split: 0% (only 2 strict-pass traces).
- Device: MPS (Apple Silicon); falls back to CPU with a warning if MPS unavailable.

**Verifiable**: `pnpm --filter @neuve/evals distill:train` against the 2-trace dataset exits 0 with adapter at `<output>/adapter_model.safetensors`. Live smoke test passes when peft + transformers + torch + MPS are available.

**Effort**: medium (Effect wrapping + spawn + tests; HF+peft was de-risked by the Path E sub-probe-zero — first-time integration verified end-to-end on real Gemma 4 E4B).

### P5 — GGUF conversion (`distill:convert-gguf`)

**Goal**: convert peft Safetensors adapter to GGUF format that `llama-server --lora` (P5.5) and any future Ollama LoRA-supporting version can load.

**Sub-probe-zero outcome (run 2026-04-30, see `p4-pathE-hf-peft-results.md` Step 5)**: `convert_lora_to_gguf.py` from llama.cpp HEAD (`beb42ff`) converts the peft-produced `adapter_model.safetensors` cleanly. **Gotcha**: the published `gguf` PyPI package lacks `MODEL_ARCH.GEMMA4`; install gguf-py from the local llama.cpp clone via `pip install -e <llama.cpp>/gguf-py`. With that, conversion produces 9.08 MB GGUF (264 tensors covering attn_k/q/v/output for all 42 language-model blocks) for the R11 probe adapter.

**Touched**:
- New `packages/evals/scripts/distill/convert-gguf.ts` — Effect wrapper around `convert_lora_to_gguf.py`:
  - Reads env: `EVAL_DISTILL_ADAPTER_INPUT` (Safetensors dir from P4), `EVAL_DISTILL_ADAPTER_OUTPUT` (`.gguf` path), `EVAL_DISTILL_LLAMA_CPP_PATH` (path to llama.cpp checkout containing `convert_lora_to_gguf.py` AND `gguf-py/`), `EVAL_DISTILL_BASE_MODEL_PATH` (HF cache dir for `--base` flag — defaults to the HF cache snapshot of the production base model).
  - Validates `convert_lora_to_gguf.py` exists; validates the venv's `python -c "import gguf; gguf.MODEL_ARCH.GEMMA4"` succeeds (catches the published-vs-local gguf-py drift).
  - Spawns `python convert_lora_to_gguf.py --base <hf-cache-snapshot-dir> --outfile <out.gguf> --outtype bf16 <adapter-input-dir>` via `Effect.tryPromise`.
  - Tagged errors: `LlamaCppUnavailableError`, `GgufPyMissingGemma4Error`, `GgufConvertFailedError`, `BaseModelMissingError`.
  - On success: verifies output `.gguf` exists, returns path + size.
- New `packages/evals/tests/distill-convert-gguf.test.ts`:
  - Unit: structured error path fires when llama.cpp path is missing or gguf-py lacks GEMMA4.
  - Live smoke: convert the P4 output adapter, assert `.gguf` exists + non-empty (`it.skipIf` when llama.cpp / gguf-py unreachable).
- `packages/evals/package.json` — add `distill:convert-gguf` script.
- `packages/evals/scripts/distill/smoke-finetune.ts` — extension deferred to P5.5 since Ollama can't load LoRA at runtime; the `EVAL_DISTILL_USE_ADAPTER=1` smoke moves to llama-server.

**Verifiable**: `.gguf` produced from the P4 adapter exits 0; the file loads cleanly under `llama-server --lora` in P5.5.

**Effort**: small (Effect spawn wrapper; conversion script behavior was de-risked by the Path E sub-probe-zero).

### P5.5 — `llama-server` runtime client for browsing-gemma-react (NEW)

**Goal**: route the browsing-gemma-react eval lane to `llama-server --lora <gguf>` instead of Ollama, since Ollama 0.22.0 does not yet wire LoRA inference (per locked decision #9).

**Sub-probe-zero (run before wiring the client)**: manually start `llama-server --model <base-gguf> --lora <adapter.gguf> --port 8090`, then `curl http://localhost:8090/v1/chat/completions` with a minimal OpenAI-style payload. Verify response matches OpenAI shape (`{ "choices": [{ "message": { "role": "assistant", "content": "..." } }] }`). Capture in diary §P5.5. If the curl probe fails (server crashes, schema mismatch, port collision), halt + ping lead.

**Touched**:
- New `packages/evals/src/runners/llama-server-client.ts` — `ServiceMap.Service` exposing `chat(messages, options)`:
  - `Effect.acquireRelease` for the `llama-server` subprocess lifecycle (spawn-per-eval; clean isolation between eval runs; kill on scope close). Pre-running instance via env-var `PERF_AGENT_LLAMA_SERVER_URL` skips the spawn (CI / dev workflow).
  - Reads env: `PERF_AGENT_LLAMA_SERVER_URL` (override; default spawn local), `PERF_AGENT_LLAMA_SERVER_PORT` (default 8090), `PERF_AGENT_LLAMA_SERVER_MODEL` (path to base GGUF), `PERF_AGENT_LLAMA_SERVER_LORA` (path to LoRA GGUF from P5).
  - Speaks OpenAI `/v1/chat/completions` (same schema the existing `OllamaClient.chat` mirrors). Streams ndjson by default; non-streaming mode for the smoke.
  - Tagged errors: `LlamaServerUnavailableError`, `LlamaServerSpawnError`, `LlamaServerHttpError`, `LlamaServerEmptyResponseError`.
- New `packages/evals/tests/llama-server-client.test.ts`:
  - Unit: structured error path fires when binary is missing.
  - Live smoke: spawn `llama-server` against `gemma4:e4b` GGUF + the P4/P5 LoRA, send a single chat-completion, assert non-empty response (`it.skipIf` when llama-server / GGUFs unavailable).

**Effort**: medium (new client + lifecycle scope + tests; OpenAI-compat schema aligns with the existing ollama-client so much of the JSON shape is reusable).

### P6 — Eval-runner browsing-gemma lane (with runtime fork)

**Goal**: extend `wave-r5-ab.eval.ts` to run a fourth runner (`browsing-gemma-react`) alongside gemma-react / gemini-react / gemma-oracle-plan, routing through the P5.5 llama-server client instead of Ollama.

**Touched**:
- `packages/evals/src/runners/runner-names.ts` — add `BROWSING_GEMMA_REACT_RUNNER_NAME = "browsing-gemma-react"`.
- `packages/evals/src/runners/gemma.ts` — extend `GemmaRunnerOptions`:
  - `runtime: "ollama" | "llama-server"` (default `"ollama"`).
  - `adapterPath: Schema.optional(Schema.String)` — required when `runtime === "llama-server"`.
  - When `runtime === "llama-server"`, the runner constructs the agent layer with `LlamaServerClient` instead of `OllamaClient`. Both clients implement the same chat-completion contract; existing local-agent → tool-loop → reducer wiring stays unchanged.
- `packages/evals/evals/wave-r5-ab.eval.ts` — register `browsing-gemma-react` with `runtime: "llama-server"`, `adapterPath: process.env.EVAL_BROWSING_GEMMA_ADAPTER`. Skip with `EVAL_R5_SKIP_RUNNERS=browsing-gemma-react` when the adapter env is unset (CI without a built LoRA).
- `packages/evals/scripts/wave-r5-ab/build-report.ts` — register the new runner in the aggregator.

**Verifiable**: After P1+P4+P5+P5.5 land AND `EVAL_BROWSING_GEMMA_ADAPTER=<path-to-gguf>` is set, `pnpm --filter @neuve/evals eval:wave-r5-ab` produces 80 trace files (20 tasks × 4 runners) including 20 `browsing-gemma-react__*.ndjson`. Aggregator shows browsing-gemma column.

**Effort**: small-to-medium (the runtime branch in `gemma.ts` + registration + skip-logic; runtime fork is the architectural delta, mechanics are familiar).

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
4. **HF+peft training driver**: `distill:train` produces `adapter_model.safetensors` on the 2-trace dataset; live smoke test passes.
5. **GGUF conversion**: `distill:convert-gguf` produces a loadable `.gguf` from the P4 Safetensors adapter.
5.5. **llama-server runtime**: `LlamaServerClient` chats with the loaded LoRA + base GGUF, returns non-empty response (smoke).
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
3. **GGUF conversion compatibility** — De-risked by Path E sub-probe (2026-04-30): `convert_lora_to_gguf.py` from llama.cpp HEAD converts the peft Safetensors adapter cleanly once `gguf-py` is installed from the local clone (published PyPI lacks `MODEL_ARCH.GEMMA4`). Documented in §P5 implementation.
4. **Catastrophic narrowing**: fine-tuning may make browsing-gemma WORSE at off-task behavior (the LoRA over-specializes on the 2 trivial-shape traces). Behavioral floor catches the worst cases on harness tasks; off-task degradation isn't measured here (would need a separate eval out of R11 scope).
5. **HF+peft + MPS first-time integration**: probe verified end-to-end (forward+backward+save in 110s on MPS for one step on Gemma 4 E4B). At full sweep scale (~80 traces × 1 epoch on R12 dataset growth), MPS throughput may bottleneck — revisit if R12 sweep wall-clock becomes painful.
6. **Sidecar score-file backfill**: P2's strict filter requires sidecars on existing R10 traces. The sidecar emission seam in build-report retroactively populated all 60 traces in `evals/traces/wave-r10-pro-preview/` (P2 closed). Same path covers any future archive — re-run `wave-r5-ab:report --trace-dir <archive>` once.
7. **Runtime fork debt** (NEW): every wave landing while the fork is active inherits maintenance cost — `LlamaServerClient` and `OllamaClient` both implement the chat-completion contract; bug fixes need to land in both. Reconvergence trigger: Ollama upstream lands LoRA inference (then route browsing-gemma-react back to Ollama, drop the fork). Until then, the fork stays.

## Out of scope (R12 hooks)

R11 does NOT solve, R12 owns:
- Multi-sweep capture to grow strict-pass dataset above engineer's 15/5 threshold
- Trajectory cleanup (truncate-at-success-state for over-execution, recover-finalState for premature) to recover the 5 "passed-only" stragglers
- New task set authoring (smaller-grained journey-* tasks where Pro reliably reaches finalState=1.0)
- Hyperparam exploration (rank, epochs, lr sweeps; possibly higher rank per Thinking Machines "LoRA Without Regret" guidance)
- Off-task chat data augmentation to mitigate catastrophic narrowing
- Vertex AI training backend (revisit when dataset > 30 traces)
- Path A native `<|tool_call>` token format migration (defer to R13 conditional on Ollama upstream parser fix)
- Production deployment beyond local Ollama / local llama-server
- Capability-lift gates (browsing-gemma > base-gemma or > Pro 3.1)
- **Ollama LoRA reconvergence (NEW)**: when Ollama upstream lands LoRA inference, route browsing-gemma-react back to Ollama and drop the runtime fork. Drop `LlamaServerClient` if no other user. Trigger: Ollama release notes mention LoRA support.
- **MLX-LM Gemma 4 fix retry (NEW)**: when MLX-LM lands the kv-shared K/V loader fix, evaluate switching back from HF+peft for Apple Silicon speedup at scale. Trigger: MLX-LM release loads `mlx-community/gemma-4-e4b-it-bf16` cleanly.

## Process invariants

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`, `Effect.fn` with descriptive spans, `Effect.acquireRelease` for resource lifecycle, no `catchAll`/`mapError`/`null`/`as`-casts (per `CLAUDE.md`).
- No `Co-Authored-By` footer. Granular commits after reviewer APPROVE per `feedback_commit_guidelines.md`.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push` per `feedback_reviewer_never_stash.md`.
- Real services for all live smoke tests: real `python` venv with `peft + transformers + torch` (skip-if-unavailable), real `llama.cpp` `convert_lora_to_gguf.py` (skip-if-unavailable), real `llama-server` (skip-if-unavailable), real Ollama for non-LoRA runners. No `MockLanguageModelV4` per `feedback_no_test_only_injection_seams.md`.
- `pnpm --filter @neuve/local-agent build` before any sweep that exercises new local-agent source per `project_eval_build_cache_trap.md`. R11 P6 doesn't currently expect to touch local-agent (P6 only registers a new model id — local-agent's existing Ollama plumbing handles arbitrary names) but the discipline holds if any seam needs touching.
- No prompt overfitting per `feedback_avoid_prompt_overfitting.md`. The Modelfile SYSTEM directive uses `buildLocalAgentSystemPrompt()` unchanged — same prompt as production runtime. browsing-gemma learns from trajectories, not prompts.
- Always read prior work in full before drafting new sub-plans per `feedback_always_read_prior_work.md`.

## Team structure

`react-r11` with engineer + reviewer per `feedback_use_teammates.md`.

- **T1 (engineer)**: P1 + P2 + P3 — identity rename, strict-filter retrofit, Path B alignment test. Surface to lead at end of P3 for intermediate review (these are pure infra-correctness phases).
- **T2 (reviewer, antagonistic, intermediate)**: audit P1-P3 work. Verify rename completeness, sidecar emission seam choice, filter-test correctness, Path B conformance. Block T3 until APPROVE.
- **T3 (engineer)**: P4 + P5 + P5.5 + P6 + P7 — HF+peft training driver, GGUF convert, llama-server runtime client, eval lane, comparison report. The hard phases. Surface to lead at end of P7 with full sweep numbers.
- **T4 (reviewer, antagonistic, final)**: end-of-wave audit. Verify gates 1-9, spot-check the browsing-gemma-react traces, confirm no test-only seams in P4/P5 wrappers, audit the wave-r11 baseline report's methodology. Block ship until APPROVE.

## Diary location

`docs/handover/distillation-pipeline/diary/r11-2026-04-30.md` — engineer captures per-phase evidence, sub-probe outcomes, peft + transformers + torch + llama.cpp + llama-server version pins, the sidecar emission seam decision rationale, hyperparam config used, behavioral-floor sweep numbers.

## Cost analysis reference

R11 training cost: **$0** (HF transformers + peft local on Apple Silicon MPS). Reference web research summary captured in this plan's "What we're explicitly NOT building" section above (Vertex deferred to R12 conditional). Full cost analysis (Vertex pricing tables, RunPod alternatives, GCP free trial details, hardware speedup math) lives in the team-research artifacts and is not reproduced here to keep this plan tight.
