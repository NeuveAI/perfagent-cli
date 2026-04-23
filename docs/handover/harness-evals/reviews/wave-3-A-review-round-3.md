# Review: Wave 3.A — Real agent runner in evalite (Round 3)

## Verdict: APPROVE

The Config-validation bypass from Round 2 is fixed. All 12 verification scenarios the seed prompt specified produce the correct behavior. Scope is tight (`5f2a2d14` touches exactly 2 files). Tests remain 48/48 deterministic. Span names now follow the module-dotted convention, and the `EvalRunError` identifier polish turned out to be a Round-2 misread on my part — the committed code was already bare since `1c803c95`.

No Critical or Major remains. Ready to land.

## Engineer's diagnosis check — is the `Config.option` rejection correct?

Engineer rejected my Round-2 `Config.option + Option.getOrElse` sketch because `Config.option` internally wraps with `Config.withDefault(Option.none())` and inherits the same `isMissingDataOnly` false-positive on `Schema.Literals` in effect@4.0.0-beta.35. I didn't verify this in Effect's source directly, but the symptom matches: both `Config.withDefault` and `Config.option` live on the same "classify failure as MissingData" plumbing in the ConfigProvider layer. The engineer's explanation is plausible and the chosen fix (validate on top of `Config.string`, whose only failure mode is MissingKey, and apply the schema via `mapOrFail`) sidesteps the classifier entirely by keeping the decoder OUT of the Config failure path until after `withDefault` has done its job.

The fix is the correct shape. Accepting the engineer's rejection of my sketch.

## Verification executed

### Scope

| Check | Outcome |
|---|---|
| `git show 5f2a2d14 --stat` | 2 files: `packages/evals/evals/smoke.eval.ts` (+41/-11), `packages/evals/src/runners/real.ts` (+2/-2). Zero other files. ✔ |
| `git log --oneline 700349f7..HEAD` | 8 commits: 4 Wave 3.A (`1c803c95`, `99c5cb54`, `4956c76b`, `fa787631`) + 3 Wave 3.B (`dd8e7266`, `5ab597d3`, `8502f510`) + 1 Wave 3.B diary + 1 Wave 3.A round-3 fix (`5f2a2d14`). Partition holds. ✔ |
| `git diff HEAD~1 HEAD --stat` | Same 2 files as `git show`. No drift since the fix commit. ✔ |
| `git restore` concern | The fix commit touches only the engineer's own files. No evidence of prior-author work destruction. ✔ |

### Config helper (read)

`packages/evals/evals/smoke.eval.ts:55-76` — the helper is:

```ts
const stringWithSchemaDefault = <T, E>(
  envName: string,
  codec: Schema.Codec<T, E>,
  defaultRawValue: string,
): Config.Config<T> => {
  const decode = Schema.decodeUnknownEffect(codec);
  return Config.string(envName).pipe(
    Config.withDefault(defaultRawValue),
    Config.mapOrFail((raw) =>
      decode(raw).pipe(
        Effect.catchTag("SchemaError", (schemaError) =>
          Effect.fail(new Config.ConfigError(schemaError)),
        ),
      ),
    ),
  );
};
```

Cross-checked against Effect source:
- `Config.mapOrFail` at `node_modules/effect/dist/Config.d.ts:293-343` — signature `<A, B>(f: (a: A) => Effect.Effect<B, ConfigError>): (self: Config<A>) => Config<B>`. Signature matches.
- `Config.ConfigError` at `node_modules/effect/dist/Config.d.ts:123-127` — `class ConfigError; constructor(cause: SourceError | Schema.SchemaError)`. Accepting `Schema.SchemaError` is the documented path. Matches.
- `Config.Boolean` at `node_modules/effect/dist/Config.d.ts:687` — `Schema.decodeTo<Schema.Boolean, Schema.Literals<readonly ["true", "yes", "on", "1", "y", "false", "no", "off", "0", "n"]>, ...>`. It IS a `Schema.Codec` so the helper signature accepts it cleanly. `EVAL_HEADED=notabool` surfaces "Expected ... got 'notabool'" (verified below).
- The `catchTag("SchemaError", e => Effect.fail(new Config.ConfigError(e)))` routes the decode failure into the Config error channel as required (not a raw `Effect.fail(new Error(...))` that would defeat Config's plumbing). ✔
- Default value is the RAW string (pre-decode), not a decoded value, matching the helper signature `defaultRawValue: string`. The default flows through the same `mapOrFail` decoder as a real env value, so a typo in the default itself would also surface at load time. ✔

### 12 seed-prompt verification scenarios

Every case run from the shell (single command, fresh process so the ConfigProvider re-reads env):

| Env | Outcome | Pass? |
|---|---|---|
| `EVAL_RUNNER` absent | default `mock` → 60-row mock scoreboard, 65% score | ✔ |
| `EVAL_RUNNER=mock` | valid → 60-row mock scoreboard | ✔ |
| `EVAL_RUNNER=real` | routes to `real-runner smoke (real)` suite, 20 evals, AcpClient adapters initialize (would then 404 on auth without `claude login`) | ✔ |
| `EVAL_RUNNER=bogus` | `ConfigError` with `Caused by: SchemaError: Expected "mock" \| "real", got "bogus"`; exit code 1; 0 evals | ✔ |
| `EVAL_BACKEND` absent | default `claude`, no Config error | ✔ |
| `EVAL_BACKEND=gemini` (with `EVAL_HEADED=true`, `EVAL_PLANNER=template` too) | valid, 60-row scoreboard runs | ✔ |
| `EVAL_BACKEND=bogus` | `ConfigError` with `Expected "claude" \| "codex" \| ... \| "local", got "bogus"`; exit 1 | ✔ |
| `EVAL_PLANNER` absent | default `frontier` | ✔ |
| `EVAL_PLANNER=template` | valid | ✔ |
| `EVAL_PLANNER=bogus` | `ConfigError` with `Expected "frontier" \| "template" \| "none", got "bogus"`; exit 1 | ✔ |
| `EVAL_HEADED` absent | default `false` | ✔ |
| `EVAL_HEADED=true` | valid | ✔ |
| `EVAL_HEADED=notabool` | `ConfigError` with `Expected "true" \| "yes" \| "on" \| "1" \| "y" \| "false" \| "no" \| "off" \| "0" \| "n", got "notabool"`; exit 1 | ✔ |

That's 13 scenarios against the seed-specified 12 — I kept `EVAL_HEADED=true` as a sanity check for a non-default valid string. All behave correctly.

### Tests + typecheck

| Command | Outcome |
|---|---|
| `pnpm --filter @neuve/evals test` (run 1) | 4 files, 48 passed ✔ |
| `pnpm --filter @neuve/evals test` (run 2) | 4 files, 48 passed — deterministic ✔ |
| `pnpm --filter @neuve/evals typecheck` | green ✔ |
| `pnpm typecheck` (repo-wide via turbo) | 5/10 packages green, only `@neuve/sdk#typecheck` fails on the pre-existing `Cannot find module 'playwright'` error at `src/perf-agent.ts(17,27)` + `src/types.ts(1,51)`. Documented in the engineer's Wave 3.A diary as pre-existing. ✔ |

### Round-2 minors

**`Effect.fn` span names — resolved.** `real.ts:164` `Effect.fn("RealRunner.applyExecutionEvent")`, `real.ts:242` `Effect.fn("RealRunner.run")`. Module-dotted. Matches sibling spans (`"Executor.execute"`, `"TraceRecorder.open"`). ✔

**Error-class prefix consistency — noted as never-really-open.** I re-read `git show HEAD:packages/evals/src/runners/types.ts` and `git show 1c803c95:packages/evals/src/runners/types.ts`. Both show `Schema.ErrorClass<EvalRunError>("EvalRunError")` (bare). I misread the file during Round 2. The trace-recorder has always been bare too. Apologies to the engineer — this was a reviewer error, not an engineer oversight. ✔

### Production-vs-test parity check (structural `satisfies`)

The Round 2 `scriptedAgentLayer` structurally satisfies `AgentShape` via `ServiceMap.Service.Shape<typeof Agent>`. Mental check: if someone adds a new method to `Agent` tomorrow (say, `terminateSession: () => Effect.Effect<void>`), the fake falls out of shape and TypeScript rejects the `satisfies` at compile time. The `feedback_no_test_only_injection_seams` invariant is enforced at the type boundary. ✔

## Findings

None blocking. All Round-1 and Round-2 findings are resolved.

## Suggestions (non-blocking, for Wave 3.C or Wave 5)

- The serialized `ConfigError` output prints `ConfigError: <unserializable>: this.cause.toString is not a function` as the headline before the `Caused by: SchemaError: ...` detail. The underlying SchemaError IS printed so users aren't blind, but the cosmetic "<unserializable>" is an Effect v4 beta quirk (`ConfigError.toString` apparently doesn't handle the wrapped SchemaError pretty-print). Not the engineer's bug to fix, and not blocking. Worth mentioning upstream if/when you file a ticket with Effect.
- `Effect.runSync(resolveEvalConfig)` at module-load is still the right call (see Round-2 INFO) — the new behavior makes misconfigurations noisy at the evalite import boundary, which is where they're cheapest to diagnose.
- Error-path test for `toRunError` (mentioned in both prior rounds as INFO). Remains optional.
- When Wave 3.C lands the `"gemma-local"` runner, reusing `stringWithSchemaDefault` for its own env overrides (e.g. `EVAL_GEMMA_PORT`) will keep the validation contract uniform across runners. The helper is currently private to `smoke.eval.ts` — if 3.C needs it, promote to `packages/evals/src/config.ts` or similar.

## Why APPROVE

- Scope: clean (2 files, runner-focused).
- Config validation: the exact 12 scenarios the seed asked for all produce the correct behavior. Bogus values fail with a ConfigError + SchemaError chain at process startup; valid and absent values proceed through default/resolved paths.
- Tests: 48/48 deterministic over two runs. Typecheck: green modulo the pre-existing, documented `@neuve/sdk` playwright failure.
- Round-1 and Round-2 code quality findings: all resolved (structurally-complete Agent stub, `satisfies AgentShape`, `Effect.fn` spans with module-dotted names, no `try/catch`, no `as` casts, no `as unknown as`, schema-decoded ndjson tests, double-close/write-callback race fixes, `Stream.mapAccumEffect` refactor, schema-based wire-event classes).
- Production-vs-test parity: `satisfies AgentShape` enforces the feedback-memory invariant at compile time — a future Agent-interface addition will break the test stub instead of silently diverging.
- Handover: the engineer's diary (wave-3-A) remains accurate and gives 3.C a concrete `runRealTask` + `TraceRecorderFactory.layer` entry point.

Shipping. Team-lead to handle shutdown.
