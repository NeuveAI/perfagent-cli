# Review: Wave 3.A — Real agent runner in evalite (Round 2)

## Verdict: REQUEST_CHANGES

9 of 10 Round-1 findings are cleanly resolved. The partition into 4 granular
commits with 3.B on separate commits is exactly what was asked for. Tests are
48/48 deterministic over two runs, typecheck is clean apart from the
pre-existing `@neuve/sdk` playwright error, and the Agent stub now uses
`satisfies AgentShape` with structurally-complete methods — the
`feedback_no_test_only_injection_seams` memory's guard shape is in place.

But the headline Round-1 fix — "move env-var parsing to `Config.*` so invalid
values fail at load time" — **does not actually validate**. The seed prompt's
verification step for Round 2 literally says *"run `EVAL_RUNNER=bogus
pnpm --filter @neuve/evals eval` — should fail with ConfigError, not silent
default"*. I ran that exact command. It silently fell through to the mock
runner and scored 60 rows. The `Config.schema(...).pipe(Config.withDefault(...))`
composition swallows **all** errors — including the schema-validation error —
and substitutes the default. This is strictly worse than the Round 1
`process.env` + `throw new Error` approach, because the old code at least
distinguished absent-env from invalid-env.

This is a merge-blocker. One commit to change the composition; round 3 should
be short.

## Verification executed

| Command | Outcome |
|---|---|
| `git log --oneline 700349f7..HEAD` | 7 commits: 4 Wave 3.A (`1c803c95`, `99c5cb54`, `4956c76b`, `fa787631`) + 3 Wave 3.B (`dd8e7266`, `5ab597d3`, `8502f510`). Clean partition. |
| `git show --stat 1c803c95 99c5cb54 4956c76b fa787631` | 3.A commits only touch `packages/evals/src/runners/{types,trace-recorder,real}.ts`, `packages/evals/evals/smoke.eval.ts`, `packages/evals/package.json`, `packages/evals/tests/real-runner.test.ts`, `pnpm-lock.yaml`. **Zero files in `packages/evals/tasks/` or `packages/evals/tests/tasks.test.ts`.** Scope hygiene ✔. |
| `git show 4956c76b -- packages/evals/evals/smoke.eval.ts` | Changes are exclusively runner-switching + Config hunks. Task-list expansion lives in `8502f510` (Wave 3.B). ✔ |
| `pnpm --filter @neuve/evals test` (run 1) | 4 files, 48 passed ✔ |
| `pnpm --filter @neuve/evals test` (run 2) | 4 files, 48 passed — deterministic ✔ |
| `pnpm --filter @neuve/evals typecheck` | green ✔ |
| `pnpm typecheck` (repo-wide) | Only pre-existing `@neuve/sdk` playwright-types failure (`src/perf-agent.ts(17,27)` + `src/types.ts(1,51)`). Unrelated. ✔ |
| `pnpm --filter @neuve/evals eval` (default, mock) | 60 evals scored (20 tasks × 3 scenarios). ✔ |
| `EVAL_RUNNER=bogus pnpm --filter @neuve/evals eval` | **Did NOT fail.** Silently fell back to `mock` runner and scored 60 rows. See Finding #1. |
| `rg 'process\.env' packages/evals/evals/smoke.eval.ts` | 0 hits ✔ |
| `rg 'throw new Error' packages/evals/evals/smoke.eval.ts` | 0 hits ✔ |
| `rg '\btry\s*\{\|\bcatch\s*\{' packages/evals/src/runners/real.ts` | 0 hits ✔ |
| `rg ' as ' packages/evals/src/runners/real.ts` | 2 hits: one in a comment ("as a standalone effect"), one legitimate `[next, [next]] as const` on the `mapAccumEffect` tuple. ✔ |
| `rg 'as unknown as' packages/evals/tests/real-runner.test.ts` | 0 hits ✔ |
| `Effect.fn("runRealTask")`, `Effect.fn("realRunner.applyExecutionEvent")`, `Effect.fn("TraceRecorder.open")`, `Effect.fn("TraceRecorder.append")`, per-event `Effect.withSpan(\`TraceEvent.write.${event.type}\`)` | All present. `annotateCurrentSpan({ runner, taskId, plannerMode })` at `real.ts:246-250`. ✔ |
| `satisfies AgentShape` via `ServiceMap.Service.Shape<typeof Agent>` | Present at `tests/real-runner.test.ts:29,155`. `createSession`, `setConfigOption`, `fetchConfigOptions` now return plausible success values (not `Effect.die`). ✔ |

## Findings

### [MAJOR] `Config.schema(...).pipe(Config.withDefault(...))` silently swallows validation errors — `packages/evals/evals/smoke.eval.ts:55-83`

The round-1 fix for "raw `process.env` + `throw new Error`" moved the three literal-validated env vars (`EVAL_RUNNER`, `EVAL_BACKEND`, `EVAL_PLANNER`) behind `Config.schema(Schema.Literals([...]), "NAME").pipe(Config.withDefault(DEFAULT))`. The intention — and the Round 1 review's explicit ask — was *"verify `Config.schema(Schema.Literals(...))` catches typos at load time"*.

I ran the exact verification command the seed prompt specified:

```bash
EVAL_RUNNER=bogus pnpm --filter @neuve/evals eval
```

Result: **no ConfigError**. The eval ran the full 60-row mock scoreboard to completion. No warning, no non-zero exit, no diagnostic — the invalid env var was silently treated as "absent" and replaced with `"mock"`.

Reproduced in isolation (`node --input-type=module -e ...` in the package dir) with `EVAL_RUNNER=bogus`:

```
exit: { _id: "Exit", _tag: "Success", value: "mock" }
```

Same behavior for `EVAL_BACKEND=bogus` → succeeds with `"claude"`.
Same behavior for `EVAL_HEADED=notabool` → succeeds with `false`.

Root cause: `Config.withDefault(x)` in Effect v4 catches *any* failure from the upstream Config — missing-env, malformed, or schema-validation — and substitutes the default. It does not distinguish "absent" from "invalid". Composing `Config.schema(...)` before `Config.withDefault(...)` therefore defeats the validation entirely.

Why it matters (exact wording from my Round 1 finding, re-confirmed here):

> A typo'd `EVAL_BCKEND=codex` today silently defaults to claude and blows up hundreds of dollars later when the user re-reads the scoreboard thinking they benched codex.

This is now actually *worse* than the Round-1 code it replaced: the old `throw new Error("Unsupported EVAL_BACKEND...")` at least distinguished the two cases (absent → default; invalid → hard fail). The new code treats both identically.

Fix sketches (any of these resolves it):

1. **Use `Config.option` instead of `Config.withDefault` + explicit default on the resolved Option.** `Config.option` gives `Option<A>` and only `Option.none` on missing; malformed env still fails.
   ```ts
   const RUNNER_CONFIG = Config.schema(Schema.Literals(["mock", "real"] as const), "EVAL_RUNNER");
   // in resolveEvalConfig:
   const runnerOpt = yield* Config.option(RUNNER_CONFIG);
   const runner = Option.getOrElse(runnerOpt, () => "mock" as const);
   ```

2. **Validate post-resolution with an explicit `Effect.fail`.** Resolve as `Config.string(...).pipe(Config.withDefault("mock"))`, then `if (!isRunner(raw)) return yield* new InvalidRunnerError(...)`. Loses the Config schema, but reinstates the validation.

3. **Check upstream.** `Config.validate` or `Config.mapAttempt` may give the right behavior in Effect v4. `effect_docs_search` for `Config.withDefault` semantics would confirm whether this is a known footgun with a documented workaround.

Whichever path, the Round 2 verification command must fail for the fix to count. The same treatment applies to `EVAL_BACKEND` and `EVAL_PLANNER`; `EVAL_HEADED` is lower severity (boolean typo is usually caught by eyeballing) but also affected.

### [MINOR] `Effect.fn("runRealTask")` span name not module-dotted — `packages/evals/src/runners/real.ts:242`

Every other span in this codebase uses the `"Module.method"` or `"module.method"` dot-prefix convention: `"Executor.execute"`, `"TraceRecorder.open"`, `"TraceRecorder.append"`, `"realRunner.applyExecutionEvent"` (same file, line 164). `runRealTask` on its own is inconsistent. Pick `"realRunner.runTask"` or similar so OpenTelemetry consumers can group spans by module.

### [MINOR] `stream_terminated` is written through `write()` but may still bypass schema-validated shape — `packages/evals/src/runners/real.ts:311`, `trace-recorder.ts:78-81`

`TraceRecorder.append(event: TraceEvent)` types `event` against the discriminated union (`TraceEventSchema`). But the schemas (`AgentMessageEvent`, `ToolCallEvent`, etc.) are declared as `Schema.Struct` with `Schema.Literal(...)` on `type`, not `Schema.TaggedStruct`. The type is satisfied structurally — so if a field is ever misspelled in the runner (e.g. `reminingSteps`), TypeScript catches it, but if a numeric is passed where a string is expected, the wire format drifts without the writer noticing. Decoding at write time (`Schema.decodeUnknownSync(TraceEventSchema)(event)` inside `append`) would turn the schema into a runtime contract.

Non-blocker — TypeScript will catch most of this statically. Just noting it because the Round 1 INFO finding about schema classes was partially addressed (schemas exist now) but the writer still trusts TS, not the schema.

### [MINOR] `toRunError` does not translate `EvalRunError` back onto the error channel — `packages/evals/src/runners/real.ts:333-339`

Cosmetic: the helper wraps a raw error-like into an `EvalRunError.asEffect()`. Fine. But the lack of an `Effect.fn`/`Effect.withSpan` around the translate path means a real production failure won't carry the `runner` + `taskId` annotations into tracing — only into the constructed error's `message`. If the scoreboard starts plotting MTTR-per-runner, spans will be the cheaper source than message parsing.

### [INFO] Error-path test coverage still missing

Round 1 suggested adding a test for the `toRunError` translation path (e.g. scripted Agent fails with `AcpProviderUnauthenticatedError` → returned `EvalRunError(cause: "agent-unauthenticated:…")`). The 3 existing tests still cover only happy/abort paths. Not a blocker — the projection logic is well-tested — but the error channel stays structurally unverified until Wave 3.C forces the issue.

### [INFO] `Effect.runSync(resolveEvalConfig)` at module-load time — `packages/evals/evals/smoke.eval.ts:104`

Not a bug per se, but the choice to run sync at module-load means a `ConfigError` (when the upstream Config composition is fixed) will surface as an uncaught exception in evalite's import path. That's the correct behavior — fail fast rather than surface a cryptic "why is EVAL_BACKEND not honored" deep in the scoreboard. Keep as-is.

## What improved since Round 1

- **CRITICAL scope creep** — fully resolved. `git show --stat` on each 3.A commit confirms zero `packages/evals/tasks/` touches. 3.B lives in `dd8e7266`, `5ab597d3`, `8502f510`.
- **`Effect.fn` span names** — added on `runRealTask`, `applyExecutionEvent`, and per-event-type `Effect.withSpan` on writes. `Effect.annotateCurrentSpan({ runner, taskId, plannerMode })` is at the top of `runRealTask`.
- **`try/catch`** — gone. `extractUrlFromToolInput` / `isWellFormedToolCall` use `Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))`. Clean.
- **`as Record<string, unknown>` casts** — gone. `Predicate.isObject` does the right narrowing. The only remaining `as` is `as const` on the `mapAccumEffect` tuple (legitimate).
- **`as unknown as` in tests** — gone. Tests decode through `Schema.decodeUnknownSync(WireStatusMarker)` / `WireStreamTerminated` / `WireEventSchema`. This round-trips the ndjson through the schema at test time, catching wire-format drift.
- **Partial Agent stub** — gone. `scriptedAgentLayer` now passes a full-shape object with `satisfies AgentShape` (`ServiceMap.Service.Shape<typeof Agent>`). A future Agent method addition will fail compilation — the invariant the `feedback_no_test_only_injection_seams` memory exists to enforce is now in place. (Verified: `createSession: () => Effect.succeed(SessionId.makeUnsafe("test-session"))`, `setConfigOption: () => Effect.succeed({})`, `fetchConfigOptions: () => Effect.succeed([])`.)
- **`@evals/` prefix on error classes** — dropped. `TraceWriteError` and `EvalRunError` now use plain class-name identifiers (`"TraceWriteError"`, `"@evals/EvalRunError"` — wait, the latter still has it).

  Actually rechecking: `types.ts:12` still reads `Schema.ErrorClass<EvalRunError>("@evals/EvalRunError")`. `trace-recorder.ts:5` was fixed to `"TraceWriteError"` without the prefix. Inconsistency is trivially cosmetic but worth the tiny polish.
- **Double-close + write-callback race** — both fixed cleanly in `trace-recorder.ts:103-107` (scope-finalizer now awaits the `end` callback via `Effect.callback`) and `113-122` (resolve inside the write callback, not before). These were MINOR in Round 1 and are now resolved.
- **Mutable closure state in `Stream.runForEach`** — replaced with `Stream.mapAccumEffect` + `Stream.runFold` (`real.ts:276-292`). State is now immutable in each step. Clean.
- **Schema-based wire-event definitions** — `trace-recorder.ts:17-76` now has `AgentMessageEvent`, `ToolCallEvent`, `ToolResultEvent`, `StatusMarkerEvent`, `StreamTerminatedEvent` as `Schema.Struct`, plus a `TraceEventSchema` union. The MINOR Round-1 ask ("interfaces, not schemas") is resolved — and the tests immediately leverage the decoders.

## Suggestions (non-blocking)

- Round-3 fix should consider `effect_docs_search "Config.validate"` or `"Config.withDefault semantics"`. There may be a first-class Effect idiom for "default if absent, fail if malformed" that I'm missing.
- Once the Config bug is fixed, add a one-line test that runs `Effect.runSyncExit(resolveEvalConfig)` under `EVAL_RUNNER=bogus` (`process.env["EVAL_RUNNER"] = "bogus"` in a `beforeEach`, restore in `afterEach`) and asserts the exit is `Failure`. That freezes the validation contract in the suite.
- `EvalRunError._tag` identifier polish (`"@evals/EvalRunError"` → `"EvalRunError"` to match `TraceWriteError`). Trivial.

## Why REQUEST_CHANGES

- Finding #1 (Config validation bypass) is MAJOR under the severity table: *"missing error handling"* applies directly. The seed prompt's explicit Round-2 verification command produces the wrong outcome.
- It's also a regression from the Round 1 code on the specific dimension the Round 1 fix was supposed to improve (validation of literal env values).

Everything else is resolved. One commit to fix the Config composition, re-run `EVAL_RUNNER=bogus pnpm eval` to confirm it errors, and Round 3 should APPROVE.

Staying alive for Round 3.
