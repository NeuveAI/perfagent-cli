# Wave 1.B — RUN_COMPLETED adherence gate

Date: 2026-04-23
Owner: `adherence-gate-eng` (team `harness-evals`)
Task: #4 — blocks Wave 2.B (#6), Wave 2.A (#5), Wave 3 (#8).

## Design

### Where the gate lives

The gate is applied inside the Executor stream pipeline, between the `Stream.tap(...)` for config-option callbacks and the outer `Stream.takeUntil(executed.hasRunFinished)` — the exact site Wave 0 flagged.

The previous pipeline shape used `Stream.mapAccum` (pure). Wave 1.B upgrades this to `Stream.mapAccumEffect` so the reducer can `yield* Effect.logWarning(...)` when it rejects a premature `RUN_COMPLETED`. The state shape (`{ plan, allTerminalSince }`) is unchanged; only the reducer gained an extra branch.

### Reducer logic (executor.ts:275-323)

For each upstream `AcpSessionUpdate` the reducer:

1. Calls `state.plan.addEvent(update)` to append events (`finalizeTextBlock` still synthesizes `RunFinished` from any `RUN_COMPLETED|...` marker in the agent's text).
2. Computes `terminalTimestamp` for the existing `ALL_STEPS_TERMINAL_GRACE_MS` safety net.
3. Applies the grace-period synthesizer if all steps are terminal and no explicit `RunFinished` exists (unchanged from before).
4. **Gate:** if the resulting plan gained one or more `RunFinished` events compared to the previous state, evaluates `runFinishedSatisfiesGate(...)`:
   - Gate PASSES iff the most-recent `RunFinished` has `abort` metadata set **OR** `plan.allPlanStepsTerminal === true`.
   - Gate FAILS → strip all `RunFinished` events from the emitted plan via `stripRunFinished(...)`, log `Effect.logWarning("premature-run-completed", { planId, totalSteps, terminalSteps, remainingSteps })`, and return the filtered plan so `hasRunFinished` is false and `takeUntil` does not close the stream.
5. The existing `Stream.takeUntil((executed) => executed.hasRunFinished)` at the tail stays untouched — it is only reached when a legitimate `RunFinished` passes through.

### Where `abort` metadata is set

Agents emit an abort via the `ASSERTION_FAILED|step-NN|category=abort; abort_reason=<reason>; ...` marker form. Two domain-model changes carry this through:

1. **`StepFailed` schema** (`packages/shared/src/models.ts`) gained two optional fields: `category?: string` and `abortReason?: string`. A getter `get isAbort(): boolean` returns true iff `category === "abort"` and `abortReason` is non-empty. These are parsed out of the raw `<why-it-failed>` string by a new `parseAssertionTokens(...)` helper that splits on `;` and extracts `category=...` and `abort_reason=...` key-value tokens. The backwards-compatible path: all existing `ASSERTION_FAILED` emissions without these tokens produce a `StepFailed` with `category` and `abortReason` left `undefined` — schema decoding unchanged.
2. **`RunFinished` schema** gained `abort?: { reason: Schema.String }`. `ExecutedPerfPlan.finalizeTextBlock()` was updated to track `pendingAbortReason` while walking the parsed markers in a single text block: when an abort-category `StepFailed` is observed, any subsequent `RunFinished` in that same block gets the `abort.reason` populated. A `StepCompleted`/`StepSkipped` between them clears the pending abort. Cross-block tracking uses `this.lastAbortReason` so a `RunFinished` emitted in the next agent message still picks up the prior block's abort.

This keeps the abort channel parseable from existing plain-text agent output — no new event-shape, no new session-update type, no chrome-devtools-mcp change.

### New getter: `allPlanStepsTerminal`

Placed next to `hasRunFinished` on `ExecutedPerfPlan` (per CLAUDE.md "getter on existing domain models" rule). Semantics:

- Empty `steps` → returns `true` (back-compat with `--planner=none` which produces a synthetic empty plan; the gate must still accept a single `RUN_COMPLETED` there).
- Non-empty `steps` → returns `true` iff every step is `passed | failed | skipped`.

Kept the existing `allStepsTerminal` getter unchanged — it is used by the grace-period synthesizer (`resolveTerminalTimestamp`) and has different semantics (requires non-empty). Two distinct concerns, two distinct getters.

### Prompt exposure (execution system prompt)

Added one `<abort_channel>` block inside the `<status_markers>` section of `buildExecutionSystemPrompt()` (`packages/shared/src/prompts.ts`). Five-line documentation: explains that `RUN_COMPLETED` is rejected when plan steps remain pending unless preceded by `ASSERTION_FAILED|...|category=abort; abort_reason=...`. Also added `abort` to the `Allowed failure categories` list in `<failure_reporting>`. That's the entirety of the prompt edit. Full rewrite remains Wave 2.B's scope.

## Tests

`packages/supervisor/tests/executor-adherence-gate.test.ts` — 5 new tests, all passing:

| # | Test | What it proves |
|---|------|----------------|
| 1 | Volvo trace replay | Fed the captured `2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson` trace's `RUN_COMPLETED|failed|...` marker through the real Executor pipeline against a mocked 6-step plan. Asserts `finalPlan.hasRunFinished === false` (gate rejected it), `finalPlan.allPlanStepsTerminal === false`, and a `premature-run-completed` warning was emitted via `Logger.make`. |
| 2 | Clean termination | 6 steps transition `STEP_START`/`STEP_DONE` to `passed`; then `RUN_COMPLETED|passed|...`. Asserts `hasRunFinished === true`, `allPlanStepsTerminal === true`, all steps `passed`. |
| 3 | Abort termination | 2 steps passed; 3rd emits `ASSERTION_FAILED|...|category=abort; abort_reason=blocked-by-captcha; ...`; then `RUN_COMPLETED|failed|...`. Asserts `hasRunFinished === true` and the `RunFinished.abort.reason === "blocked-by-captcha"`. Remaining pending steps are tolerated — the abort is the legitimate exit. |
| 4 | `plannerMode=none` back-compat | Wave 1.A regression lock. Runs the executor with `plannerMode: "none"` and a `PlanDecomposer.decompose` that dies if called (confirming the short-circuit). The synthetic empty-steps plan receives a single `RUN_COMPLETED|passed|...` marker. Asserts `finalPlan.steps.length === 0`, `allPlanStepsTerminal === true` (empty-plan semantics), `hasRunFinished === true`, and zero `premature-run-completed` warnings. |
| 5 | Grace-period safety net | Drives 6 steps to terminal by `STEP_START`/`STEP_DONE` in a loop; never emits `RUN_COMPLETED`. Confirms `allPlanStepsTerminal === true && hasRunFinished === false`, then calls `synthesizeRunFinished()` directly and verifies it produces a `passed` `RunFinished` with no `abort`. (The in-stream grace-period timer is not exercised with a real sleep — the reducer logic around it is the same it was pre-Wave-1.B, and exercising the timer deterministically without sleeps would require a Clock stub that's disproportionate here.) |

Tests use the existing `vitest` + `Effect` convention (matching `plan-decomposer.test.ts` / `executor-planner-integration.test.ts`). The log-capture test uses `Logger.make(...) + Logger.layer([...])` to assert the warning at `"Warn"` level. Deterministic, no network.

## DoD evidence

Each item from the task's DoD list:

1. **Volvo replay test passes.** → Test #1 above. Asserts explicit `hasRunFinished === false` after the recorded `RUN_COMPLETED` reaches the reducer, and asserts the `premature-run-completed` warning fires.
2. **Clean-termination test passes.** → Test #2.
3. **Abort-termination test passes.** → Test #3.
4. **Grace-period test passes.** → Test #4.
5. **`pnpm --filter @neuve/supervisor test` green.** → 87/87 (was 82/82, +5 new).
6. **`pnpm --filter @neuve/supervisor typecheck` green.** → confirmed.
7. **`pnpm --filter @neuve/perf-agent-cli typecheck` green.** → confirmed.
8. **`pnpm --filter cli-solid typecheck` green.** → confirmed.
9. **`pnpm check` — only pre-existing oxfmt findings.** → `@neuve/shared` formatting errors in 6 files (`cwv-thresholds.ts`, `parse-insight-detail.ts`, `parse-network-requests.ts`, `tests/ci-result-output.test.ts`, `tests/parse-insight-detail.test.ts`, `tests/parse-trace-output.test.ts`) are all pre-existing. I reverted the auto-formatter's touches to those unrelated files so only `models.ts` / `prompts.ts` remain changed within `@neuve/shared`, and both are formatted cleanly. Pre-existing `@neuve/evals` findings also remain. The oxlint "Failed to parse vite.config.mjs" error is a repo-wide pre-existing issue unrelated to this wave.
10. **No `executed.hasRunFinished` bypass.** → Grep confirms the only runtime uses of `.hasRunFinished` in executor.ts are:
    - Line 294: the grace-period synthesizer's "don't synthesize if already have one" check (unchanged from pre-Wave-1.B). If the gate strips a `RunFinished`, `hasRunFinished` is false again and the synthesizer is free to auto-complete if the timer elapses.
    - Line 327: the final `Stream.takeUntil` — guaranteed to only see valid `RunFinished` because the gate filter runs upstream in the same `mapAccumEffect` reducer.
11. **All existing `ASSERTION_FAILED` emissions still parse.** → The schema additions are optional fields; existing `new StepFailed({ stepId, message })` calls still decode. `packages/shared/tests/dynamic-steps.test.ts` exercises the legacy marker form (`ASSERTION_FAILED|step-01|Login button not found` with no `category=`) and still passes — `parseAssertionTokens` returns `{ category: undefined, abortReason: undefined }` for that shape.

## Files touched

### Modified

- `packages/shared/src/models.ts`
  - `StepFailed`: added `category?`, `abortReason?`, and `isAbort` getter.
  - `RunFinished`: added `abort?: { reason }`.
  - New `parseAssertionTokens(...)` helper.
  - `parseMarker("ASSERTION_FAILED", ...)` populates the new fields.
  - `ExecutedPerfPlan.finalizeTextBlock()` enriches `RunFinished` events with `abort` when preceded by an abort-category `StepFailed` (in-block or from prior blocks via `lastAbortReason`).
  - New `get allPlanStepsTerminal(): boolean` (alongside `hasRunFinished`, `allStepsTerminal`).
  - New `get lastAbortReason(): string | undefined` (used by the finalizer to thread abort state across text blocks).

- `packages/shared/src/prompts.ts`
  - Added `abort` to allowed failure categories list.
  - Added five-line `<abort_channel>` block inside `<status_markers>`. Under the 10-line cap the task specified.

- `packages/supervisor/src/executor.ts`
  - Added `countNewRunFinished`, `stripRunFinished`, `runFinishedSatisfiesGate` helpers at module scope.
  - Replaced `Stream.mapAccum(...)` with `Stream.mapAccumEffect(...)` so the reducer can call `Effect.logWarning`.
  - Gate logic inside the reducer: checks for new `RunFinished`, validates gate, strips + logs when rejected.
  - `Stream.takeUntil((executed) => executed.hasRunFinished)` **unchanged** at the tail.

### New

- `packages/supervisor/tests/executor-adherence-gate.test.ts` — 5 tests described above. Reads the captured Volvo ndjson from `evals/traces/` via `fs.readFileSync`.

## Deviations from plan

- **"Introduce a `dropPrematureRunFinished` Stream transformation as a separate pipeline stage" (plan's suggestion).** I implemented the gate inside the existing reducer's closure rather than as a separate `Stream.filter` stage. Two reasons:
  1. The reducer already owns the `{ plan, allTerminalSince }` state that the gate needs (to know whether `RunFinished` just got added); a separate stage would have to re-derive this.
  2. The grace-period synthesizer (`withGrace.synthesizeRunFinished()`) inside the reducer can also emit a new `RunFinished` — putting the gate in the same reducer keeps both synthesis paths uniformly gated by a single codepath.

  The functional outcome is identical to the plan's suggested transformation — same inputs, same outputs, same log behavior, same `takeUntil` contract — but the code locality is better.

- **Grace-period test does not drive the in-stream timer.** Test #5 exercises `synthesizeRunFinished()` directly rather than waiting `ALL_STEPS_TERMINAL_GRACE_MS` (120 s) inside a test. The reducer logic that calls `synthesizeRunFinished` when the timer elapses is unchanged from pre-Wave-1.B — it was already covered indirectly by the existing executor tests. Introducing a `TestClock` dependency mid-wave would be disproportionate.

## Handover notes for Wave 2.B

Wave 2.B owns the full rewrite of `buildExecutionSystemPrompt()` (≤80 lines). Three invariants from 1.B that the new prompt must preserve:

1. The `<abort_channel>` documentation (or equivalent) — the agent must know it can emit `ASSERTION_FAILED|step|category=abort; abort_reason=<reason>;` immediately before `RUN_COMPLETED` to cleanly terminate a blocked run.
2. The `abort` entry in the allowed-failure-categories list.
3. The existing single-line format for `ASSERTION_FAILED` messages must continue to contain `;`-separated `key=value` tokens so `parseAssertionTokens` in `models.ts` keeps finding `category=` and `abort_reason=`. The parser is permissive (accepts surrounding whitespace, case-sensitive keys, keys in any order) so the exact wording can change.

If Wave 2.B changes the ASSERTION_FAILED message format more aggressively (e.g. switches to a JSON payload), the parser in `models.ts` will need a coordinated update. Today it's robust to reordering and extra tokens.

## Round 1 review follow-ups

Reviewer APPROVED round 1 with two non-blocking Minors, both addressed before commit:

1. **Removed the `as ExecutedPerfPlan["events"]` cast in `stripRunFinished`.** The constructor accepts the `Array.filter` output directly once the callback's parameter type is left to inference (the annotation that required the cast was redundant). No `// HACK:` needed — cast was avoidable after all.
2. **Added Test #4** — the `plannerMode=none` regression lock described in the table above. Uses a `PlanDecomposer.decompose` that `Effect.die`s when called, proving the short-circuit path still runs; asserts `hasRunFinished === true`, `steps.length === 0`, and zero `premature-run-completed` warnings were emitted.

Post-fix: `pnpm --filter @neuve/supervisor test` → **87 / 87** passing. Typechecks green.

## Commit breakdown

Four granular commits, no Co-Authored-By footer:

1. `feat(shared): add allPlanStepsTerminal getter, abortReason schema field, and abort run-finished metadata`
2. `docs(shared): expose abort_channel marker in execution prompt`
3. `feat(supervisor): add premature-run-completed gate via Stream.mapAccumEffect reducer`
4. `test(supervisor): add adherence-gate tests including wave-0-A volvo trace replay and planner=none regression`
