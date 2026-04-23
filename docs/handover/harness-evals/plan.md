# Harness & Eval Overhaul — Plan

## Context

The perf-agent CLI's agent harness stops short on multi-step user journeys. Two real runs of "go to volvocars.com → navigate buy → build → configure EX90 → reach the order form → report web vitals" both emitted `RUN_COMPLETED` after a single homepage trace. The agent never navigated past the landing page.

Production target model is **Gemma 3n E4B** (4B effective params, multimodal, via Ollama — see `.specs/local-gemma4-agent.md`). Frontier models (Claude, GPT-4 class) are dev-time scaffolding only. Every decision in this plan is gated by "will a 4B model actually do this well?"

We also have no measurable way to A/B-test prompt/harness changes. Improvements today are anecdotal.

## Goals

1. **Multi-step journey completion.** A user prompt that implies N navigation steps should execute N steps (or fail loudly), not collapse to 1.
2. **Measurable iteration.** Every prompt/tool/harness change is scored against a fixed eval set. Regressions are visible, not guessed.
3. **4B-capable tool surface.** The agent must be able to click/fill/hover via first-class tools with visual grounding — not write `evaluate_script` JS by hand.
4. **Path to distillation.** Trace capture infra exists from day one so frontier-model traces can later be used as teacher data for Gemma.

## Assumptions (please redirect if wrong)

1. **Offline is soft.** A frontier-model pre-planning call per run is acceptable (hybrid mode), gated by a `--offline` / `--no-planner` flag that falls back to template-driven decomposition.
2. **Set-of-Mark is the committed visual-grounding approach.** Numbered-element screenshot overlays + "click N" actions. Alternatives (accessibility-tree grounding, SeeClick) are P2 research only if SOM underperforms.
3. **Distillation infra is greenfield.** Phase 4 builds the teacher-data pipeline from scratch.

## Diagnosis (4 root causes)

Full findings in `docs/handover/harness-evals/diary/wave-0-harness-diagnosis.md` (to be written in Wave 0).

1. **Harness terminates on first `RUN_COMPLETED`** — `packages/supervisor/src/executor.ts:238` uses `Stream.takeUntil(executed.hasRunFinished)`. No check for "were all planned steps executed?". A single marker kills the stream.
2. **No up-front plan.** `executor.ts:168` creates a synthetic empty plan; steps are emitted on-the-fly via `STEP_START`. Plan decomposition is the LLM's burden — and 4B collapses it.
3. **System prompt bias.** `packages/shared/src/prompts.ts` (~290 lines) says *"First profile the primary route, then additional related routes."* Aspirational, not enforced. Easy for a 4B model to read as "only the primary."
4. **Tool-surface gap.** No native `click`/`fill`/`hover`. Agent must write `evaluate_script` JS for every menu interaction. Prohibitively expensive for 4B.

## Architecture — target end-state

```
User prompt
  │
  ▼
PlanDecomposer (hybrid: frontier-LLM | template)
  │ produces Journey = [{sub_goal, expected_state, perf_assertions}, …]
  ▼
Executor loop (per sub_goal)
  │
  ├─ Agent turn (Gemma 3n E4B)
  │    observes: current page screenshot (Set-of-Mark overlay) + prior state
  │    emits: tool_call | STEP_DONE | ASSERTION_FAILED | RUN_COMPLETED
  │
  ├─ Adherence gate:
  │    - RUN_COMPLETED with pending steps → reject unless accompanied by ASSERTION_FAILED + abort_reason
  │    - STEP_DONE → advance sub_goal cursor
  │
  └─ Tool execution:
       - click(n) / fill(n, text) / hover(n) / wait_for(selector)
       - performance_{start,stop,analyze}_trace
       - evaluate_script (last resort)
       - Every interaction re-renders the SOM screenshot for the next turn
```

All agent turns and tool I/O are captured in a structured trace format (`evals/traces/{runId}.ndjson`) ready for replay and later fine-tuning.

## Phases

| # | Name | Scope | Blocks |
|---|------|-------|--------|
| 0 | Baseline capture + eval scaffold | Reproduce failure; add evalite + scorers + 5 tasks; zero harness changes | 1, 3 |
| 1 | Harness correctness | Pre-planner + adherence gate | 2, 3 |
| 2 | Tool surface + prompt | SOM visual grounding, click/fill/hover tools, 4B-tuned prompt rewrite | 3 |
| 3 | Eval integration | Wire real agent into evalite runner; score Gemma + Claude on 5 tasks; regression dashboards | 4 |
| 4 | Online-Mind2Web subset | BrowserGym-style adapter; filtered ≤5-key-node subset; baseline scores | 5 |
| 5 | Distillation pipeline | Trace capture format finalised; teacher-data exporter; fine-tune stub (no training yet) | — |

Phases 0 and 1 overlap partially (disjoint files). Phase 2 blocks on 1. Phase 3 blocks on 1+2. Phase 4 blocks on 3. Phase 5 blocks on 4.

## Wave 0 — Baseline capture + eval scaffold (parallel groups)

### 0.A — Harness diagnosis reproduction (read-only investigation)

**Team:** `harness-research`

**Scope:**
- Reproduce the Volvo prompt failure with instrumentation. Write the agent's raw stream, tool calls, and status markers to disk.
- Produce `docs/handover/harness-evals/diary/wave-0-harness-diagnosis.md` citing the exact `file:line` at which the stream terminates, the exact system-prompt phrases that bias early-stop, and the actual text the agent emitted before `RUN_COMPLETED`.
- Produce a deterministic replay script at `scripts/replay-harness-trace.ts` that reads a saved trace ndjson and re-emits it to stdout (for later use in evals and fine-tuning).

**DoD — Behavior:**
- Running `pnpm --filter @neuve/perf-agent-cli run harness:capture -- "lets go to volvocars.com, navigate to the build page, under the 'buy' > 'build your volvo' menu and build me a new ex90, any spec. Proceed all the way to the order request form and report back the web vitals"` produces an ndjson trace file under `evals/traces/` containing at minimum: one `agent_message` event per model turn, one `tool_call` + `tool_result` pair per tool invocation, and one `stream_terminated` event with the terminating marker.
- `pnpm tsx scripts/replay-harness-trace.ts evals/traces/<file>.ndjson` re-emits those events verbatim to stdout in the same order.
- The diary doc includes verbatim problematic prompt phrases (line numbers), the executor.ts termination site (line number), and the list of planned-but-unexecuted steps (if any) from the captured run.

**Non-goals:** No changes to executor.ts, prompts.ts, or any runtime code. Additive only.

### 0.B — Eval scaffold (greenfield package)

**Team:** `eval-infra`

**Scope:**
- New package `packages/evals/` (pnpm workspace). Deps: `evalite`, `vitest`, `effect`. No runtime dep on supervisor/browser.
- Scorer skeletons in `packages/evals/src/scorers/`:
  - `step-coverage.ts` — `(reached: KeyNode[], expected: KeyNode[]) => number` in `[0,1]`
  - `final-state.ts` — `(finalUrl, finalDom, expected) => boolean`
  - `tool-call-validity.ts` — `(calls: ToolCall[]) => number` ratio
  - `furthest-key-node.ts` — `(reached, expected) => number` index
- Task fixture format in `packages/evals/src/task.ts` using `Schema.Class`:
  ```
  EvalTask = { id, prompt, keyNodes: KeyNode[], expectedFinalState, perfBudget? }
  KeyNode = { urlPattern, domAssertion, perfCapture?: "required" | "optional" }
  ```
- 5 hand-authored tasks in `packages/evals/tasks/`: 2 trivial single-nav, 2 moderate menu→detail, 1 hard (Volvo EX90 configurator journey from the failing case).
- Mock agent runner in `packages/evals/src/runners/mock.ts` that returns a scripted trace, so the scorers can be tested without a live browser.
- One `.eval.ts` entry in `packages/evals/evals/` that runs the mock against all 5 tasks and reports scores.
- `pnpm --filter @neuve/evals eval` launches the evalite runner.

**DoD — Behavior:**
- `pnpm --filter @neuve/evals test` passes: unit tests for each scorer against hand-crafted input.
- `pnpm --filter @neuve/evals eval` produces a results table with a score per task per scorer — non-zero for the mock runner's scripted-success cases, zero for the scripted-failure cases.
- All 5 task fixtures parse under their `Schema.Class` (decoding test covers this).
- `pnpm typecheck` across the repo stays green. `packages/evals/` tsconfig does not leak types into other packages.

**Non-goals:** Real browser, real agent, Online-Mind2Web integration, visual grounding — all deferred to later waves.

**Conflict avoidance:** 0.A touches only scripts + docs + new trace files. 0.B touches only the new `packages/evals/` directory and workspace metadata. Zero file overlap.

## Wave 1 — Harness correctness (sequential pair)

### 1.A — Plan decomposer (hybrid pre-planner)

**Team:** `harness-core`

**Scope:**
- New service `packages/supervisor/src/plan-decomposer.ts` — `PlanDecomposer` via `ServiceMap.Service` with `make:` + `static layer`, per Effect rules.
- Method `decompose(prompt, mode: "frontier" | "template")`: returns `PerfPlanDraft` with populated `steps: AnalysisStep[]` (each step has `sub_goal`, optional `expected_state`, optional `perf_assertions`).
- Frontier mode: call Claude Haiku / Gemini Flash via existing AgentProvider infra. Low temp. Schema-validated output.
- Template mode: rule-based — split prompt on "then", "and then", "navigate to", etc., produce a best-effort step list. Used when offline flag set or frontier call fails.
- Wire into `executor.ts` before the agent stream: replace the synthetic empty plan with the decomposed plan.
- CLI flag `--planner=frontier|template|none` with default `frontier`.

**DoD — Behavior:**
- Running the CLI with the Volvo prompt and `--planner=frontier` produces a plan with ≥4 steps observable in the TUI's plan preview screen.
- With `--planner=template` the same prompt produces ≥2 steps (heuristic doesn't have to be perfect, just non-empty).
- With `--planner=none` behavior matches today (empty plan, agent freestyle) — backwards compatibility verified by existing tests.
- New unit tests in `packages/supervisor/tests/plan-decomposer.test.ts`: both modes, fixture-based, no network calls (frontier mode uses a mocked AgentProvider).

### 1.B — RUN_COMPLETED adherence gate

**Team:** `harness-core`

**Scope:**
- Modify `executor.ts:238` termination logic. Change the `Stream.takeUntil` predicate to:
  - Terminate on `RUN_COMPLETED` **iff** `executed.allPlanStepsTerminal` is true.
  - Terminate on `RUN_COMPLETED` **iff** the last `ASSERTION_FAILED` event has `category === "abort"` with an `abort_reason`.
  - Otherwise, log a warning, drop the marker, and let the stream continue.
- Add `allPlanStepsTerminal` getter to `ExecutedPerfPlan` in `packages/shared/src/models.ts`.
- Add `abort_reason` to the `ASSERTION_FAILED` schema and expose the abort category in the prompt's status-marker section.
- The existing `ALL_STEPS_TERMINAL_GRACE_MS` safety net stays.

**DoD — Behavior:**
- Replay test: feed the captured Volvo-failure ndjson trace (from 0.A) through the executor. With 1.A decomposition active, the stream does NOT terminate after the first `RUN_COMPLETED` — it logs a `premature-run-completed` warning and awaits further agent output.
- Unit test: synthesized trace with `RUN_COMPLETED` + all steps terminal → stream terminates cleanly.
- Unit test: synthesized trace with `ASSERTION_FAILED category=abort` + `RUN_COMPLETED` → stream terminates.
- `pnpm check` + `pnpm test` green.

**Order:** 1.A first, 1.B after. Both modify `executor.ts` so they cannot run in parallel. `1.B blockedBy 1.A`.

## Wave 2 — Tool surface + prompt (parallel)

### 2.A — First-class interaction tools

**Team:** `tool-surface`

**Scope:**
- Extend the chrome-devtools-mcp proxy in `packages/browser/src/` (or wherever tool exposure lives) with: `click(ref)`, `fill(ref, text)`, `hover(ref)`, `select(ref, option)`, `wait_for(selector | aria)`.
- `ref` is an opaque string returned by the Set-of-Mark overlay (implemented in 2.C) OR a CSS/aria fallback.
- Each tool: structured error on missing ref, post-action snapshot capture, automatic `wait_for_network_idle` debounce.
- Register in the prompt's `<tool_catalog>` block.

**DoD — Behavior:**
- Integration test with a mock chrome-devtools-mcp stub: `click("3")` issues the expected CDP-equivalent action and returns structured success/failure.
- The Volvo trace captured in 0.A, when replayed with 2.A tools available, shows the agent can click the "Buy" menu without writing any `evaluate_script` JS (verified via trace inspection in a followup integration test added to `packages/browser/tests/`).

### 2.B — System prompt rewrite for 4B

**Team:** `prompt-tuning`

**Scope:**
- Replace `packages/shared/src/prompts.ts` `buildExecutionSystemPrompt()` with a ≤80-line version structured for 4B:
  - Identity line (1 line).
  - `<current_sub_goal>`, `<observed_state>`, `<available_actions>` XML blocks re-populated per turn (via `buildExecutionPrompt()`).
  - Status-marker protocol as a short, emphasized block at the end.
  - Tool catalog as a single flat list, one line each.
- Preserve existing external invariants (`STEP_START`, `STEP_DONE`, `ASSERTION_FAILED`, `RUN_COMPLETED`, domain tags).
- Golden-file tests in `packages/shared/tests/prompts.test.ts` that pin the emitted prompt shape.

**DoD — Behavior:**
- Old `.specs/prompt-optimization.md` principles preserved or documented as superseded.
- Evalite score for the hand-authored Volvo task under a Gemma runner (once 2.B + 2.A land together) is measurably higher than the Wave 0 baseline. Exact threshold TBD once baseline is captured.
- No regressions to existing `packages/supervisor/tests/` prompt-related tests.

### 2.C — Set-of-Mark visual grounding

**Team:** `tool-surface`

**Scope:**
- New module `packages/browser/src/set-of-mark.ts`.
- Function: take a page screenshot, enumerate interactive elements (buttons, links, inputs, selects, `[role=button]`, `[onclick]`), draw numbered boxes via Canvas/ImageMagick, return `{ image: Buffer, refs: Record<number, ElementHandle> }`.
- Integrate with 2.A: every interaction tool result includes the next turn's SOM screenshot.
- The multimodal content is attached to the next agent turn via the existing tool-result content array.

**DoD — Behavior:**
- Unit test with a canned HTML fixture: 10 interactive elements → overlay has 10 numbered boxes, `refs[1..10]` each resolves to a distinct element.
- Integration test: `click(ref)` on a ref from the overlay resolves to a real page interaction.
- The 2.A `click(3)` call in the Volvo replay actually triggers the "Build your Volvo" menu link.

**Conflict:** 2.A and 2.C touch `packages/browser/`. Coordinate via shared seed prompt: 2.A adds tool wrappers in `tools/` subdir, 2.C adds overlay module in `set-of-mark.ts` at package root. 2.B is fully disjoint (`packages/shared/src/prompts.ts`). Parallel OK with coordination.

## Wave 3 — Eval integration

### 3.A — Real agent runner in evalite

Wire `packages/evals` mock runner to a real `@neuve/agent` runner driving `chrome-devtools-mcp`. Record full traces to `evals/traces/`.

### 3.B — Expand task set to 20

Add 5 calibration tasks + 10 curated multi-step journeys (car configurators, checkout flows, form submissions, auth flows).

### 3.C — Gemma-specific runner via @neuve/local-agent

Wire the `.specs/local-gemma4-agent.md` local-agent into the eval runner. Dual-runner mode: Claude + Gemma run the same tasks; diff scored.

## Wave 4 — Online-Mind2Web subset

### 4.A — BrowserGym-style adapter

Add `packages/evals/src/adapters/online-mind2web.ts`. Read the HF dataset, filter tasks with ≤5 key-nodes, map to `EvalTask` format.

### 4.B — Baseline scoring

Run Claude (frontier baseline) + Gemma (production target) against the filtered subset. Commit score deltas to `docs/handover/harness-evals/baselines/`.

## Wave 5 — Distillation pipeline

### 5.A — Teacher-data exporter

Trace format → JSONL training samples (`{prompt, tool_calls, final_answer}` triples). Claude traces first.

### 5.B — Fine-tune stub

Scripts to LoRA-fine-tune Gemma via Ollama's Modelfile path. No training run yet — just the pipeline + a smoke test on a single sample.

## Risks

| Risk | Mitigation |
|------|-----------|
| Hybrid planner breaks offline story | `--offline` flag falls back to template decomposer. Document clearly. |
| SOM screenshots balloon context on 4B | Render at ≤768px, JPEG q70, lazy-render (only on ambiguity signals from agent) |
| Online-Mind2Web tasks too hard for 4B | Filter to ≤5 key-nodes; ramp up as harness matures |
| evalite beta churn | Pin version, fall back to vitest + custom scorer harness if API breaks |
| Trace format lock-in bites later | Design format review gate in Wave 5 before committing to distillation |
| Adherence gate loops forever on a confused agent | `ALL_STEPS_TERMINAL_GRACE_MS` safety net + per-run hard time budget |

## Out of scope

- LLM-as-judge scorers (punt to Wave 6+).
- WebArena / WebVoyager / GAIA adapters (only Online-Mind2Web in this plan).
- Actual fine-tuning runs (only pipeline).
- UI changes to the TUI results screen beyond what's needed to show plan steps.

## Reference material

- `.specs/local-gemma4-agent.md` — Gemma via Ollama ACP agent (already in flight separately)
- `.specs/prompt-optimization.md` — prior prompt work; some principles preserved, some superseded in 2.B
- `docs/research/chrome-devtools-mcp-capabilities.md` — tool surface inventory
- `docs/handover/harness-evals/review-system-prompt.md` — antagonistic reviewer base
