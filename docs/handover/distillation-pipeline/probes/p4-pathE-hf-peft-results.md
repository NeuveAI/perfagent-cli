# R11 P4 Path E feasibility probe — results

**Date**: 2026-04-30 (T0=22:35 → T_end=23:16, ~42 min elapsed, under 60-min budget)
**Branch**: `gemma-harness-lora`, post P1-P3 commits
**Outcome**: STEPS 1-5 PASS on real Gemma 4 E4B; STEP 6 (Ollama runtime) FAILS on a separate, generic blocker — needs lead/user direction.

## Summary

Path E was authorized to feasibility-probe HF transformers + peft as the alternative training stack after MLX-LM 0.31.3's K/V loader rejected `mlx-community/gemma-4-e4b-it-bf16`. The probe ran end-to-end through GGUF conversion successfully on the real Gemma 4 E4B checkpoint — preserving the production-target identity. **However, Ollama 0.22.0 cannot load the resulting LoRA at inference time** (generic LoRA-serving gap, not Gemma 4 specific). This was a non-obvious blocker independent of the training framework.

## Step-by-step

### Step 1 — Install peft + transformers (PASS)

`/tmp/r11-pathE/venv` (python3.13). Versions:
- `transformers 5.7.0`
- `peft 0.19.1`
- `torch 2.11.0` (MPS available)
- `accelerate 1.13.0`, `safetensors 0.7.0`, `datasets 4.8.5`, `sentencepiece 0.2.1`

### Step 2 — Load `google/gemma-4-e4b-it` + discover target_modules (PASS)

Model loads cleanly via `AutoModelForCausalLM.from_pretrained(..., dtype=torch.bfloat16)`. Architecture: `Gemma4ForConditionalGeneration` (multimodal: `model.vision_tower`, `model.language_model`, `model.audio_tower`).

Total params: 7.94 B. Attention-projection module names per branch:
- Vision tower: `model.vision_tower.encoder.layers.<n>.self_attn.{q,k,v,o}_proj.linear`
- Language model: `model.language_model.layers.<n>.self_attn.{q,k,v,o}_proj`
- Audio tower: `model.audio_tower.layers.<n>.self_attn.{q,k,v,o}_proj.linear`

For browsing-gemma's runtime use (text-only ReAct browsing), only the language-model branch needs LoRA — vision_tower + audio_tower stay frozen. Regex pattern targets language only:

```
target_modules = r"model\.language_model\.layers\.\d+\.self_attn\.(q|k|v|o)_proj$"
```

### Step 3 — LoRA wrap + single-step train on MPS (PASS)

`LoraConfig(r=8, lora_alpha=16, target_modules=<regex>, lora_dropout=0.0, bias="none", task_type="CAUSAL_LM")` + `get_peft_model(model, lora_config)`.

```
trainable=4,538,368 / 7,945,639,200 (0.0571%)
```

LoRA wrapping confirmed at the language-model attention only — trainable count matches expected (~4.5M params for r=8 across 42 language-model layers × 4 projections).

CPU forward+backward was prohibitively slow (timed out at 30 min). MPS run was tractable: model→MPS in 41s, forward in 50s, backward+step in 14s, save in 1s. Total: 110s for one step on a 512-token sequence.

LoRA matrix norm Δ after one step: 1e-6 (small but non-zero — peft init has `lora_B=zero`, so first step's gradient on `lora_A` is small. Still passes `delta > 1e-9` sanity check).

### Step 4 — Save adapter (PASS)

`peft_model.save_pretrained(out, safe_serialization=True)` → 18.2 MB `adapter_model.safetensors` + `adapter_config.json` + auto-generated README. Standard peft Safetensors layout.

### Step 5 — GGUF conversion via llama.cpp (PASS)

Cloned `ggml-org/llama.cpp` HEAD (`beb42ff` commit) sparse-checkout (just python convert scripts + `gguf-py`). Installed `gguf-py` from the local clone via `pip install -e` to get the `MODEL_ARCH.GEMMA4` constant — published `gguf` PyPI package (`gguf` from PyPI) does **not** yet have `GEMMA4` enum; the local llama.cpp `gguf-py` does.

```
python llama.cpp/convert_lora_to_gguf.py \
  --base ~/.cache/huggingface/hub/models--google--gemma-4-e4b-it/snapshots/<sha>/ \
  --outfile probing-gemma.gguf \
  --outtype bf16 \
  /tmp/r11-pathE/adapter

INFO:lora-to-gguf:Model successfully exported to probing-gemma.gguf
```

Result: 9.08 MB GGUF, 264 tensors, all attention projections (q/k/v/output for all 42 language-model blocks). `--base` flag accepts the HF transformers cache snapshot dir directly (read its `config.json` + tokenizer files for shape inference).

### Step 6 — Ollama load + generate probe (FAIL: independent blocker)

```
ollama --version   # ollama version is 0.22.0
ollama list        # gemma4:e4b cached (8h ago)
ollama show gemma4:e4b
  architecture        gemma4
  parameters          8.0B
  context length      131072
  quantization        Q4_K_M
  requires            0.20.0
  capabilities        completion, vision, audio, tools, thinking
```

`ollama create probing-gemma -f Modelfile`:

```
gathering model components
copying file sha256:e09832...
parsing GGUF
using existing layer ...
creating new layer sha256:dfc25c...
writing manifest
success
```

— Ollama parses the LoRA GGUF and writes the manifest cleanly. Modelfile is accepted.

`ollama run probing-gemma "Reply with a single word: ok"`:

```
Error: 500 Internal Server Error: failed to initialize model: loras are not yet implemented
```

This error is generic — not Gemma 4-specific. Ollama 0.22.0's inference engine does not yet wire up LoRA loading at runtime, even though `ollama create` accepts the GGUF + ADAPTER directive.

## Independent failure mode — affects ALL training paths

**The Ollama LoRA-runtime gap is independent of the training framework.** Any path that ends in `ollama create + ollama run` against a LoRA adapter — Path A (Gemma 3n), Path C (preprocess Gemma 4), Path D (older MLX-LM), Path E (HF+peft) — would hit the same step-6 wall. Punting to Path A (Gemma 3n) **would not have helped** for DoD gate #8 (behavioral floor).

The only two paths that bypass step 6's Ollama wall:

- **Path E + llama-server**: serve browsing-gemma via `llama-server --lora <gguf>` directly (LLAMA.cpp's own HTTP server natively supports LoRA via the `--lora` CLI flag we verified). Re-route the eval harness's `OllamaClient` to point at llama-server's OpenAI-compatible endpoint for the browsing-gemma lane only. base-gemma + gemini-react + gemma-oracle-plan stay on Ollama. Major architectural fork but keeps the production-target identity (Gemma 4) AND keeps DoD #8 measurable.
- **Path F**: ship R11 without DoD #8. P4-P5 land plumbing (training driver, GGUF convert, Modelfile builder), P6 registers browsing-gemma in the eval-lane code but the actual runtime check is gated behind a feature flag that activates when Ollama 0.21+ ships LoRA support. R12 includes "wire DoD #8 once Ollama lands LoRA serving."

## What works (to commit if path is decided)

`packages/evals/scripts/distill/train.ts` — written, typechecks clean. Uses `mlx_lm.lora` spawn. Either:
- **If Path E adopted**: rewrite to `python <hf-peft-train.py>` spawn. Keeps same Effect-wrapper shape + tagged errors, swaps the binary + arg surface. ~30 min effort.
- **If Path E + llama-server**: same as above; additionally introduce a separate `distill:serve` script that boots `llama-server --lora <gguf>` for the eval lane to query.

## Recommendation matrix (for lead/user)

| Choice | Training | Conversion | Inference | Identity | DoD #8 |
|---|---|---|---|---|---|
| **E1: HF+peft, Ollama+wait** | works | works | blocked on Ollama 0.21+ | Gemma 4 ✓ | deferred to R12 |
| **E2: HF+peft, llama-server** | works | works | works (llama-server) | Gemma 4 ✓ | measurable in R11 |
| **A: Gemma 3n, Ollama+wait** | unproven | unproven | blocked on Ollama 0.21+ | Gemma 3n (drift) | deferred |
| **A: Gemma 3n, llama-server** | unproven | unproven | likely works | Gemma 3n (drift) | measurable but on drifted base |
| **F: punt P4 entirely to R12** | R12 | R12 | R12 | TBD R12 | deferred |

Lean: **E2** preserves identity AND keeps R11's behavioral-floor gate. Adds ~30-60 min to wire `llama-server` into the eval-lane runtime selection (gemma-react keeps Ollama; browsing-gemma-react routes to llama-server). Documents the runtime fork in diary + R11 plan amendment.

## Disk state

- `~/.cache/huggingface/hub/models--mlx-community--gemma-4-e4b-it-bf16` — 13 GB (mlx-community variant; safe to prune since Path E uses HF transformers checkpoint directly).
- `~/.cache/huggingface/hub/models--google--gemma-4-e4b-it` — newly cached during Path E probe (~16 GB bf16). Keep.
- `/tmp/r11-pathE/` — venv + adapter + GGUF + llama.cpp clone. Sandbox; can prune after path is decided.
