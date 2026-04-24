# Review: Wave 3.C — Gemma dual-runner via @neuve/local-agent (Round 1)

## Verdict: REQUEST_CHANGES

## Verification executed

| Command | Outcome |
|---|---|
| `git diff --stat` | Only `packages/evals/evals/smoke.eval.ts` modified (49 lines). New files: `dual.ts`, `gemma-preflight.ts`, `gemma.ts`, `gemma-runner.test.ts`, diary. Zero changes in `types.ts`, `real.ts`, `trace-recorder.ts`, `packages/supervisor/`, `packages/browser/`, `packages/shared/`, `packages/local-agent/`, `apps/`. |
| `pnpm --filter @neuve/evals typecheck` | PASS (clean tsgo --noEmit). |
| `pnpm --filter @neuve/evals test` (twice) | **54/54 passed**, both runs deterministic, 545ms / 533ms. |
| `pnpm --filter @neuve/evals check` | FAIL — 3 pre-existing formatting issues in `src/scorers/final-state.ts`, `tests/mock-runner.test.ts`, `tests/scorers.test.ts` (committed in `4ce748e3` and `62746a41` before 3.C). Not introduced by engineer. |
| `EVAL_RUNNER=bogus pnpm --filter @neuve/evals eval` | Exit 1 with `ConfigError` caused by `SchemaError: Expected "mock" \| "real" \| "gemma" \| "dual", got "bogus"`. Fail-fast confirmed. |
| `EVAL_RUNNER=gemma pnpm --filter @neuve/evals eval` (Ollama running, `gemma4:e4b` pulled, `gemma3n:e4b` absent) | 20 tasks failed uniformly with structured `EvalRunError(cause: "gemma-preflight:model-missing: Model \"gemma3n:e4b\" not found. Available: gemma4:e4b.. Action: Pull the model with ...")`. No crash. Preflight works. |
| Repo-wide `pnpm typecheck` | FAIL — only the known-pre-existing `@neuve/sdk` playwright module-not-found at `src/perf-agent.ts:17` and `src/types.ts:1` (documented in prior reviews). Not introduced by 3.C. |
| `pnpm check` | FAIL — pre-existing formatting debt in `@neuve/shared/src/cwv-thresholds.ts`, `parse-insight-detail.ts`, `parse-network-requests.ts`, and three test files. Not introduced by 3.C. |

## Findings

### [MAJOR] Gemma default model (`gemma3n:e4b`) diverges from the entire rest of the codebase (`gemma4:e4b`)

`packages/evals/src/runners/gemma-preflight.ts:109` defines `GEMMA_DEFAULT_MODEL = "gemma3n:e4b"`, and `smoke.eval.ts:118` uses the same as the `EVAL_GEMMA_MODEL` default.

Every other reference in the codebase uses `gemma4:e4b`:
- `packages/local-agent/src/ollama-client.ts:5` — `DEFAULT_MODEL = "gemma4:e4b"`
- `packages/agent/src/acp-client.ts:557` — `Config.withDefault("gemma4:e4b")`
- `apps/cli/README.md:49` — documents `gemma4:e4b`
- `.specs/local-gemma4-agent.md:33,124,180,207,209,229` — entire spec uses `gemma4:e4b`

Why this matters:
1. The `applyGemmaEnvDefaults` mutation writes `gemma3n:e4b` into `process.env["PERF_AGENT_LOCAL_MODEL"]` at factory time. This **overrides** the local-agent's own `gemma4:e4b` default. A user with `gemma4:e4b` pulled and no `EVAL_GEMMA_MODEL` set will get a `model-missing` failure on every task, as demonstrated by my `EVAL_RUNNER=gemma pnpm --filter @neuve/evals eval` run. This is the ONLY bundled model on a dev machine; engineer's default is effectively unusable without a separate pull.
2. If `plan.md` line 7 ("Gemma 3n E4B") is authoritative, then the `.specs/local-gemma4-agent.md` spec, `local-agent/ollama-client.ts`, `acp-client.ts`, and README are stale — that's a broader fix spanning packages the engineer explicitly kept out of scope. Either (a) escalate to team-lead to align everything, or (b) default to `gemma4:e4b` here to stay consistent with the deployed local-agent.

Recommendation: Change `GEMMA_DEFAULT_MODEL` to `gemma4:e4b` in this wave; file a follow-up to align plan.md's Gemma 3n naming later. Do NOT let Wave 3.C's default silently break production `EVAL_RUNNER=gemma` runs.

---

### [MAJOR] Duplicated Ollama preflight logic — `GemmaPreflight` re-implements exactly what `AcpAdapter.layerLocal` already does

`packages/evals/src/runners/gemma-preflight.ts:48-92` performs:
1. `GET /api/version` (5-sec timeout) → `ollama-unreachable` error
2. `GET /api/tags` (5-sec timeout) → `list-failed` error
3. Model presence match (`=== model` or `=== ${model}:latest`) → `model-missing` error

`packages/agent/src/acp-client.ts:583-617` does the **exact same thing** inside `AcpAdapter.layerLocal`:
1. `fetch(${apiBase}/api/version)` with 5-sec timeout → `AcpConnectionInitError("Ollama is not running.")`
2. `fetch(${apiBase}/api/tags)` → `AcpConnectionInitError("Failed to list Ollama models")`
3. `availableModels.some(name => name === configuredModel || name === \`${configuredModel}:latest\`)` → `AcpConnectionInitError("Model ... not found ...")`

Consequences:
1. **Four HTTP calls per task instead of two.** 20 tasks × `EVAL_RUNNER=gemma` = 80 HTTP calls to Ollama that could be 40.
2. **Two sources of truth.** If `AcpAdapter.layerLocal`'s model-match logic changes (e.g. to tolerate more tag suffixes), Gemma preflight silently drifts.
3. The engineer's `gemma.ts` `catchTags` (line 107-116) already handles `AcpConnectionInitError` → translate to `EvalRunError`. That single catch would deliver the same structured failure UX without `GemmaPreflight` existing at all.
4. Violates CLAUDE.md: "No unused code, no duplication."

Recommendation: delete `gemma-preflight.ts` and its `preflightLayer?` seam entirely. Rely on `AcpAdapter.layerLocal`'s built-in preflight — the `AcpConnectionInitError` catchTag already translates the same remediation messaging. If the eval-specific `Action:` wording is valued, add an enrichment step in the catchTag that maps `AcpConnectionInitError.cause` matching "Ollama is not running" / "not found" / "Failed to list" to the same action suffixes.

If kept (non-recommended), at least share a single preflight module between `@neuve/agent`'s `AcpAdapter.layerLocal` and `@neuve/evals`'s Gemma runner so both consume the same code path.

---

### [MAJOR] `process.env` mutation at factory time bypasses Config system

`packages/evals/src/runners/gemma.ts:45-52` mutates `process.env["PERF_AGENT_LOCAL_MODEL"]` and `process.env["PERF_AGENT_OLLAMA_URL"]` at runner construction time.

This violates multiple rules:
1. **CLAUDE.md "Environment Variables":** "Never use `process.env`. Use `Config.string` / `Config.integer` for validated config." Reading is banned, mutating is worse.
2. **Ordering hazard with `Agent.layerLocal`:** `AcpAdapter.layerLocal` reads `Config.string("PERF_AGENT_LOCAL_MODEL")` at layer-build time (`acp-client.ts:556`). Because `Agent.layerLocal` is a layer *description* pipe (not effect), the Config read runs lazily when the layer is actually built inside `runRealTask`. In `smoke.eval.ts`, `makeGemmaRunner(evalConfig.gemmaOptions)` is called AFTER `resolveEvalConfig` completes → env mutation happens BEFORE layer construction → works by luck. If anyone ever constructs `makeGemmaRunner` with `EVAL_RUNNER=dual` via a worker, async boundary, or a second invocation (e.g. `runDualSequential`), the env-mutation/Config-read ordering becomes load-bearing and silent.
3. **Race / cross-test contamination:** Vitest runs tests in one process by default. If `makeGemmaRunner({ model: "gemma3n:custom", preflightLayer })` runs in the "produces a model-missing action for the configured EVAL_GEMMA_MODEL" test (line 248 of test file), the env var gets set to `gemma3n:custom` **and stays set** for any later test or eval run in the same process. The guard `process.env["PERF_AGENT_LOCAL_MODEL"] === undefined` prevents overwrites, but the first test to run wins — a per-test-order bug. Luckily all current gemma tests happen to pass regardless because they stub `preflightLayer` before reaching local-agent, but any future test that DOES reach the local-agent path will see stale values.
4. **Claim "we can't thread those through without forking `AcpAdapter`" is not fully accurate.** `AcpAdapter.layerLocal` reads from `Config`. `Config` is resolvable from `ConfigProvider`. Options to consider without forking:
   - Wrap `runRealTask` in `Effect.withConfigProvider(ConfigProvider.fromMap(new Map([["PERF_AGENT_LOCAL_MODEL", model], ["PERF_AGENT_OLLAMA_URL", baseUrl]])))`. This threads the model through the effect's Config resolver and neither reads nor writes `process.env`.
   - Or, extend `AcpAdapter.layerLocal` to accept an `AcpAdapterOptions` tag whose `layerFor` can be given explicit values — this requires a small touch to `@neuve/agent` but is cleaner than env-mutation and removable once done.

Recommendation: replace `applyGemmaEnvDefaults` with `Effect.withConfigProvider` scoping around the `runtimeLayer` so the model/baseUrl flows through Effect's Config system only, with zero `process.env` writes. Document any remaining `process.env` read in `@neuve/local-agent` as a separate known-debt item — but the Gemma runner should not be the one to *write* into a shared mutable.

---

### [MAJOR] `makeGemmaRunner`'s `catchTags` omits `SchemaError` (diverges from sibling `real.ts`)

`packages/evals/src/runners/real.ts:375-385` catches:
```
TraceWriteError, AcpProviderNotInstalledError, AcpProviderUnauthenticatedError,
AcpConnectionInitError, AcpAdapterNotFoundError, FindRepoRootError,
PlatformError, ConfigError, SchemaError
```

`packages/evals/src/runners/gemma.ts:107-116` catches the same EXCEPT `SchemaError`.

If any Effect in the Gemma pipeline emits a `SchemaError` (e.g. schema decoding inside `@neuve/agent` or `@neuve/supervisor`), it escapes the runner's error-channel contract `Effect<ExecutedTrace, EvalRunError>` and either crashes the harness or surfaces as an unhandled defect. Tests don't catch this because they stub the agent/git/decomposer layers out entirely.

Recommendation: add `SchemaError: toError("schema"),` to the `catchTags` in `gemma.ts:116`.

---

### [MINOR] Dead-code duplicate `GEMMA_MODEL_CONFIG` / `GEMMA_BASE_URL_CONFIG` in `gemma-preflight.ts`

`packages/evals/src/runners/gemma-preflight.ts:112-117` exports `GEMMA_MODEL_CONFIG` and `GEMMA_BASE_URL_CONFIG`. They are not imported anywhere. `smoke.eval.ts:117-123` re-declares its own local copies with the same names. Two sources of truth, dead exports on the preflight module.

Recommendation: delete lines 112-117 of `gemma-preflight.ts`, OR import the exports in `smoke.eval.ts` instead of re-declaring. CLAUDE.md: "No unused code, no duplication."

---

### [MINOR] Diary claim that `preflightLayer?` "matches 3.A's pattern of injecting Agent/Git/PlanDecomposer layers" is inaccurate

Wave 3.A's `makeRealRunner` does not accept `agentLayer?`, `gitLayer?`, or `planDecomposerLayer?` options. It takes `agentBackend: AgentBackend` (an enum) and builds layers itself. Its tests exercise the lower-level exported `runRealTask` directly with their own `buildTestLayer`, NOT by overriding layer options on `makeRealRunner`.

The `preflightLayer?` in 3.C's `GemmaRunnerOptions` is legitimate injection (the default IS the real production `GemmaPreflight.layer`, so tests don't diverge from prod on the default-exercise path — this is NOT the anti-pattern from `feedback_no_test_only_injection_seams.md`). But the diary's justification (line 78-81 of the diary) should not cite 3.A as precedent, because 3.A doesn't have this pattern. Either follow 3.A's model (test via exported `runRealTask` + `buildTestLayer`) and remove `preflightLayer?`, or rewrite the diary's "matches 3.A's pattern" sentence to explain why this is a DIFFERENT, case-specific choice.

(If Finding #2 is addressed by deleting `GemmaPreflight` altogether, this becomes moot.)

---

### [MINOR] `run` effect has no explicit span annotation for the preflight step

`packages/evals/src/runners/gemma.ts:95-98`: preflight runs inside an `Effect.gen` without a span. The diary claims `Effect.annotateCurrentSpan({ model, baseUrl })` is applied by `GemmaPreflight.check` itself (line 45 of `gemma-preflight.ts`). True — but the outer `run` only has `Effect.withSpan("GemmaRunner.run", ...)` at line 119. Annotations for `model` and `plannerMode` would match real.ts's annotation discipline (`real.ts:246-250`).

Recommendation: add `yield* Effect.annotateCurrentSpan({ runner: runnerName, taskId: task.id, model, plannerMode })` once at the top of `run`.

---

### [INFO] Manual Ollama smoke not run

Engineer's diary correctly flags this as "manual-smoke-pending" and explains the test-env lacks a locally-running `gemma3n:e4b`. I ran `EVAL_RUNNER=gemma pnpm --filter @neuve/evals eval` with Ollama serving `gemma4:e4b` → preflight correctly detects the missing `gemma3n:e4b` and emits structured errors for all 20 tasks. This is a positive signal that the preflight path works end-to-end (though see Finding #2 about whether the preflight should exist at all).

Before Wave 5 distillation, a real run on a dev box with the correct model pulled is required. Not a merge blocker today.

## Suggestions (non-blocking)

1. If `GemmaPreflight` is deleted (Finding #2), also delete its test (`gemma preflight` describe block) and its `preflightFailureLayer` helper in the test file. Keep only the trace-projection and dual-orchestration tests.
2. `runDualSequential` helper (`dual.ts:37-50`) is unused inside `smoke.eval.ts`. Diary justifies it as future-use for "Wave 5 distillation teacher sample generator". CLAUDE.md discourages speculative code, but Wave 5's task #10 is on-roadmap and the helper is 13 lines; marginal. Consider adding at least one test covering it, or defer to Wave 5.
3. `packages/evals/src/runners/gemma.ts:30-36` has a `translate` helper that is byte-identical to `real.ts:333-339`'s `toRunError`. Extract to a shared `trace-recorder.ts` helper or a new `runner-errors.ts` — both runners use it the same way.

## Exit criteria status

| Criterion | Status |
|---|---|
| Mandatory verification commands pass | Partial — `pnpm test` + `pnpm typecheck` for `@neuve/evals` green; repo-wide `pnpm check` fails on pre-existing debt (not 3.C). |
| All Critical/Major findings resolved | **NO — 4 Major findings outstanding.** |
| Engineer's diary claims independently verified | Verified. `gemma3n:e4b` default confirmed mismatched. Duplicate preflight confirmed. Env mutation confirmed unjustified. `SchemaError` omission confirmed. |
| DoD behavior demonstrated end-to-end | Partial — mock/real runner behavior unchanged; gemma preflight-fail path works; gemma happy-path untested on real Ollama (pending). |
| Sibling-code checklist | Run: `real.ts`'s catchTags has `SchemaError`, gemma does not — Finding #4. `AcpAdapter.layerLocal` does the same preflight — Finding #2. |

**Verdict stands: REQUEST_CHANGES.** The model-name default alone will break every `EVAL_RUNNER=gemma` invocation on a box set up per the local-agent spec. The other Majors compound: duplicated preflight wastes work and drifts over time; `process.env` mutation is a banned pattern with a latent cross-test contamination risk; `SchemaError` omission creates an unhandled-error hole. None block comprehension of the architecture but each must be addressed before merge.
