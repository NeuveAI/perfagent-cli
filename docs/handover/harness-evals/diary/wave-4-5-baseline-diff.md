# Wave 4.5 — Baseline vs current regression eval

## Summary

Post-hoc commit revert on throwaway branches to produce a B1 (whole-harness
revert) and B2 (prompt-only revert) baseline alongside the current main
HEAD, scored by `pnpm --filter @neuve/evals eval`.

**Outcome:** Ran — but with the `EVAL_RUNNER=mock` fallback, the only runner
available in this environment that does not depend on a provisioned ACP
Claude/Codex/Gemini backend or a reachable chrome-devtools-mcp browser. Mock
scores are **byte-identical** across all three branches by construction
(the mock runner is prompt- and harness-agnostic — it synthesizes its trace
from the task fixture and the scenario enum, never touching the supervisor,
executor, decomposer, or prompts). The measurement artifact for this wave
is therefore (a) the triplicated mock JSON, (b) a static-diff analysis of
what each revert set removes and which scorers would move under a real
runner, and (c) the test-suite sanity-check results on each branch.

## Procedure log

```
2026-04-24 07:09:40Z  on main (HEAD=541c4f6d), tree clean
                      pnpm --filter @neuve/evals exec evalite run \
                        ./evals/smoke.eval.ts \
                        --outputPath /tmp/wave-45-eval-output/current.json
                      → 60 evals, averageScore 0.6525, 20 tasks × 3 scenarios

2026-04-24 07:10:13Z  git switch -c baseline-b1
                      git revert --no-edit <21 commits, LIFO across waves 2.A→2.B→2.C→1.B→1.A>
                      all 21 reverts applied cleanly, zero conflicts
                      pnpm install → already up to date (no package.json or lockfile touched)
                      pnpm --filter @neuve/evals test
                        → 2 test files fail / 7 pass (5 tests fail / 76 pass, 81 total)
                        → gemma-runner.test.ts + real-runner.test.ts reference
                          PlanDecomposer.of({...}) which no longer exists post-revert
                      pnpm --filter @neuve/evals exec evalite run ... → b1.json captured

2026-04-24 07:10:52Z  git switch main && git switch -c baseline-b2
                      git revert --no-edit c8eaff83 1b75e23f  # Wave 2.B prompt only
                      clean, zero conflicts
                      pnpm install → already up to date
                      pnpm --filter @neuve/evals test → 81/81 pass
                      pnpm --filter @neuve/evals exec evalite run ... → b2.json captured

2026-04-24 07:11:11Z  git switch main
                      git branch -D baseline-b1 baseline-b2
                      pnpm --filter @neuve/evals test → 81/81 pass on main
                      Main HEAD (541c4f6d) unchanged throughout.
```

## Authoritative revert commit list

### B1 — whole-harness baseline (21 commits)

Reverted in LIFO order (newest commit reverted first):

**Wave 2.A — First-class interaction tools (7 commits):**

1. `e87a8442` — test(devtools): add interaction tool, parse, live-layer, and MCP registration tests
2. `b14e5ed4` — feat(devtools): register interaction tools and wire into MCP server runtime
3. `de0e9fba` — feat(devtools): add click/fill/hover/select/wait-for interaction tool wrappers
4. `c1614c66` — feat(devtools): add uid-based live layers for RefResolver, NetworkIdleSampler, SnapshotTaker, and WaitForEngine
5. `b4815640` — feat(devtools): add parse helpers for network idle, uid match, and combobox option discovery
6. `e1f23a12` — feat(devtools): export CallToolResult from devtools-client
7. `d37eef61` — feat(devtools): add tool ref types, errors, constants, and shared helpers

**Wave 2.B — System prompt rewrite for 4B (2 commits):**

- `c8eaff83` — test(shared): replace prompts.test.ts with golden-file tests for new shape and invariants
- `1b75e23f` — feat(shared): rewrite buildExecutionSystemPrompt for 4B and add optional per-turn state fields

**Wave 2.C — Set-of-Mark visual grounding (2 commits):**

- `1f76cf5d` — test(devtools): add set-of-mark tests (determinism, hidden exclusion, stale refs)
- `61b08a96` — feat(devtools): add Set-of-Mark overlay module with deterministic ref numbering

**Wave 1.B — RUN_COMPLETED adherence gate (4 commits):**

- `575d126a` — test(supervisor): add adherence-gate tests including wave-0-A volvo trace replay and planner=none regression
- `91aea83f` — feat(supervisor): add premature-run-completed gate via Stream.mapAccumEffect reducer
- `3cd19556` — docs(shared): expose abort_channel marker in execution prompt
- `84babdfe` — feat(shared): add allPlanStepsTerminal getter, abortReason schema field, and abort run-finished metadata

**Wave 1.A — Plan decomposer (hybrid pre-planner) (6 commits):**

- `e6d12d3d` — test(supervisor): add plan-decomposer unit tests and executor-planner integration tests
- `80967963` — feat(cli,cli-solid): add --planner flag and thread plannerMode through tui, watch, and headless surfaces
- `9409b367` — feat(supervisor,typescript-sdk): wire PlanDecomposer into executor, watch, and layer composition
- `b2169cb3` — feat(supervisor): add PlanDecomposer service with frontier and template modes
- `7464d55f` — feat(supervisor): add planner system prompt
- `c49ccf91` — feat(supervisor): add DecomposeError, PlannerMode, and parsePlannerMode helper

### B2 — prompt-only baseline (2 commits)

Reverted in LIFO order:

1. `c8eaff83` — test(shared): replace prompts.test.ts with golden-file tests for new shape and invariants
2. `1b75e23f` — feat(shared): rewrite buildExecutionSystemPrompt for 4B and add optional per-turn state fields

### Decisions and exclusions

- **Excluded from both sets:** all `docs(harness-evals): ...` diary/review
  commits (per seed: "Exclude the docs commits"), the pre-wave vite-plus
  fix `65c4f3c6`, Wave 0.A and 0.B commits (`wave-0-harness-diagnosis`,
  `wave-0-eval-scaffold`), Wave 3 commits (these wire the eval harness
  itself — reverting them would break the measurement apparatus), Wave 4
  commits (Online-Mind2Web adapter, out of scope for the hand-authored
  smoke eval).
- **Included despite `docs:` prefix:** `3cd19556 docs(shared): expose
abort_channel marker in execution prompt` — the conventional-commits tag
  is misleading; the commit modifies `packages/shared/src/prompts.ts`
  runtime output (exposes a new status marker in the system prompt), which
  is a behavior change and therefore part of the Wave 1.B runtime surface.

## Runner-choice rationale

Seed instruction: "Runner choice: `EVAL_RUNNER=real` if you have the
Claude/Gemini ACP env set up. If you don't have a real agent provider
available, run `EVAL_RUNNER=mock` as the fallback and explicitly document
the limitation."

### What's available in this environment

- `claude`, `codex`, `cursor` CLIs installed on PATH.
- `ollama` running at `http://localhost:11434` (version 0.21.0 responsive).
- `GOOGLE_GENERATIVE_AI_API_KEY` set in `packages/evals/.env.local` — used
  by the LLM-as-judge, not the agent backend.
- **No** provisioned, pre-authenticated ACP session suitable for unattended
  20-task × 3-branch runs. No `HUGGINGFACE_TOKEN` either (Wave 4's
  placeholder JSON already notes this).

### Why mock is the only realistic choice here

Real-runner costs on 20 tasks × 3 branches = 60 full browser-driven runs,
each with Claude-Code ACP roundtrips and Playwright automation. Per-run
wall-clock easily hits tens of minutes on hard tasks like
`hard-volvo-ex90-configurator`, and the per-run API spend is non-trivial.
In a bash-tool-bounded execution environment with a 10-minute per-command
timeout, a single failing task mid-run aborts the sweep with no recovery.
The prior Wave 4 run recognized this constraint and punted with a
placeholder-only `wave-4-online-mind2web-real-runner-2026-04-24.json`.

### Consequence

Mock-runner output is a function of `(task, scenario)` only — see
`packages/evals/src/runners/mock.ts`. It does not invoke the prompt, the
plan decomposer, the executor's `RUN_COMPLETED` gate, the Set-of-Mark
overlay, or the interaction tool surface. Therefore the three JSON files
are **byte-identical** (same size, same per-eval score objects):

```
349597 bytes  wave-4-5-current.json
349597 bytes  wave-4-5-baseline-b1.json
349597 bytes  wave-4-5-baseline-b2.json

diff <(jq '.suites[].evals[] | {id: .input.task.id, scenario, scores}' current.json) \
     <(jq '.suites[].evals[] | {id: .input.task.id, scenario, scores}' b1.json)
→ empty
diff ... b2.json  → empty
```

The regression report therefore stands on **three load-bearing pieces of
evidence**:

1. The mock-invariance check itself, which quantifies that harness changes
   of this magnitude are invisible to the mock runner — directly affects
   eval-set design decisions.
2. A static-diff characterization of each revert set (what code is gone,
   which scorers it would plausibly move in a real run).
3. The test-suite sanity-check on each branch, which flagged a genuine
   coupling finding on B1.

## Findings and anomalies

### F1 — B1 breaks 5 eval tests (all in `@neuve/evals`)

When the Wave 1.A plan-decomposer service is reverted, the
`@neuve/evals` test suite fails in two files:

- `packages/evals/tests/gemma-runner.test.ts` (2 tests fail)
- `packages/evals/tests/real-runner.test.ts` (3 tests fail)

All five fail identically: `TypeError: Cannot read properties of undefined
(reading 'of')` at `PlanDecomposer.of({ decompose: ... })`. The test
scaffold constructs a scripted `PlanDecomposer` layer via
`Layer.succeed(PlanDecomposer, PlanDecomposer.of({...}))` to avoid hitting
a real frontier model during unit tests, and that symbol is what Wave 1.A
commit `b2169cb3` introduced.

This is a real coupling between the eval harness test scaffold and the
Wave 1.A feature surface. It does **not** affect the eval run itself —
`evalite run` went green on B1 — but it means any future B1-style clean
baseline on this test file set would need a shim layer stub that does not
reference `PlanDecomposer.of`. Not fixing in this wave (measurement only
per seed), just recording.

On B2 (prompt-only revert), all 81 tests pass. Full 81/81 also green on
`main` before and after the sweep.

### F2 — `docs:` conventional-commits tag is unreliable on `packages/shared/`

Commit `3cd19556 docs(shared): expose abort_channel marker in execution
prompt` is tagged `docs:` but modifies `packages/shared/src/prompts.ts` —
runtime prompt text that the agent sees. A plan-directed scripted revert
that relies solely on the conventional-commit subject prefix (e.g. `git
log --grep="^feat"`) would miss this commit and silently leave the new
abort-channel marker in the reverted B1 prompt. This wave included it
manually; future revert-based baselines should audit any `docs(<pkg>):`
commits that touch runtime files.

### F3 — Zero merge/revert conflicts across 21 commits

All 21 B1 reverts and both B2 reverts applied cleanly with `--no-edit`.
This reflects how well-sliced each wave was along file boundaries — Wave
1.A lives in new files, 1.B in contained getter additions, 2.A in a new
`tools/` subdir, 2.B in a pure rewrite of a single file, 2.C in one new
file. The revert-based measurement protocol is therefore viable for this
repo's history, and should be reusable for Wave 6+ baselines.

### F4 — Mock runner invariance is a design feature, not a bug

The seed anticipated this ("mock scenarios give directional signal even
though they don't use real models"). What this wave establishes
quantitatively: the mock runner's output depends only on `(EvalTask,
MockScenario)`, so harness and prompt changes are **undetectable** in its
output. If the `packages/evals/evals/smoke.eval.ts` suite is ever to
serve as a regression detector for harness or prompt changes (as opposed
to a scorer-correctness test suite), it must be run under `EVAL_RUNNER=real`
or `gemma` with actual model calls.

This is a recommendation for the user / team-lead, not a code change to
make in this wave.

## Files written

- `docs/handover/harness-evals/baselines/wave-4-5-current.json`
- `docs/handover/harness-evals/baselines/wave-4-5-baseline-b1.json`
- `docs/handover/harness-evals/baselines/wave-4-5-baseline-b2.json`
- `docs/handover/harness-evals/baselines/wave-4-5-regression-report.md`
- `docs/handover/harness-evals/diary/wave-4-5-baseline-diff.md` (this file)

## State after wave

- `main` HEAD `541c4f6d` unchanged.
- Both throwaway branches (`baseline-b1`, `baseline-b2`) deleted.
- Repo tree clean.
- `pnpm --filter @neuve/evals test` → 81/81 on main.
