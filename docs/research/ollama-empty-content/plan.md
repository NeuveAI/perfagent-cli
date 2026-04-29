# R8 — Ollama empty-content investigation

_Surfaced from R7 phase-7 sweep evidence (`docs/research/strict-tool-schema/post-r7-investigation.md`)._

## What we're investigating

Production gemma (`gemma4:e4b` via Ollama) silently returns zero-byte responses on ~30-35% of tasks per sweep. The failure trace is consistent:

```
turn N: agent_message → "[Local agent: model returned empty content at round 1
        with done_reason='stop'. The format grammar should have prevented this —
        likely a server-side cancellation.]"
```

Code path: `packages/local-agent/src/tool-loop.ts:181-193` — `if (result.content.length === 0) return;` bails the loop. Ollama returns success (`done_reason='stop'`) but no tokens were emitted; `format` grammar didn't constrain anything because there was nothing to constrain.

## Why R7 falsified the schema-strictness hypothesis

R7 strict full sweep: 7/20 tasks hit empty-content. R7 phase-7 loose sweep (2.36 KB / depth-1 schema): 6/20 tasks hit it. Affected task sets are **disjoint** between the two runs. The bug is task-stochastic and triggers under both schema shapes. Cause is deeper than schema strictness.

## Hypothesis matrix

| # | Hypothesis | Evidence-for | Evidence-against |
|---|---|---|---|
| H1 | Grammar-compile pathology (llama.cpp's GBNF compiler chokes on certain schema/token interactions) | Failure correlates with format-grammar use | Triggers on both 27 KB and 2.4 KB schemas |
| H2 | Context-length interaction (prompt + history exceeds model window mid-stream) | Bug surfaces more on longer tasks | num_ctx=131072 should be ample for E4B |
| H3 | Sampler-grammar interaction at certain temperatures | Stochastic per-task triggering | We don't tune temp per task |
| H4 | Ollama version regression in adapter layer | We pinned a specific Ollama version recently | No version delta tested yet |
| H5 | Specific tool-call sequence yields rejected token distribution after grammar masking | Failure can occur mid-run, not always round 1 | Some empty-content events ARE at round 1 |
| H6 | Upstream llama.cpp grammar engine bug | All evidence points below the Ollama API surface | Hard to localize without upstream tracing |

## Sub-probes

### P1 — Characterize the Ollama trigger

Goal: identify what's different between an empty-content run and a normal run on the same task.

Probes:
- Pick a known-failing task (e.g. `journey-1-car-configurator-bmw` from R7 strict, or whichever phase-7 sweep run hit empty-content).
- Run with `OLLAMA_DEBUG=1` and inspect Ollama server logs around the failing turn.
- Check `num_ctx` actual usage vs configured (probe whether truncation happens silently — Q9 probe-D pattern).
- Capture the exact prompt + grammar size at the failing turn vs the prior succeeding turn.
- Test repeated runs of the same task: is the trigger deterministic or genuinely stochastic per-task per-run?

Effort: small probe.

Outcome: a characterization note documenting what we see (logs, sizes, timing). Doesn't necessarily fix anything — just narrows the hypothesis space.

### P2 — LM Studio backend comparison

Goal: test whether the bug is Ollama-specific, llama.cpp-specific, or model-specific.

Probes:
- Install LM Studio (or use existing install). Configure `gemma4:e4b` GGUF model.
- Run the same known-failing task under:
  - LM Studio with **llama.cpp backend** (same engine as Ollama, different adapter)
  - LM Studio with **MLX backend** (Apple's framework, different sampler/grammar implementation, materially faster on Apple Silicon)
- Compare empty-content rate across backends.

Effort: medium (involves spinning up a parallel inference server).

Outcomes:
- llama.cpp same bug, MLX clean → migration path is LM Studio + MLX (also faster for distillation throughput).
- Both backends show the bug → root cause is in the model's grammar interaction or the GGUF itself; harness-level safety net is the right move.
- LM Studio llama.cpp clean, Ollama llama.cpp buggy → Ollama adapter bug; pin a known-good Ollama version or migrate adapter.

### P3 — Decision: migrate vs harness safety net

Goal: based on P1+P2 findings, land the right fix.

Possible outcomes:
- **Migrate** to LM Studio + MLX backend. Rewire `OllamaClient` to point at LM Studio's API (OpenAI-compatible on port 1234, OR LM Studio's native API). Keep `format` grammar pathway. Re-run R5b baseline + R7 sweep to confirm empty-content drops to 0/20 and gemma scores match or beat R5b.
- **Harness safety net.** Add to `tool-loop.ts`: detect `result.content.length === 0` → log structured event with retry counter → retry with grammar-relaxed format (or no format) → if retry succeeds, log recovery telemetry. If both retries fail, emit `RunCompleted({status:"failed", abort:{reason:"empty-content-unrecoverable"}})` so the supervisor counts it as a deterministic failure rather than an infinite hang. (Per `feedback_no_test_only_injection_seams.md`, this needs a live integration test against a real Ollama instance, not just MockLanguageModelV4.)
- **Both** — migrate AND keep a safety net for any future model-server-grammar interaction.

Effort: ranges from small (config flip if migration is clean) to medium (safety net with live test).

## Wave gate

Production gemma empty-content events drop to 0/20 on a full 20-task sweep. If P3 lands a safety net rather than a migration, also gate: empty-content recovery rate ≥ 80% after the safety net (i.e. retry-then-grammar-relax recovers most, hard-fails the rest).

## Out of scope for R8

- Teacher-viability ladder. That's R9 (Q1 — `gemini-3-pro-preview` first, then `claude-sonnet-4-6`).
- Distillation pipeline work. Gated on R8 + R9 outcomes.
- Any prompt-overfitting to specific tasks (per `feedback_avoid_prompt_overfitting.md`).

## Process invariants (carry from R5b/R6/R7)

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass` with `_tag: Schema.tag(...)`, `Effect.fn`. No `Effect.catchAll`, `Effect.mapError`, `try/catch`, `null`. Per `CLAUDE.md`.
- No `Co-Authored-By` footer. Granular commits.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push`.
- Live smoke probe required for any new local-server integration (per `feedback_no_test_only_injection_seams.md`).
- DoDs describe runtime behavior not "function exists" (per `feedback_dod_behavior_vs_verification.md`).
- Reviewers antagonistic; never destructive git ops (per `feedback_reviewer_never_stash.md`).

## Team structure

`react-r8` with engineer + reviewer per `feedback_use_teammates.md`.

- T1 (engineer): execute P1 + P2 probes, write characterization diary, propose P3 path with evidence.
- T2 (reviewer, antagonistic): verify probe methodology is sound (real Ollama, real LM Studio with both backends, real failing task), verify the P3 decision matches the evidence, verify any code lands without test-only seams.

After lead authorizes the P3 path, T1 executes the chosen fix; T2 reviews it for INVESTIGATIVE-VERIFIED close-out.

## Diary location

`docs/handover/ollama-empty-content/diary/r8-{date}.md` — engineer captures probe methodology, raw evidence, hypothesis updates, and decision rationale.
