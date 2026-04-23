# Review: Wave 1.B — RUN_COMPLETED adherence gate (Round 1)

## Verdict: APPROVE

### Verification executed

- `git status --short` — only three modified runtime files + new test + diary (matches engineer scope exactly).
- `git diff --stat HEAD` — `packages/shared/src/models.ts` (+83/−5), `packages/shared/src/prompts.ts` (+10/−6), `packages/supervisor/src/executor.ts` (+61/−21). No drift.
- `git diff HEAD -- packages/supervisor/src/plan-decomposer.ts packages/supervisor/src/planner-prompt.ts packages/browser/` — empty. Wave 1.A and Wave 2.A/2.C files untouched.
- `pnpm --filter @neuve/supervisor test` — **86 passed / 86** (was 82 pre-Wave-1.B; +4 adherence-gate tests). Run **twice**, deterministic both times.
- `pnpm --filter @neuve/supervisor typecheck` — green.
- `pnpm --filter @neuve/shared typecheck` — green.
- `pnpm --filter @neuve/shared test` — **118 passed / 118** (legacy fixtures + dynamic-steps tests included, confirming backwards compat with pre-Wave-1.B serialized `RunFinished` and `ASSERTION_FAILED` shapes).
- `pnpm --filter @neuve/perf-agent-cli typecheck` — green.
- `pnpm --filter cli-solid typecheck` — green.
- `pnpm check` — only pre-existing oxfmt findings in `@neuve/shared` (`src/cwv-thresholds.ts`, `src/parse-insight-detail.ts`, `src/parse-network-requests.ts`, `tests/ci-result-output.test.ts`, `tests/parse-insight-detail.test.ts`, `tests/parse-trace-output.test.ts`) and `@neuve/evals` (3 files). **None** are in `models.ts`, `prompts.ts`, or `executor.ts`. Matches engineer's diary claim (#9) and prior round findings.
- `pnpm build` — all 5 tasks green; CLI bundle produced (`apps/cli` 485 kB, `apps/cli-solid` built by `bun build.ts`).

### Scope hygiene

- Engineer's claimed files match `git diff --stat` exactly: `models.ts`, `prompts.ts`, `executor.ts`, + new `tests/executor-adherence-gate.test.ts` + diary. No scope creep.
- Prompt edit is tight: **1 `<abort_channel>` block (5 non-blank lines) + 1 blank separator + 1 edited failure-categories line = 7 net lines** inside `buildExecutionSystemPrompt`. Under the ≤10-line cap.
- Additional `prompts.ts` hunks (import collapse + blank-line removal near line 85) are auto-formatter noise limited to the already-touched file; nothing semantic.
- Wave 1.A's `--planner=none` short-circuit path in `executor.ts` (lines 189–226) is syntactically untouched by the diff — only the downstream `Stream.mapAccum → mapAccumEffect` section changed.

### Stream topology verification

The reducer refactor from `Stream.mapAccum` → `Stream.mapAccumEffect` preserves the accumulator contract:

- Signature confirmed against `effect@4.0.0-beta.35` Stream.ts:11671 — returns `Effect<[state, ReadonlyArray<B>], E, R>` per element, sequentially.
- Pre-existing grace-period synth logic (`resolveTerminalTimestamp`, `Date.now() - terminalTimestamp >= ALL_STEPS_TERMINAL_GRACE_MS`) is copied verbatim inside the new `Effect.gen`. Behavior equivalence verified by inspection of the diff.
- Gate placement: inside the reducer, AFTER grace synthesis but BEFORE returning the state — single codepath gates both agent-emitted AND grace-synthesized `RunFinished` events. Diary claim confirmed.
- `Stream.takeUntil((executed) => executed.hasRunFinished)` at `executor.ts:327` is unchanged and only sees plans where the gate has already admitted a `RunFinished` (gate writes `filtered` plan with `events` missing any `RunFinished` when rejecting, so `hasRunFinished === false` and `takeUntil` holds).
- `countNewRunFinished` compares prior-state vs. current-state counts — detects new events regardless of whether they came from `addEvent`/`finalizeTextBlock` parsing or from `synthesizeRunFinished`. Simple, correct.
- `runFinishedSatisfiesGate` correctly prefers the **last** `RunFinished` (walks `events` in reverse via `[...events].reverse().find(...)`). Passes iff `abort !== undefined` OR `allPlanStepsTerminal === true`.

No race: `Stream.mapAccumEffect` is sequential per-element (Effect 4 beta 35 implementation backs to `channel.mapAccum` — confirmed in source). `state.plan` reference is threaded forward correctly; `countNewRunFinished(state.plan, withGrace)` sees the *prior* state because `state` is the accumulator, not the mutated plan.

### Back-compat verification

- **`--planner=none` empty-plan back-compat.** `ExecutedPerfPlan.allPlanStepsTerminal` (models.ts:1148–1153) returns `true` when `steps.length === 0` — the critical branch for Wave 1.A's synthetic plan. Verified by reading the getter. Combined with the fact that empty plans never trigger grace (pre-existing `allStepsTerminal` requires `steps.length > 0`), an empty-plan session terminates correctly on the first agent-emitted `RUN_COMPLETED` (no abort + `allPlanStepsTerminal === true` → gate PASSES). Not covered by a dedicated test, but the logic is trivially correct and the 4 existing Wave-1.A tests in `executor-planner-integration.test.ts` with `plannerMode !== "frontier"` paths still pass in the 86/86 count.
- **Pre-existing `ASSERTION_FAILED` marker emissions.** `packages/shared/tests/dynamic-steps.test.ts` lines 223–246 and 279 exercise the legacy form (`ASSERTION_FAILED|step-01|Login button not found`, no `;key=value` tokens). Both tests pass. `parseAssertionTokens` returns `{category: undefined, abortReason: undefined}` for that shape → `StepFailed.isAbort` returns `false` → behavior identical to pre-Wave-1.B.
- **Legacy report fixture** (`packages/supervisor/tests/fixtures/legacy-report-task61.json`) contains a pre-Wave-1.B serialized `RunFinished` with no `abort` field. Decodes cleanly because `abort` is `Schema.optional(...)`. All 86 supervisor tests pass including those that consume this fixture.
- **`hasRunFinished` getter** at `models.ts:1135` is byte-identical to pre-Wave-1.B definition. No callers' semantics changed.

### Schema correctness

- `StepFailed.category?: string` and `StepFailed.abortReason?: string` — both `Schema.optional(...)`. `isAbort` getter derives from `category === "abort" && abortReason !== undefined && abortReason.length > 0`. Single source of truth. Gate reads `lastRunFinished.abort !== undefined` (on `RunFinished`), and `finalizeTextBlock` is the sole writer of that field — one writer, one reader.
- `RunFinished.abort?: { reason: string }` — nested struct, optional. Decodes legacy shapes unchanged.
- Token parser (`parseAssertionTokens`) correctly maps snake_case agent output (`abort_reason=<value>`) to camelCase schema field (`abortReason`). Verified by reading lines 735–744 and the abort test payload `category=abort; domain=general; abort_reason=blocked-by-captcha; ...` → test asserts `runFinished.abort?.reason === "blocked-by-captcha"` (passes).
- Cross-block abort threading via `lastAbortReason` getter (models.ts:1155–1162) walks events in reverse, returns most-recent abort's reason, and is reset by any subsequent `StepCompleted`/`StepSkipped`. Consistent with the in-block `pendingAbortReason` logic in `finalizeTextBlock`.

### Test coverage

- **Test #1 (Volvo replay)** drives the REAL Executor stream pipeline with the captured ndjson trace's `RUN_COMPLETED|failed|...` payload, plus a mocked 6-step plan. Asserts `finalPlan.hasRunFinished === false`, `allPlanStepsTerminal === false`, and `premature-run-completed` warning fires. ✓
- **Test #2 (clean termination)** drives 6 `STEP_START`/`STEP_DONE` pairs + `RUN_COMPLETED|passed` through the real pipeline. Asserts all steps `passed`, `hasRunFinished === true`, `allPlanStepsTerminal === true`. ✓
- **Test #3 (abort termination)** drives 2 completions + abort + `RUN_COMPLETED` through the real pipeline. Asserts `runFinished.abort.reason === "blocked-by-captcha"` and `hasRunFinished === true` (gate admits via abort branch). ✓
- **Test #4 (grace-period)** exercises `addEvent`/`synthesizeRunFinished` directly — does NOT drive the in-stream timer. Engineer called this out as a deliberate deviation. Acceptable since the reducer's timer branch is pre-existing code (only wrapped into `Effect.gen`) and exercising a 120-second sleep in a unit test would require a `TestClock` injection that's disproportionate to the change.

### Logging hygiene

- `Effect.logWarning("premature-run-completed", {planId, totalSteps, terminalSteps, remainingSteps})` — structured, correct log level, no sensitive data, uses `withGrace.id` (the real plan id, not a freshly-generated UUID). Matches Wave 1.A's minor fix from round-2 review.
- No `console.log` anywhere in the diff.

### Findings

#### Minor

- [MINOR] `packages/supervisor/src/executor.ts:98-104` — `stripRunFinished` uses `as ExecutedPerfPlan["events"]` to coerce `ExecutionEvent[]` back to the branded readonly array type. CLAUDE.md says "No type casts (as) unless unavoidable." A `Schema.decode` roundtrip or `Arr.filter` from `effect` would avoid the cast, but the cast is local, correct, and non-semantic. Non-blocking.
- [MINOR] No explicit test coverage for `--planner=none` empty-plan + `RUN_COMPLETED` through the gate. The logic is trivially correct (`allPlanStepsTerminal` returns `true` for empty steps, so the gate admits), but a single-line test would lock this contract. Non-blocking because the back-compat Wave-1.A tests in `executor-planner-integration.test.ts` exercise adjacent paths and all pass.

#### Info

- [INFO] The plan suggested introducing a separate `dropPrematureRunFinished` Stream stage upstream of `takeUntil`. Engineer inlined the gate into the `mapAccumEffect` reducer instead — functionally equivalent (the filter happens before `takeUntil` sees the plan) and arguably better locality (same closure owns both the grace-synth path and the gate, so both synthesis paths go through one codepath). Confirmed by inspection of the final code.

### Suggestions (non-blocking)

- When commits are authored, consider adding a single regression test for the `--planner=none` empty-plan + `RUN_COMPLETED` path, even if trivially short, to lock the `allPlanStepsTerminal → true` contract on empty steps against future refactors. One extra test, covers an explicit back-compat invariant.
- The two-minor findings above are both non-blocking; approving without a round 2 is appropriate.

### Approval rationale

All four DoD items from the task are demonstrated end-to-end:
1. Volvo replay does not terminate on premature `RUN_COMPLETED` — Test #1 ✓
2. Clean termination path works — Test #2 ✓
3. Abort-termination path works — Test #3 ✓
4. Grace-period synth path works — Test #4 (direct, not timer-driven, acknowledged) ✓

Stream topology refactor is minimally-invasive and preserves all existing contracts. Schema additions are all optional fields; legacy serialized data decodes unchanged. Gate logic is correct for all three enumerated termination scenarios (normal, aborted, premature). Logging is structured and uses the real plan id. `hasRunFinished` is still the single termination predicate at the `takeUntil` tail; the gate filters upstream.

No critical or major findings. Engineer may proceed with the 4-commit breakdown in diary section "Round 2 / reviewer notes."
