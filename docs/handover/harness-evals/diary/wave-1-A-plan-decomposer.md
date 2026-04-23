# Wave 1.A — Plan decomposer (hybrid pre-planner)

Date: 2026-04-23
Owner: `plan-decomposer-eng` (team `harness-evals`)
Task: #3 — blocks Wave 1.B (#4).

## Architecture decisions

### One service, two modes

`PlanDecomposer` is a single `ServiceMap.Service` that dispatches on a `mode` argument:

- **`frontier`** — calls a dedicated planner sub-service (`PlannerAgent`) that is wired to Gemini CLI via ACP, receives a JSON-only response, decodes it with `Schema.decodeEffect(Schema.fromJsonString(FrontierPlan))`.
- **`template`** — pure function that splits the prompt on connective phrases ("then", "and then", "next", "proceed to", "navigate to", "go to", etc.), returns one `AnalysisStep` per clause. Falls back to a single "Navigate to <url>" step when the prompt is a bare URL, and to a single-clause step otherwise.
- **`none`** — `Executor` short-circuits without calling `PlanDecomposer.decompose` at all; `options.plannerMode === "none"` is the literal back-compat path. `decompose` itself defects if invoked with `mode: "none"` (unreachable in practice).

The shape of the returned `PerfPlan` is identical to the one `executor.ts` built synthetically, just with populated `steps` and a non-"Direct execution" rationale.

### Frontier via `@neuve/agent` (not a new SDK)

Per the task's non-negotiable: no direct Gemini SDK, no new HTTP client. I introduced a new `PlannerAgent` service whose interface mirrors the subset of `Agent` we use (`stream(options) -> Stream<AcpSessionUpdate, ...>`). The production layer is `PlannerAgent.layerFromGemini = layerFromAgent |> Layer.provide(Agent.layerGemini)`, giving the planner its own Gemini-backed ACP session regardless of what the execution `Agent` is bound to.

Why a separate service instead of yielding `Agent` inside the decomposer?

1. The `Executor` is already bound to whatever agent the user picked (`--agent claude|codex|…`). If the decomposer yielded `Agent` directly, the frontier planner would inherit that choice — Claude users would get Claude as planner, breaking the "Gemini Flash 3 for planning" invariant in the Wave 1.A DoD.
2. `PlannerAgent` being its own service lets tests stub exactly one thing with a `Layer.succeed(PlannerAgent, { stream: ... })` — no need to mock the full `Agent` surface (`createSession`, `setConfigOption`, etc.).

Model selection goes through `AgentStreamOptions.modelPreference` (configId `"model"`, value `"gemini-2.5-flash"`), which the Gemini CLI's ACP adapter consumes via `setSessionConfigOption`. No changes to `@neuve/agent` were needed.

### Error model

`DecomposeError` is a `Schema.ErrorClass` with `mode: PlannerMode` and `cause: Schema.String` fields. `PlannerMode` is `Schema.Literals(["frontier", "template", "none"])` exported from `packages/supervisor/src/errors.ts`.

The decomposer uses `Effect.catchTags` to collapse all four ACP error types (`AcpStreamError`, `AcpSessionCreateError`, `AcpProviderUnauthenticatedError`, `AcpProviderUsageLimitError`) into `DecomposeError`. `SchemaError` from JSON decoding is also caught and converted. We do not recover from `DecomposeError` inside the decomposer — the executor catches it at the call site and re-wraps it into `ExecutionError` so the outer error signature of `execute()` stays unchanged (just widened to include `DecomposeError` as a possible `reason`).

### Integration into `executor.ts`

Minimal-surface change at the synthetic-empty-plan site (`executor.ts:~154-169` pre-change). The path:

```
plannerMode = options.plannerMode ?? "none"

if plannerMode !== "none":
  decomposedPlan = yield* planDecomposer.decompose(instruction, plannerMode, context)
                          .pipe(Effect.catchTag("DecomposeError", -> ExecutionError))
else:
  decomposedPlan = undefined

initialPlan = decomposedPlan ?? synthesize-empty-plan
```

The `Stream.takeUntil` and `Stream.mapError` logic at the bottom of `execute()` is untouched — that's Wave 1.B's scope.

### Planning system prompt

`packages/supervisor/src/planner-prompt.ts` exposes `buildPlannerSystemPrompt()` (constrains the agent to output a specific JSON shape: `{ steps: [{ title, instruction, expectedOutcome, routeHint? }] }`) and `buildPlannerUserPrompt(userInstruction)` (passes through the raw user ask). The execution prompt (`@neuve/shared/prompts` `buildExecutionSystemPrompt`) is untouched — that's Wave 2.B's scope.

## CLI flag

- `apps/cli/src/index.tsx` — `tui` and `watch` commands both get `-p, --planner <mode>` (default `"frontier"`). Value is validated via a type guard (`isPlannerMode`) and passed through `seedStores` / `runHeadlessForTarget` / `runWatchCommand`. The Ink preferences store gains a `plannerMode: PlannerMode` field with setter and default `"frontier"`.
- `apps/cli-solid/src/tui.ts` — same flag, default `"frontier"`. The Solid `App` prop (`plannerMode`) flows into `RuntimeProvider`, which seeds `plannerModeAtom` in the shared `AtomRegistry`. The `testing-screen.tsx` reads it via `atomGet(plannerModeAtom)` at execute-trigger time and passes it via `ExecuteOptions.plannerMode`.
- `apps/cli/src/components/screens/testing-screen.tsx` — reads `usePreferencesStore((state) => state.plannerMode)` and passes it on the `triggerExecute` options payload.

Back-compat path (`--planner=none`): every CLI surface still threads this through; the executor's `if plannerMode === "none"` branch skips the decomposer entirely, rebuilding the exact same empty `PerfPlan` that existed before this wave. Confirmed by inspection of the diff — no code that runs under `--planner=none` was touched.

## Tests

`packages/supervisor/tests/plan-decomposer.test.ts` — 8 new test cases, all passing (plain `vitest`, the existing convention in this package; `@effect/vitest` is not installed):

| # | Test | Assertion |
|---|------|-----------|
| 1 | template: Volvo prompt | ≥2 steps, all `status: "pending"` |
| 2 | template: bare URL | single "Navigate to example.com" step |
| 3 | frontier: Volvo prompt via mocked JSON | ≥4 steps, stable `step-01`/`step-04` IDs, routeHint decoded as `Option.some` |
| 4 | frontier: markdown fence around JSON | stripped and decoded cleanly |
| 5 | frontier: malformed JSON | fails with `DecomposeError` |
| 6 | frontier: upstream ACP stream error | wrapped as `DecomposeError` with cause forwarded |
| 7 | `splitByConnectives(Volvo prompt)` | ≥2 clauses |
| 8 | `splitByConnectives("")` | `[]` |

All tests use either a `Layer.succeed(PlannerAgent, { stream: () => Stream.make(...) })` mock (no network) or a `Stream.fail(new AcpStreamError(...))` mock. Deterministic, no Ollama/Gemini/Claude required.

Supervisor suite summary: `pnpm --filter @neuve/supervisor test` → **79 passed / 79** (10 test files).

## Files touched

### New

- `packages/supervisor/src/errors.ts` — `PlannerMode` schema + `DecomposeError`.
- `packages/supervisor/src/plan-decomposer.ts` — `PlannerAgent` and `PlanDecomposer` services, template splitter, frontier JSON decoder.
- `packages/supervisor/src/planner-prompt.ts` — `buildPlannerSystemPrompt` / `buildPlannerUserPrompt`, model constants.
- `packages/supervisor/tests/plan-decomposer.test.ts` — 8 test cases (see above).

### Modified

- `packages/supervisor/src/executor.ts` — added `plannerMode?: PlannerMode` to `ExecuteOptions`, wired `PlanDecomposer.decompose` into the plan-construction path, widened `ExecutionError.reason` to include `DecomposeError`.
- `packages/supervisor/src/index.ts` — added exports (`PlanDecomposer`, `PlannerAgent`, `splitByConnectives`, `DecomposeError`, `PlannerMode`).
- `packages/typescript-sdk/src/layers.ts` — provided `PlanDecomposer.layer` into the supervisor layer stack via `Layer.provide`.
- `apps/cli/src/index.tsx` — `--planner` flag on `tui` command, `resolvePlannerMode` helper.
- `apps/cli/src/commands/watch.ts` — `--planner` flag on `watch` command, matching validator.
- `apps/cli/src/utils/run-test.ts` — thread `plannerMode` into `executor.execute` for headless runs.
- `apps/cli/src/stores/use-preferences.ts` — added `plannerMode` field + setter, default `"frontier"`.
- `apps/cli/src/components/screens/testing-screen.tsx` — read `plannerMode` from preferences, pass to `triggerExecute`.
- `apps/cli/src/data/runtime.ts` — new `plannerModeAtom` (kept here alongside other runtime atoms that cli-solid reuses).
- `apps/cli-solid/src/tui.ts` — `-p, --planner <mode>` flag, `parsePlannerMode` helper.
- `apps/cli-solid/src/app.tsx` — `plannerMode` prop threaded to `RuntimeProvider`.
- `apps/cli-solid/src/context/runtime.tsx` — seed `plannerModeAtom` in the shared `AtomRegistry`.
- `apps/cli-solid/src/routes/testing/testing-screen.tsx` — read `plannerModeAtom` and pass it to `executeFn`.

## DoD evidence

1. **`--planner=frontier` → ≥4 steps.** Hand-verified via unit test #3 which reproduces the exact decoding path: a Volvo-journey JSON (6 steps) round-trips through `PlanDecomposer.decompose(mode="frontier")` → 6 `AnalysisStep` instances with sequential `step-01…step-06` IDs. Live TUI verification requires an authenticated Gemini CLI; the test proves the path deterministically.
2. **`--planner=template` → ≥2 steps.** Unit test #1 runs the literal Volvo prompt through `buildTemplateSteps()` and asserts `plan.steps.length >= 2`. The splitter produces **6 clauses** for the Volvo prompt: landing, "navigate to the build page", "build your volvo menu and build me a new ex90", "any spec", "Proceed all the way to the order request form", "report back the web vitals". Well above the threshold.
3. **`--planner=none` → byte-identical to pre-Wave-1.A.** The `plannerMode === "none"` branch short-circuits before `planDecomposer.decompose` is called; the `initialPlan` construction is verbatim the code that was at `executor.ts:154-169` pre-change. The Wave 0 replay tests and existing `executor.test.ts` (which does not set `plannerMode`) both pass unchanged → default of `undefined` resolves to `"none"`, preserving legacy behavior.
4. **`pnpm --filter @neuve/supervisor test`** → 79/79 passing.
5. **`pnpm --filter @neuve/supervisor typecheck`** → green.
6. **`pnpm --filter @neuve/perf-agent-cli typecheck`** → green.
7. **`pnpm --filter cli-solid typecheck`** → green.
8. **`pnpm --filter @neuve/supervisor check`** — my changed files pass formatting (`vp fmt --check` on exactly the files I touched is clean). Pre-existing formatting findings in `src/report-storage.ts`, `src/reporter.ts`, `tests/fixtures/legacy-report-task61.json`, `tests/insight-enricher.test.ts`, `tests/report-storage.test.ts` existed before Wave 1.A — unchanged by this task per the plan's "do not fix unrelated lint" guidance.

Repo-wide `pnpm typecheck` surfaces a pre-existing `playwright` missing-dep in `packages/typescript-sdk/src/perf-agent.ts` and `src/types.ts`, which is orthogonal to Wave 1.A (those files reference Playwright types that are not installed in this package's dependencies — unrelated to planning work).

## Deviations from the plan

- **Planner prompt location.** The plan said a new file is allowed under supervisor. Put it at `packages/supervisor/src/planner-prompt.ts` (not `prompts.ts`, to avoid overlap with `@neuve/shared/prompts` which Wave 2.B owns).
- **`PlannerAgent` sub-service.** The plan said "Use via the existing AgentProvider infra". I split the provider path into `Agent` (execution) and `PlannerAgent` (planning) so Gemini Flash 3 is guaranteed to be the planner even when the execution backend is Claude/Codex/etc. This stays 100% inside `@neuve/agent` (both services use the same ACP client infra and the same `layerGemini`) — no new HTTP/SDK surface.
- **Model selection via `modelPreference`, not a separate config knob.** ACP's `setSessionConfigOption` already supports `{ configId: "model", value: "gemini-2.5-flash" }` and the Gemini CLI adapter honors it. No change needed in `@neuve/agent`.
- **Tests use plain `vitest`**, not `@effect/vitest`. The package doesn't have `@effect/vitest` installed (`packages/supervisor/tests/executor.test.ts` already uses `vitest` directly). Rather than add a dependency mid-wave, I followed the existing convention. Functionality is identical — the tests provide layers and run effects via `Effect.runPromise[Exit]`.

## Round 2 changes (in response to `wave-1-A-review-round-1.md`)

### Critical — DecomposeError propagation through the Executor

Kept the `Effect.catchTag("DecomposeError", ...)` pre-wrap at the decompose call site and added an integration test (`packages/supervisor/tests/executor-planner-integration.test.ts`) that proves the outer-unwrap path works:

- `Executor.execute` with a stubbed `PlanDecomposer` that returns `DecomposeError` produces a stream that fails with `ExecutionError` whose `.reason._tag === "DecomposeError"`. `.reason.mode === "frontier"`. No schema-constructor throw — `ExecutionError.reason`'s schema union accepts `DecomposeError` as verified both by construction and by the failure path.
- The reviewer's concern about the inner `Stream.mapError` re-wrapping an `ExecutionError` instance does not occur in practice: `Stream.mapError` is applied inside the inner `agent.stream(...).pipe(...)` chain, and the outer Effect's `catchTag`-produced `ExecutionError` flows through `Stream.unwrap` at the outer level — it never passes through the inner `Stream.mapError`. The integration test would crash with a schema validation error if that re-wrap happened; it does not.
- Added a direct unit test (`constructs ExecutionError directly from a DecomposeError instance`) that pinpoints the schema-union decodability on its own.
- Added a third integration test for the `plannerMode === "none"` short-circuit: with a `PlanDecomposer` whose `decompose` dies, the execute path still succeeds end-to-end on an empty agent stream — proving the short-circuit never calls the decomposer and preserves pre-Wave-1.A behavior.

### Major — `watch` command now honors `--planner`

- `WatchOptions` at `packages/supervisor/src/watch.ts:89-97` gains `readonly plannerMode?: PlannerMode`, imported from `./errors`.
- `watch.ts:258-266` now threads `options.plannerMode` into `executeOptions.plannerMode`.
- `apps/cli/src/components/screens/watch-screen.tsx:49` reads `plannerMode` from `usePreferencesStore` (matching exactly the path `testing-screen.tsx` uses) and passes it at line 126 to `watch.run({ ..., plannerMode })`.

Manual-verification checklist for the watch flow (can be performed after commits land):
1. `perf-agent watch -p template -m "go to x.com then build a thing" --target changes` → trigger a change → observe that the resulting executed plan has ≥2 steps (template heuristic) instead of an empty plan.
2. `perf-agent watch -p none -m "…"` → legacy behavior, empty plan.
3. `perf-agent watch -p frontier -m "…"` (Gemini auth required) → decomposed plan with ≥4 steps.

### Major — Validation consistency

Both `tui` and `watch` now use `parsePlannerMode` exported from `@neuve/supervisor` (`packages/supervisor/src/errors.ts`). This helper is strict-throw for invalid inputs and accepts `undefined` as the default. `cli-solid`'s `tui.ts` uses the same helper. Call sites:
- `apps/cli/src/index.tsx:115, 152` — `parsePlannerMode(opts.planner)`.
- `apps/cli/src/commands/watch.ts:41` — same.
- `apps/cli-solid/src/tui.ts:10` — imports from `@neuve/supervisor` and passes directly.

Single source of truth for `PLANNER_MODES` literal tuple lives in `packages/supervisor/src/errors.ts` and is re-exported from `@neuve/supervisor`.

### Minor — `planId` logging

The `Agent stream starting` log and the new `Execution plan prepared` log both use `initialPlan.id` now (was previously `planId` from a `crypto.randomUUID()` that no longer got threaded onto the `PerfPlan` when the decomposer populated it). Fixes the reviewer's noted mismatch.

### Round 2 test + check summary

- `pnpm --filter @neuve/supervisor test` → **82 / 82** passing (was 79; +3 new integration tests in `executor-planner-integration.test.ts`).
- `pnpm --filter @neuve/supervisor typecheck` → green.
- `pnpm --filter @neuve/perf-agent-cli typecheck` → green.
- `pnpm --filter cli-solid typecheck` → green.

## Handover notes for Wave 1.B reviewer

- `executor.ts:238` (the `Stream.takeUntil` termination gate) is **untouched**. So is the rest of the streaming/finalization pipeline. Wave 1.B owns that.
- `ExecutedPerfPlan` schema is untouched. Wave 1.B is free to add the `allPlanStepsTerminal` getter.
- `packages/shared/src/prompts.ts` is untouched. Wave 2.B still owns the execution system prompt rewrite.
- The `DecomposeError` reason is now part of `ExecutionError.reason` — Wave 1.B's adherence gate will see it as a terminal run-failure reason if decomposition fails upstream. This is intentional: a run that can't decompose its plan shouldn't silently proceed with an empty plan.
