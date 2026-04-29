# Post-R7 — strict-tool-schema investigation memo

_2026-04-29 — closing R7 INVESTIGATIVE, opening R8/R9 questions._

R7 shipped phase-7 (split schema: Gemini strict / Ollama loose) on top of R7's strict-schema fix, gating four lead-defined criteria. **All four gates failed** but the phase-7 unit is the right state to land — the alternative (revert to R7 strict) is strictly worse on the production gemma path.

This memo captures the two open questions R7 surfaced and frames them as the next two waves.

---

## What R7 actually proved

| Claim from the wave plan | Result |
|---|---|
| Strict per-tool union fixes Gemini's "flat-action" structured-output bug | **TRUE** — gemini-react went 0.000 → 0.392-0.465 |
| Strict schema causes the gemma empty-content failure mode | **FALSE** — phase-7 loose schema (2.36 KB / depth 1) still trips empty-content on 6/20 tasks; affected task set just shifted |
| Splitting schemas (gemini strict / ollama loose) recovers gemma | **PARTIAL** — 7/20 → 6/20 is single-task noise, not the 0/20 the gate required |
| Strict-schema lift on gemini is stable | **FALSE** — high stochastic variance run-to-run (0.465 → 0.392 with no code changes) |

What we got right:
- Gemini's `responseSchema` decoder needs the per-tool discriminated union to physically reject upstream-catalog hallucinations. R7 phase-1 through phase-6 nailed this.
- The auto-wrap normalizer in `mcp-bridge` keeps gemma's existing canonical/shorthand emissions valid against the strict schema. R5b parity preserved.

What we got wrong:
- We diagnosed the empty-content bug as schema-strictness-driven. The phase-7 sweep falsifies that — loose schema is small, shallow, and still triggers the bug on a different task set. The cause is deeper in the Ollama / llama.cpp grammar pipeline.
- We picked `gemini-3-flash-preview` as the frontier baseline. R7 sweep numbers show gemini ≈ gemma at the noise floor (0.392 vs 0.398). Without a teacher that decisively beats the student, distillation is blocked.

---

## Open question 1 — Ollama empty-content bug (R8)

### What we know
- Failure trace: `agent_message → "[Local agent: model returned empty content at round 1 with done_reason='stop'. The format grammar should have prevented this — likely a server-side cancellation.]"`
- Code path: `tool-loop.ts:181-193` — `if (result.content.length === 0) return;` bails the loop.
- Affected rate: ~30-35% of tasks per run (7/20 R7 strict, 6/20 phase-7 loose).
- Schema-stochastic per task: strict and loose schemas trip the bug on disjoint task sets.
- Pattern: `done_reason="stop"` with zero-byte content. Ollama returns success but no tokens were emitted.

### What we don't know
- Whether the trigger is grammar-compile pathology, context-length interaction (prompt + history exceeding model window), sampler-grammar interaction at certain temperatures, an Ollama version regression, or a specific tool-call sequence producing rejected token distributions.
- Whether the bug is in Ollama's adapter layer or upstream in llama.cpp's grammar engine itself.
- Whether LM Studio's MLX backend (Apple Silicon-tuned, different sampler) shows the same pathology or runs cleanly.

### R8 plan (Q2)

Three sub-probes:
1. **Characterize the Ollama trigger.** Probe Ollama logs during a known-failing task. Check context length vs model window, llama.cpp version, sampler params. Identify what changes between an empty-content run and a normal run.
2. **LM Studio comparison.** Same task under (a) llama.cpp backend, (b) MLX backend. If MLX doesn't fire empty-content, that's a migration path. MLX is also materially faster on Mac for inference (relevant for distillation throughput).
3. **Decide.** Either migrate to LM Studio + MLX, or add a harness-level safety net (detect empty-content event → retry with simpler schema, log recovery for telemetry, don't fail the task). Either way gemma's production reliability improves.

### Why R8 first, not R9
The Ollama bug is hygiene — it doesn't unblock distillation. But our gemma baseline is poisoned by 30-35% silent-degradation noise, so any teacher comparison is reading through that noise. Cleaning the floor before teacher-shopping makes the teacher-comparison cleaner.

---

## Open question 2 — Teacher viability (R9)

### The problem
Distillation requires a teacher that decisively beats the student. R7 evidence:

| Run | gemini-react | gemma-react | Δ |
|---|---|---|---|
| R7 strict full sweep | 0.465 | 0.365 | gemini +0.100 |
| Phase-7 full sweep | 0.392 | 0.398 | **gemma +0.006** |
| 5b baseline | 0.000 | 0.465 | gemma +0.465 |

`gemini-3-flash-preview` is at gemma's noise floor. Two phase-7 runs with no code changes between them produced 0.465 and 0.392 — wider variance than the gemini-vs-gemma gap. This is not a viable teacher.

### R9 plan (Q1) — ladder

Step 1: **`gemini-3-pro-preview`.** Same provider (`@ai-sdk/google` already wired), flip the modelId string, run sweep. Cheapest probe — tests whether "bigger Gemini" alone solves teacher-viability while keeping the same training-distribution prior (knows chrome-devtools-mcp upstream API, same oneOf quirks). If gemma-react +0.15 lift on full sweep: distillation unblocked.

Step 2: **`claude-sonnet-4-6`.** If Pro doesn't decisively beat gemma. Needs `@ai-sdk/anthropic` added to evals package, `ANTHROPIC_API_KEY` in `.env.local` (separate from Claude Code's session auth). Different provider quirks — Anthropic uses `strict: true` for tools rather than `responseSchema`, cleaner tool-call typing, no oneOf grammar issues. Bigger commitment but different prior + different schema behavior.

Step 3: **biggers.** GPT-5, claude-opus-4-7, or self-hosted Llama 4 70B / Gemma 3 27B. Only if Sonnet also doesn't clearly beat gemma. At that point we'd revisit whether the harness/scorers themselves are noise-bound, not just the teacher.

### Cost asymmetry
- gemini-3-pro-preview: same provider plumbing, ~4-5x flash cost, sweep ~$30-60
- claude-sonnet-4-6: ~10x flash cost ($3/$15 per Mtok), sweep ~$15-30 (smaller token budgets per task offset higher unit cost), distillation data-collection ~$100-500
- claude-opus-4-7: ~$$$, only as last resort

Test cheap before committing big.

---

## What ships at end of R7

Phase-7 is the R7 final state. Splitting schemas was correct in design even though it didn't fix the empty-content bug — Gemini still needs the strict per-tool union for `responseSchema` to honor the upstream catalog, and the loose Ollama schema is a structurally cleaner contract for the grammar engine even though it didn't deliver the empirical gain we expected. The size+depth-bound tests pin the loose schema at 2.36 KB / depth 1 so future drift toward strict is caught at unit-test time.

R7 closes INVESTIGATIVE-VERIFIED with two open questions queued as R8 (Ollama hygiene) and R9 (teacher viability), R8 first.
