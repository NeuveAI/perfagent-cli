# R10 — Teacher viability ladder

_Surfaced in `docs/research/strict-tool-schema/post-r7-investigation.md` "Open question 2", deferred behind R8 (Ollama empty-content) and R9 (schema-invalid reconciliation). Now active._

## What we're answering

Does a frontier LLM decisively beat current gemma 4 E4B on our gemma-react browsing harness? Distillation (`browsing-gemma` LoRA training) is gated on this — without a teacher that's clearly stronger than the student, we have nothing to distill.

The R7 phase-7 sweep had `gemini-3-flash-preview` ≈ gemma at the noise floor (gemini 0.392, gemma 0.398 step-coverage; two phase-7 runs with no code changes between them produced 0.465 and 0.392 — wider variance than the gap). Flash 3 is not a viable teacher.

## Locked entry point

Probe `gemini-3-pro-preview` first. Same `@ai-sdk/google` provider plumbing that `gemini-3-flash-preview` already uses — flip the modelId, run the sweep. Cheapest probe; doesn't add any new package or API key.

The runtime override path is the fastest iteration: `PERF_AGENT_GEMINI_REACT_MODEL=gemini-3-pro-preview` env var, plumbed at `packages/evals/src/runners/gemini.ts:70`. Source flip can land after the probe shows lift.

## Hypothesis-of-fix matrix

| # | Step | What changes | Cost | Risk |
|---|---|---|---|---|
| 1 | **`gemini-3-pro-preview`** | Env var override or constant flip in `gemini-react-constants.ts:27`. Same `@ai-sdk/google` provider, same training-distribution prior (knows chrome-devtools-mcp upstream API), same `responseSchema` + per-tool union plumbing. | ~4-5x flash unit cost; full sweep ~$30-60 estimate. | Same provider quirks — if Pro inherits Flash's stochastic variance on `responseSchema`, cleaner-but-not-stronger. Gate on +0.10 step-coverage delta. |
| 2 | **`claude-sonnet-4-6`** | Add `@ai-sdk/anthropic` to `packages/evals/package.json`, `ANTHROPIC_API_KEY` in `.env.local` (separate from Claude Code session auth). New runner file or parameterize the existing loop provider-agnostic. | ~10x flash unit cost; tighter token budgets per task offset some of that; sweep ~$15-30. | Different provider quirks — Anthropic uses `strict: true` on tools rather than Google's `responseSchema`, no oneOf grammar issues. Cleaner schema behavior but bigger plumbing lift. |
| 3 | **biggers** | GPT-5, claude-opus-4-7, self-hosted Llama 4 70B / Gemma 3 27B. | ~$$$ per run; opus ~5x sonnet. | Only if Sonnet doesn't lift. At this point we'd revisit whether harness/scorers themselves are noise-bound, not just the teacher. |

Lean: start at step 1 (Pro env-var probe). Escalate only if the gate misses by margin (i.e. Pro lifts <+0.10 over gemma on full sweep).

## Sub-probes

### P1 — gemini-3-pro-preview probe sweep

Goal: full sweep, both runners (gemini-react + gemma-react), determine if Pro decisively beats gemma.

Probes:
- Verify env var path works: run a smoke task with `PERF_AGENT_GEMINI_REACT_MODEL=gemini-3-pro-preview` to confirm Pro is reachable. If it 404s on the modelId, we need a different SKU string — Google's preview names rotate.
- Run full `wave-r5-ab` sweep (both runners, full task set). Save report to `docs/handover/harness-evals/baselines/wave-r10-pro-preview.md`.
- Compare to R9 baseline (`wave-r9-bridge-coerce.md`): step-coverage, PASS rate, schema-invalid count, empty-content count, final-state. Single-row teacher delta = `gemini-pro step-cov` − `gemma step-cov`.
- If Pro lifts ≥ +0.10 over gemma: gate cleared, ship INVESTIGATIVE-VERIFIED, open distillation work.
- If Pro lifts < +0.10: pause, surface to lead with delta numbers + per-task pattern (where does Pro win, where does it tie/lose).

Effort: small probe (env-var + sweep + report).

### P2 — Source-land Pro modelId (only if P1 clears the gate)

Goal: persist the probe's modelId as the new gemini-react default.

Probes:
- Edit `packages/evals/src/runners/gemini-react-constants.ts:27` `gemini-3-flash-preview` → `gemini-3-pro-preview`.
- Decision points (ask lead before flipping):
  - `packages/evals/src/planning/planner-prompt.ts:1` `PLAN_DECOMPOSER_MODEL_ID` — used by gemma-oracle-plan path. Pro is overkill for plan decomposition; lean is to leave on Flash.
  - `packages/evals/src/scorers/llm-judge.ts:21` `JUDGE_DEFAULT_MODEL` — LLM-as-judge. Pro might give sharper scoring but ~5x cost on every eval. Lean is to leave on Flash unless judge noise is a measured problem.
- Re-run smoke + a partial sweep to confirm post-flip behavior matches the probe.
- Commit: `feat(evals): adopt gemini-3-pro-preview as gemini-react default`.

Effort: small (single-line source edit + verification).

### P3 — Escalate to claude-sonnet-4-6 (only if P1 misses)

Goal: add Anthropic provider, run sweep, determine if Sonnet beats gemma where Pro didn't.

Probes:
- Add `@ai-sdk/anthropic` (matching @ai-sdk/google version line) to `packages/evals/package.json`.
- Add `ANTHROPIC_API_KEY` to `.env.local` (user provides — separate from Claude Code session auth).
- Either parameterize `gemini-react-loop.ts` to accept a non-Google `LanguageModel` and rename, OR clone to `claude-react-loop.ts`. Lean is parameterize — both runners are doing identical ReAct work, only the model handle differs.
- Smoke task with Sonnet to confirm tool-call + responseSchema-equivalent (Anthropic's `tool_choice: { type: "tool", name: ... }` + `strict: true`) plumbing works.
- Full sweep. Report to `docs/handover/harness-evals/baselines/wave-r10-sonnet-4-6.md`.
- Same gate as P1 — Sonnet step-coverage − gemma step-coverage ≥ +0.10.

Effort: medium (provider plumbing + sweep + report).

### P4 — Reviewer

Antagonistic verification of:
- Probe methodology — same task set, same runner config except modelId. No accidental confound (e.g. different temperature, different system prompt, different tool catalog).
- Cost discipline — confirm we ran the cheapest viable probe path before escalating.
- Threshold reasoning — confirm +0.10 step-coverage is a defensible gate (vs noise-floor variance in R7 phase-7 ≈ 0.07 wider, R8/R9 sub-task swings).
- No test-only injection seams — real Anthropic / Google providers in any new runner code.
- Per `feedback_no_test_only_injection_seams.md`: live integration smoke must hit the real API in `tests/`.

## Wave gates

1. **Probe sweep numbers exist.** Pro-preview full `wave-r5-ab` sweep completes; report posted to `docs/handover/harness-evals/baselines/wave-r10-pro-preview.md`.
2. **Teacher delta determined.** `gemini-pro step-cov` − `gemma step-cov` measured on full sweep, with per-task breakdown.
3. **Decision recorded.** Either (a) Pro clears +0.10 gate → ship + open distillation, or (b) Pro misses → escalate to P3 Sonnet OR record explicit deferral with rationale.
4. **R8/R9 fixes intact.** Empty-content stays at 0/20 on the gemma lane, schema-invalid stays at ≤ 2/20. Pro probe doesn't accidentally regress the production gemma path.

## Out of scope

- Distillation pipeline itself. Trace capture + LoRA training is the **next** wave (gated on R10 ship).
- Harness/scorer rework. If Pro AND Sonnet both fail the gate, we'd consider whether scorers are noise-bound — but that's a separate investigation, not part of R10.
- Local self-hosted teacher (Llama 4 70B / Gemma 3 27B) — only if the cloud-frontier ladder fails. Different infrastructure surface area.

## Process invariants

- Effect v4 patterns: `ServiceMap.Service`, `Schema.ErrorClass`, `Effect.fn`. No `catchAll`/`mapError`/`try-catch`/`null`. Per `CLAUDE.md`.
- No `Co-Authored-By` footer. Granular commits after reviewer APPROVE. Per `feedback_commit_guidelines.md`.
- No `git stash` / `reset --hard` / `checkout --` / `restore --staged` / `clean -f` / `--no-verify` / `git push`. Per `feedback_reviewer_never_stash.md`.
- Live smoke for any new provider integration — no `MockLanguageModelV4`. Per `feedback_no_test_only_injection_seams.md`.
- `pnpm --filter @neuve/local-agent build` before any sweep that exercises new local-agent source. Per `project_eval_build_cache_trap.md`. (R10 doesn't expect to touch local-agent source, but if any gemma-side fix lands as part of the comparison work, build first.)

## Team structure

`react-r10` with engineer + reviewer per `feedback_use_teammates.md`.

- T1 (engineer): P1 — Pro env-var probe sweep + report + recommendation. Surface numbers to lead before P2 source-flip.
- T2 (reviewer, antagonistic): P4 — verify probe methodology, threshold reasoning, no test-only seams.
- T3 (engineer, conditional): P2 source-flip OR P3 Sonnet escalation, after lead authorizes based on P1 numbers.

## Diary location

`docs/handover/teacher-viability/diary/r10-2026-04-30.md` — engineer captures P1 probe results, per-task delta breakdown, decision rationale.
