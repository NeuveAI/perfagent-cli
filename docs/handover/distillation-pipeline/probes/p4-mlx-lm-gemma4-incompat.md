# R11 P4 sub-probe — MLX-LM Gemma 4 E4B incompatibility

**Date**: 2026-04-30
**Branch**: `gemma-harness-lora`, post P1-P3 commits
**Outcome**: BLOCKER — MLX-LM 0.31.3 cannot load `mlx-community/gemma-4-e4b-it-bf16`. Surface to lead per R11 plan §"Risk areas" #5.

## What we ran

```bash
brew install mlx-lm                                    # → 0.31.3 OK
mkdir -p /tmp/r11-mlx-probe/data
cp r11-teacher-final.jsonl /tmp/r11-mlx-probe/data/train.jsonl
touch /tmp/r11-mlx-probe/data/{valid,test}.jsonl
mlx_lm.lora --model mlx-community/gemma-4-e4b-it-bf16 \
            --train --data /tmp/r11-mlx-probe/data \
            --fine-tune-type lora --num-layers 4 \
            --batch-size 1 --iters 2 --learning-rate 5e-5 \
            --max-seq-length 1024 \
            --adapter-path /tmp/r11-mlx-probe/adapter --seed 42
```

## What broke

After downloading the full bf16 checkpoint (~13 GB), MLX-LM exits non-zero with:

```
Loading pretrained model
Fetching 11 files: 100%
Traceback (most recent call last):
  File ".../mlx_lm/lora.py", line 369, in main
    run(types.SimpleNamespace(**args))
  File ".../mlx_lm/lora.py", line 329, in run
    model, tokenizer = load(args.model, tokenizer_config={"trust_remote_code": True})
  File ".../mlx_lm/utils.py", line 491, in load
    model, config = load_model(model_path, lazy, model_config=model_config)
  File ".../mlx_lm/utils.py", line 415, in load_model
    model.load_weights(list(weights.items()), strict=strict)
  File ".../mlx/nn/layers/base.py", line 185, in load_weights
    raise ValueError(...)
ValueError: Received 54 parameters not in model:
language_model.model.layers.24.self_attn.k_norm.weight,
language_model.model.layers.24.self_attn.k_proj.weight,
language_model.model.layers.24.self_attn.v_proj.weight,
... (continues for layers 25-41) ...
```

54 weights = 18 layers × 3 keys (`k_norm`, `k_proj`, `v_proj`) for layers 24-41.

## Root cause

The published bf16 checkpoint includes redundant `k_norm`/`k_proj`/`v_proj` weights for layers 24–41 even though those layers share KV with earlier layers in Gemma 4's architecture. MLX-LM's `gemma4_text.py` (the active model class for `model_type: gemma4_text`) follows the architectural spec and only allocates K/V projections for `num_hidden_layers − num_kv_shared_layers = 42 − 18 = 24` layers. When `load_weights(strict=True)` (default) sees 54 extra parameters, it bails.

Config snapshot:

```
text_config.num_hidden_layers     : 42
text_config.num_kv_shared_layers  : 18
text_config.layer_types           : sliding_attention × 35 + full_attention × 7 (interleaved)
architectures                     : Gemma4ForConditionalGeneration  (multimodal: text + vision + audio)
model_type (root)                 : gemma4
model_type (text_config)          : gemma4_text
```

The checkpoint also contains `audio_config` and `vision_config` blocks — full multimodal — but the language-model loader reaches the bail via the redundant K/V weight names before getting to the multimodal weights. Stripping the multimodal head wouldn't help.

## What we know about MLX-LM Gemma 4 support

- `gemma4.py` (multimodal class) and `gemma4_text.py` (text-only class) BOTH exist in MLX-LM 0.31.3 — they were committed before this release.
- `mlx-community/gemma-4-e4b-it-4bit` (4-bit quantized) is published. We did not probe whether it loads — community lore says quantized variants train poorly with LoRA so even if it loaded we wouldn't want it as the base.
- `deadbydawn101/gemma-4-E4B-opus-reasoning-claude-code-lora` exists on HuggingFace as a Gemma 4 E4B LoRA adapter — proving SOMEONE successfully fine-tuned. They may have used a different MLX-LM commit, a custom config, or upstream `transformers` instead of MLX-LM.
- HF `transformers` loads the same checkpoint cleanly (different weight-loader implementation; tolerates extra keys).

## Mitigation matrix

| Path | Pros | Cons |
|---|---|---|
| **A — Switch base to Gemma 3n E4B** (`mlx-community/gemma-3n-E4B-it-bf16`) | MLX-LM `gemma3n.py` is older + battle-tested; bf16 published; same E4B architecture footprint | ~10 GB additional download; training base ≠ runtime target (gemma4:e4b on Ollama via Path B grammar). Distillation gradient quality unclear because attention patterns differ from gemma 4. R12 dataset growth might amortize the divergence. |
| **B — Wait for MLX-LM upstream fix** | Best long-term; no fork/hack | Unbounded wall-clock; out of scope for R11. |
| **C — Preprocess checkpoint** to strip the 54 redundant weights | Stays on Gemma 4 | Brittle; out-of-band manipulation; reviewer-unfriendly; likely to break on next checkpoint update. |
| **D — Try earlier MLX-LM version** in a venv (`pip install mlx-lm==0.30.x`) | Maybe works | Speculative; older versions probably had less Gemma 4 support, not more. |
| **E — Use HF `transformers` + `peft`** directly via Python | Bypasses MLX-LM weight-loader entirely; works on any checkpoint | Loses MLX speedup (Apple Silicon optimization is the whole reason for picking MLX-LM); CPU/CUDA only; much slower; doesn't match plan §"Locked decisions" #4. |
| **F — Punt training driver to R12** | R11 still ships P1+P2+P2.1+P3 (already committed) plus P5/P6/P7 plumbing; R12 gets full training scope | Behavioral-floor gate (DoD #8) becomes untestable in R11 — no browsing-gemma adapter exists to compare. R11 closure becomes "pipeline plumbing minus training" which weakens the R11 narrative. |

## Lean

**A (Gemma 3n E4B)** is the cleanest path that keeps R11 in motion without forking from upstream. The 3n→4 distillation transfer is unproven but R11's behavioral floor is "no significant regression vs base-gemma" — even a partially-effective adapter on a slightly-different base meets that gate. R12 can revisit with Gemma 4 once upstream MLX-LM stabilizes.

**Caveat to A**: the runtime model in production is `gemma4:e4b` on Ollama. If we train an adapter on Gemma 3n E4B's MLX weights and try to load it as a LoRA over `gemma4:e4b`, the layer shapes likely differ enough that Ollama's adapter loader rejects. So picking A means **the deployed model becomes browsing-gemma-3n** (Gemma 3n base + LoRA), not browsing-gemma (Gemma 4 base + LoRA). That's a non-trivial deviation from `project_target_model_gemma.md` ("Gemma 4 E4B is the production model") and warrants explicit lead approval.

## Surfacing for lead direction

Per plan §"Risk areas" #5: "If either sub-probe-zero fails, surface to lead immediately — that's a P4/P5 blocker, not a soldier-on situation."

Three questions for lead:
1. **Pick a mitigation path** (A/B/C/D/E/F) — leaning A but it changes the deployed model identity.
2. **If A**: do we rename `browsing-gemma` → `browsing-gemma-3n` for R11, and queue a "Gemma 4 base reattempt" item for R12 once upstream lands?
3. **If F**: does R11 ship without DoD gate #8 (behavioral floor)? P5+P6+P7 still buy plumbing for R12, but the wave loses its capability sanity check.

R11 P1+P2+P2.1+P3 (six commits already on `gemma-harness-lora`) are unaffected — those land regardless of P4 path.

Probe artifacts:
- HF cache: `~/.cache/huggingface/hub/models--mlx-community--gemma-4-e4b-it-bf16` (~13 GB on disk; can prune if A/B/C path chosen).
- `train.ts` Effect wrapper at `packages/evals/scripts/distill/train.ts` is written against the Gemma 4 default but is base-model-agnostic — flipping `EVAL_DISTILL_BASE_MODEL_PATH=mlx-community/gemma-3n-E4B-it-bf16` reroutes it without code change.
- Test scaffold at `packages/evals/tests/distill-train.test.ts` uses `mlx-community/Qwen2.5-0.5B-Instruct-bf16` for live smoke (cache-gated to avoid CI bandwidth burn).
