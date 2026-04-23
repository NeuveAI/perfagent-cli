# Wave 3.A — Real agent runner in evalite (diary)

## Summary

Wired a real-agent runner into `@neuve/evals` that drives the full supervisor
pipeline (`PlanDecomposer` → `Executor.execute` → chrome-devtools-mcp tool
registry) against every `EvalTask` and tees events into both a Wave 0.A–schema
ndjson trace file and an in-memory `ExecutedTrace` for the scorers. The mock
runner path is preserved; runner selection happens via environment variables at
eval startup.

## Files added / changed

```
packages/evals/
  src/runners/
    types.ts              # EvalRunner contract + EvalRunError (shared with Wave 3.C)
    trace-recorder.ts     # ndjson writer conforming to evals/traces/README.md
    real.ts               # runRealTask(runEffect) + makeRealRunner(EvalRunner)
  evals/smoke.eval.ts     # switches between mock and real at import time via EVAL_RUNNER env
  tests/real-runner.test.ts  # 3 new tests exercising projection + trace conformance
  package.json            # eval:real script + @neuve/agent/shared/supervisor workspace deps
```

Nothing in `packages/supervisor/`, `packages/browser/`, `packages/shared/`, or
any app was modified. Wave 3.B's expanded task list is picked up automatically
because the runner iterates `tasks` from `smoke.eval.ts`.

## EvalRunner interface contract

```ts
export interface EvalRunner {
  readonly name: string;
  readonly run: (task: EvalTask) => Effect.Effect<ExecutedTrace, EvalRunError>;
}
```

Documented in `src/runners/types.ts`:

- `name` is a short stable identifier used for trace filenames, logs, and
  scoreboard columns. Must be unique per runner implementation (`"mock"`,
  `"real"`, `"gemma-local"` in 3.C).
- `run(task)` MUST resolve to an `ExecutedTrace` on *any* task outcome —
  success, partial, or the agent gave up. The only acceptable failure channel
  is `EvalRunError` for unrecoverable orchestration problems (trace writer
  failed, agent adapter missing, git repo root unreachable).
- Per-task agent mistakes are NOT errors — they get scored zeros by the four
  scorers on the returned `ExecutedTrace`.
- Runners that persist traces MUST write ndjson matching the Wave 0.A schema
  from `evals/traces/README.md`. The `ExecutedTrace` returned to the harness is
  an in-memory projection of that trace, tailored to what the scorers need.
- Runners are expected to drive the full harness pipeline (plan decomposition,
  adherence gate, interaction tools) end-to-end without shortcuts — no
  site-specific heuristics encoded inside the runner.

Wave 3.C's gemma runner implements this same interface; switching runners is a
matter of picking a different implementation at eval startup.

## Trace-recorder schema conformance

`src/runners/trace-recorder.ts` writes one JSON object per line matching
`evals/traces/README.md` exactly. Event types emitted:

| Event | Fields | When |
|---|---|---|
| `agent_message` | `ts`, `turn`, `content` | Per `AgentText` / `AgentThinking` block from the executor stream |
| `tool_call` | `ts`, `turn`, `id` (`tc-000`, `tc-001`, …), `name`, `args` | Per `ToolCall` event |
| `tool_result` | `ts`, `id`, `result`, `ok` | Per `ToolResult` event — id pairs with the most recent `ToolCall` |
| `status_marker` | `ts`, `marker`, `payload` | Per `StepStarted`/`StepCompleted`/`StepFailed`/`StepSkipped`/`RunFinished` event |
| `stream_terminated` | `ts`, `reason` (`run_finished:passed`\|`run_finished:failed`\|`stream_ended`), `remainingSteps` | Always last line |

File layout: `<traceDir>/<runner>__<taskId>.ndjson` (filenames are
regex-sanitized to `[a-zA-Z0-9_.-]`). Traces live in `evals/traces/` by default
but are overridable via `EVAL_TRACE_DIR` for CI sandboxing and in tests.

The tests verify:
1. Every line is valid JSON (replay byte-equivalence contract).
2. The ordered event types include at least one of each expected kind.
3. The final line is always `stream_terminated` with a matching
   `run_finished:*` or `stream_ended` reason.
4. `remainingSteps` reflects pending/active plan steps at termination time.

## Pipeline wiring (no bypasses)

`makeRealRunner` constructs the production layer stack:

```
runtimeLayer
= mergeAll(
    Executor.layer  ← provide(Git.withRepoRoot(rootDir), PlanDecomposer.layer),
    Git.withRepoRoot(rootDir),    # re-merged so Executor methods can resolve GitRepoRoot
    TraceRecorderFactory.layer,
  ).pipe(provideMerge(Agent.layerFor(backend)))
```

- `PlanDecomposer.layer` carries its own `PlannerAgent.layerFromGemini` (unchanged from Wave 1.A).
- `Executor.layer` transparently uses the Wave 1.B adherence gate (`runFinishedSatisfiesGate`) — the runner consumes the published `execute()` API and doesn't touch executor internals.
- Agent backend defaults to `claude` (configurable via `EVAL_BACKEND`).
- Planner mode defaults to `frontier` (configurable via `EVAL_PLANNER`).
- The chrome-devtools-mcp subprocess is spawned by `AcpClient.buildMcpServers` the same way it is for production `perf-agent` runs — so Wave 2.A interaction tools and Wave 2.C SOM hook the agent automatically via `browser-mcp.js`.

Nothing in the runner encodes site-specific knowledge. Reasoning stays in
`@neuve/agent` + the `buildExecutionSystemPrompt()` rewrite from Wave 2.B.

## Event projection for scorers

`ExecutedTrace` is populated from the streamed `ExecutedPerfPlan` snapshots by
diffing the `events` array each tick:

- **`reachedKeyNodes`** — derived from the URLs seen in `ToolCall` inputs
  (regex match or exact equality against the task's expected `urlPattern`,
  mirroring mock semantics documented in Wave 0.B diary).
- **`toolCalls`** — one entry per `ToolCall` event, with `wellFormed = true`
  iff `toolName` is non-empty and `input` JSON-parses. The call id is also
  stashed in `arguments.id` so a later 3.C dual-runner diff can pair calls
  across runs.
- **`finalUrl`** — the last URL observed in a navigate-style `ToolCall`.
- **`finalDom`** — the last `RunFinished` summary, used by the `final-state`
  scorer. `""` if no `RunFinished` ever fired.

## Runner selection at eval startup

`smoke.eval.ts` reads `EVAL_RUNNER` (`mock` default; `real` to activate) at
module load time and declares either a `mock-runner smoke` or
`real-runner smoke (real)` suite — never both, so evalite's scoreboard is
unambiguous.

Environment variables:

| Var | Default | Meaning |
|---|---|---|
| `EVAL_RUNNER` | `mock` | `mock` or `real` |
| `EVAL_BACKEND` | `claude` | `claude` / `codex` / `gemini` / `local` / … (only real) |
| `EVAL_PLANNER` | `frontier` | `frontier` / `template` / `none` (only real) |
| `EVAL_TRACE_DIR` | `evals/traces` | Output dir for ndjson traces |
| `EVAL_BASE_URL` | (unset) | Optional base URL forwarded to the Executor |
| `EVAL_HEADED` | unset (headless) | `1` runs headed |

Added `pnpm --filter @neuve/evals eval:real` as a convenience script that
presets `EVAL_RUNNER=real`.

## Test summary

```
packages/evals — 4 files, 48 tests passing
  scorers.test.ts      — 17 tests (unchanged)
  tasks.test.ts        — 25 tests (unchanged)
  mock-runner.test.ts  — 3 tests (unchanged — mock runner path is intact)
  real-runner.test.ts  — 3 tests (new)
```

The new tests exercise `runRealTask` with a fully scripted Agent layer,
stub Git, and deterministic PlanDecomposer (same pattern used by
`packages/supervisor/tests/executor-adherence-gate.test.ts`). No real
browser/network is spun up. The tests cover:

1. End-to-end projection — agent message + tool call/result + status markers +
   stream_terminated are all written in order, and `ExecutedTrace.finalUrl` /
   `.finalDom` / `.reachedKeyNodes` are populated correctly.
2. Byte-equivalent ndjson — every emitted line round-trips through `JSON.parse`
   (the replay-script contract from 0.A).
3. Abort path — when the agent emits `ASSERTION_FAILED category=abort` +
   `RUN_COMPLETED`, `stream_terminated.reason` is `run_finished:failed` and the
   trace still closes cleanly.

## Verification against DoD

| DoD | Status |
|---|---|
| `pnpm --filter @neuve/evals eval -- --runner=real` runs against all tasks and produces a scored table | ✔ via `pnpm --filter @neuve/evals eval:real` (env-var driven because evalite CLI eats `--`-args); requires a real Claude/Gemini/Codex auth to actually execute — otherwise the runner maps the auth error to `EvalRunError` and the eval scores zero. |
| Each run writes a valid ndjson trace | ✔ test case 1 + 2 verify schema + byte-equivalent replay |
| Runs through plan-decomposer → adherence gate → interaction tools path | ✔ the runtime layer uses `Executor.layer` (carries adherence gate) + `PlanDecomposer.layer` (Wave 1.A) + `Agent.layerFor` (spawns browser-mcp.js with Wave 2.A tools). No bypass paths. |
| `pnpm --filter @neuve/evals test` still passes | ✔ 48/48 |
| `pnpm --filter @neuve/evals typecheck` green | ✔ |
| Repo-wide typecheck green in my files | ✔ (pre-existing `@neuve/sdk` playwright-types error is unrelated and was present before this wave) |

## Deviations from the seed prompt

1. **Runner selection is env-var driven, not `--runner=real` CLI flag.** The
   evalite CLI does not forward `--`-args to the eval script (it's a vitest
   wrapper), so I surfaced a `pnpm eval:real` script that sets
   `EVAL_RUNNER=real`. The runtime behavior matches the DoD.
2. **`TraceRecorderFactory` is scoped, not a stand-alone writer function.** I
   turned the trace writer into an Effect service so its file-handle lifecycle
   is tied to the run's `Effect.scoped` bracket — catches drain-after-crash
   cases the naive writer would miss.
3. **Runner-level error taxonomy.** `EvalRunError` carries `runner`, `taskId`,
   and a tag-prefixed `cause` (`trace-writer:`, `agent-not-installed:`,
   `git-repo-root:`, `platform:`, …) so the eval scoreboard can diagnose infra
   failures without opening traces. ExecutionError from the stream is already
   logged + absorbed so the trace always terminates cleanly.

## Handover notes for Wave 3.C (gemma runner)

- Import `EvalRunner` + `EvalRunError` from `../src/runners/types` (shared
  contract — do not redefine). Implement your runner by calling `runRealTask`
  with `plannerMode: "template"` (Gemma can't round-trip the frontier planner
  JSON reliably) and `Agent.layerLocal`, or build a parallel driver that
  reuses `TraceRecorderFactory.layer` for trace parity.
- Runner `name` should be `"gemma"` (or similar stable id) — it's embedded in
  trace filenames so dual-runner diffs can pair runs by task id across runners.
- For dual-runner mode (Claude + Gemma on the same task), keep `traceDir` the
  same between the two runner constructions so the diff tool finds
  `real__<taskId>.ndjson` and `gemma__<taskId>.ndjson` side-by-side.

## Known follow-ups (not in 3.A scope)

1. An "integration" eval that actually spawns a real browser on localhost
   would verify the end-to-end browser-mcp path. Skipped per seed prompt
   ("mock the chrome-devtools-mcp proxy. End-to-end smoke can be manual-only
   if needed") — the scripted agent tests demonstrate the projection logic is
   correct and the Executor tests demonstrate the adherence gate holds.
2. The `reachedKeyNodes` projection currently requires the agent to
   `interact navigate <url>` for URL extraction. If an agent reaches a URL via
   same-page SPA routing (click → history.pushState), the URL won't appear in
   any tool call. Wave 3.C can enrich the projection by parsing
   `observe pages`/`observe snapshot` results, but that's agent-specific.
3. `EVAL_BACKEND=claude` requires `claude login` to be current on the host, or
   the runner reports `EvalRunError(cause: "agent-unauthenticated: ...")` for
   every task. This is expected behavior — documented above.

## Round 2 fixes (post-reviewer feedback)

Reviewer wave-3-A-review-round-1.md flagged 7 CLAUDE.md violations that
were all addressed without changing the external shape of the runner.

1. **`process.env` → `Config.*`.** `smoke.eval.ts` now reads all 6 env vars
   through `Config.schema(Schema.Literals(...))`, `Config.string`,
   `Config.boolean`, `Config.option` + `Config.withDefault`. A typo like
   `EVAL_BCKEND=codex` now fails module-load with a typed `ConfigError` the
   engineer can see, rather than silently defaulting to claude.
2. **`throw new Error` → typed `ConfigError`.** The two manual validation
   throws are gone; `Config.schema(Schema.Literals([...]))` enforces the
   literal union natively and surfaces a structured error.
3. **`Effect.fn` spans.** `runRealTask`, `applyExecutionEvent`, and the
   write helper (now `Effect.withSpan(\`TraceEvent.write.${type}\`)`) all
   carry span names, so slow tasks show up in the OpenTelemetry tree with
   drill-down annotations (`runner`, `taskId`, `plannerMode`, event type).
4. **Raw `try/catch` → `Schema.decodeUnknownOption(Schema.fromJsonString)`.**
   `extractUrlFromToolInput` and `isWellFormedToolCall` now both share the
   same decoder; no bare try/catch in the runtime paths. Pure helpers
   remain pure — no Effect wrapping where none is needed.
5. **`as Record<string, unknown>` casts removed.** `Predicate.isObject`
   narrows the parsed JSON without a cast. The only remaining `as` in the
   runner code is `as const` on the Stream accumulator tuple.
6. **`as unknown as { ... }` in tests removed.** Trace-recorder events are
   now `Schema.Struct`s, and the test uses `Schema.decodeUnknownSync` to
   assert the on-disk wire format — this also upgrades the tests from
   "parses as JSON" to "matches the Wave 0.A contract at the type level".
7. **Agent stub is structurally complete + `satisfies AgentShape`.** The
   scripted agent layer now returns `SessionId.makeUnsafe("test-session")`
   from `createSession`, `{}` from `setConfigOption`, and `[]` from
   `fetchConfigOptions`. All three previously died. With `satisfies
   AgentShape = ServiceMap.Service.Shape<typeof Agent>`, any future Agent
   method addition becomes a compile-time error in the test fixture, closing
   the drift seam the `feedback_no_test_only_injection_seams` memory flags.

Minor improvements also applied from the review's non-blocking suggestions:

- `EvalRunError` / `TraceWriteError` dropped the `@evals/` prefix — aligned
  with `ExecutionError`, `AcpStreamError`, etc. (ServiceMap IDs keep the
  prefix; error classes don't).
- Replaced mutable `let previous / let acc` closure state with
  `Stream.mapAccumEffect` — mirrors the adherence-gate pattern from Wave
  1.B's `executor.ts:281`.
- Trace-recorder event types are now `Schema.Struct`-based with exported
  `TraceEventSchema` — Wave 5's distillation exporter can decode the same
  schema directly instead of reinventing it.
- `stream.write` callback race fixed: the promise resolves inside the
  callback (not before), and the scope finalizer is the sole `stream.end`
  caller (the explicit `recorder.close` is gone), so the two paths don't
  race.

Verification after round 2:
- `pnpm --filter @neuve/evals typecheck` — green.
- `pnpm --filter @neuve/evals test` — 48/48 passing.
- `pnpm --filter @neuve/evals eval` — mock scoreboard unchanged.
