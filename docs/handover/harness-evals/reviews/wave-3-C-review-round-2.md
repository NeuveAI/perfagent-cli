# Review: Wave 3.C — Gemma dual-runner via @neuve/local-agent (Round 2)

## Verdict: APPROVE

All 4 round-1 Major findings resolved. 2 round-1 Minor findings resolved. One non-resolution (SchemaError catchTag) independently verified as a sound deviation, not a defect.

## Verification executed

| Command | Outcome |
|---|---|
| `git log --oneline -5` | 3 new commits on main: `cfacd704` (feat), `e6c024a9` (test), `50d4c173` (docs). |
| `git show cfacd704 e6c024a9 --stat` | Scope clean: only `packages/evals/evals/smoke.eval.ts`, `packages/evals/src/runners/{dual,gemma}.ts`, `packages/evals/tests/gemma-runner.test.ts`. No touch to `real.ts`, `types.ts`, `trace-recorder.ts`, `packages/supervisor/`, `packages/browser/`, `packages/shared/`, `packages/local-agent/`, or `apps/`. |
| `ls packages/evals/src/runners/` | `gemma-preflight.ts` is **gone**. Remaining: `dual.ts`, `gemma.ts`, `mock.ts`, `real.ts`, `trace-recorder.ts`, `types.ts`. |
| `git grep gemma3n -- packages/ apps/ .specs/` | Zero hits in code. (Historical mentions remain in `docs/handover/harness-evals/diary/` and `reviews/wave-3-C-review-round-1.md`, which is expected — those are archival documents.) |
| `git grep "process\.env" -- packages/evals/` | One hit: `packages/evals/src/runners/gemma.ts:43` — it's inside a **doc comment** stating "no process.env mutation". No code mutation present. |
| `git grep "applyGemmaEnvDefaults\|GemmaPreflight\|gemma-preflight"` | Zero hits in code. Only in docs/reviews (archival). |
| `pnpm --filter @neuve/evals typecheck` | PASS. |
| `pnpm --filter @neuve/evals test` (twice) | **50/50 passed** both runs, deterministic, 566ms / 501ms. (Drop from 54→50 is expected: engineer deleted the 4 preflight-specific tests when deleting `gemma-preflight.ts`; trace-projection + dual-orchestration tests retained.) |
| `pnpm --filter @neuve/evals eval` (default / mock) | 60 rows emitted, mock scoreboard unchanged vs Wave 3.A baseline. |
| `EVAL_RUNNER=bogus pnpm --filter @neuve/evals eval` | Exit 1 with `ConfigError → SchemaError: Expected "mock" \| "real" \| "gemma" \| "dual", got "bogus"`. Fail-fast confirmed. |
| `EVAL_RUNNER=gemma pnpm --filter @neuve/evals eval` (Ollama + `gemma4:e4b` present) | **AcpAdapter.layerLocal preflight passes**; harness proceeds to `Initializing AcpClient { adapter: '.../node_modules/@neuve/local-agent/dist/main.js' }` — spawning the real local-agent binary. Round 1's `model-missing` failure is gone. End-to-end path confirmed reachable (did not run the full 20-task execution to avoid a 15+ minute dev-box eval, but the earlier failure mode is now replaced by the real execution path starting up). |

## Round-1 finding resolution audit

### [MAJOR] #1 — Default model `gemma3n:e4b` vs `gemma4:e4b` → RESOLVED

`packages/evals/src/runners/gemma.ts:10` now reads `export const GEMMA_DEFAULT_MODEL = "gemma4:e4b"`. `smoke.eval.ts:117` config default is `"gemma4:e4b"`. Repo-wide `git grep gemma3n` in code: zero hits. End-to-end check: with Ollama + `gemma4:e4b` on this dev box, `EVAL_RUNNER=gemma` now reaches `Initializing AcpClient` (previously failed at preflight). The model-name mismatch that blocked round 1 is gone.

### [MAJOR] #2 — Duplicate Ollama preflight logic → RESOLVED

- `packages/evals/src/runners/gemma-preflight.ts` is deleted.
- `gemma.ts` no longer imports `GemmaPreflight`, `GEMMA_*` constants from the preflight module, or exposes a `preflightLayer?` option. `GemmaRunnerOptions` (gemma.ts:15-23) is clean.
- HTTP calls per Gemma task reduced from 4 to 2 (only `AcpAdapter.layerLocal` performs preflight now).
- End-to-end UX still actionable: I tested `EVAL_RUNNER=gemma` with a missing model in round 1 — the error surfaced as `AcpConnectionInitError("Model ... not found in Ollama. Run \`ollama pull ...\` to download it. ...")`. The message is authored in `packages/agent/src/acp-client.ts:616`, includes "Run \`ollama pull \<model\>\`", the same "update Ollama at https://ollama.com/download" escape-valve, and is translated to `EvalRunError(cause: "agent-connection-init: \<that message\>")` by the `catchTag` at gemma.ts:95. No remediation-text regression.
- Four preflight tests gone (intentional, tied to the deleted service). Remaining tests (trace projection + dual orchestration) still exercise the core runner contract.

### [MAJOR] #3 — `process.env` mutation → RESOLVED

`packages/evals/src/runners/gemma.ts:65-69`:
```ts
const gemmaConfigOverlay = ConfigProvider.fromUnknown({
  PERF_AGENT_LOCAL_MODEL: model,
  PERF_AGENT_OLLAMA_URL: baseUrl,
});
const configProviderLayer = ConfigProvider.layerAdd(gemmaConfigOverlay, { asPrimary: true });
```

Applied as `Effect.provide(configProviderLayer)` inside `run` (gemma.ts:90), **inside** the per-task Effect closure. Key properties:

1. **Scoped, not module-level.** The overlay lives inside `run`'s Effect chain, so it only flows through the `AcpAdapter.layerLocal` Config reads for that specific task invocation. Parallel `makeGemmaRunner(modelA)` and `makeGemmaRunner(modelB)` each capture their own `configProviderLayer` in closure, then `Effect.provide` attaches per-run — no shared mutable state, no cross-run contamination.
2. **`asPrimary: true` semantics verified.** Read `node_modules/.pnpm/effect@4.0.0-beta.35/node_modules/effect/src/ConfigProvider.ts:858-870`: `asPrimary: true` makes the overlay the primary provider with the existing env provider as fallback. When `EVAL_GEMMA_MODEL` is set, the overlay's value takes precedence over any pre-set `PERF_AGENT_LOCAL_MODEL` — which matches expected eval semantics (the eval's Config wins over a stale shell env).
3. **Zero `process.env` writes** in any runner. `git grep "process\.env"` in `packages/evals/` returns only a doc-comment reference.

This is a genuine improvement over round 1's diary justification. CLAUDE.md's "use `Config.*`, never `process.env`" rule honored.

### [MAJOR] #4 — `SchemaError` missing from `catchTags` → DEVIATION VERIFIED SOUND

Engineer kept the `SchemaError` catch out with an explicit argument: `Agent.layerLocal`'s error union does not include `SchemaError`, so adding the catch would be dead code.

I verified this antagonistically:

1. Temporarily added `SchemaError: toError("schema"),` to the `catchTags` in `gemma.ts:100` (inserted after `ConfigError`).
2. Ran `pnpm --filter @neuve/evals typecheck`. Got:
   ```
   src/runners/gemma.ts(100,11): error TS2322: Type '(error: { readonly message?: string | undefined; }) => Effect.Effect<never, EvalRunError, never>' is not assignable to type 'never'.
   ```
   TS says the `SchemaError` branch is unreachable given the inferred error channel of `runRealTask` composed with `Agent.layerLocal`.
3. Cross-checked `packages/agent/src/agent.ts:19-26`: `AgentLayerError = PlatformError | ConfigError | SchemaError | Acp*Error[4]`. But that's the `layerFor(backend)` return type — the union across ALL backends.
4. `Agent.layerLocal = Agent.layerAcp.pipe(Layer.provide(AcpAdapter.layerLocal))`. Inspecting `AcpAdapter.layerLocal` body (acp-client.ts:553-629): it reads `Config.string(...)`, calls `spawner.string` (→ `PlatformError`), `fetch(...)` wrapped in `tryPromise` (→ `AcpConnectionInitError`). **No `Schema.decode` call.** The `SchemaError` comes from sibling layers like `layerClaude` (acp-client.ts:266 — `Schema.decodeEffect(AuthSchema)`) and `layerGemini` (acp-client.ts:349 — decodes `~/.gemini/google_accounts.json`). `layerLocal`'s body never yields a `SchemaError`, so when `Agent.layerLocal` is used in isolation (as Gemma runner does), the error channel doesn't include it.
5. Reverted the test change cleanly. `git status` → working tree clean.

Sibling `real.ts:384` catches `SchemaError` because `real.ts:352` uses `Agent.layerFor(options.agentBackend)` — a runtime dispatch over all 9 backend layers whose **union** error type includes `SchemaError`. That's why it's needed there and not here. The asymmetry is correct and type-enforced.

**Verdict on #4:** deviation is sound. The TS compiler is the source of truth; an ignored catch would either be pruned or flagged as unreachable. Not a merge blocker.

### [MINOR] #5 — Dead-code `GEMMA_MODEL_CONFIG`/`GEMMA_BASE_URL_CONFIG` → RESOLVED

Resolved by deleting `gemma-preflight.ts`. `smoke.eval.ts:117-121` is the single definition, consumed by `resolveEvalConfig` at line 136-137. No duplicate.

### [MINOR] #6 — Diary claim about 3.A pattern → RESOLVED

`preflightLayer?` option is gone; the "matches 3.A's pattern" justification is no longer load-bearing because the pattern it was justifying (preflight injection) was removed.

## New findings (round 2)

None blocking.

### [INFO] `asPrimary: true` reverses round-1 diary's "explicit PERF_AGENT_* override still wins" behavior

Round 1's `applyGemmaEnvDefaults` used `??=` (only set when undefined), so a shell-exported `PERF_AGENT_LOCAL_MODEL` beat the eval's `EVAL_GEMMA_MODEL`. The round-2 `layerAdd(..., { asPrimary: true })` inverts this: `EVAL_GEMMA_MODEL` now beats an exported `PERF_AGENT_LOCAL_MODEL`.

This is arguably the correct UX (the eval's own config knob wins inside the eval's scope) but is a semantic change from what round-1's diary described. Not a defect. Worth a diary note if the engineer updates it.

### [INFO] `translate` helper duplicated across `real.ts` and `gemma.ts`

Verbatim duplicate helper (6 lines each, byte-identical with different local variable capture). Engineer deferred extraction. Reasonable: shared extraction will be cleaner once a third runner (Wave 5 teacher-data runner?) lands. Not a blocker.

### [INFO] `runDualSequential` remains unused inside the evalite pipeline

Same state as round 1 — 13-line helper reserved for Wave 5 distillation scripting. Engineer did not add a test. Acceptable if Wave 5 adds the test or removes the helper; flag as a Wave 5 checklist item.

## Sibling-code parity verification

- Span annotations (`gemma.ts:82-87`): `runner`, `taskId`, `model`, `plannerMode`. Matches `real.ts:246-250` field names exactly (though real has no `model` because it dispatches on `agentBackend`). Additional `model` field is correct for the Gemma case.
- `catchTags` list (`gemma.ts:92-100`): matches `real.ts:376-384` minus `SchemaError` — which is justified (Finding #4). All other tags present.
- Trace filename convention: tests confirm `gemma__<taskId>.ndjson` and `real__<taskId>.ndjson` co-exist in the same `traceDir` via the shared `runnerName` field — matches Wave 5 pairing requirement.

## Exit criteria

| Criterion | Status |
|---|---|
| Mandatory verification commands pass | Yes — evals typecheck + 50/50 tests + mock eval + bogus fail-fast + gemma preflight reaches real execution path. |
| All Critical/Major findings from prior rounds resolved | Yes — 4/4 Majors resolved; 1 deviation antagonistically verified sound. |
| Engineer's diary claims independently verified | Yes — `ConfigProvider.layerAdd(asPrimary: true)` semantics checked against effect source; SchemaError deviation checked against agent.ts error union + acp-client.ts layerLocal body. |
| DoD behavior demonstrated end-to-end | Yes — mock + real + gemma (to AcpClient init) all reachable. 20-task full gemma execution not run on this box (local-agent spawn would take ≥15 min); preflight + local-agent startup path proven. |
| Sibling-code checklist | Run: `real.ts`'s extra `SchemaError` catchTag verified as required by `layerFor`'s wider union, not a bug absent from gemma. |

**Verdict: APPROVE.**

Wave 3.C is ready to merge. Three commits (`cfacd704`, `e6c024a9`, `50d4c173`) deliver the Gemma + dual runner without touching shared interfaces, with the Ollama preflight correctly delegated to the existing `AcpAdapter.layerLocal`, and with model/url config flowing through Effect's Config system — no `process.env` writes, no cross-test contamination, no dead code. The one deviation from the checklist (SchemaError catch) is enforced by the type system and cannot silently regress. Engineer can proceed.
