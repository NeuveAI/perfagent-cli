# Wave 3.C — Gemma dual-runner via @neuve/local-agent (diary)

## Summary

Added a Gemma-specific `EvalRunner` that drives `@neuve/local-agent` (Gemma 4
E4B via Ollama) through the same supervisor pipeline as Wave 3.A's real
runner, and a dual-runner orchestrator that runs Claude + Gemma side-by-side
on the same 20 tasks so the scoreboard shows both models' scores for a direct
Δ comparison. Trace files share the `evals/traces/` directory and the Wave
0.A ndjson schema, so replay + distillation tooling (Wave 5) consumes them
identically.

## Files added / changed

```
packages/evals/
  src/runners/
    gemma.ts                  # NEW — makeGemmaRunner: Agent.layerLocal + ConfigProvider overlay + runRealTask reuse
    dual.ts                   # NEW — makeDualRunner (primary + secondary pair) + runDualSequential helper
  evals/smoke.eval.ts         # EXTENDED — EVAL_RUNNER union +gemma +dual;
                              #            EVAL_GEMMA_MODEL, EVAL_OLLAMA_URL,
                              #            EVAL_GEMMA_PLANNER Config entries;
                              #            registerRunnerSuite helper; two
                              #            evalite suites for dual mode
  tests/gemma-runner.test.ts  # NEW — trace schema/naming + dual orchestration
```

Nothing in `packages/supervisor/`, `packages/browser/`, `packages/shared/`,
`packages/agent/`, `packages/local-agent/`, or any app was modified. Wave 3.B's
20-task fixture set is consumed unchanged via the existing `tasks` list in
`smoke.eval.ts`.

## Architecture

```
makeGemmaRunner()
└─ runRealTask(task, context).pipe(
     Effect.provide(runtimeLayer),          # Executor + Git + TraceRecorderFactory + Agent.layerLocal
     Effect.provide(configProviderLayer),   # ConfigProvider overlay: PERF_AGENT_LOCAL_MODEL, PERF_AGENT_OLLAMA_URL
     Effect.catchTags({ ... → EvalRunError }),
   )
```

`Agent.layerLocal` (shipped by @neuve/agent) spawns the local-agent binary
over stdio and already performs its own Ollama preflight at layer-build time
(`packages/agent/src/acp-client.ts:564-618`):

1. `GET /api/version` → `AcpConnectionInitError` if Ollama is unreachable,
   with message "Ollama is not running. Start it with `ollama serve` …"
2. `GET /api/tags` → `AcpConnectionInitError` if model list fails
3. Model presence check → `AcpConnectionInitError` with message `Model "<x>"
   not found … Run \`ollama pull <x>\` …`

The Gemma runner relies on this single source of truth and translates
`AcpConnectionInitError` into `EvalRunError(cause: "agent-connection-init: <message>")`
via the existing `catchTags` block. The eval scoreboard shows the remediation
text the same way `perf-agent -a local` shows it to CLI users.

## Config threading without `process.env`

`AcpAdapter.layerLocal` reads the model + base URL via
`Config.string("PERF_AGENT_LOCAL_MODEL")` and `Config.string("PERF_AGENT_OLLAMA_URL")`.
The Gemma runner needs to override these per-runner without mutating the
shared process environment.

The solution uses `ConfigProvider.fromUnknown` + `ConfigProvider.layerAdd({ asPrimary: true })`:

```ts
const gemmaConfigOverlay = ConfigProvider.fromUnknown({
  PERF_AGENT_LOCAL_MODEL: model,
  PERF_AGENT_OLLAMA_URL: baseUrl,
});
const configProviderLayer = ConfigProvider.layerAdd(gemmaConfigOverlay, {
  asPrimary: true,
});
```

`layerAdd(..., { asPrimary: true })` installs the overlay as the primary
provider and demotes the default `fromEnv()` provider to fallback. Because
the overlay layer is applied as a scoped `Effect.provide` around
`runRealTask`, the override is runner-scoped: no global mutation, no cross-
test contamination, works identically for concurrent dual-runner fibers.
`AcpAdapter.layerLocal`'s `Config.string(...)` reads resolve through the
overlay first and fall through to `fromEnv()` for anything not declared.

## Dual-runner orchestration

Evalite emits one score per task per registered suite
(`node_modules/evalite/dist/evalite.js:97`: `export const evalite = (evalName, opts) => registerEvalite(evalName, opts)`), so "dual mode" cannot be a single runner that returns two traces. The cleanest
shape is two side-by-side suites:

```ts
// smoke.eval.ts, EVAL_RUNNER=dual
const primary   = makeRealRunner("real",  evalConfig.realOptions);
const secondary = makeGemmaRunner(evalConfig.gemmaOptions);
const dual      = makeDualRunner(primary, secondary);
registerRunnerSuite(dual.primary,   `dual-runner smoke [primary ${dual.name}]`);
registerRunnerSuite(dual.secondary, `dual-runner smoke [secondary ${dual.name}]`);
```

Evalite renders two scoreboards — one per model — and the trace files
`real__<taskId>.ndjson` + `gemma__<taskId>.ndjson` sit in the same
`evals/traces/` directory for the Wave 5 distillation pipeline and a follow-
up Δ report (Wave 4.5) to pair up.

`makeDualRunner` returns a `DualRunner` struct (`{primary, secondary, name}`)
rather than a merged `EvalRunner` because fusing into one `run()` would force
evalite to pick one score — defeating the purpose. `runDualSequential` is an
ad-hoc in-memory helper (primary then secondary) for scripts that want both
traces in one promise; it's NOT used in evalite's pipeline.

## Config surface (smoke.eval.ts)

All entries go through the `stringWithSchemaDefault` helper (the
Config-withDefault-over-schema trap is documented in Wave 3.A round 2).
Union validation failures surface as typed `ConfigError`s at module load —
`EVAL_RUNNER=bogus` → immediate fail-fast.

| Var | Default | Schema | Meaning |
|---|---|---|---|
| `EVAL_RUNNER` | `mock` | `"mock"\|"real"\|"gemma"\|"dual"` | Suite to register |
| `EVAL_BACKEND` | `claude` | `"claude"\|...\|"local"` | Real-runner agent backend (unchanged) |
| `EVAL_PLANNER` | `frontier` | `"frontier"\|"template"\|"none"` | Real-runner planner mode (unchanged) |
| `EVAL_TRACE_DIR` | `evals/traces` | `string` | Shared across runners (unchanged) |
| `EVAL_HEADED` | `false` | `Config.Boolean` | Shared across runners (unchanged) |
| `EVAL_GEMMA_MODEL` | `gemma4:e4b` | `string` | **NEW** — Ollama model tag; flows into AcpAdapter via ConfigProvider overlay |
| `EVAL_OLLAMA_URL` | `http://localhost:11434/v1/` | `string` | **NEW** — Ollama API base; flows in the same way |
| `EVAL_GEMMA_PLANNER` | `template` | `"frontier"\|"template"\|"none"` | **NEW** — Gemma-specific planner (defaults to template since 4B collapses frontier JSON round-trip) |

## SchemaError catchTag omission — justification

Sibling `real.ts` catches `SchemaError` because `Agent.layerClaude` decodes
JSON inside its auth-check path (`packages/agent/src/acp-client.ts:266`).
`Agent.layerLocal` does not decode JSON — the Ollama preflight uses
`Effect.tryPromise` with a plain `fetch().json()`, not `Schema.decodeEffect`.
TypeScript confirms this at compile time: adding `SchemaError: toError("schema")`
to the Gemma runner's `catchTags` fails with "Type '...Effect<never, EvalRunError, never>' is not assignable to type 'never'" — the tag isn't in the
error union, so the catch branch is dead code.

If a future refactor adds `Schema.decodeEffect` to `Agent.layerLocal` (or
any layer the Gemma runner depends on), the error union will expand and
TypeScript will force the catchTag to be added at that site. The Gemma
runner stays honest about the errors it actually handles today.

## DoD evidence

| DoD | Status |
|---|---|
| `pnpm --filter @neuve/evals test` — all tests green | ✔ 50/50 passing (48 pre-existing + 2 new: trace-projection + dual orchestration) |
| `pnpm --filter @neuve/evals typecheck` green | ✔ tsgo --noEmit clean |
| `pnpm --filter @neuve/evals eval` default (mock) unchanged | ✔ 60 rows emitted, scoreboard identical to Wave 3.A |
| `EVAL_RUNNER=gemma pnpm --filter @neuve/evals eval` with Ollama running + model pulled | **manual-smoke-pending** on this env (no local Ollama). Round-1 reviewer ran against real Ollama with `gemma4:e4b` — preflight correctly detected missing model and emitted structured errors for all 20 tasks. With the round-2 default alignment (`gemma4:e4b`), a `pnpm eval` with `EVAL_RUNNER=gemma` on a correctly-provisioned box should pass preflight. |
| `EVAL_RUNNER=dual` emits two sets of scores | ✔ wiring verified via unit test (`dual runner orchestration`); suite registration pattern confirmed by evalite source (`registerEvalite(evalName, opts)` per-suite) |
| Pre-flight failure → structured error, NOT a crash | ✔ via `AcpConnectionInitError → EvalRunError` translation; the CLI uses the same error surface so no eval-specific behavior divergence |
| `EVAL_RUNNER=bogus` → ConfigError (fail-fast) | ✔ confirmed — `SchemaError: Expected "mock" \| "real" \| "gemma" \| "dual", got "bogus"` ; exit code 1 before any suite registers |
| Trace ndjson Wave 0.A schema-compatible | ✔ test `writes a gemma__<task-id>.ndjson trace with the Wave 0.A schema` replays the same `TraceEventSchema` decoder the real runner uses |
| Trace file naming `gemma__<task-id>.ndjson` | ✔ explicit assert in the same test |

## Round 2 response (post-reviewer round 1)

### MAJOR #1 — Model default mismatch (gemma3n:e4b → gemma4:e4b)

Changed `GEMMA_DEFAULT_MODEL` from `"gemma3n:e4b"` to `"gemma4:e4b"` in
`gemma.ts`. Also updated `GEMMA_MODEL_CONFIG` default in `smoke.eval.ts`.
Grepped the codebase: only references to `gemma3n:e4b` in this patch set are
now in the review/diary docs; all code uses `gemma4:e4b` consistently with
`packages/local-agent/src/ollama-client.ts:5`, `packages/agent/src/acp-client.ts:557`,
`.specs/local-gemma4-agent.md`, and `apps/cli/README.md`. The `plan.md`
"Gemma 3n E4B" naming is left to a separate doc-alignment follow-up as the
reviewer suggested.

### MAJOR #2 — Delete gemma-preflight.ts

`packages/evals/src/runners/gemma-preflight.ts` deleted (the file, its
`GemmaPreflight` service, its `GemmaPreflightError`, its `preflightLayer?`
option on `GemmaRunnerOptions`, and all preflight-specific tests). The runner
now relies entirely on `AcpAdapter.layerLocal`'s built-in preflight (which
performs the identical `/api/version` + `/api/tags` + model-match checks and
emits `AcpConnectionInitError` with the same actionable remediation text).

HTTP call count per task: **2** (down from 4). Single source of truth
restored.

### MAJOR #3 — Replace `process.env` mutation with `ConfigProvider` overlay

`applyGemmaEnvDefaults` (the banned `process.env` writer) is gone. Replaced
with a runner-scoped `ConfigProvider.layerAdd(gemmaConfigOverlay, { asPrimary: true })`
applied as a `Effect.provide(configProviderLayer)` around `runRealTask`.
This threads `PERF_AGENT_LOCAL_MODEL` + `PERF_AGENT_OLLAMA_URL` through
Effect's Config system so `AcpAdapter.layerLocal` reads them from the
overlay first and falls through to `fromEnv()` for anything not declared.

Zero `process.env` reads, zero `process.env` writes, zero cross-test
contamination. The reviewer's concern about `makeGemmaRunner({ model: "gemma3n:custom" })`
leaking state into later tests is structurally eliminated — the overlay
layer is a pure value and only takes effect inside the Effect chain it's
provided to.

### MAJOR #4 — SchemaError catchTag

See "SchemaError catchTag omission — justification" section above. The tag
is **not in the runner's error union** (TypeScript compile check confirms
this). Adding it creates a `never` slot in `catchTags` and fails
typechecking. If the pipeline ever starts emitting SchemaError, TypeScript
will force the catch — so this is a type-safe omission, not a blind hole.

### MINOR #1 — Dead-code `GEMMA_MODEL_CONFIG` in gemma-preflight.ts

Resolved naturally by deleting `gemma-preflight.ts` entirely.

### MINOR #2 — Diary claim about 3.A pattern

With the `preflightLayer?` seam gone (Finding #2), the injection-seam
discussion is moot. The runner has zero injection options on
`GemmaRunnerOptions` now — tests exercise `runRealTask` directly with their
own `buildTestLayer`, same as Wave 3.A's real-runner tests.

### MINOR suggestion — span annotations at top of `run`

Added `yield* Effect.annotateCurrentSpan({ runner: runnerName, taskId, model, plannerMode })`
at the top of the `run` effect, matching real.ts's annotation discipline at
`real.ts:246-250`. Still under the `Effect.withSpan("GemmaRunner.run")`
wrapper.

### MINOR suggestion — translate helper duplication

The byte-identical `toRunError` / `translate` helper in `real.ts` is left
intact. Not extracted to a shared module this wave — scope said "ONLY
packages/evals/src/runners/" which is where both copies already live, and
the helper is small (6 lines). A future refactor can consolidate it when a
third consumer appears (e.g. an Online-Mind2Web runner in Wave 4). Flagged
here so reviewer sees the conscious defer.

## Round 2 verification commands run

```
pnpm --filter @neuve/evals typecheck   # green (tsgo --noEmit)
pnpm --filter @neuve/evals test        # 50/50 passing
pnpm --filter @neuve/evals eval        # default mock, 60 rows, identical to baseline
EVAL_RUNNER=bogus pnpm --filter @neuve/evals eval   # ConfigError + exit 1
```

`pnpm check` still fails with the same unrelated pre-existing oxlint config
error (`vite.config.mjs must wrap default export with defineConfig() from
"oxlint"`) flagged in round 1 — not introduced or affected by this wave.
Formatting applied to new files via `pnpm format`.

## Handover notes for Wave 4

- `evals/traces/gemma__*.ndjson` now co-exists with `real__*.ndjson` in the
  same directory. A Wave 4.5 regression-diff script should read both and
  compute per-task Δ by matching trailing `__<taskId>.ndjson` suffixes.
- `EVAL_GEMMA_MODEL` flows through `ConfigProvider.layerAdd` — any future
  code that needs to introspect the active model should prefer reading
  `Config.string("PERF_AGENT_LOCAL_MODEL")` from within an Effect provided
  with the Gemma runner's `configProviderLayer`, rather than re-plumbing a
  separate channel.
- The `runDualSequential` helper in `dual.ts` is NOT used by evalite today
  — it exists for standalone comparison scripts (Wave 5's distillation
  "teacher sample generator" may want to drive Claude + Gemma on a single
  prompt and emit a paired training row).
- If `packages/agent/src/acp-client.ts:557`'s default `gemma4:e4b` changes
  (e.g. Gemma 5 lands), update `GEMMA_DEFAULT_MODEL` in
  `packages/evals/src/runners/gemma.ts` to stay consistent. Both sources of
  truth share the same value today by convention, not by import.
