"""peft_train.py — R11 P4 HF transformers + peft LoRA training driver.

Consumes the OpenAI-chat JSONL produced by `distill:export` and produces a
Safetensors LoRA adapter at <output>/adapter_model.safetensors. The
companion Effect wrapper at scripts/distill/train.ts spawns this script
via `python <path>` after validating the venv has peft + transformers
+ torch importable.

Why this exists (vs. mlx_lm.lora which the R11 plan §"Locked decisions"
#4 originally pinned): MLX-LM 0.31.3 cannot load
`mlx-community/gemma-4-e4b-it-bf16` because the published checkpoint
includes 54 redundant K/V weights for kv-shared layers (24-41) that
MLX-LM's strict loader rejects. HF transformers tolerates the same
checkpoint cleanly. Path E feasibility probe (2026-04-30) verified
end-to-end on real Gemma 4 E4B; this is the productization.

Architecture target (Gemma 4 E4B):
- `Gemma4ForConditionalGeneration` (multimodal: vision_tower +
  language_model + audio_tower)
- LoRA wraps language_model attention only via regex on
  `model.language_model.layers.<n>.self_attn.{q,k,v,o}_proj` —
  vision_tower + audio_tower stay frozen.

R11 hyperparams (locked in plan §P4): rank 8, 1 epoch, lr 5e-5,
batch_size 1, max_seq_length 4096. Validation split 0% (only 2
strict-pass traces under R10).
"""
import argparse
import json
import os
import sys
import time
import warnings
from typing import Optional

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

LANGUAGE_MODEL_TARGET_REGEX = (
    r"model\.language_model\.layers\.\d+\.self_attn\.(q|k|v|o)_proj$"
)

ADAPTER_FILENAME = "adapter_model.safetensors"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HF+peft LoRA training driver for browsing-gemma")
    parser.add_argument("--input", required=True, help="Path to teacher JSONL (one sample per line)")
    parser.add_argument("--output", required=True, help="Path to output adapter directory")
    parser.add_argument(
        "--base-model",
        default="google/gemma-4-e4b-it",
        help="HF model id or local path; default google/gemma-4-e4b-it",
    )
    parser.add_argument(
        "--target-modules",
        default=LANGUAGE_MODEL_TARGET_REGEX,
        help=(
            "peft LoraConfig.target_modules. Either a regex (default: Gemma 4 "
            "language_model branch only — vision_tower + audio_tower stay "
            "frozen) or a comma-separated list of leaf names (e.g. "
            "'q_proj,k_proj,v_proj,o_proj' for non-multimodal models). "
            "Auto-detected as comma-list if no regex metacharacters present."
        ),
    )
    parser.add_argument("--rank", type=int, default=8, help="LoRA rank (default 8)")
    parser.add_argument("--epochs", type=int, default=1, help="Training epochs (default 1)")
    parser.add_argument("--lr", type=float, default=5e-5, help="Learning rate (default 5e-5)")
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size (default 1)")
    parser.add_argument(
        "--max-seq-length", type=int, default=4096, help="Max sequence length (default 4096)"
    )
    parser.add_argument(
        "--device",
        choices=["mps", "cpu", "auto"],
        default="auto",
        help="Compute device (default auto: mps if available, else cpu)",
    )
    parser.add_argument("--seed", type=int, default=42, help="PRNG seed (default 42)")
    return parser.parse_args()


def resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    warnings.warn(
        "MPS unavailable; falling back to CPU — training will be much slower (10-30x). "
        "On Apple Silicon Macs, install torch with MPS support.",
        stacklevel=2,
    )
    return "cpu"


def load_samples(input_path: str) -> list[dict]:
    """Read JSONL line-by-line into a list of dicts.

    The TypeScript wrapper validates each line through the TrainingSample
    Effect schema before spawning this script, so we trust the contents
    here. We still defensively check the `messages` key exists per line.
    """
    samples: list[dict] = []
    with open(input_path, "r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            obj = json.loads(line)
            if "messages" not in obj or not isinstance(obj["messages"], list):
                raise ValueError(f"line {line_no}: missing/invalid `messages` field")
            samples.append(obj)
    if not samples:
        raise ValueError(f"{input_path} contains no samples")
    return samples


def main() -> int:
    args = parse_args()
    torch.manual_seed(args.seed)

    device = resolve_device(args.device)
    t0 = time.time()
    print(f"[peft_train] device={device} torch={torch.__version__} t=0.0s", flush=True)

    samples = load_samples(args.input)
    print(f"[peft_train] loaded {len(samples)} samples from {args.input}", flush=True)

    print(f"[peft_train] loading base model {args.base_model} ...", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForCausalLM.from_pretrained(args.base_model, dtype=torch.bfloat16)
    model = model.to(device)
    print(f"[peft_train] base model on {device} t={time.time() - t0:.1f}s", flush=True)

    # Auto-detect target-modules format: regex if it contains regex metacharacters
    # (\\, ^, $, +, *, ?, |, parens, brackets), otherwise treat as comma-list.
    target_modules_arg: object
    if any(ch in args.target_modules for ch in r"\^$+*?|()[]"):
        target_modules_arg = args.target_modules
        target_modules_kind = "regex"
    else:
        target_modules_arg = [s.strip() for s in args.target_modules.split(",") if s.strip()]
        target_modules_kind = "list"
    print(
        f"[peft_train] target_modules ({target_modules_kind}): {target_modules_arg}",
        flush=True,
    )

    lora_config = LoraConfig(
        r=args.rank,
        lora_alpha=2 * args.rank,
        target_modules=target_modules_arg,
        lora_dropout=0.0,
        bias="none",
        task_type="CAUSAL_LM",
    )
    peft_model = get_peft_model(model, lora_config)

    trainable = sum(p.numel() for p in peft_model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in peft_model.parameters())
    print(
        f"[peft_train] LoRA wrapped: trainable={trainable:,}/{total:,} "
        f"({100 * trainable / total:.4f}%) t={time.time() - t0:.1f}s",
        flush=True,
    )

    optimizer = torch.optim.AdamW(
        [p for p in peft_model.parameters() if p.requires_grad], lr=args.lr
    )

    iters_per_epoch = max(1, (len(samples) + args.batch_size - 1) // args.batch_size)
    total_iters = max(1, args.epochs * iters_per_epoch)
    print(
        f"[peft_train] training plan: epochs={args.epochs} "
        f"iters_per_epoch={iters_per_epoch} total_iters={total_iters} "
        f"batch_size={args.batch_size} lr={args.lr}",
        flush=True,
    )

    peft_model.train()
    sample_lora_param: Optional[torch.nn.Parameter] = next(
        (p for n, p in peft_model.named_parameters() if p.requires_grad and "lora_A" in n),
        None,
    )
    if sample_lora_param is None:
        raise RuntimeError("LoRA wrap produced zero trainable lora_A params — target_modules regex mismatch")
    norm_pre = sample_lora_param.detach().clone().float().norm().item()

    for it in range(total_iters):
        # Sample-by-iter rotation; for batch_size > 1 this would chunk samples.
        # R11 default batch_size=1 with 2 samples → simplest correct behavior is
        # iter `it` consumes sample `it % len(samples)`.
        sample_idx = it % len(samples)
        sample = samples[sample_idx]
        prompt_text = tokenizer.apply_chat_template(sample["messages"], tokenize=False)
        inputs = tokenizer(
            prompt_text,
            return_tensors="pt",
            truncation=True,
            max_length=args.max_seq_length,
        )
        inputs = {k: v.to(device) for k, v in inputs.items()}
        inputs["labels"] = inputs["input_ids"].clone()

        output = peft_model(**inputs)
        loss = output.loss
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
        print(
            f"[peft_train] iter {it + 1}/{total_iters} "
            f"sample={sample_idx} seq_len={inputs['input_ids'].shape[1]} "
            f"loss={loss.item():.4f} t={time.time() - t0:.1f}s",
            flush=True,
        )

    norm_post = sample_lora_param.detach().clone().float().norm().item()
    delta = abs(norm_post - norm_pre)
    print(
        f"[peft_train] LoRA norm pre={norm_pre:.6f} post={norm_post:.6f} Δ={delta:.6f}",
        flush=True,
    )
    if delta < 1e-9:
        print("[peft_train] FAIL — LoRA params did not update across training", flush=True)
        return 2

    os.makedirs(args.output, exist_ok=True)
    peft_model.save_pretrained(args.output, safe_serialization=True)
    print(f"[peft_train] saved adapter to {args.output} t={time.time() - t0:.1f}s", flush=True)

    artifact_path = os.path.join(args.output, ADAPTER_FILENAME)
    if not os.path.exists(artifact_path):
        # Some peft versions write a .bin sibling instead of .safetensors when
        # safe_serialization isn't honored — flag that so the TS wrapper can
        # surface a structured error.
        listing = sorted(os.listdir(args.output))
        print(
            f"[peft_train] FAIL — expected {artifact_path} not found. "
            f"Output dir contents: {listing}",
            flush=True,
        )
        return 3
    size_bytes = os.path.getsize(artifact_path)
    print(
        f"[peft_train] adapter_model.safetensors: {size_bytes:,} bytes "
        f"total_iters={total_iters} sample_count={len(samples)}",
        flush=True,
    )
    print("[peft_train] OK", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
