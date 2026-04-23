# Review: Wave 1.A — Plan decomposer (Round 2)

## Verdict: APPROVE

All three blocking findings from Round 1 are resolved. The engineer's Fix 1 deviation (keeping the `catchTag` pre-wrap instead of removing it) was independently verified to be **topologically safe** — the outer-gen failure bypasses the inner `Stream.mapError` because `Stream.mapError` is scoped to the inner `agent.stream(...)` pipe, not the outer `Stream.unwrap`.

## Verification executed

- `git diff --stat` — 15 modified + 7 new files (5 code + 1 test + 1 diary + 1 review from round 1). Two new entries vs Round 1: `packages/supervisor/src/watch.ts` (Fix 2), `apps/cli/src/components/screens/watch-screen.tsx` (Fix 2), `packages/supervisor/tests/executor-planner-integration.test.ts` (Fix 1 tests). No creep into Wave 1.B (`ExecutedPerfPlan.allPlanStepsTerminal` not added; `Stream.takeUntil` predicate unchanged) or Wave 2.B (`packages/shared/src/prompts.ts` untouched).
- `pnpm --filter @neuve/supervisor test` → **82/82 passing**. Run twice consecutively, deterministic (1.53s both runs).
- `pnpm --filter @neuve/supervisor typecheck` → green.
- `pnpm --filter @neuve/perf-agent-cli typecheck` → green.
- `pnpm --filter cli-solid typecheck` → green.
- `pnpm check` → same pre-existing fmt findings in `@neuve/shared` (7 files) and `@neuve/evals` (3 files) as Round 1 + the pre-wave vite-plus review. None of the flagged files are touched by Wave 1.A. No new loader errors.
- Independent topology spike: wrote and ran a test reproducing the `Effect.fn("...")(genFn, Stream.unwrap)` shape with a pre-wrapped error in the gen's fail channel and a `Stream.mapError` inside the returned stream pipe. Confirmed that the outer-gen failure exits with the pre-wrapped error **unchanged** — inner `Stream.mapError` does NOT wrap it a second time. Test deleted after verification.

## Fix 1 (CRITICAL) — deviation analysis

**Claim under scrutiny:** engineer kept the `Effect.catchTag("DecomposeError", … ExecutionError …)` at `executor.ts:172-174` instead of removing it, arguing the double-wrap crash cannot occur because `Stream.mapError` at line 270 is scoped to the inner `agent.stream(...)` pipe.

**Topology trace:**

```ts
Effect.fn("Executor.execute")(function* (options) {
  // … yield* catchTag wraps DecomposeError → ExecutionError here (line 173) …
  return agent.stream(streamOptions).pipe(
    Stream.tap(...),            // line 244
    Stream.mapAccum(...),       // line 251
    Stream.takeUntil(...),      // line 269
    Stream.mapError(reason => new ExecutionError({ reason })),  // line 270
  );
}, Stream.unwrap);
```

`Effect.fn(name)(genFn, Stream.unwrap)` returns a function that produces a stream by running the gen through `Stream.unwrap`. The gen yields `Effect<Stream<A, E_inner>, E_outer>`; `Stream.unwrap` lifts that into `Stream<A, E_inner | E_outer>`. Critically, the `.pipe(..., Stream.mapError(...))` inside the gen attaches to `E_inner` (errors from `agent.stream`) — NOT to `E_outer` (errors from the gen's Effect fail channel).

So when the gen fails via `yield* new ExecutionError({ reason: decomposeError }).asEffect()`, the failure propagates through `Stream.unwrap` directly into the stream's error channel, **bypassing** the inner `Stream.mapError` entirely. The pre-wrapped `ExecutionError` is the terminal error the consumer sees — no second wrap is attempted.

**Independent reproduction:** I wrote a minimal spike (later deleted) using `Effect.fn("test")(function* () { yield* preWrappedError.asEffect(); return Stream.make(1,2,3).pipe(Stream.mapError(r => new Outer({ reason: r }))); }, Stream.unwrap)` and ran it. Exit's surfaced error was the pre-wrapped one **unchanged** — `Outer({ reason: Inner })`, not `Outer({ reason: Outer({ reason: Inner }) })`. Confirmed the topology claim.

**Integration test quality** (`executor-planner-integration.test.ts`):

- Test A (lines 71-101) — provides the real `Executor.layer` with a stubbed `PlanDecomposer` (fails synthetically with `DecomposeError`), a never-called `Agent` (`Stream.die` if invoked), and a `Git` stub. Calls `executor.execute(...).pipe(Stream.runDrain)` and asserts the surfaced error is an `ExecutionError` with `reason._tag === "DecomposeError"`, `reason.mode === "frontier"`, and `message` containing "synthetic planner failure". The agent never-called layer is a good forcing function: if the decomposer's error propagation accidentally fell through and the agent got invoked, the test would surface a `Stream.die` defect instead of a clean `ExecutionError` — so this test DOES exercise the production topology, not a shortcut.
- Test B (lines 103-113) — constructs `new ExecutionError({ reason: new DecomposeError(...) })` directly and asserts fields decode. Proves the schema union accepts `DecomposeError` as a valid `reason`.
- Test C (lines 115-154) — sets `plannerMode: "none"`, stubs a `PlanDecomposer` that dies if invoked, and expects `Exit.Success` from a single empty-stream run. Proves the `none` short-circuit doesn't reach the decomposer.

All three pass deterministically. **Fix 1 accepted as a valid deviation.**

## Fix 2 (MAJOR) — watch path threading

Verified end-to-end:

- `packages/supervisor/src/watch.ts:96` — `WatchOptions` now includes `readonly plannerMode?: PlannerMode`.
- `packages/supervisor/src/watch.ts:265` — `executeOptions` in `run.run()` threads `plannerMode: options.plannerMode` directly into `ExecuteOptions`.
- `apps/cli/src/components/screens/watch-screen.tsx:49` — `WatchScreen` reads `plannerMode` from `usePreferencesStore`.
- `apps/cli/src/components/screens/watch-screen.tsx:126` — passes `plannerMode` into the `watch.run({...})` call.
- `apps/cli/src/commands/watch.ts:41` — CLI command uses `parsePlannerMode(opts.planner)` to seed the preference before navigating to the `Watch` screen.

Grepped all `watch.run(` call sites repo-wide. Exactly one caller: `apps/cli/src/components/screens/watch-screen.tsx:120`. No caller missed.

## Fix 3 (MAJOR) — validation consistency via `parsePlannerMode`

Verified:

- `packages/supervisor/src/errors.ts:13-17` — new exported `parsePlannerMode(raw: string | undefined): PlannerMode` that returns `DEFAULT_PLANNER_MODE` when raw is undefined, matches via `isPlannerMode`, else throws `Error("Unknown planner mode \"<raw>\". Expected one of: frontier, template, none.")`. Single source of truth.
- `apps/cli/src/index.tsx:3,115,152` — both `seedStores` and `runHeadlessForTarget` call `parsePlannerMode(opts.planner)`.
- `apps/cli/src/commands/watch.ts:2,41` — `runWatchCommand` calls `parsePlannerMode(opts.planner)` (replaces the old silent-fallback `resolveWatchPlannerMode`).
- `apps/cli-solid/src/tui.ts:3,52` — `launch(...)` call threads `parsePlannerMode(opts.planner)`.
- Grepped `apps/cli/src/` + `apps/cli-solid/src/` for any surviving inline `PLANNER_MODES`, `isPlannerMode`, `resolvePlannerMode`, `resolveWatchPlannerMode`, or any other local planner-mode parser. **Zero hits.** Engineer fully deleted the duplicated validators.
- Error message is identical across surfaces (single helper, one source) — `"Unknown planner mode \"<raw>\". Expected one of: frontier, template, none."`.

## Minor (Round 1) — `planId` logging

Verified: `packages/supervisor/src/executor.ts:197` and `:229` both now use `planId: initialPlan.id`. No other `planId` references in the file. Fixed.

## Scope hygiene

- `packages/shared/src/prompts.ts` — **untouched** (Wave 2.B scope). Confirmed via `git diff HEAD -- packages/shared/src/prompts.ts` → empty.
- `packages/shared/src/models.ts` — **untouched** (Wave 1.B scope). `allPlanStepsTerminal` getter not added. Confirmed via `git diff HEAD -- packages/shared/src/models.ts` → empty.
- `Stream.takeUntil((executed) => executed.hasRunFinished)` at `executor.ts:269` — **unchanged** from HEAD. Wave 1.B's termination-gate scope is untouched.
- `ExecutionError.reason` union at `executor.ts:46-52` still includes exactly the same five members as Round 1 (four ACP errors + `DecomposeError`). No further widening.
- `packages/supervisor/src/index.ts` public exports grew by `PlanDecomposer`, `PlannerAgent`, `splitByConnectives`, `DecomposeError`, `DEFAULT_PLANNER_MODE`, `isPlannerMode`, `parsePlannerMode`, `PLANNER_MODES`, `PlannerMode`. All are genuinely used by the CLI packages.

## Effect / CLAUDE.md compliance (rechecked)

- `PlanDecomposer` and `PlannerAgent` still use `ServiceMap.Service` with `make:` + `static layer`. No `Effect.Service`, no `Context.Tag`.
- Errors still `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)` and class-field `message`.
- New integration test file uses plain `vitest` (package convention, same as `executor.test.ts`).
- `parsePlannerMode` is a pure sync function that throws on bad input — not wrapped in `Effect.try`. Acceptable because it runs at CLI startup (not inside Effect code) and the thrown error is caught by commander's own error handling.
- Filenames kebab-case (`executor-planner-integration.test.ts`).
- No `null`, no `Effect.mapError`, no `Effect.orElseSucceed`, no `Effect.option`, no `Effect.ignore`, no `catchAll`. Grepped the new/changed files — zero hits.

## Suggestions (non-blocking)

- `parsePlannerMode` and `PLANNER_MODES` / `isPlannerMode` / `DEFAULT_PLANNER_MODE` currently live in `packages/supervisor/src/errors.ts`. Semantically they're parsing / config helpers, not errors. A future cleanup could move them to a new `packages/supervisor/src/planner-mode.ts` (or inline them into `plan-decomposer.ts` since that's where `PlannerMode` is actually consumed). Deferring because the current location doesn't break anything and moving would be noise.
- The `@neuve/supervisor` barrel (`src/index.ts`) is the only re-export point and already exists pre-wave, so adding `PlannerMode` / `parsePlannerMode` to it is consistent with the rest of the package's public surface. No CLAUDE.md barrel-ban violation (the rule is about avoiding sub-directory `index.ts` re-exporters; top-level package entry points are the documented exception).
- Consider a regression test for Fix 3's error message format, so a future refactor can't accidentally silent-fallback again. Low priority.

## Bottom line

Engineer addressed all three blockers. The Fix 1 deviation is technically correct — verified both by tracing the code and by an independent topology spike. The integration tests exercise the true production path. No new scope creep. All verification commands green. Pre-existing repo-wide formatting issues match the documented pre-wave set.

**APPROVE.**
