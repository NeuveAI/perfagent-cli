# Review: Wave 1.A — Plan decomposer (Round 1)

## Verdict: REQUEST_CHANGES

Two blocking issues found. One CRITICAL runtime crash on the frontier-failure path that is not exercised by any test. One MAJOR scope gap where the `watch` command silently ignores the `--planner` flag. Plus one MAJOR validation inconsistency and several Minor findings.

## Verification executed

- `git status` + `git diff --stat` — 13 modified, 4 new files + 1 diary. Matches engineer's claimed scope exactly. `packages/shared/src/prompts.ts`, `packages/shared/src/models.ts`, and the `Stream.takeUntil` + `hasRunFinished` site in `executor.ts` are all **untouched**. No scope-creep into 1.B or 2.B.
- `pnpm --filter @neuve/supervisor test` → **79/79 passing**. Run twice in a row, deterministic.
- `pnpm --filter @neuve/supervisor typecheck` → green.
- `pnpm --filter @neuve/perf-agent-cli typecheck` → green.
- `pnpm --filter cli-solid typecheck` → green.
- `pnpm build` → green (all 5 tasks).
- `pnpm check` → fails in `@neuve/shared` and `@neuve/evals` on pre-existing formatting issues (7 + 3 files). **None of the flagged files were touched in Wave 1.A** — findings match the pre-existing set documented in prior reviews (task #11 vite-plus review). Acceptable per engineer's diary.
- Independent spike test against `DecomposeError` flowing through `Stream.mapError` in the actual `packages/supervisor/src/executor.ts` — see Finding #1 below.

## Findings

### [CRITICAL] `Stream.mapError` on the frontier-failure path crashes with a schema error — the user sees an unhandled exception instead of a `DecomposeError`

`packages/supervisor/src/executor.ts:157-175, 271`

Repro is mechanical. When `planDecomposer.decompose(...)` fails with a `DecomposeError`, the code at `executor.ts:171-174` wraps it via `Effect.catchTag("DecomposeError", ...)` into a new `ExecutionError`. That `ExecutionError` flows into the outer gen's fail channel, and because `execute` is an `Effect.fn(..., Stream.unwrap)`, the fail channel surfaces as a stream-level error. The stream then runs through `Stream.mapError((reason) => new ExecutionError({ reason }))` at line 271 — and `reason` at that point is **an `ExecutionError`, not one of the five types in the `ExecutionError.reason` union**.

`ExecutionError.reason` is `Schema.Union([AcpStreamError, AcpSessionCreateError, AcpProviderUnauthenticatedError, AcpProviderUsageLimitError, DecomposeError])` — `ExecutionError` is **not** in that union. So `new ExecutionError({ reason: theExistingExecutionError })` throws at constructor time with a schema validation error.

Verified with a spike test against the actual `ExecutionError` and `DecomposeError` classes (file written under `packages/supervisor/tests/`, run, then deleted). Stack trace:

```
Error: Expected AcpStreamError | AcpSessionCreateError | AcpProviderUnauthenticatedError
  | AcpProviderUsageLimitError | @supervisor/DecomposeError,
  got @supervisor/ExecutionError({"reason":@supervisor/DecomposeError(...)})
  at ["reason"]
    at new ExecutionError (.../packages/supervisor/src/executor.ts:43:8)
    at Stream.mapError callback (executor.ts:271)
```

This exception becomes an unhandled defect in the stream — users see a cryptic "Expected ... got @supervisor/ExecutionError" message instead of "Plan decomposition (frontier) failed: <cause>".

**Why no test caught this:** `packages/supervisor/tests/plan-decomposer.test.ts` tests `PlanDecomposer.decompose` directly, never through `Executor.execute`. There is no integration test for "decomposer fails → executor surfaces a clean error." The engineer's diary test table lists cases 5 and 6 (malformed JSON → `DecomposeError`, ACP stream error → `DecomposeError`) but those are scoped to the decomposer's own output, not the executor's forwarding of that error.

**Fix options:**

1. In the `catchTag` at `executor.ts:172-174`, fail with the raw `DecomposeError` instead of prewrapping as `ExecutionError`, then let `Stream.mapError` at line 271 do the single wrap. But TS inference then needs the union at line 271 to cover `DecomposeError`, which it already does.
2. Or, keep the `catchTag` wrap, but add `ExecutionError` itself to the `reason` union (ugly self-reference).
3. Or, use a `DecomposeError.asEffect()` at line 173 (i.e. do *not* convert to ExecutionError there), and trust `Stream.mapError` to finish the job.

Option 1 is the cleanest — the `reason` union already includes `DecomposeError`, so letting the error flow unchanged through the gen's fail channel and then through a single `Stream.mapError` wrap will produce a valid `ExecutionError({ reason: DecomposeError(...) })`.

Either way: add an integration test that exercises `Executor.execute` with a failing `PlanDecomposer` and asserts the surfaced error is a well-formed `ExecutionError` with `reason._tag === "DecomposeError"`.

---

### [MAJOR] `--planner` flag is wired into `watch` command CLI surface but never reaches `watch.run()` — it is silently ignored

`packages/supervisor/src/watch.ts:89-96, 257-263` + `apps/cli/src/components/screens/watch-screen.tsx:37-128`

Trace:

1. User runs `perf-agent watch -p frontier -m "..."`.
2. `apps/cli/src/commands/watch.ts:52` correctly stores `plannerMode: "frontier"` on `usePreferencesStore`.
3. `runWatchCommand` navigates to `Screen.Watch({...})` and calls `renderApp(...)`.
4. `WatchScreen` mounts (`watch-screen.tsx:37`). It reads `agentBackend`, `verbose`, `browserHeaded`, `notifications` from the preferences store — but **not** `plannerMode`.
5. `watch-screen.tsx:119` calls `watch.run({ changesFor, instruction, isHeadless, cookieBrowserKeys, baseUrl, onEvent })` — no `plannerMode` parameter.
6. `packages/supervisor/src/watch.ts:89-96` defines `WatchOptions` with **no** `plannerMode` field.
7. `watch.ts:257-263` builds `executeOptions: ExecuteOptions` with no `plannerMode` — defaults to `undefined` → treated as `"none"` in the executor.

So `perf-agent watch -p frontier` runs the agent with `plannerMode === "none"` — the flag is accepted, parsed, stored, and then thrown on the floor. The user gets the pre-Wave-1.A synthetic empty plan in watch mode.

The diary explicitly claims: *"`apps/cli/src/commands/watch.ts` — `--planner` flag on watch command, matching validator."* That is true at the CLI parse layer but false at the execution layer. The flag has no runtime effect in watch mode.

**Fix:** Add `plannerMode?: PlannerMode` to `WatchOptions`, propagate it into `executeOptions`, and have `WatchScreen` read it from `usePreferencesStore` and pass it to `watch.run(...)`.

---

### [MAJOR] Inconsistent planner-mode validation — `tui` throws on invalid input, `watch` silently falls back

`apps/cli/src/index.tsx:66-70` vs `apps/cli/src/commands/watch.ts:17-21`

`resolvePlannerMode` in `index.tsx` throws `Error("Unknown planner mode \"<raw>\". Expected one of: ...")` when the user passes an invalid value. Good — clear failure mode.

`resolveWatchPlannerMode` in `watch.ts` silently swallows the bad value and returns `"frontier"`:

```ts
const resolveWatchPlannerMode = (raw: string | undefined): PlannerMode => {
  if (raw === undefined) return "frontier";
  if (isPlannerMode(raw)) return raw;
  return "frontier";   // silent fallback — no warning, no error
};
```

So `perf-agent watch --planner=nonsense` silently becomes `--planner=frontier` instead of surfacing the typo. CLAUDE.md's no-swallow-errors guidance applies here: either throw (match `tui`) or log a warning. Same enum, two divergent behaviors in the same CLI binary is a bug.

(Somewhat overlaps Finding #2 — even the silent fallback doesn't matter in practice because the flag is ignored downstream anyway.)

---

### [MINOR] `planId` logged at line 230 no longer matches the plan actually in use when a decomposed plan is returned

`packages/supervisor/src/executor.ts:177, 230-234`

`planId` is freshly generated at line 177, but when `decomposedPlan` is non-undefined, `initialPlan` uses the decomposer's own ID (generated inside `plan-decomposer.ts:119`). The `Effect.logInfo("Agent stream starting", { planId, ... })` at line 229-233 therefore logs an unrelated UUID that appears nowhere else in the run.

Either:
- Log `initialPlan.id` instead, or
- Drop the fresh UUID generation at line 177 and use `initialPlan.id` for the synthetic fallback too.

Pre-change this was correct (single plan, single ID). Post-change the log is a red herring when frontier/template mode is active.

---

### [MINOR] Tests don't cover the `Executor.execute` → `PlanDecomposer.decompose` → `DecomposeError` propagation path

`packages/supervisor/tests/plan-decomposer.test.ts`

All 8 tests exercise `PlanDecomposer` in isolation with a mocked `PlannerAgent`. Cases 5 and 6 prove that the decomposer fails with `DecomposeError` — good. But no test mocks `PlanDecomposer` and calls `Executor.execute` to verify that the error surfaces as a well-formed `ExecutionError` with `reason._tag === "DecomposeError"`. This is the exact gap that let Finding #1 ship.

At minimum: one test in `executor.test.ts` with a layer that provides a failing `PlanDecomposer` and asserts the stream yields a clean `ExecutionError`. Without this, the adherence-gate Wave (1.B) will build on top of an undetected crash.

---

### [MINOR] No handling or user-facing message when Gemini CLI is not installed

`packages/supervisor/src/plan-decomposer.ts:267-276`

The `Effect.catchTags` block catches four ACP error types and wraps them as `DecomposeError`. But if the Gemini CLI binary is missing or not in `PATH`, the failure happens at process spawn inside the ACP adapter — which probably surfaces as `AcpSessionCreateError` or `AcpStreamError` with a raw ENOENT message. The user gets `"Plan decomposition (frontier) failed: <ugly cause>"` with no actionable "install Gemini CLI" hint.

Non-blocking, but worth a follow-up: either (a) detect Gemini CLI availability at layer-construction time and fail with a clear error, or (b) add a `catchTag` that recognises ENOENT and prefixes the message with "Gemini CLI not found. Install with: npm i -g @google/gemini-cli" (or whichever the official install path is).

---

### [INFO] typescript-sdk's `perf-agent.ts` does not thread `plannerMode`

`packages/typescript-sdk/src/perf-agent.ts:310-316`

SDK consumers can't opt into the planner via this entry point — `executeOptions` omits `plannerMode`, which defaults to `"none"`. Not a regression (the field didn't exist before this wave) but a gap worth noting for Wave 1.B / 3 planning. Same observation for `scripts/capture-harness-trace.ts:252-273` — deliberate for deterministic replay, no action needed.

---

## Effect / CLAUDE.md rules — passes

Verified against CLAUDE.md rules. All pass:

- `PlanDecomposer` uses `ServiceMap.Service<PlanDecomposer>()("@supervisor/PlanDecomposer", { make: ... })` with `static layer = Layer.effect(this)(this.make).pipe(Layer.provide(PlannerAgent.layerFromGemini))`. No `Effect.Service`, no `Context.Tag`.
- `PlannerAgent` uses the abstract-service interface pattern (`ServiceMap.Service<PlannerAgent, {...}>()(...)` 3-arg form, interface-only) — this matches CLAUDE.md's "for abstract services, define the interface in the class generic."
- `decompose`, `decomposeFrontier`, `callFrontier` all use `Effect.fn("...")` with span names and structured `Effect.annotateCurrentSpan`.
- `DecomposeError` is a `Schema.ErrorClass` with explicit `_tag: Schema.tag("DecomposeError")` and a class-field `message` derived from `this.mode` and `this.cause`.
- `ExecutionError.reason` widening at `executor.ts:46-52` is a disjoint-tag union addition — not a broadening to `unknown`.
- No `Effect.mapError`, `Effect.orElseSucceed`, `Effect.option`, `Effect.ignore`, `catchAll`, or bare `null` in the new code (grep confirmed zero hits in `plan-decomposer.ts` and `errors.ts`). Only `as const` appears (line 348).
- Zero comments in `plan-decomposer.ts`.
- File naming is kebab-case: `plan-decomposer.ts`, `planner-prompt.ts`.
- `FrontierPlan` / `FrontierStep` schemas are structured (`Schema.Struct` with `title`, `instruction`, `expectedOutcome`, optional `routeHint`) — not `Schema.Unknown`.
- `Schema.decodeEffect(Schema.fromJsonString(FrontierPlan))(jsonText)` correctly catches `SchemaError` via `catchTag` and converts to `DecomposeError`.
- Step IDs are deterministic: `makeStepId(index)` at `plan-decomposer.ts:58-59` produces `step-01`, `step-02`, etc. No `Math.random()` / `Date.now()`.
- `PerfPlan` / `PerfPlanDraft` construction uses existing domain constructors; no new wrapper types.
- `modelPreference: { configId: "model", value: "gemini-2.5-flash" }` — verified `"model"` is the canonical config ID (see `packages/shared/src/models.ts:160 Schema.Literal("model")` and `packages/agent/src/acp-client.ts:918` `setConfigOption(sessionId, modelPreference.configId, modelPreference.value)`).
- `PlannerAgent.layerFromGemini = layerFromAgent |> Layer.provide(Agent.layerGemini)` correctly isolates the planner's agent backend from the outer user-selected backend.
- Barrel-file exports only in `packages/supervisor/src/index.ts` (the package's own public-API file); no new sub-directory `index.ts` introduced.
- Tests use plain `vitest` per package convention — acceptable deviation (see engineer's diary; matches `packages/supervisor/tests/executor.test.ts` precedent).

## Scope & discipline — passes

- `git diff --stat` shows 13 modifications + 5 new files (4 code + 1 diary), all within the declared scope.
- `Stream.takeUntil(executed => executed.hasRunFinished)` at `executor.ts:270` is **unchanged** (verified via `git diff`). Wave 1.B's scope is untouched.
- `packages/shared/src/prompts.ts` is **untouched**. Wave 2.B's scope is untouched.
- `packages/shared/src/models.ts` is **untouched**. `allPlanStepsTerminal` getter not added (correctly reserved for Wave 1.B).
- `PlanDecomposer.layer` is wired into `packages/typescript-sdk/src/layers.ts` via `Layer.provide` chain on the `Executor.layer`.
- CLI flag present on both Ink (`apps/cli/src/index.tsx` `tui` command) and Solid (`apps/cli-solid/src/tui.ts`) with same enum values and default `"frontier"`.

## Backward-compat (`--planner=none`) — passes

- `executor.ts:157-175` short-circuits when `plannerMode === "none"` (line 160: `plannerMode === "none" ? undefined : yield* ...`). `PlanDecomposer.decompose` is never invoked in that branch.
- The fallback `initialPlan` synthesized at `executor.ts:180-196` is structurally identical to the pre-change synthetic plan (same fields, same default values). Diffed line-by-line against `git show HEAD:packages/supervisor/src/executor.ts`.
- Existing `executor.test.ts` doesn't set `plannerMode` and still passes → `undefined` resolves to `"none"` per line 157 (`options.plannerMode ?? "none"`).

## Suggestions (non-blocking)

- Promote the `PlannerMode` enum and its `isPlannerMode`/`resolvePlannerMode` helpers out of CLI-specific files and into `@neuve/supervisor` (alongside `PlannerMode` itself). Right now `apps/cli/src/index.tsx`, `apps/cli/src/commands/watch.ts`, and `apps/cli-solid/src/tui.ts` each re-declare `const PLANNER_MODES = [...]` and `isPlannerMode`. Shared exported helper would remove three copies and make the Finding #3 inconsistency impossible.
- Add a debug log when a decomposed plan replaces the synthetic plan, including the `plan.id` and step count, to help correlate with the ExecutedPerfPlan in the report output.
- Document in the supervisor package README (or `@neuve/supervisor`'s exported types) that `plannerMode` defaults to `"none"` when unset — SDK users currently have no way to know.

## What the reviewer will verify in Round 2

1. Finding #1 fix: `DecomposeError` round-trip integration test added in `packages/supervisor/tests/executor.test.ts` with a failing `PlanDecomposer` mock, asserting the surfaced error is `ExecutionError` with `reason._tag === "DecomposeError"`.
2. Finding #2 fix: `WatchOptions.plannerMode` added, threaded from `WatchScreen` → `watch.run(...)` → `executeOptions.plannerMode`, and a test that verifies the `watch` path respects the flag.
3. Finding #3 fix: `resolveWatchPlannerMode` either throws (matches `tui`) or is deleted in favour of a shared validator.
4. Full `pnpm --filter @neuve/supervisor test` still green with the new integration test(s).
