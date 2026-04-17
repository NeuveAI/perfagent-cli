# Review: F-Prompt — Unify local-agent system prompt via shared package

## Verdict: APPROVE

### Verification

- **tsc (cli-solid)**: `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` exits 0 (clean).
- **pnpm typecheck (shared, agent, local-agent, supervisor)**: all 4 projects pass clean.
- **shared tests**: `pnpm --filter @neuve/shared test` → `10 passed (10)` files, `118 passed (118)` tests. Matches engineer's claim.
- **prompt length (measured)**: `buildLocalAgentSystemPrompt()` output = 1,936 bytes — comfortably under the 4 KB spec cap; old remote prompt is ~13 KB.
- **system-prompt.ts deleted**: confirmed via `ls` (No such file or directory) and `git status` (`deleted: packages/local-agent/src/system-prompt.ts`).
- **package.json diff**: only `"@neuve/shared": "workspace:*"` added to dependencies — nothing else changed.
- **grep `LOCAL_AGENT_SYSTEM_PROMPT`**: 0 hits in `packages/` and `apps/`. Only `.specs/dry-run-criteria.md` (historical investigation log) and F-Prompt's own diary mention the old symbol.
- **grep `ignoring incoming system prompt`**: 0 hits across the monorepo.

### End-to-end flow validation

Traced the happy path for `--agent local`:

1. CLI issues a run → supervisor `Executor.execute` in `packages/supervisor/src/executor.ts:134` still calls `buildExecutionSystemPrompt()` (backend-agnostic, untouched).
2. Supervisor `acp-client.ts` `AcpClient.stream` forwards `systemPrompt` to `createSession` at line 913.
3. `createSession` at `packages/agent/src/acp-client.ts:789-810` checks `adapter.provider === "local"` and swaps to `buildLocalAgentSystemPrompt()` regardless of caller input. `adapter.provider` is set to `"local"` at line 623 inside `layerLocal`, so detection is authoritative (not aliased — the AcpAdapter is built from Effect layers, not from a runtime string, so there's no provider-string spoofing risk).
4. `buildSessionMeta` places the resolved prompt at `_meta.systemPrompt` in the ACP request.
5. `packages/local-agent/src/agent.ts:74-81` reads `_meta.systemPrompt`, resolves once per session, stores on `Session`, and uses it in `prompt()` at line 114. Fallback to `buildLocalAgentSystemPrompt()` if the incoming prompt is missing.
6. Log line `"system prompt resolved"` reports `source` and `length`, replacing the old "ignoring incoming system prompt" log.

For non-local providers (claude, codex, cursor, gemini, etc.), `adapter.provider !== "local"`, so `Option.getOrUndefined(systemPrompt)` runs and the supervisor's unchanged `buildExecutionSystemPrompt()` output is sent as before. **No regression risk for remote providers.**

### Tests

5 new tests in `packages/shared/tests/prompts.test.ts:315-349`:

1. `names the three local-agent tool categories` — asserts `` `interact` ``, `` `observe` ``, `` `trace` `` appear.
2. `includes Core Web Vitals thresholds` — asserts `LCP < 2500 ms`, `CLS < 0.1`, `INP < 200 ms`.
3. `mandates per-insight analyze drill-ins with directive language` — asserts `YOU MUST call \`trace\` with command="analyze" for EACH insight`, `Do not produce a final report until every insight has been analyzed`, and the three flagship insight names (LCPBreakdown, CLSCulprits, RenderBlocking).
4. `fits a small-model context budget (<= 4 KB)` — hard cap assertion (`toBeLessThanOrEqual(4 * 1024)`); actual length 1,936.
5. `includes the analyze call-shape example` — asserts the JSON example fragments `"command": "analyze"` and `"insightSetId": "NAVIGATION_0"`.

Each assertion is meaningful. The directive-language test specifically pins the strengthened "YOU MUST" phrasing, so future accidental weakening would break the test. The 4 KB budget test is a hard cap, not a comment — good.

### Directive strengthening

Comparison of old vs new bullet (quoted in diary §1):

- **Old**: `IMPORTANT: after EVERY trace, drill into EACH listed insight by calling trace with command="analyze"...`
- **New**: `YOU MUST call trace with command="analyze" for EACH insight name returned in the trace response before you stop. Do not produce a final report until every insight has been analyzed. Every insight listed — LCPBreakdown, CLSCulprits, RenderBlocking, NetworkDependencyTree, DocumentLatency, and any others — requires its own analyze call. Skipping any insight means the report is incomplete.`

The new text is genuinely more directive: imperative `YOU MUST`, explicit negative constraint (`Do not produce a final report until...`), and a stated consequence (`Skipping any insight means the report is incomplete`). Not just longer — the structural language change shifts it from a suggestion to a blocking rule. Appropriate for a small model.

### Scope discipline

- `buildExecutionSystemPrompt()` untouched — only a new function was added next to it.
- `packages/local-agent/src/tool-loop.ts` **is** modified in the working tree, **but** those changes are F-AutoDrill (task #19)'s territory — they add `parseTraceOutput`-based auto-drill-in in the runtime. Confirmed by inspecting the diff (adds `AutoDrillTarget`, `collectAutoDrillTargets`, TRACE_STOPPED_SENTINEL logic) — these are programmatic enforcement, not prompt work. F-Prompt's diary correctly lists tool-loop as out of scope; the diff shown is F-AutoDrill in flight. No F-Prompt scope violation.
- `apps/cli/src/data/execution-atom.ts` modifications beyond the comment rename (reportPath tracking) are F-Catalog (task #20)'s territory. Again, the F-Prompt-specific comment edit is just the symbol rename from `LOCAL_AGENT_SYSTEM_PROMPT` to `buildLocalAgentSystemPrompt`.
- No UI changes by F-Prompt.
- No session-storage changes by F-Prompt.

### Failure-mode checks

- **Missing `_meta.systemPrompt` on local session**: `agent.ts:77` falls back to `buildLocalAgentSystemPrompt()`. Import at line 6 is wired correctly, and the `@neuve/shared` workspace dep was added, so the import resolves. Verified by typecheck pass.
- **Supervisor sends non-local prompt to local-agent**: can't happen post-fix because `acp-client.ts:797-799` overrides it before the `_meta` is built. Local-agent would only ever receive either `buildLocalAgentSystemPrompt()` output or nothing (fallback path). No chance of a 13 KB remote prompt reaching the local model through this code path.
- **Provider mis-detection**: `adapter.provider` is set inside each `layer*` constructor (not from user input), so spoofing is not possible. `"local"` is set at `acp-client.ts:623` inside `layerLocal`, which is only loaded when `-a local` is passed.

### Type safety / style

- No `null`.
- No `as` casts in the new code.
- `interface` used (the existing `Session` interface in `agent.ts` unchanged).
- Arrow function for `buildLocalAgentSystemPrompt` — consistent with `buildExecutionSystemPrompt` style.
- Descriptive variable names (`systemPrompt`, `source`, `length`).
- Namespaced `node:*` imports not applicable (no new Node built-ins).
- No new barrel files; subpath import `@neuve/shared/prompts` used correctly in both `agent.ts:6` and `acp-client.ts:33`.

### Minor suggestions (non-blocking)

- **Length-guard log**: `local-agent/src/agent.ts:78-81` logs source + length but does not warn if an incoming prompt is suspiciously large (e.g. > 6 KB, which would indicate a supervisor-side bug sent the remote prompt). The swap in `acp-client.ts:797-799` already guarantees this cannot happen through our codepath, but a defensive `log.warn` in `agent.ts` would surface a future regression immediately in `.perf-agent/local-agent.log`. Pure defense-in-depth; fine to skip.
- `.specs/dry-run-criteria.md` still references the old `LOCAL_AGENT_SYSTEM_PROMPT` name. Engineer explicitly chose not to rewrite the historical investigation log; acceptable since `.specs` documents are frozen snapshots.
- `buildLocalAgentSystemPrompt` returns a fresh string on every call (no memoization). At the single call-site per session this is a non-issue. Not worth caching.

### Notes

- The session in `local-agent/src/agent.ts` resolves the prompt once per session and stores it on the `Session` struct, then reuses it for each subsequent `prompt()` call. Correct — avoids re-reading `_meta` on every turn.
- The 4 KB hard-cap test is useful long-term guardrail. If future edits push the prompt beyond budget, the test fails with a clear signal.
- Diary is accurate and matches the code.
