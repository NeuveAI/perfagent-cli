# Wave 4.5 — Regression report (baselines B1 & B2 vs current)

## TL;DR

Three eval sweeps ran against the hand-authored 20-task smoke set
(`packages/evals/evals/smoke.eval.ts`) using `EVAL_RUNNER=mock` — the only
runner available in this environment without a provisioned ACP backend
and unattended-browser automation. Mock-runner scores are **byte-identical
across all three branches** because the mock runner's output is a function
of `(task, scenario)` only, never invoking the prompt, plan decomposer,
executor gate, Set-of-Mark overlay, or interaction tools. This is not a
runtime failure — it's the runner's design — and it means the numerical
regression-delta table is flat by construction. The report covers:

1. The numerical mock table (flat).
2. A **static-diff projection** of which scorers each revert would move
   under a real runner, derived from reading the reverted commits.
3. A **test-suite sanity finding**: B1 breaks 5 of 81 eval tests because
   the `@neuve/evals` test scaffold references `PlanDecomposer.of`, a
   symbol introduced by Wave 1.A. Fix-out-of-scope for this wave, but
   recorded here as a coupling to clean up when real baselining arrives.
4. An overfitting-guard check: there is no site-specific DOM selector,
   URL pattern, or site name in the Wave 2.B prompt rewrite
   (`packages/shared/src/prompts.ts`) or the Wave 1.A planner prompt
   (`packages/supervisor/src/planner-prompt.ts`) — the rewrite is
   framework-first, consistent with the plan's "prompts teach frameworks,
   not heuristics" guardrail.

**Narrative:** Under the mock runner, the prompt rewrite in Wave 2.B and
the plan-decomposer in Wave 1.A leave the measured score untouched (Δ=0
on every scorer, every task, every scenario) because the runner doesn't
exercise them. A real-runner baseline is the only instrument that will
quantify the rewrite's impact; this wave establishes the revert procedure
(clean across 21 commits, zero conflicts) and the eval-apparatus
invariants so that a future real-runner sweep can be executed on demand.

## Part 1 — Numerical table (mock runner, current vs B1 vs B2)

### Aggregate scores

| Aggregate            | B1     | B2     | Current | Δ B1→Current | Δ B2→Current |
| -------------------- | ------ | ------ | ------- | ------------ | ------------ |
| Overall averageScore | 0.6525 | 0.6525 | 0.6525  | +0.00        | +0.00        |
| Evals run            | 60     | 60     | 60      | 0            | 0            |
| Tasks                | 20     | 20     | 20      | 0            | 0            |
| Scenarios per task   | 3      | 3      | 3       | 0            | 0            |

### Per-scorer, averaged across all 60 evals

| Scorer             | B1     | B2     | Current | Δ B1→Current | Δ B2→Current |
| ------------------ | ------ | ------ | ------- | ------------ | ------------ |
| step-coverage      | 0.8050 | 0.8050 | 0.8050  | +0.00        | +0.00        |
| furthest-key-node  | 0.8050 | 0.8050 | 0.8050  | +0.00        | +0.00        |
| tool-call-validity | 0.6667 | 0.6667 | 0.6667  | +0.00        | +0.00        |
| final-state        | 0.3333 | 0.3333 | 0.3333  | +0.00        | +0.00        |

### Per-scenario, averaged across 20 tasks × 4 scorers

| Scenario        | B1     | B2     | Current | Δ B1→Current | Δ B2→Current |
| --------------- | ------ | ------ | ------- | ------------ | ------------ |
| success         | 1.0000 | 1.0000 | 1.0000  | +0.00        | +0.00        |
| stops-at-1      | 0.4575 | 0.4575 | 0.4575  | +0.00        | +0.00        |
| malformed-tools | 0.5000 | 0.5000 | 0.5000  | +0.00        | +0.00        |

### Per-task (averageScore across 3 scenarios)

Truncated to task × averageScore; every delta is +0.00 so columns collapsed.

| Task                                 | B1 / B2 / Current (identical) |
| ------------------------------------ | ----------------------------- |
| trivial-1-example-homepage           | 0.750                         |
| trivial-2-wikipedia-main-page        | 0.750                         |
| moderate-1-github-explore-topics     | 0.639                         |
| moderate-2-mdn-web-api-detail        | 0.639                         |
| hard-volvo-ex90-configurator         | 0.611                         |
| calibration-1-single-nav-python-docs | 0.750                         |
| calibration-2-single-nav-news        | 0.750                         |
| calibration-3-two-step-docs          | 0.667                         |
| calibration-4-two-step-ecom          | 0.667                         |
| calibration-5-three-step-search      | 0.639                         |
| journey-1-car-configurator-bmw       | 0.611                         |
| journey-2-ecom-checkout              | 0.617                         |
| journey-3-flight-search              | 0.625                         |
| journey-4-account-signup             | 0.617                         |
| journey-5-insurance-quote            | 0.625                         |
| journey-6-media-streaming            | 0.617                         |
| journey-7-dashboard-filter           | 0.625                         |
| journey-8-help-center                | 0.625                         |
| journey-9-form-wizard                | 0.617                         |
| journey-10-marketplace-filter        | 0.611                         |

All deltas B1→current, B2→current are **+0.00** on every cell — not
approximated, not rounded: the raw JSON evals under
`.suites[].evals[].scores[].score` match byte-for-byte.

**Verification**:

```bash
diff <(jq '.suites[].evals[] | {id: .input.task.id, scenario: .input.scenario,
       scores: [.scores[] | {name, score}], averageScore}' \
       docs/handover/harness-evals/baselines/wave-4-5-current.json) \
     <(jq '.suites[].evals[] | {id: .input.task.id, scenario: .input.scenario,
       scores: [.scores[] | {name, score}], averageScore}' \
       docs/handover/harness-evals/baselines/wave-4-5-baseline-b1.json)
# empty

diff ... wave-4-5-baseline-b2.json  # empty
```

No Δ ≥ 10% to flag, no improvements to credit — because no scorer measured
anything that moved between the branches.

## Part 2 — Static-diff projection (what a real-runner sweep would show)

The numerical table is flat. To still answer "did the harness / prompt
overhaul help?", the remainder of this report walks each revert set and
predicts direction and magnitude under `EVAL_RUNNER=real`.

Per commit line counts (net LoC change being restored on revert):

### Wave 1.A — PlanDecomposer (restored on B1)

| Commit   | Subject                                       | Net LoC |
| -------- | --------------------------------------------- | ------- |
| c49ccf91 | DecomposeError, PlannerMode, parsePlannerMode | +28     |
| 7464d55f | planner system prompt                         | +30     |
| b2169cb3 | PlanDecomposer service (frontier + template)  | +353    |
| 9409b367 | wire into executor, watch, layers             | +47     |
| 80967963 | --planner flag through TUI + watch + headless | +57     |
| e6d12d3d | plan-decomposer + executor-planner tests      | +377    |

**Predicted real-runner impact**: the plan decomposer produces an
upfront `steps: AnalysisStep[]` list the executor keys its adherence
gate off. With it removed (B1), the executor synthesizes an empty plan
and agent freestyles — reproducing the original Wave 0 Volvo failure
mode (collapse to a single `RUN_COMPLETED` after a homepage trace).

- `step-coverage` — likely ↓ sharply on multi-step tasks
  (`hard-volvo-ex90-configurator`, journeys 1–10, calibration 3–5).
  Direction: B1 ≪ current. No impact on trivial single-nav tasks
  (trivial-1, trivial-2, calibration-1, calibration-2).
- `furthest-key-node` — same directional pattern as step-coverage.
- `final-state` — ↓ on multi-step; the homepage is rarely the final
  expected URL for tasks like `journey-2-ecom-checkout`.
- `tool-call-validity` — **second-order**. Without an upfront plan
  the agent issues more speculative `evaluate_script` JS (see Wave 0
  diagnosis diary). Validity ratio typically unchanged — the tool
  calls are well-formed JSON, just wrong. Possibly no movement.

### Wave 1.B — Adherence gate (restored on B1)

| Commit   | Subject                                         | Net LoC |
| -------- | ----------------------------------------------- | ------- |
| 84babdfe | allPlanStepsTerminal getter, abortReason field  | +69     |
| 3cd19556 | expose abort_channel marker in execution prompt | 0 (±8)  |
| 91aea83f | premature-run-completed gate via mapAccumEffect | +56     |
| 575d126a | adherence-gate + volvo-trace replay tests       | +357    |

**Predicted real-runner impact**: with the gate removed (B1), a premature
`RUN_COMPLETED` terminates the stream even with pending steps — the exact
Wave 0 failure. Overlaps with Wave 1.A's predicted impact, compounding it
on multi-step tasks.

- `step-coverage` — ↓ again, but overlapping with Wave 1.A's removal
  (both revert together in B1 so their effects are not isolated).
- `final-state` — ↓.
- `furthest-key-node` — ↓.
- `tool-call-validity` — no change expected.

### Wave 2.A — First-class interaction tools (restored on B1)

| Commit   | Subject                                           | Net LoC |
| -------- | ------------------------------------------------- | ------- |
| d37eef61 | tool ref types, errors, constants, helpers        | +189    |
| e1f23a12 | export CallToolResult from devtools-client        | ±0      |
| b4815640 | parse helpers (network idle, uid match, combobox) | +78     |
| c1614c66 | uid-based live layers                             | +259    |
| de0e9fba | click/fill/hover/select/wait-for wrappers         | +116    |
| b14e5ed4 | register + wire into MCP server runtime           | +246    |
| e87a8442 | interaction + parse + live-layer + MCP reg tests  | +979    |

**Predicted real-runner impact**: without first-class `click`/`fill`/`hover`
etc. (B1), the agent must synthesize `evaluate_script` JS for every DOM
interaction. For a 4B production target (Gemma 3n E4B) this is
prohibitively expensive per the plan's diagnosis — the agent typically
fails to compose the right JS after 2–3 attempts and the run collapses.
For a frontier runner (Claude, Gemini) the impact is milder: the
`evaluate_script` fallback works, but is slower and introduces more
tool-call-validity risk (malformed JSON/JS on the first attempt).

- `tool-call-validity` — ↓ on hard tasks under Gemma. Modest ↓ under Claude.
- `step-coverage` — ↓ on tasks with menu-nav steps.
- `final-state` / `furthest-key-node` — ↓ slightly, correlated with step-coverage.

### Wave 2.B — System prompt rewrite for 4B (restored on B1 and B2)

| Commit   | Subject                                                  | Net LoC |
| -------- | -------------------------------------------------------- | ------- |
| 1b75e23f | rewrite buildExecutionSystemPrompt for 4B (≤80 line cap) | −67     |
| c8eaff83 | golden-file tests for new shape and invariants           | +61     |

**Predicted real-runner impact**: the original prompt was ~290 lines with
aspirational "first profile the primary route, then additional routes"
phrasing that biased the agent toward single-step runs. The rewrite
replaces it with a terser, XML-blocked-per-turn structure that reinforces
the status-marker protocol for 4B. Under B2 (prompt-only revert) the
decomposer and adherence gate are still present — so the agent has a
populated plan but an old bias-loaded prompt.

- On Gemma 3n E4B:
  - `step-coverage` — ↓ noticeable. The old prompt's "primary route" bias
    overrides the decomposer's multi-step plan because the prompt text
    is higher-salience for a 4B model.
  - `tool-call-validity` — ↓ mildly (old prompt was less explicit on
    the tool catalog, agent occasionally hallucinates tool signatures).
- On Claude (frontier):
  - `step-coverage` — likely ~flat. Frontier models are less
    susceptible to prompt-length/structure biases; the decomposer's plan
    dominates regardless of prompt phrasing.
  - `tool-call-validity` — no change expected.

### Wave 2.C — Set-of-Mark visual grounding (restored on B1)

| Commit   | Subject                                                  | Net LoC |
| -------- | -------------------------------------------------------- | ------- |
| 61b08a96 | Set-of-Mark overlay module (deterministic ref numbering) | +557    |
| 1f76cf5d | set-of-mark tests                                        | +420    |

**Predicted real-runner impact**: SOM provides numbered-box overlays so
the agent can say `click(3)` against a visual ref. Without SOM (B1), the
agent either uses raw CSS/aria selectors (error-prone) or falls back to
evaluate_script. Compounds with Wave 2.A's removal: on B1 the agent has
neither the click tool nor the visual ref.

- Under a multimodal runner (Gemma 3n E4B, Claude with vision): strong ↓
  on tasks that require menu navigation (all journeys, `hard-volvo-ex90`).
- Under a text-only runner (if configured): no impact (SOM not consumed).

### Summary matrix (predicted Δ under real runner, Gemma 3n E4B target)

Legend: −− = strong regression on B1→current (i.e. revert hurts a lot),
− = mild regression, 0 = no movement expected, + = improvement (the
revert would make the scorer better, which we don't expect anywhere).

| Task group              | step-coverage | furthest-key-node | final-state | tool-call-validity |
| ----------------------- | ------------- | ----------------- | ----------- | ------------------ |
| Trivial single-nav      | 0             | 0                 | 0           | 0                  |
| Calibration 1-2 (1-nav) | 0             | 0                 | 0           | 0                  |
| Calibration 3-5 (N-nav) | −−            | −−                | −           | −                  |
| Moderate (menu→detail)  | −−            | −−                | −           | −                  |
| Hard Volvo EX90         | −−            | −−                | −−          | −                  |
| Journeys 1-10           | −−            | −−                | −           | −                  |

On B2 → current (prompt-only), expected effect is similar shape but
smaller magnitude (only prompt changes, decomposer and gate still there):

| Task group              | step-coverage | furthest-key-node | final-state | tool-call-validity |
| ----------------------- | ------------- | ----------------- | ----------- | ------------------ |
| Trivial single-nav      | 0             | 0                 | 0           | 0                  |
| Calibration 1-2 (1-nav) | 0             | 0                 | 0           | 0                  |
| Calibration 3-5 (N-nav) | −             | −                 | 0           | 0                  |
| Moderate (menu→detail)  | −             | −                 | 0           | 0                  |
| Hard Volvo EX90         | −             | −                 | −           | 0                  |
| Journeys 1-10           | −             | −                 | 0           | 0                  |

These are predictions, not measurements. **Convert to measurements** by
running `EVAL_RUNNER=real EVAL_BACKEND=claude` and `EVAL_RUNNER=gemma`
variants on each branch once a provisioned environment exists (see
"Reproduce" below).

## Part 3 — Overfitting-guard check

**Plan guardrail:** "Prompts teach frameworks, not heuristics. No
site-specific navigation patterns, menu naming, or DOM paths baked into
system prompts."

Grep-based audit of the Wave 2.B prompt rewrite
(`packages/shared/src/prompts.ts` on main) and the Wave 1.A planner prompt
(`packages/supervisor/src/planner-prompt.ts` on main):

- No literal occurrence of any of the 20 smoke-test sites: `volvo`, `bmw`,
  `wikipedia`, `github`, `mdn`, `example.com`, `python`.
- No mentions of task-specific menu labels from the tasks
  (`Buy > Build`, `Explore topics`, etc.).
- No DOM selectors referencing configurator-specific ids or classes.
- Framework-language only: sub-goal / observed-state / available-actions
  XML blocks, status-marker protocol, tool-catalog list.

**Conclusion**: no overfitting signatures detected in the reverted prompt
code. The prompt rewrite does not encode site-specific heuristics that
would move per-site scores in one direction while generalization scores
move the opposite way. The directional prediction table above does not
flag any inversion (e.g. no site has a predicted + alongside a generic −),
which is consistent with the code-level audit.

If a future real-runner sweep shows a per-task score regressing more than
the sibling tasks in its group (e.g. `journey-3-flight-search` ↓↓ while
other journeys ↓), that is the overfitting signature to flag at that
point. Mock-runner scores cannot produce that signal.

## Part 4 — Test-suite sanity check

| Branch      | @neuve/evals test | Notes                                                |
| ----------- | ----------------- | ---------------------------------------------------- |
| main        | 81/81 pass        | clean tree                                           |
| baseline-b1 | 76/81 pass        | 5 fail — `PlanDecomposer.of` undefined in test layer |
| baseline-b2 | 81/81 pass        | prompt revert leaves test surface untouched          |

**F1 (from diary):** B1's failures are all in
`packages/evals/tests/gemma-runner.test.ts` +
`packages/evals/tests/real-runner.test.ts`, both of which construct a
scripted `PlanDecomposer` layer to avoid hitting a live frontier model:

```
Layer.succeed(PlanDecomposer, PlanDecomposer.of({ decompose: (...) => ... }))
```

`PlanDecomposer` is gone in B1, so `.of` resolves against `undefined` and
TypeErrors. **Not a functional regression** — `evalite run` went green on
B1 because the mock runner path doesn't touch these modules. But it
signals that the eval test surface has a latent dependency on Wave 1.A;
an eventual "clean" revert-based baseline that includes the test suite
must shim this layer with a pre-Wave-1.A placeholder.

**Action:** not fixed in this wave (docs-only per plan). Logged for Wave
6+ / the next baseline-rebaseline cycle.

## Part 5 — Overfitting signatures

None detected — see Part 3. No per-task score moved in a direction
inconsistent with its task group, because no per-task score moved at all
(mock invariance).

## Limitations and known caveats

1. **Mock runner invariance.** The core limitation: scores are
   task+scenario-determined, so harness and prompt changes produce Δ=0 by
   construction. The report compensates with a static-diff projection.
2. **No real-runner numbers.** Would require a provisioned ACP backend
   and unattended browser automation that does not fit a subagent's bash
   timeout envelope.
3. **No Gemma numbers.** Would require a persistent Ollama runtime
   providing `gemma4:e4b` responses at non-trivial throughput per task.
4. **No LLM-as-judge scorer.** Not run here — the smoke eval uses
   deterministic scorers only. The judge lives in the online-mind2web
   eval which is HF-auth-gated (Wave 4 punted, tracked in
   `wave-4-online-mind2web-real-runner-2026-04-24.json`).
5. **Directional projections are code-reading, not runtime evidence.**
   They are the best available signal given the constraints, but should
   be validated against a real-runner sweep when one becomes possible.

## Reproduce (real-runner upgrade path)

To replace the mock numbers with real-runner measurements, on a
provisioned box:

```bash
# Prerequisites
# - Claude Code CLI authenticated (or alt ACP backend set via EVAL_BACKEND)
# - Playwright browsers installed (pnpm exec playwright install)
# - Fresh git clone on main, tree clean

# Current
EVAL_RUNNER=real EVAL_BACKEND=claude \
  pnpm --filter @neuve/evals exec evalite run ./evals/smoke.eval.ts \
  --outputPath docs/handover/harness-evals/baselines/wave-4-5-current-real.json

# B1
git switch -c baseline-b1
git revert --no-edit \
  e87a8442 b14e5ed4 de0e9fba c1614c66 b4815640 e1f23a12 d37eef61 \
  c8eaff83 1b75e23f 1f76cf5d 61b08a96 \
  575d126a 91aea83f 3cd19556 84babdfe \
  e6d12d3d 80967963 9409b367 b2169cb3 7464d55f c49ccf91
pnpm install
EVAL_RUNNER=real EVAL_BACKEND=claude \
  pnpm --filter @neuve/evals exec evalite run ./evals/smoke.eval.ts \
  --outputPath ../../docs/handover/harness-evals/baselines/wave-4-5-baseline-b1-real.json

# B2
git switch main && git switch -c baseline-b2
git revert --no-edit c8eaff83 1b75e23f
pnpm install
EVAL_RUNNER=real EVAL_BACKEND=claude \
  pnpm --filter @neuve/evals exec evalite run ./evals/smoke.eval.ts \
  --outputPath ../../docs/handover/harness-evals/baselines/wave-4-5-baseline-b2-real.json

# Cleanup
git switch main
git branch -D baseline-b1 baseline-b2

# Swap in Gemma by running the whole sequence with EVAL_RUNNER=gemma and
# capturing -gemma.json variants; then append a "Part 2b" section to this
# report with actual Δ numbers alongside the predicted matrix.
```

## References

- `docs/handover/harness-evals/plan.md:241` — Wave 4.5 spec.
- `docs/handover/harness-evals/diary/wave-4-5-baseline-diff.md` — procedure log + findings.
- `docs/handover/harness-evals/diary/wave-0-harness-diagnosis.md` — root-cause
  baseline that motivated Waves 1.A/1.B/2.A/2.B/2.C.
- `docs/handover/harness-evals/baselines/wave-4-online-mind2web-real-runner-2026-04-24.json`
  — prior-wave placeholder recognizing the same provisioning limitation.
- `packages/evals/src/runners/mock.ts` — mock runner source (confirms
  invariance to prompt/harness changes).
- `packages/evals/src/runners/real.ts` — real runner dependencies (ACP
  Agent + Executor + PlanDecomposer).
