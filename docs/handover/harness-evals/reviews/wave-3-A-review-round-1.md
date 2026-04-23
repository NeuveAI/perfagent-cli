# Review: Wave 3.A — Real agent runner in evalite (Round 1)

## Verdict: REQUEST_CHANGES

The runner wires the supervisor → agent → trace-recorder pipeline correctly and
the 48/48 test suite is green on two deterministic runs. The diary accurately
describes the intended shape. However, this diff also ships most of Wave 3.B
(15 task fixtures + 79 lines of new `tasks.test.ts` assertions + a
`wave-3-B-eval-tasks.md` diary), which the seed prompt explicitly forbids.
Independent of the scope creep, multiple `CLAUDE.md` rules are broken inside
`src/runners/real.ts` and `evals/smoke.eval.ts`: raw `process.env` access, raw
`throw`, `try/catch` blocks, `as` casts, `as unknown as` in tests, and missing
`Effect.fn` span names on effectful functions. These are the exact same kinds
of "test-path OK, prod-path diverges" seams that burnt Wave 2.A and Wave 4b
(see `feedback_no_test_only_injection_seams`). Resolving them is a merge-block.

## Verification executed

| Command | Outcome |
|---|---|
| `git status` + `git diff --stat HEAD` | **Scope violation:** diff includes `packages/evals/tasks/{calibration-*,journey-*}` (15 files), `packages/evals/tests/tasks.test.ts` (+53 lines), `packages/evals/src/scorers/final-state.ts` (whitespace-only), `tests/scorers.test.ts` (whitespace-only), `tests/mock-runner.test.ts` (whitespace-only), plus `docs/handover/harness-evals/diary/wave-3-B-eval-tasks.md`. See Finding #1. |
| `git diff packages/supervisor/` | empty ✔ |
| `git diff packages/browser/` | empty ✔ |
| `git diff packages/shared/` | empty ✔ |
| `git diff apps/` | empty ✔ |
| `git diff packages/evals/src/task.ts` | empty ✔ |
| `git diff packages/evals/src/scorers/` | only whitespace reflow in `final-state.ts` (still within seed ban zone — see Finding #1) |
| `pnpm --filter @neuve/evals test` (twice) | 48/48 passed, 48/48 passed — deterministic ✔ |
| `pnpm --filter @neuve/evals typecheck` | green ✔ |
| `pnpm typecheck` (repo-wide via turbo) | only pre-existing `@neuve/sdk` playwright-types failure (`src/perf-agent.ts(17,27)` + `src/types.ts(1,51)`) — present on main, unrelated to this wave ✔ |
| `pnpm --filter @neuve/evals eval:real` | **not executed** — requires live `claude login`; the runner correctly maps the resulting auth error to `EvalRunError(cause: "agent-unauthenticated: ...")` per the diary. Runtime behavior is demonstrated by the scripted test suite instead. |
| evalite CLI arg forwarding | Read `node_modules/evalite/dist/command.js:61-90` — `commonParameters` only declares `threshold`, `outputPath`, `hideTable`, `noCache`. **There is no passthrough for `--runner=real`.** Engineer's deviation #1 is justified. |

## Findings

### [CRITICAL] Wave 3.B work mixed into Wave 3.A commit surface — `packages/evals/tasks/*.ts`, `packages/evals/tests/tasks.test.ts`, `packages/evals/evals/smoke.eval.ts`, `docs/handover/harness-evals/diary/wave-3-B-eval-tasks.md`

The seed prompt (review checklist items #6 and its parent directive "confirm exactly: `src/runners/{types,trace-recorder,real}.ts`, `tests/real-runner.test.ts`, `evals/smoke.eval.ts`, `package.json`, diary") bounds this wave tightly. The actual diff includes:

- 15 new task fixture files — `packages/evals/tasks/calibration-{1..5}-*.ts` and `packages/evals/tasks/journey-{1..10}-*.ts` — which are the Wave 3.B deliverable (task #15 in the task list, currently `in_progress`).
- `packages/evals/tests/tasks.test.ts` — +53 lines of new assertions (calibration count, journey count, perfCapture presence, perfBudget majority, 20-fixture total).
- `packages/evals/evals/smoke.eval.ts` — the new `tasks` list imports and inlines all 20 fixtures. A pure Wave 3.A smoke.eval would have touched only 5 (the existing fixtures).
- `docs/handover/harness-evals/diary/wave-3-B-eval-tasks.md` — 3.B's diary shipped in 3.A's diff.

Why it matters:
- The seed for Wave 3.A explicitly listed `packages/evals/tasks/` as "MUST be empty. Anything else → Major" and flagged repeat scope creep with a Critical-level severity prompt ("If you find ANY critical or major issue, verdict MUST be REQUEST_CHANGES").
- Mixing waves defeats the purpose of the regression-eval discipline that Wave 4.5 will exercise: if 3.A and 3.B ship in the same commit range, B1/B2 baseline reverts can't isolate the runner from the task expansion.
- The reviewer job for Wave 3.B is scheduled separately (task #15). This PR as-shipped preempts that review.

Requested action: either split the diff into two commits (3.A = runner + types + trace-recorder + 1 new test file; 3.B = tasks + tasks.test additions + diary), or restrict this PR to 3.A and move the 3.B files onto a separate branch. The `smoke.eval.ts` file needs to be decomposed — the 3.A change is the runner-select `if (selectedRunner === "real")` block, not the 20-task import list.

### [MAJOR] `process.env` raw access in `packages/evals/evals/smoke.eval.ts:71,74,80,89,90,91`

CLAUDE.md (Environment Variables section): *"Never use `process.env`. Use `Config.string` / `Config.integer` for validated config."*

```ts
const selectedRunner = (process.env["EVAL_RUNNER"] ?? "mock").toLowerCase();
// ...
const rawBackend = (process.env["EVAL_BACKEND"] ?? "claude").toLowerCase();
// ...
const rawPlanner = (process.env["EVAL_PLANNER"] ?? "frontier").toLowerCase();
// ...
traceDir: process.env["EVAL_TRACE_DIR"] ?? "evals/traces",
baseUrl: process.env["EVAL_BASE_URL"],
isHeadless: process.env["EVAL_HEADED"] !== "1",
```

All six reads bypass Effect's validated config module. Because `smoke.eval.ts` runs at module load via evalite's vitest wrapper, the engineer may have believed Effect config was unavailable — but the real-runner construction eventually runs inside `Effect.runPromise(runner.run(...))`, so the env reads can (and should) be hoisted into an `Effect.gen` that yields `Config.string("EVAL_RUNNER")` etc. and fails with a typed `ConfigError` rather than `throw new Error`.

Why it matters: this bypasses the exact validation path the CLAUDE.md rule exists to enforce. A typo'd `EVAL_BCKEND=codex` today silently defaults to claude and blows up hundreds of dollars later when the user re-reads the scoreboard thinking they benched codex.

### [MAJOR] `throw new Error` on invalid env values — `packages/evals/evals/smoke.eval.ts:76,82`

```ts
throw new Error(
  `Unsupported EVAL_BACKEND "${rawBackend}". Expected one of: ${SUPPORTED_BACKENDS.join(", ")}.`,
);
```

Effect-style validation (per CLAUDE.md) either `Effect.fail(new UnsupportedBackendError({...}))` or the `Config` module's built-in `Config.literal(...)` should have been used. Raw throws at module-load time kill the evalite process with a plain `Error` instead of producing a typed, scored-zero result via `EvalRunError`. That's the same "unrecoverable infra failure masquerades as a test crash" class of bug that the engineer consciously avoided elsewhere in `real.ts` (see `toRunError`).

### [MAJOR] `Effect.fn` + span name missing on all runtime effectful functions in `packages/evals/src/runners/real.ts`

CLAUDE.md: *"Every effectful function uses `Effect.fn` with a descriptive span name."*

| Function | Location | Current shape |
|---|---|---|
| `runRealTask` | `real.ts:162` | `(task, context) => Effect.gen(function* () { ... })` — no `Effect.fn`, no span |
| `observeEvent` | `real.ts:200` | `(event) => Effect.gen(function* () { ... })` — inline closure, no span |
| `write` | `real.ts:177` | `(event) => recorder.append(event).pipe(...)` — no span |

Compare with the codebase's approved pattern (`trace-recorder.ts:76,98` uses `Effect.fn("TraceRecorder.open")` and `Effect.fn("TraceRecorder.append")`, and the Executor itself uses `Effect.fn("Executor.execute")`). The runner is where the annotateCurrentSpan for `runner`, `taskId`, `plannerMode` should live — those are currently only in `Effect.logInfo` annotations, which don't propagate into the tracing tree for OpenTelemetry consumers. This matters when scoreboard runs are slow and the user wants to drill into "why did journey-7 take 12 minutes" — without spans the trace is flat.

### [MAJOR] Raw `try/catch` in `packages/evals/src/runners/real.ts:33-47, 55-60`

CLAUDE.md (Avoid try/catch section): *"Use Effect.try for sync and Effect.tryPromise for async."*

```ts
const extractUrlFromToolInput = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(input);
    // ...
  } catch {
    // HACK: ...
  }
  return undefined;
};

const isWellFormedToolCall = (toolName: string, input: unknown): boolean => {
  // ...
  try {
    JSON.parse(input);
    return true;
  } catch {
    return false;
  }
};
```

These helpers are pure (no Effect context needed) so the rule "pure functions stay pure" arguably exempts them. But the `HACK:` comment explicitly admits to swallowing errors — which is a defect-recovery pattern. `Schema.decodeUnknownEither(Schema.fromJsonString(Schema.Unknown))` would give a typed success/failure branch without the raw `catch {}`. At a minimum the HACK comment needs to justify why swallowing is safe for *this* call path (it does — "the recorder's raw write still captures the original args verbatim" — but that reasoning should be in the HACK block, not the prose commentary).

### [MAJOR] `as` type casts in `packages/evals/src/runners/real.ts:37,40`

CLAUDE.md: *"No type casts (`as`) unless unavoidable."*

```ts
const top = parsed as Record<string, unknown>;
// ...
const actionUrl = (action as Record<string, unknown>)["url"];
```

`Predicate.isObject` from the `effect` module returns a proper type guard without a cast. The surrounding code already uses narrow `typeof` checks — the Record cast is pure noise. Same-file line 36 already does `parsed === null || typeof parsed !== "object"` which is the Predicate.isObject pattern inlined; one import removes both casts.

### [MAJOR] `as unknown as` double-cast in `packages/evals/tests/real-runner.test.ts:262-267, 342-346`

```ts
const terminated = events[events.length - 1] as unknown as {
  type: string;
  reason: string;
  remainingSteps: number;
};
```

Same forbidden cast. The events array is `{ type: string }[]`-ish from `JSON.parse`, so just validate via `Schema.decodeUnknownSync(StreamTerminatedEvent)` (the schema already exists in `trace-recorder.ts:56-61`). The trace-recorder file exports the TS `interface` but not an `effect/Schema` class for each event — which is itself a latent gap (see suggestion below). Using a schema here would also exercise the round-trip contract the recorder is supposed to uphold, turning the test into a real byte-equivalence check.

### [MAJOR] Test stubs use partial `Agent.of({...})` with 3-method `Effect.die` fallback — `packages/evals/tests/real-runner.test.ts:136-145`

```ts
const scriptedAgentLayer = (updates: readonly AcpSessionUpdate[]) =>
  Layer.succeed(
    Agent,
    Agent.of({
      stream: () => Stream.fromIterable(updates),
      createSession: () => Effect.die("createSession not used in this test"),
      setConfigOption: () => Effect.die("setConfigOption not used in this test"),
      fetchConfigOptions: () => Effect.die("fetchConfigOptions not used in this test"),
    }),
  );
```

I verified (`grep agent\.\\w+\\(` inside `packages/supervisor/src/executor.ts`) that the Executor path only calls `agent.stream`, so the die stubs are functionally equivalent to the production path *today*. But per `feedback_no_test_only_injection_seams` — which was authored the week before this wave started — *optional fetcher props with defaults create production-vs-test divergence*. A future contributor adding, say, a `createSession` call inside `executor.execute` would pass the test suite (because `runRealTask` doesn't wire it) and immediately blow up in production with a defect.

Requested action: either (a) make the stub structurally complete by returning a plausible success shape (`createSession: () => Effect.succeed(SessionId.makeUnsafe("test"))`, `fetchConfigOptions: () => Effect.succeed([])`, etc.) so a future call silently passes in tests and production; or (b) add a `satisfies Agent.Service` (or equivalent type-level check) in a dedicated fixture helper so the shape is compile-time-guaranteed to match the real interface. Option (a) is the one Wave 2.A settled on after round 2.

### [MINOR] `EvalRunError` ID naming inconsistent with codebase conventions — `packages/evals/src/runners/types.ts:12`, `trace-recorder.ts:5`

```ts
Schema.ErrorClass<EvalRunError>("@evals/EvalRunError")
Schema.ErrorClass<TraceWriteError>("@evals/TraceWriteError")
```

Compare with `packages/supervisor/src/errors.ts`, `packages/agent/src/acp-client.ts`, etc. — these use plain class names (`"ExecutionError"`, `"AcpStreamError"`). The `@evals/` prefix is the ServiceMap convention (`"@evals/TraceRecorderFactory"` at `trace-recorder.ts:136` is correct), not the error-class convention. Not load-bearing, but inconsistent.

### [MINOR] Mutable closure state inside `Stream.runForEach` — `packages/evals/src/runners/real.ts:197-198, 263-267`

```ts
let previous: ExecutedPerfPlan | undefined;
let acc = INITIAL_ACC;

yield* stream.pipe(
  Stream.runForEach((snapshot) =>
    Effect.gen(function* () {
      const newEvents = diffEvents(previous, snapshot);
      previous = snapshot;
      // mutation inside observeEvent via `acc = { ... }`
    }),
  ),
```

`Stream.runForEach` runs its body sequentially on a single fiber, so the mutation is safe. But Effect idiom is `Stream.mapAccumEffect(initial, (acc, snapshot) => ...)` — same shape as Wave 1.B's adherence-gate implementation (`packages/supervisor/src/executor.ts` — `runFinishedSatisfiesGate` via `Stream.mapAccumEffect`). Using `Ref` or the `mapAccum` combinator removes a whole class of "did the engineer know this fiber was serial?" questions for future readers.

### [MINOR] `stream.write` resolves before the write callback fires — `packages/evals/src/runners/trace-recorder.ts:99-108`

```ts
const canContinue = stream.write(line, (error) => {
  if (error) reject(error);
});
if (canContinue) resolve();
else stream.once("drain", resolve);
```

When `canContinue === true` the promise resolves synchronously, ahead of the write callback. If the callback later fires with an error (rare on fs streams, but possible), `reject` is a no-op because the promise already settled. The test's byte-equivalence check can miss partial writes because of this. Safer pattern: resolve inside the callback, not before it. This isn't strictly needed for MVP — writes to a freshly-opened local file rarely error — but it's one of those things that bites in a CI container with a tight disk quota years from now.

### [MINOR] Explicit `recorder.close` + scope finalizer both call `stream.end()` — `packages/evals/src/runners/real.ts:304`, `trace-recorder.ts:92-96`

```ts
// runRealTask:
yield* recorder.close;  // calls stream.end(callback)

// trace-recorder.ts acquireRelease finalizer (runs at scope close):
Effect.sync(() => { current.end(); })
```

Writable streams tolerate multiple `end()` calls, so this is harmless. But the explicit `close` on the happy path makes the scope finalizer dead code on that path, which clouds the intent. If the explicit close is needed for byte-equivalence (to flush before `Effect.runPromise` resolves in tests), then the scope finalizer is redundant; if the scope finalizer suffices, the explicit close can go. Pick one.

### [INFO] `EvalRunner.run` return type cannot surface the `EvalRunError` schema tag to scoreboard consumers

The interface at `types.ts:44-47`:

```ts
export interface EvalRunner {
  readonly name: string;
  readonly run: (task: EvalTask) => Effect.Effect<ExecutedTrace, EvalRunError>;
}
```

`Effect.runPromise(runner.run(task))` rejects on `EvalRunError` — evalite's `task: async (input) => Effect.runPromise(runner.run(input.task))` at `smoke.eval.ts:154` will reject the promise and score zero for that row. That matches the diary claim ("infra failures score zero"). Good.

However the `satisfies EvalRunner` in `makeRealRunner` at `real.ts:385` only checks the shape, not the error channel — if a future runner variant returns `Effect.Effect<ExecutedTrace, EvalRunError | SomeOther>`, it'll still `satisfies` but scoreboard display for the extra error type silently mismatches. Not a blocker, just a future-watchout for Wave 3.C.

### [INFO] Event schemas in `trace-recorder.ts` are TS `interface`s, not `Schema.Class`

Lines 20-68 declare `AgentMessageEvent`, `ToolCallEvent`, etc. as plain TS interfaces instead of `Schema.TaggedStruct` or `Schema.Class`. CLAUDE.md's schema-selection table recommends `Schema.TaggedStruct` for "lightweight enum-like variants" — and these are exactly that. A schema-based definition would give the tests a `Schema.decodeUnknownSync` replay contract, remove the `as unknown as` in tests (see MAJOR finding above), and make Wave 3.C's dual-runner diff tool trivially reuse the same decoders.

Non-blocker, but worth noting because Wave 5 (distillation pipeline) is going to need exactly this decoder for teacher-data export, and shipping it now saves a rewrite later.

## Suggestions (non-blocking)

- Document the `EVAL_*` env vars in `packages/evals/README.md` (or a new file) — the diary's Wave 3.A section is the only doc, and future operators will look in the package, not the docs/handover tree.
- The `runRealTask` implementation file is 386 lines. The event-projection logic (`extractUrlFromToolInput`, `isWellFormedToolCall`, `diffEvents`, `statusMarkerForEvent`, `buildReachedKeyNodes`, `finalUrlFromReached`, `padToolCallId`, accumulator shape) is a clean standalone module. Splitting it into `src/runners/event-projection.ts` would shrink `real.ts` to pure orchestration and give 3.C a reusable projection. Not load-bearing.
- The `EvalRunError.cause` string uses informal `trace-writer: …` prefixes. A `_tag`-discriminated sub-error union (`TraceWriterFailedCause`, `AgentUnauthenticatedCause`, …) would give the scoreboard a structured way to group failures. Future work.
- Consider adding one *error-path* test: a scripted Agent that fails with `AcpProviderUnauthenticatedError` should produce `EvalRunError(cause: "agent-unauthenticated:…")` — the current 3 tests only cover projection and happy/abort paths, not error translation. The `toRunError` function at `real.ts:326` is currently untested.

## Why REQUEST_CHANGES

- The scope violation (Finding #1) alone is merge-blocking under the seed prompt's explicit check #6.
- Multiple MAJOR CLAUDE.md violations (process.env, throw, try/catch, as casts, as unknown as, missing Effect.fn spans) are independently merge-blocking per the severity table.
- The partial-stub pattern in tests (Finding #7) is the exact anti-pattern called out in `feedback_no_test_only_injection_seams.md`. The feedback memory exists precisely to catch this before it ships.

Round 2 needed. Will stay alive for engineer response.
