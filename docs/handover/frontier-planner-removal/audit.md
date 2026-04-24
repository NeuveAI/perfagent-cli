# Frontier Planner Runtime Removal — Audit

Date: 2026-04-24
Author: `audit-eng` @ team `frontier-planner-removal`
Status: Scoping only. NOT executed. Feeds a future execution team.

## Purpose

Inventory every runtime touchpoint of the frontier planner (Gemini 3 Flash via `@ai-sdk/google` `generateObject`) so a future execution team can excise it with confidence. Frontier models stay ONLY for:

1. **Eval A:B comparison** — `packages/evals/src/runners/real.ts` (`makeRealRunner`) drives the same @neuve supervisor pipeline with the frontier backend for benchmarking Gemma vs Gemini.
2. **Distillation teacher data** — traces captured by the real runner (frontier-driven) feed `packages/evals/src/distill/teacher-data-exporter.ts` which produces fine-tuning data for Gemma. (No distill script directly imports the frontier planner; it reads trace files written by evals.)
3. **LLM-as-judge** — `packages/evals/src/scorers/llm-judge.ts` scores Online-Mind2Web completion with Gemini Flash 3.

Everything else is KILL.

---

## Summary

- **21 KILL touchpoints across 10 runtime files** — CLI flag, preferences store, runtime atoms, TUI screens, supervisor exports/wiring, the entire `plan-decomposer.ts` frontier code path plus its prompt builder, the two runtime error classes, `DEFAULT_PLANNER_MODE = "frontier"` literal.
- **~10 KEEP-EVAL-AB touchpoints** — `packages/evals/evals/*.eval.ts` `EVAL_PLANNER`/`EVAL_GEMMA_PLANNER` configs, `real.ts`/`gemma.ts` runner `plannerMode` plumbing, eval runner tests.
- **1 KEEP-DISTILL touchpoint** — `packages/evals/src/distill/` is downstream of trace files only; no source-level frontier reference. Preserved implicitly by keeping the eval runners.
- **2 KEEP-JUDGE touchpoints** — `packages/evals/src/scorers/llm-judge.ts` + its tests.
- **1 AMBIGUOUS item** — the location of `PlanDecomposer`/`PlannerAgent`/`FrontierPlanSchema` after removal. Two viable paths (keep in `@neuve/supervisor` as eval-only OR move to `@neuve/evals`). See Open Questions §1.
- **Top 3 removal-ordering concerns** — (a) `Executor.make` currently yields `PlanDecomposer` at construction — either the service stays in-tree for evals (Option A) or Executor must be refactored to not depend on it (Option B); (b) `@neuve/evals` already depends on `@neuve/supervisor` for `PlanDecomposer` + `PlannerMode`, so those exports can't be deleted in the same commit that stops the runtime from calling them; (c) the `DEFAULT_PLANNER_MODE = "frontier"` literal in `packages/supervisor/src/errors.ts` is exported and read by the runtime TUI — change of default order matters.

---

## KILL inventory

### K1 — `apps/cli/src/index.tsx` L75-76, L115, L152, L275-278, L425-428

What it does: defines the user-facing `--planner <mode>` CLI flag on both the `watch` and `tui` subcommands with `"frontier"` as the default, wires `parsePlannerMode(opts.planner)` into `usePreferencesStore.setState({ plannerMode: ... })` and the headless `runHeadless({ plannerMode, ... })` call.
Depends on: `parsePlannerMode` from `@neuve/supervisor` (K19), `usePreferencesStore.plannerMode` (K4), `runHeadless` options (K3).
Depended on by: User shell invocations (`perf-agent tui --planner frontier`). All callers route straight through K2 / K3 / K4.
Risk: Low. Dropping the `--planner` option string in Commander causes `opts.planner` to be permanently `undefined` — any `parsePlannerMode(undefined)` call returns `DEFAULT_PLANNER_MODE`, today `"frontier"`, so until K19 changes, the runtime silently defaults to frontier. MUST be excised alongside K2 / K3 / K4 / K19 in a single commit.
Removal order: together with K2, K3, K4, K19 in one commit (CLI surface).

### K2 — `apps/cli/src/commands/watch.ts` L2, L22, L41

What it does: accepts `--planner` on the watch subcommand and seeds the preferences store with `plannerMode: parsePlannerMode(opts.planner)`.
Depends on: same as K1.
Depended on by: `renderApp` → `WatchScreen` (K9).
Risk: Low. Pure plumbing. Delete together with K1.
Removal order: with K1.

### K3 — `apps/cli/src/utils/run-test.ts` L9 import, L38, L139

What it does: threads `plannerMode` into `executor.execute({ ..., plannerMode })` for the headless / CI path.
Depends on: `PlannerMode` type and `Executor.execute`'s `plannerMode` option (K14).
Depended on by: `apps/cli/src/index.tsx` `runHeadless` (K1).
Risk: Low. Removing drops the option; Executor then defaults to `"none"` which already skips PlanDecomposer entirely (see `packages/supervisor/src/executor.ts:190` — `options.plannerMode ?? "none"`).
Removal order: with K1.

### K4 — `apps/cli/src/stores/use-preferences.ts` L3, L20, L26, L53, L55

What it does: zustand-persisted preferences store adds `plannerMode: PlannerMode` field with `"frontier"` initial value plus a `setPlannerMode` setter. NOTE: the `partialize` block (L76-81) does **not** persist `plannerMode`, so disk migration is not required.
Depends on: `PlannerMode` type (K19).
Depended on by: `WatchScreen` (K9), `TestingScreen` (K10), `index.tsx` (K1), `commands/watch.ts` (K2).
Risk: Low. Non-persisted, no settings-file migration. Dropping the field + setter breaks type refs in K9/K10 which must be deleted in the same commit.
Removal order: with K1.

### K5 — `apps/cli/src/data/runtime.ts` L4, L9

What it does: exports `plannerModeAtom = Atom.make<PlannerMode>("frontier")` — the cli-solid TUI uses this atom via cross-package import (K11).
Depends on: `PlannerMode` from `@neuve/supervisor` (K19).
Depended on by: `apps/cli-solid/src/context/runtime.tsx` (K12), `apps/cli-solid/src/routes/testing/testing-screen.tsx` (K11).
Risk: Low. cli-solid is consumer. Must be deleted together with its cli-solid consumers.
Removal order: with K11, K12, K13.

### K6 — `apps/cli/src/components/screens/testing-screen.tsx` L433, L583, L612 (dep-array)

What it does: reads `plannerMode` from preferences store and threads it into the `triggerExecute({ options: { ..., plannerMode } })` atom call; includes `plannerMode` in the `useEffect` dep array.
Depends on: K4 (store), `executeFn` atom (not shown — lives in `data/execution-atom`).
Depended on by: nothing downstream of UI.
Risk: Low. Pure plumbing removal.
Removal order: with K1/K4.

### K7 — `apps/cli/src/components/screens/watch-screen.tsx` L6-7, L49, L126

What it does: `WatchScreen` reads `plannerMode` from preferences store and passes it to `watch.run({ ..., plannerMode })`.
Depends on: K4, `Watch` service with `WatchOptions.plannerMode` (K15).
Depended on by: nothing.
Risk: Low.
Removal order: with K1/K4.

### K8 — `apps/cli-solid/src/tui.ts` L3, L9, L17, L47-49, L52

What it does: cli-solid TUI command-line entry; defines `--planner <mode>` flag default `"frontier"`, calls `parsePlannerMode(opts.planner)`, passes `plannerMode` into `App`.
Depends on: `parsePlannerMode`, `PlannerMode` from supervisor.
Depended on by: user invocation.
Risk: Low. Mirror of K1 for cli-solid.
Removal order: with K1 (single-commit CLI-surface excision).

### K9 — `apps/cli-solid/src/app.tsx` L18, L190, L195, L198

What it does: `App` React component accepts `plannerMode` prop, default `"frontier"`, passes to `<RuntimeProvider plannerMode={...}>`.
Depends on: K8, K12.
Depended on by: nothing.
Risk: Low.
Removal order: with K8.

### K10 — `apps/cli-solid/src/context/runtime.tsx` L5, L8, L41, L49

What it does: seeds `plannerModeAtom` in the Solid `AtomRegistry` with `props.plannerMode ?? "frontier"`.
Depends on: K5, K9.
Depended on by: K11.
Risk: Low.
Removal order: with K5.

### K11 — `apps/cli-solid/src/routes/testing/testing-screen.tsx` L13, L92, L108

What it does: reads `atomGet(plannerModeAtom)` and passes into `executeFn` call.
Depends on: K5.
Depended on by: nothing.
Risk: Low.
Removal order: with K5.

### K12 — `packages/supervisor/src/plan-decomposer.ts` (entire file, 420 lines)

What it does: Defines `FrontierStepSchema`/`FrontierPlanSchema` (zod), `PlannerAgent` service that calls `generateObject` with Gemini provider, and `PlanDecomposer` service with `decomposeFrontier` + `decompose` methods. `PlanDecomposer.decompose(prompt, "frontier", ...)` is the single function that makes the Gemini call.
Depends on: `ai`, `@ai-sdk/google`, `zod`, `@neuve/shared/models`, `@neuve/shared/token-usage-bus`, `./errors`, `./planner-prompt`.
Depended on by: `executor.ts` (K14), `supervisor/src/index.ts` re-exports (K16), `evals/src/runners/real.ts` (KEEP-EVAL-AB), `evals/src/runners/gemma.ts` (KEEP-EVAL-AB), `typescript-sdk/src/layers.ts` (K17), `apps/cli/src/layers.ts` via `layerSdk` (transitive). Tests: `packages/supervisor/tests/plan-decomposer.test.ts`, `plan-decomposer-integration`, `executor-planner-integration.test.ts`, `executor-adherence-gate.test.ts`, `evals/tests/real-runner.test.ts`, `evals/tests/gemma-runner.test.ts`.
Risk: **MEDIUM** — this is the single biggest untangle. Two viable paths (see Open Question §1):
  - **Option A — Keep PlanDecomposer in `@neuve/supervisor`, but make the runtime never invoke it.** Remove all runtime callers (K1-K11), remove the `--planner` flag, set executor default to `"none"` (already the fallback at `executor.ts:190`). PlanDecomposer remains for evals. Net change to this file: split the runtime error messages (K18 — drop `--planner template` remediation).
  - **Option B — Move `plan-decomposer.ts`, `planner-prompt.ts`, `PlannerMode`/`DecomposeError`/`PlannerConfigError`/`PlannerCallError` into `@neuve/evals` (new `packages/evals/src/planning/`).** Executor stops consuming `PlanDecomposer` entirely; `ExecuteOptions.plannerMode` is removed; Executor accepts optional `initialSteps: readonly AnalysisStep[]` that evals populate by calling the moved `PlanDecomposer.decompose` before `executor.execute`. Runtime has ZERO frontier trace. Eval `runRealTask`/`runGemmaTask` become two-step (`decompose`, then `execute`).
Option B is the "leave no trace" spirit; Option A is 80% of the benefit at 30% of the risk.
Removal order: depends on Option A/B. Either way, AFTER K1-K11 (runtime callers gone) and BEFORE K18/K19 (errors/types).

### K13 — `packages/supervisor/src/planner-prompt.ts` (entire file)

What it does: `PLAN_DECOMPOSER_MODEL_ID = "gemini-3-flash-preview"`, `PLAN_DECOMPOSER_TEMPERATURE`, `PLAN_DECOMPOSER_MIN_STEPS`, `PLAN_DECOMPOSER_MAX_STEPS`, `buildPlannerSystemPrompt()`, `buildPlannerUserPrompt()`.
Depends on: nothing.
Depended on by: `plan-decomposer.ts` only (K12).
Risk: Low. Pure prompt-authoring constants.
Removal order: MOVE (Option B) or STAY (Option A) with K12.

### K14 — `packages/supervisor/src/executor.ts` L42-43, L74, L121, L190-208, L231

What it does: `Executor.make` yields `PlanDecomposer` (L121). `ExecuteOptions.plannerMode?: PlannerMode` (L74). Inside `execute`, line 190 `plannerMode = options.plannerMode ?? "none"`, and line 192-208 routes to `planDecomposer.decompose(...)` when mode is not `"none"`. Line 53 lists `DecomposeError` in the `ExecutionError.reason` schema union.
Depends on: K12, K18, K19.
Depended on by: all runtime (apps/cli headless, watch, TUI) + evals' `runRealTask`.
Risk: **HIGH** if Option B is chosen (Executor interface change ripples to evals). **LOW** if Option A (keep `plannerMode?: PlannerMode` but CLI never sets it; internal `?? "none"` short-circuits). Behavior is preserved today: `plannerMode` default is `"none"` which never calls PlanDecomposer — so a runtime that passes nothing works end-to-end. The CLI currently **overrides** the default to `"frontier"`; killing the CLI override suffices.
Removal order: with K12. If Option A, the only edits here are prose (clean up the `ExecutionError.reason` union when `DecomposeError` moves).

### K15 — `packages/supervisor/src/watch.ts` L13, L96, L265

What it does: `WatchOptions.plannerMode?: PlannerMode` (L96), threads it into `Executor.execute({ ..., plannerMode: options.plannerMode })` on line 265.
Depends on: `PlannerMode` (K19), Executor (K14).
Depended on by: `apps/cli/src/components/screens/watch-screen.tsx` (K7).
Risk: Low. Drop the option field.
Removal order: with K1/K7/K14.

### K16 — `packages/supervisor/src/index.ts` L3-4, L6-14

What it does: re-exports `PlanDecomposer`, `PlannerAgent`, `splitByConnectives`, `FrontierPlan`, `FrontierStep`, `PlannerAgentOptions`, `DecomposeError`, `DEFAULT_PLANNER_MODE`, `isPlannerMode`, `parsePlannerMode`, `PLANNER_MODES`, `PlannerCallError`, `PlannerConfigError`, `PlannerMode`.
Depends on: K12, K18, K19.
Depended on by: `@neuve/perf-agent-cli` (K1, K4, K6, K7), `@neuve/sdk` layers (K17), `@neuve/evals` (KEEP-EVAL-AB consumers).
Risk: Low. Option A — leave as-is; Option B — remove everything except whatever survives (likely `splitByConnectives` if unused elsewhere; grep shows it's only in plan-decomposer internals → also removed).
Removal order: with K12.

### K17 — `packages/typescript-sdk/src/layers.ts` L2, L9-13

What it does: `layerSdk` builds `PlanDecomposer.layer` and provides it to `Executor.layer`. Same wiring as `apps/cli/src/layers.ts` (via `layerSdk`).
Depends on: K12.
Depended on by: `apps/cli/src/layers.ts` `layerCli`, `packages/typescript-sdk/src/perf-agent.ts` (which calls `layerSdk(...)` but never sets `plannerMode` in its `ExecuteOptions` — so today the SDK runtime never reaches frontier).
Risk: Low-Medium. Option A: keep PlanDecomposer provided in the SDK layer but runtime never calls it (wasteful, but safe). Option B: remove the `planDecomposerLayer` stanza; Executor no longer needs it.
Removal order: with K12 (Option B) or after K1 (Option A).

### K18 — `packages/supervisor/src/errors.ts` L30-48 (`PlannerConfigError`, `PlannerCallError`)

What it does: error classes used only by `plan-decomposer.ts` frontier path. `PlannerConfigError.message` hardcodes the runtime remediation string `"rerun with --planner template to skip the Gemini planner"` which becomes dead text if K1 lands.
Depends on: nothing.
Depended on by: `plan-decomposer.ts` only.
Risk: Low. Delete both when K12 lands.
Removal order: with K12.

### K19 — `packages/supervisor/src/errors.ts` L3-17 (`PLANNER_MODES`, `PlannerMode`, `DEFAULT_PLANNER_MODE`, `isPlannerMode`, `parsePlannerMode`) — **partially killed**

What it does: type-level planner-mode plumbing. **CAUTION — `PlannerMode` is still used by evals (KEEP-EVAL-AB).** The runtime pieces to kill are:
  - `DEFAULT_PLANNER_MODE: PlannerMode = "frontier"` — dead as soon as K1 removes the `--planner` flag (no caller reads `parsePlannerMode(undefined)` once `opts.planner` is gone). Can stay as a dead export OR be removed if Option B (moving PlannerMode into `@neuve/evals`).
  - `parsePlannerMode` — used by K1/K2/K8 CLI glue; dies with them. Keep if evals consume it; evals today DO NOT import `parsePlannerMode` (they schema-decode `"frontier" | "template" | "none"` themselves in the eval files).
  - `PlannerMode` literal — still needed by evals unless Option B is adopted.
  - `PLANNER_MODES` array — used by `parsePlannerMode` only; dies with it.
Depends on: nothing (outside of `Schema.Literals`).
Depended on by: supervisor/src/index.ts re-exports (K16), apps/cli (K4), apps/cli-solid (K8/K9/K10), evals runners + tests (KEEP-EVAL-AB), supervisor tests.
Risk: Low-Medium. In Option A: delete `DEFAULT_PLANNER_MODE` + `parsePlannerMode` + `PLANNER_MODES` + `isPlannerMode`; keep `PlannerMode` literal (evals still reference it). In Option B: move the whole block to evals.
Removal order: AFTER K1 (last runtime consumer) and together with K12/K18.

### K20 — `packages/supervisor/package.json` L20-21, L26, L31 (`@ai-sdk/google`, `@ai-sdk/provider`, `ai`, `zod`)

What it does: these four deps are **only** used by `plan-decomposer.ts` and its test. `grep -rn "@ai-sdk\|generateObject\|createGoogle\|from ['\"]zod['\"]\|from ['\"]ai['\"]"` on `packages/supervisor/src/` returns zero hits outside of `plan-decomposer.ts`. Tests use `MockLanguageModelV4` from `ai/test` — if we keep PlanDecomposer in supervisor for evals (Option A), these deps stay; if we move it (Option B), they go with it.
Depends on: nothing intrinsic.
Depended on by: K12.
Risk: Low. Option B yields a cleaner supervisor package.
Removal order: with K12 (Option B only).

### K21 — Dead env var `PERF_AGENT_PLANNER_MODEL`

What it does: `plan-decomposer.ts` L298 reads `Config.string("PERF_AGENT_PLANNER_MODEL")` to override the default `"gemini-3-flash-preview"` model. Referenced in `docs/handover/harness-evals/diary/post-compact-2-planner-decode-fix.md` L112 and elsewhere. No `.env.example` or CI step sets it.
Depends on: K12.
Depended on by: nothing outside plan-decomposer.ts.
Risk: Low.
Removal order: automatic with K12.

---

## KEEP inventory (for reference — DO NOT DELETE)

### KEEP-EVAL-AB-1 — `packages/evals/src/runners/real.ts` L3, L20, L30, L35, L235, L248, L260, L378, L385-388, L401

Why kept: `makeRealRunner` is THE A:B comparison runner — it drives the same supervisor pipeline as production but with a frontier backend (configurable via `EVAL_BACKEND`). `DEFAULT_PLANNER_MODE: PlannerMode = "frontier"` at L35 is INTENTIONAL for the real runner — it's how the frontier plan-decomposer gets exercised under eval. After K1-K11 land, the CLI no longer reaches this path; only `pnpm --filter @neuve/evals eval:real` does.

### KEEP-EVAL-AB-2 — `packages/evals/src/runners/gemma.ts` L3, L13, L19, L50, L57-61, L79, L91

Why kept: the Gemma baseline runner; its `DEFAULT_PLANNER_MODE: PlannerMode = "template"` means the Gemma runner does NOT call frontier by default. Configurable via `EVAL_GEMMA_PLANNER`. Retains access to PlanDecomposer because the Wave 4.5 A:B harness allows Gemma + frontier-plan oracle as a debug mode (see `docs/research/gemma-react-browsing/architecture-prd.md` — `gemma-oracle-plan` runner).

### KEEP-EVAL-AB-3 — `packages/evals/evals/smoke.eval.ts` L103-107, L123-127, L143, L151

Why kept: `EVAL_PLANNER=frontier` (default) and `EVAL_GEMMA_PLANNER=template` (default) are the A:B configuration knobs. The string literal union `["frontier", "template", "none"]` is re-declared locally here (schema decode with a default) — it does NOT import `PlannerMode` or `PLANNER_MODES` from supervisor, so it is decoupled from K19.

### KEEP-EVAL-AB-4 — `packages/evals/evals/online-mind2web.eval.ts` L73-77, L87-91, L143, L151

Same as above for the Online-Mind2Web eval. Same local schema literal.

### KEEP-EVAL-AB-5 — `packages/evals/evals/wave-4-5-subset.eval.ts` L67-69, L85-86, L104, L112

Same as above for the Wave 4.5 subset eval.

### KEEP-EVAL-AB-6 — Eval runner tests

- `packages/evals/tests/real-runner.test.ts` — multiple `plannerMode: "frontier"` cases exercise the full pipe.
- `packages/evals/tests/gemma-runner.test.ts` — uses `plannerMode: "template"`, does not exercise frontier directly.
- `packages/evals/tests/tokenomics-getter.test.ts` L117 — comment referencing the frontier planner.
Why kept: eval-path regression tests.

### KEEP-EVAL-AB-7 — `packages/supervisor/tests/plan-decomposer.test.ts` (entire file)

Why kept: this is the test suite for the KEEP-EVAL-AB frontier planner. If we adopt Option A (keep PlanDecomposer in supervisor), the test stays where it is. If we adopt Option B (move to evals), the test moves with it. NOTE the comment at L358-359 references `layerCli` — which is the apps/cli layer that currently still provides PlanDecomposer.layer (K17); post-removal that comment should read "the layer that `@neuve/evals` wires up".

### KEEP-EVAL-AB-8 — `packages/supervisor/tests/executor-planner-integration.test.ts` + `executor-adherence-gate.test.ts`

Why kept: these test Executor ↔ PlanDecomposer propagation. If Option A, they stay; if Option B and Executor loses its `plannerMode` option, most of these tests move to evals or are retired.

### KEEP-DISTILL — `packages/evals/src/distill/` + `packages/evals/scripts/distill/`

Why kept: zero source-level frontier reference. Distill scripts consume `.ndjson` trace files written by the KEEP-EVAL-AB runners. As long as evals can write frontier traces, distill continues to work. Files verified: `teacher-data-exporter.ts`, `modelfile-builder.ts`, `modelfile-messages.ts`, `task-registry.ts`, `jsonl-writer.ts`, `filters.ts`, `types.ts`, plus the three scripts.

### KEEP-JUDGE-1 — `packages/evals/src/scorers/llm-judge.ts`

Why kept: `LlmJudge` uses `generateObject` + `@ai-sdk/google` exactly like the frontier planner, but scoped to scoring Online-Mind2Web task-completion. Independent service, independent `Schema.ErrorClass` hierarchy (`JudgeConfigError`/`JudgeCallError`), independent env var `EVAL_JUDGE_MODEL`. The deps `@ai-sdk/google`, `ai`, `zod`, `@ai-sdk/provider` in `packages/evals/package.json` remain owned by this file (plus the eval runners).

### KEEP-JUDGE-2 — `packages/evals/tests/llm-judge.test.ts` + `llm-judge-disabled.test.ts`

Why kept: regression tests for the judge.

### KEEP-ADJACENT — `packages/shared/src/token-usage-bus.ts` L6, L16

Why kept: the docstring mentions "frontier PlannerAgent" as a publisher, and the `TokenUsageSource` literal union includes `"planner"`. Both stay for evals — PlanDecomposer (running under evals) continues to publish planner-source entries. After removal, only evals emit "planner" entries; runtime emits only "executor" (via ACP `usage_update`).
Suggested future tidy (optional, NOT required for excision): update the docstring to "frontier PlannerAgent (evals only)".

---

## AMBIGUOUS items

### AMB-1 — Where does `PlanDecomposer` live after removal?

**Problem.** PlanDecomposer is used by the CLI runtime today (KILL) AND by the eval A:B runner (KEEP). Both paths flow through `Executor` which requires it at construction time.

**Recommendation.** Option A (keep in supervisor, kill the runtime callers) for the first landing; consider Option B (move to `@neuve/evals`) as a follow-up. Rationale:
  - Option A is mechanical — zero architectural risk, one-commit per layer (CLI, supervisor index, errors).
  - Option B gives "no frontier trace in `@neuve/supervisor`" which is the user's stated goal. Dependencies `@ai-sdk/google`, `ai`, `zod`, `@ai-sdk/provider` can be dropped from `packages/supervisor/package.json`. But it requires refactoring `Executor.make` to not yield `PlanDecomposer` and reworking `ExecuteOptions` (either (a) accepting pre-decomposed steps, or (b) pushing decomposition up into eval-specific runners that wrap Executor). Either is ≥2 days of work + test rewrites.
  - Shipping Option A first keeps execution-phase scope manageable. The invariant "the runtime never calls the frontier planner" holds after Option A because every runtime caller is dead. A lint rule / test that asserts `@ai-sdk/google` is not pulled transitively would lock it in.

**What we need from the user to commit.**
  - Does "leave no trace" mean "no runtime code reaches it" (Option A) or "no source file in supervisor mentions it" (Option B)?
  - If Option B: is it acceptable for `@neuve/evals` to gain a public `decompose()` API that evals wire up explicitly before `executor.execute()`?

### AMB-2 — Should the preserved eval A:B path use a different mode name than `"frontier"`?

**Problem.** If we delete `--planner frontier` from the runtime CLI, keeping a `"frontier"` literal in `packages/evals/evals/*.eval.ts` is fine (different config surface, `EVAL_PLANNER`), but a reader new to the repo might still think there's a runtime path.

**Recommendation.** Rename the literal in evals from `"frontier"` to `"gemini-decompose"` or `"oracle-plan"` to make intent obvious. Low-effort, high-clarity. Optional — surface for user decision.

---

## Dependency graph

Hierarchical — children are blocked by parents until parent is removed. Dependencies run top-down.

```
(runtime surface)                 (service layer)                    (types/deps)
K1  CLI flag --planner  ───┐
K2  commands/watch.ts   ───┤
K3  run-test.ts         ───┤
K4  preferences store   ───┼──▶  K14 Executor.execute.plannerMode
K5  runtime.ts atom     ───┤         │
K6  testing-screen      ───┤         │
K7  watch-screen        ───┤         ▼
K8  cli-solid tui.ts    ───┤     K12 PlanDecomposer.ts + PlannerAgent
K9  cli-solid app.tsx   ───┤         │
K10 cli-solid runtime   ───┤         ├──▶ K13 planner-prompt.ts (constants+prompts)
K11 cli-solid testing   ───┘         ├──▶ K18 PlannerConfigError, PlannerCallError
                                     ├──▶ K19 PlannerMode, DEFAULT_PLANNER_MODE, parsePlannerMode
                                     ├──▶ K20 @ai-sdk/google, ai, zod, @ai-sdk/provider (supervisor package.json)
                                     └──▶ K21 PERF_AGENT_PLANNER_MODEL env var
K15 Watch.plannerMode   ────────────▶ K14
K16 supervisor index    ────────────▶ K12 + K18 + K19
K17 typescript-sdk      ────────────▶ K12

KEEP-EVAL-AB-1 real.ts ─▶ K12 (imports PlanDecomposer for eval, survives)
KEEP-EVAL-AB-2 gemma.ts ─▶ K12 (same)
KEEP-EVAL-AB-3..5 evals  ─▶ local literals only, no cross-package dep on K19
```

Key: K1-K11 can all be deleted in a single commit (they are leaves). K14/K15/K16/K17 then become simpler (drop options/exports). K12/K13/K18/K19/K20/K21 are removed last, gated by AMB-1 resolution.

---

## Proposed removal order

Assuming **Option A** (keep PlanDecomposer in supervisor, excise every runtime caller). If Option B is chosen, add a pre-step 0 that moves `plan-decomposer.ts` + `planner-prompt.ts` into `packages/evals/src/planning/` and extracts the Executor's PlanDecomposer dependency.

### Commit 1 — Remove `--planner` from CLI surfaces

Files: `apps/cli/src/index.tsx` (K1), `apps/cli/src/commands/watch.ts` (K2), `apps/cli-solid/src/tui.ts` (K8), `apps/cli-solid/src/app.tsx` (K9).
Change: drop the Commander `.option("-p, --planner <mode>", …)` blocks, the `CommanderOpts.planner` field, and the `parsePlannerMode(opts.planner)` calls. Stop threading `plannerMode` into `setState`.
Verification:
  - `grep -rn "\-\-planner\|parsePlannerMode" apps/cli apps/cli-solid` → zero hits.
  - `perf-agent tui --help` does not mention `--planner`.

### Commit 2 — Remove `plannerMode` from runtime state / UI

Files: `apps/cli/src/stores/use-preferences.ts` (K4), `apps/cli/src/data/runtime.ts` (K5), `apps/cli/src/components/screens/testing-screen.tsx` (K6), `apps/cli/src/components/screens/watch-screen.tsx` (K7), `apps/cli-solid/src/context/runtime.tsx` (K10), `apps/cli-solid/src/routes/testing/testing-screen.tsx` (K11).
Change: drop the `plannerMode` field, setter, atom, and all dep-array references. Drop the `plannerModeAtom` export from runtime.ts.
Verification:
  - `grep -rn "plannerMode\|plannerModeAtom" apps/` → zero hits.
  - `pnpm --filter @neuve/perf-agent-cli typecheck` + `pnpm --filter @neuve/perf-agent-cli-solid typecheck` pass.
  - Full `pnpm typecheck` passes (this also validates that `apps/cli/src/utils/run-test.ts` K3 still compiles with the `plannerMode?` option dropped).

### Commit 3 — Remove `plannerMode` from `apps/cli/src/utils/run-test.ts`

File: `apps/cli/src/utils/run-test.ts` (K3).
Change: drop the `plannerMode?` option + its pass-through into `executor.execute`.
Verification: `pnpm --filter @neuve/perf-agent-cli typecheck` passes.

### Commit 4 — Remove `plannerMode` from `Watch` service

File: `packages/supervisor/src/watch.ts` (K15).
Change: drop `WatchOptions.plannerMode`, stop threading to `Executor.execute`. Executor will default to `"none"` internally.
Verification: `pnpm --filter @neuve/supervisor test` passes; `pnpm --filter @neuve/supervisor typecheck` passes.

### Commit 5 — Remove `plannerMode` option from Executor (Option A path)

File: `packages/supervisor/src/executor.ts` (K14).
Change: drop `ExecuteOptions.plannerMode`; retire the `planDecomposer` yield and the `decompose(...)` branch (lines 121, 190-208, 231). Keep `PlanDecomposer` service layer alive (evals still use it). Adjust `ExecutionError.reason` schema union to omit `DecomposeError` — evals catch `DecomposeError` directly on their `planDecomposer.decompose(...)` calls instead. Test updates required: `packages/supervisor/tests/executor-planner-integration.test.ts` (relocates scenarios to evals or retires them), `executor-adherence-gate.test.ts` (drop the `plannerMode: "frontier"` / `"none"` cases).
Verification: `pnpm --filter @neuve/supervisor test` passes; `pnpm --filter @neuve/supervisor typecheck` passes; `pnpm --filter @neuve/evals test` passes.

**Invariant check before Commit 6.** Run:
```bash
grep -rn "plannerMode\|PlannerMode\|plan-decomposer\|PlanDecomposer\|--planner\|parsePlannerMode\|PLANNER_MODES\|DEFAULT_PLANNER_MODE\|frontier" apps/ packages/supervisor/src/ packages/typescript-sdk/ 2>/dev/null | grep -v dist/ | grep -v "packages/supervisor/src/plan-decomposer.ts\|packages/supervisor/src/planner-prompt.ts\|packages/supervisor/src/errors.ts\|packages/supervisor/tests/"
```
Expected: zero hits (all remaining hits are in the PlanDecomposer files themselves, which live in supervisor/ awaiting eval use).

### Commit 6 — Retire dead runtime exports

Files: `packages/supervisor/src/index.ts` (K16), `packages/supervisor/src/errors.ts` (K19 partial), `packages/typescript-sdk/src/layers.ts` (K17).
Change:
  - `index.ts`: stop re-exporting `parsePlannerMode`, `DEFAULT_PLANNER_MODE`, `PLANNER_MODES`, `isPlannerMode`, `PlannerCallError`, `PlannerConfigError`. Keep `PlanDecomposer`, `PlannerAgent`, `PlannerMode`, `DecomposeError`, `FrontierPlan`, `FrontierStep`, `PlannerAgentOptions`, `splitByConnectives` (all needed by evals).
  - `errors.ts`: delete `DEFAULT_PLANNER_MODE`, `isPlannerMode`, `parsePlannerMode`, `PLANNER_MODES`. Keep `PlannerMode` literal type (`Schema.Literals(["frontier", "template", "none"])`) — evals depend on it. Update `PlannerConfigError.message` to drop the `--planner template` remediation string (now misleading — evals don't have that flag either).
  - `layers.ts` (SDK): no change required in Option A; PlanDecomposer still wires into the SDK's Executor. (If desired for extra hygiene, we can push the wiring into a per-task eval layer instead; that's a follow-up.)
Verification: full monorepo `pnpm typecheck`, `pnpm test`, `pnpm build`. Also: `grep -rn "parsePlannerMode\|DEFAULT_PLANNER_MODE\|PLANNER_MODES\|isPlannerMode\|PlannerCallError\|PlannerConfigError" packages/ apps/` expects hits only in `packages/supervisor/src/plan-decomposer.ts` + `packages/supervisor/tests/`.

### Commit 7 — Update docs + lint invariant

Files: `docs/handover/harness-evals/plan.md` (correct historical reference to `--planner=frontier|template|none` → eval-only), `docs/research/gemma-react-browsing/*` (flag the ambient context), add a new `docs/handover/frontier-planner-removal/post-removal-invariant.md` that documents the grep invariant + test lock-in.
Add a test in `packages/supervisor/tests/` or `apps/cli/tests/` (if any) that asserts the CLI help output does NOT contain `--planner`. Cheap, catches regressions.

---

## Post-removal verification checklist

### Runtime-never-reaches-frontier proofs

- `perf-agent tui --help` shows NO `--planner` option.
- `perf-agent watch --help` shows NO `--planner` option.
- `perf-agent tui -m "do thing" -y` completes a run WITHOUT `GOOGLE_GENERATIVE_AI_API_KEY` set (today fails iff user sets `--planner frontier` without the key).
- `grep -rn "frontier" apps/cli/src apps/cli-solid/src packages/supervisor/src/executor.ts packages/supervisor/src/watch.ts` returns zero hits.
- `grep -rn "plannerMode\|PlannerMode" apps/ packages/supervisor/src/watch.ts packages/supervisor/src/executor.ts packages/typescript-sdk/src/` returns zero hits (Option A) or returns hits ONLY in PlanDecomposer's own file (Option A post-Commit 6).
- Built output for apps/cli-solid (`apps/cli-solid/dist/tui.js`) rebuilt: `grep -c "planFrontier\|decomposeFrontier" apps/cli-solid/dist/tui.js` → zero. (Today this file contains 2+ references.)

### Eval / distill / judge paths must still work

- `pnpm --filter @neuve/evals eval` (mock runner) passes.
- `pnpm --filter @neuve/evals eval:real` (requires `GOOGLE_GENERATIVE_AI_API_KEY`) runs the A:B harness and exercises the frontier planner. Token usage entries include both `source: "planner"` and `source: "executor"`.
- `pnpm --filter @neuve/evals distill:export` produces a jsonl file with no shape changes.
- `pnpm --filter @neuve/evals eval:mind2web` with `EVAL_JUDGE_ENABLED=true` scores tasks using LlmJudge.

### Tests to add (lock-in)

- `apps/cli/tests/help-surface.test.ts` (new) — snapshot of `perf-agent tui --help` output; fails if `--planner` ever reappears.
- `packages/supervisor/tests/runtime-no-frontier-import.test.ts` (new, optional) — uses a bundler-style import-graph assertion to ensure `apps/cli/src/layers.ts` does not transitively import `@ai-sdk/google` via supervisor. Given Option A keeps PlanDecomposer in supervisor, this test will FAIL unless Option B is adopted — so only add it if Option B is chosen. Otherwise, rely on the CLI help-surface snapshot test as the regression guard.

---

## Open questions for user

1. **Option A vs Option B for PlanDecomposer location** (AMB-1). Phased Option A (ship excision in days, defer Option B refactor to a follow-up) vs. clean-cut Option B (harder but zero frontier in supervisor/)? The audit assumes A; Option B adds ~2 days of engineer time but is the strict "no trace" interpretation.

2. **Eval literal rename** (AMB-2). Should `EVAL_PLANNER="frontier"` literal become `"gemini-decompose"` / `"oracle-plan"` in the eval files to avoid newcomers confusing it with the runtime mode? Cheap rename; optional.

3. **`--planner template` as deprecated alias vs. full removal.** The audit assumes full removal (leave no trace). `architecture-prd.md` historically proposed keeping `--planner frontier` alive as a deprecated alias for 2 releases. Confirm the user's "leave no trace" instruction overrides that proposal (per memory `project_react_pivot_decisions.md` Q2, it does).

4. **`PLANNER_MODES` / `PlannerMode` literal in `errors.ts`.** Evals today re-declare the same union inline in each `.eval.ts` file (they do NOT import `PlannerMode`). If we keep Option A and the type stays in supervisor, evals gain the option to import it for DRY. If Option B, the type moves with PlanDecomposer. Preference?

5. **Watch mode without planner mode — regression surface.** `WatchScreen` previously gave users a planner-mode toggle via preferences. After removal, the watch loop hits Executor with an empty-plan default. Any user-facing messaging needed ("we removed the Gemini pre-planner; the agent now plans itself") or is silent-remove fine?
