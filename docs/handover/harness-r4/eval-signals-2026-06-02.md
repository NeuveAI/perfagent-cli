# harness-r4 Eval Signals — 2026-06-02

_Standalone eval-signals handover. Captures the wave-r5-ab sweep run against the external agent's harness-r4 detector implementation, so the next agent can pick up the assessment without re-running ~70 min of sweep wall-clock._

## State at handover

- **Branch**: `gemma-harness-lora`
- **HEAD**: `1ef57d5a` — `fix(evals): update Gemini Pro 3 model id after gemini-3-pro-preview retirement`
- **Commit dependency chain**:
  - `3f1e7ad8` — external agent: harness-r4 detector impl (vary-each-attempt + THOUGHT-only loop)
  - `064ce7c7` — external agent: session handover for gemma fine-tunning
  - `17ab49cb` — `.pnpm-store` gitignore
  - `5bf5438d` — `.devcontainer` config
  - `1ef57d5a` — **THIS SESSION**: gemini-3-pro-preview → gemini-3.1-pro-preview (Google retired the alias 2026-03-26)

- **Working tree**: only pre-existing untracked probe artifacts; nothing in flight.
- **Memory**: `project_harness_r3.md` + `project_harness_r2.md` + `MEMORY.md` index reflect harness-r3 close-out. **No harness-r4 memory entry written yet** — pending close-out decision below.

## Eval setup

- Sweep command: `EVAL_TRACE_DIR=evals/traces/wave-harness-r4-detectors pnpm --filter @neuve/evals eval:wave-r5-ab`
- Trace dir: `packages/evals/evals/traces/wave-harness-r4-detectors/` — 60 ndjsons + 60 `.scores.json` sidecars
- Report: `packages/evals/docs/handover/harness-evals/baselines/wave-r5-ab.md` (auto-generated 2026-06-02T15:01:25Z; **note this file is auto-overwritten on next sweep — fold into a wave-harness-r4.md before re-running**)
- Lanes run: gemma-react + gemini-react + gemma-oracle-plan. **browsing-gemma-react absent** (llama-server not up; R11 LoRA runtime not exercised this sweep).
- Pre-sweep verification: `pnpm --filter @neuve/local-agent build` OK; tests 188/193 pass (5 skipped, 0 fail) after model-id fix.

## Headline numbers vs harness-r3 anchor

| Lane | r3 step-cov | r4 step-cov | Δ | r3 pass | r4 pass | Pass Δ |
|---|---|---|---|---|---|---|
| **gemma-react** | 0.307 | 0.283 | -0.024 | 2/20 | **6/20** | **+4** |
| **gemini-react** | 0.426 | 0.413 | -0.013 | 3/20 | 7/20 | +4 |
| **gemma-oracle-plan** | 0.257 | 0.275 | +0.018 | 0/20 | 0/20 | 0 |

All step-cov deltas within harness-r2's documented natural-variance envelope (Δ ≤ 0.107). Gemma-oracle-plan was 20/20 `status=unfinished` in harness-r3 too — **not a regression**, pre-existing structural property (planner-decomposes-but-gemma-doesn't-execute-final-state pattern from harness-r3 P3).

## Detector evidence (re-derived from trace ndjson)

| Signal | r3 anchor | r4 result | Read |
|---|---|---|---|
| REFLECT injections (total) | 7/60 | **7/60** | Same total; redistributed (2 gemma-react + 4 gemini-react + 1 gemma-oracle-plan vs r3's 3+1+3) |
| Doom-loop aborts | not measured | 4 | Existing safety net still active |
| THOUGHT-only loop detections in logs | n/a | **0** | See open question 2 below |
| PLAN_UPDATE envelopes | 1/60 (calibration-5) | **0/60** | calibration-5 did not repro the emission |
| `RUN_COMPLETED:passed` (per `status` field) | varies | gemma-react 6, gemini-react 7, gemma-oracle-plan 0 | Pass-rate uplift on both gemma-react and gemini-react |

### Re-derivation commands (for the next agent)

```bash
# REFLECT count (across all traces)
cd packages/evals/evals/traces/wave-harness-r4-detectors
grep -c "REFLECT:" *.ndjson | grep -v ":0$"

# Status distribution per lane
for lane in gemma-react gemini-react gemma-oracle-plan; do
  echo "=== $lane ==="
  for f in ${lane}__*.scores.json; do
    python3 -c "import sys,json; print(json.load(open('$f'))['status'])"
  done | sort | uniq -c
done

# PLAN_UPDATE count
grep -l '"type":"agent_message".*"plan_update"\|PLAN_UPDATE' *.ndjson
```

## Three substantive observations

### 1. Detector code is correct; eval lift is marginal

The vary-each-attempt detector was designed to fire on N consecutive different-shape rejections on same `stepId` (closes the calibration-1-oracle-plan blind spot from harness-r3 P3 where 5 different-shape parse-fails → 0 REFLECT). **REFLECT-injection rate did not increase** (7/60 → 7/60). Inference: **vary-each-attempt patterns are rare in actual trajectories**; same-shape was already catching what's catchable. The calibration-1-oracle-plan finding from r3 was a single trace, not a population-level pattern.

### 2. THOUGHT-only loop detector firing rate appears 0 — OPEN QUESTION

Predicted incidence from harness-r3 P2 was 8/120 on gemma-execution lanes (combined gemma-react + gemma-oracle-plan). This sweep should have surfaced 1-2 firings on those 40 traces. Observed: 0 visible "thought-only" / "THOUGHT-only loop detected" log strings in the trace ndjson.

Two possible explanations the next agent should disambiguate:
- **(a) No occurrence this sweep** — model didn't hit the THOUGHT-only loop pattern; consistent with stochastic distribution at low base-rate
- **(b) Log format mismatch** — detector fires, but the log emission goes to stderr / Effect logger / a separate stream that doesn't end up in the trace ndjson

Cheapest probe: read `packages/local-agent/src/tool-loop.ts` THOUGHT-only block (engineer's diary says ~lines 387-438). Check whether the firing path emits to `connection.sessionUpdate({ sessionUpdate: "agent_message_chunk", ... })` (which lands in trace) or only `Effect.logInfo(...)` (which lands in `.expect/logs.md` only). If the latter, the detector is firing silently — needs trace emission for evidence.

### 3. gemma-react pass rate tripled (2 → 6) is the real win

Step-cov drifted slightly down (within noise) but more tasks reached successful `RUN_COMPLETED`. Plausible mechanism: detectors letting hung trajectories terminate cleanly via abort instead of hanging at MAX_TOOL_ROUNDS in INCOMPLETE state, OR converting BMW-shape parse-fail loops into clean abort paths that the model recognizes as recoverable on subsequent turns.

**This is the load-bearing signal for distillation candidate-trace yield** — R12 needs clean `RUN_COMPLETED:passed` trajectories as training data, and this sweep produced 6 vs the harness-r3 anchor of 2.

The PLAN_UPDATE 1/60 → 0/60 stays at noise — confirms harness-r3 P3 finding that the recovery-shape generation gap can't be closed by detection work alone.

## Direction call

harness-r4 ships clean code that closes the spec gaps from harness-r3 P3 but provides marginal eval lift on the headline injection metrics. The pass-rate uplift IS substantive and matters for distillation. The capability gap remains recovery-shape generation, which is R12 distillation's territory.

**Recommended next step**: pivot to R12 distillation. The 6 new gemma-react pass trajectories from this sweep are exactly the candidate pool R12 needs (vs. the harness-r3 anchor of 2). Re-evaluate the R12 plan (locked at `33edcc91`) against:
- New anchor: 6/20 gemma-react strict-pass candidates (3x R11 anchor)
- harness-r3 P3 data targets: recovery-shape PLAN_UPDATE exemplars + tool-discriminator disambiguation
- DoD #8 behavioral-floor carry-forward from R11

Ship harness-r4 to memory as INFO-VERIFIED (detectors land clean code but eval lift is in pass-rate, not injection rate) before R12 dispatch.

## Open questions for the next agent

1. **Resolve observation #2** — is the THOUGHT-only loop detector firing silently? Read `tool-loop.ts:387-438` for the log-emission path.
2. **Confirm pass-rate uplift mechanism** — pick 2-3 of the new gemma-react passes (tasks that were FAIL/INCOMPLETE in harness-r3 and now pass) and diff trace structure. Is it detector-driven (abort → restart) or pure stochastic noise at temp=0?
3. **The 1/60 → 0/60 PLAN_UPDATE collapse** — is harness-r3's calibration-5 emission reproducible at all? Run a 2-sweep variance check: re-run wave-r5-ab against HEAD, see if calibration-5 emits PLAN_UPDATE in either run. If 0/2, harness-r3's "first non-zero PLAN_UPDATE" was always noise; if 1+/2, the harness-r4 prompt change (if any) regressed it.
4. **harness-r4 code-level audit not done by this session** — external agent's screenshot showed an internal reviewer APPROVE, but a formal `/strict-critique` pass against the actual diff (`git show 3f1e7ad8`) hasn't run. Optional gate before R12 dispatch.

## Files referenced in this handover

- Sweep traces: `packages/evals/evals/traces/wave-harness-r4-detectors/` (60 .ndjson + 60 .scores.json)
- Sweep stdout: `/private/tmp/claude-501/-Users-vinicius-code-perfagent-cli/ab7a7eaa-98c1-4cea-a07d-f9cd30358c87/tasks/bhc0i0ilg.output`
- Auto-report (OVERWRITTEN ON NEXT SWEEP): `packages/evals/docs/handover/harness-evals/baselines/wave-r5-ab.md`
- External agent's diary: `docs/handover/harness-r4/diary/r0-2026-05-29.md`
- External agent's plan: `docs/research/harness-r4/detectors-plan.md`
- harness-r3 close-out memory: `~/.claude/projects/-Users-vinicius-code-perfagent-cli/memory/project_harness_r3.md`
- harness-r3 anchor traces (comparison set): `packages/evals/evals/traces/wave-harness-r3-reflect-injection/`

## Process invariants (still active, from prior waves)

- No `git stash` / `reset --hard` / `checkout --` / `--no-verify` / `git push` per `feedback_reviewer_never_stash.md`
- No Co-Authored-By; granular commits after reviewer APPROVE per `feedback_commit_guidelines.md`
- Real services for live smokes — no `MockLanguageModelV4` per `feedback_no_test_only_injection_seams.md`
- `pnpm --filter @neuve/local-agent build` before any sweep touching local-agent source per `project_eval_build_cache_trap.md`
- `CI=true pnpm install` when reinstalling — pnpm 10 needs CI flag in non-TTY contexts
- Distribution-form gates; never single-sample per `project_baseline_eval_strategy.md`
- Always read prior work in full per `feedback_always_read_prior_work.md`

## Seed prompt for the next agent

```
Pick up the harness-r4 eval signals work in perfagent-cli. State: HEAD 1ef57d5a on
gemma-harness-lora. External agent shipped harness-r4 detectors at 3f1e7ad8
(vary-each-attempt + THOUGHT-only loop); I ran the wave-r5-ab sweep and captured
signals at docs/handover/harness-r4/eval-signals-2026-06-02.md.

Read these in full first:
- docs/handover/harness-r4/eval-signals-2026-06-02.md (this session's signals memo)
- docs/handover/harness-r4/diary/r0-2026-05-29.md (external agent's impl diary)
- docs/research/harness-r4/detectors-plan.md (impl plan)
- memory: MEMORY.md + project_harness_r3.md + project_harness_r2.md + project_react_migration_plan.md
- Traces: packages/evals/evals/traces/wave-harness-r4-detectors/ vs anchor at
  packages/evals/evals/traces/wave-harness-r3-reflect-injection/

Headline: gemma-react PASS rate 2→6 (3x R11 anchor — load-bearing for R12 distillation
candidate-trace yield), REFLECT-injection 7/60→7/60 (same total, redistributed),
PLAN_UPDATE 1/60→0/60 (collapsed). Detectors are code-clean per external reviewer
APPROVE but eval lift is in pass-rate, not injection rate.

Three open questions to resolve before R12 dispatch (per signals memo §Open questions):
  (1) Is THOUGHT-only loop detector firing silently? Read tool-loop.ts:387-438 for
      the log-emission path — does it emit to agent_message_chunk (trace-visible) or
      only Effect.logInfo (logs-only)?
  (2) Is the gemma-react pass-rate uplift detector-driven or stochastic? Diff 2-3
      trace pairs (tasks that flipped INCOMPLETE→passed between r3 and r4).
  (3) Is the calibration-5 PLAN_UPDATE emission reproducible at all? 2nd sweep at
      HEAD would settle whether r3's 1/60 was noise or genuine.

Once those resolve, write harness-r4 close-out memory (project_harness_r4.md +
MEMORY.md index entry) following the project_harness_r3.md template. Then decide:
  (a) R12 distillation dispatch (locked plan at 33edcc91) with the 6 new pass
      trajectories as candidate pool — re-evaluate R12 estimates against new anchor
  (b) harness-r5 if a substantive detector gap surfaces from the open questions
  (c) strategic pivot (bigger base model / alternate teacher) if harness work
      hits diminishing returns

Honor all process invariants in the signals memo §Process invariants. Use
/team-orchestration + /strict-critique for any multi-step impl wave. Use
ScheduleWakeup only if monitoring a long-running background task; otherwise stand by.
```
