# F-Prompt diary — unify local-agent system prompt (task #18)

Close the end-to-end control gap for `--agent local`: the local agent was ignoring the supervisor's `_meta.systemPrompt`, so prompt changes never reached local runs. The fix moves the local prompt into shared, lets the local agent honor incoming prompts, and has the supervisor (via `AcpClient`) send the right prompt per backend.

## 1. New shared prompt

Added `buildLocalAgentSystemPrompt(): string` to `packages/shared/src/prompts.ts` (adjacent to `buildExecutionSystemPrompt`).

- Pure function, no parameters.
- Returns a joined string via `[...].join("\n")` (matches the style of `buildExecutionSystemPrompt`).
- Total length under 4 KB (test asserts `<= 4 * 1024`), safe for small-model context.

### Strengthened drill-in directive (quoted verbatim)

Old bullet (in the now-deleted `packages/local-agent/src/system-prompt.ts`):

> `IMPORTANT: after EVERY trace, drill into EACH listed insight by calling \`trace\` with command="analyze". Do this for all insights in the response — LCPBreakdown, CLSCulprits, RenderBlocking, NetworkDependencyTree, DocumentLatency, etc. These drill-ins are the deliverable; without them the report only has CWV numbers.`

New bullet:

> `YOU MUST call \`trace\` with command="analyze" for EACH insight name returned in the trace response before you stop. Do not produce a final report until every insight has been analyzed. Every insight listed — LCPBreakdown, CLSCulprits, RenderBlocking, NetworkDependencyTree, DocumentLatency, and any others — requires its own analyze call. Skipping any insight means the report is incomplete.`

## 2. Files touched

| File | Purpose |
|---|---|
| `packages/shared/src/prompts.ts` | Added `buildLocalAgentSystemPrompt` at the top of the file (line ~89, just before `buildExecutionSystemPrompt`). |
| `packages/shared/tests/prompts.test.ts` | Added a `describe("buildLocalAgentSystemPrompt")` block with 5 tests (tool names, CWV thresholds, directive language, size budget, analyze call-shape). |
| `packages/local-agent/src/system-prompt.ts` | **Deleted.** |
| `packages/local-agent/src/agent.ts` | Stopped ignoring `_meta.systemPrompt`. Resolves `systemPrompt` once in `newSession` (line ~73), stores on `Session`, uses in `prompt` (line ~112). Replaced the "ignoring incoming system prompt" log with a positive `"system prompt resolved"` log that reports `source` (`incoming` or `fallback`) and `length`. |
| `packages/local-agent/package.json` | Added `"@neuve/shared": "workspace:*"` dependency. |
| `packages/agent/src/acp-client.ts` | In `AcpClient.createSession` (line ~789): when `adapter.provider === "local"`, swap the incoming prompt for `buildLocalAgentSystemPrompt()`. For all other providers, keep using the supervisor's prompt. Also logs `"ACP session system prompt resolved"` with `provider` and `length`. |
| `packages/supervisor/src/insight-enricher.ts` | Comment reference updated `LOCAL_AGENT_SYSTEM_PROMPT` → `buildLocalAgentSystemPrompt`. |
| `apps/cli/src/data/execution-atom.ts` | Same comment reference updated. |
| `apps/cli/src/utils/run-test.ts` | Same comment reference updated. |

Supervisor continues to call `buildExecutionSystemPrompt()` in `packages/supervisor/src/executor.ts:134`. The swap for local happens inside `AcpClient.createSession`, which is the only place that knows `adapter.provider`. This keeps the executor backend-agnostic.

## 3. Grep verification — no dangling references

```
$ grep -rn "LOCAL_AGENT_SYSTEM_PROMPT" packages apps
# (no matches)

$ grep -rn "ignoring incoming system prompt" packages apps
# (no matches)

$ grep -rn "LOCAL_AGENT_SYSTEM_PROMPT" .specs
.specs/dry-run-criteria.md:14: ...Investigate LOCAL_AGENT_SYSTEM_PROMPT...
.specs/dry-run-criteria.md:19: ...clarify in LOCAL_AGENT_SYSTEM_PROMPT...
.specs/dry-run-criteria.md:62: ...investigate LOCAL_AGENT_SYSTEM_PROMPT instead.
```

`.specs/dry-run-criteria.md` is a historical investigation log, not active code. Left as-is (not worth rewriting a frozen doc).

## 4. Type checks

```
$ pnpm --filter @neuve/shared --filter @neuve/agent --filter @neuve/local-agent --filter @neuve/supervisor typecheck
packages/shared typecheck: Done
packages/local-agent typecheck: Done
packages/agent typecheck: Done
packages/supervisor typecheck: Done

$ bunx tsc --noEmit -p apps/cli-solid/tsconfig.json
# exit 0
```

`packages/typescript-sdk` has a pre-existing typecheck failure (missing `playwright` types) that exists on `main` independent of this task (verified with `git stash`).

## 5. Tests

```
$ pnpm --filter @neuve/shared test
Test Files  10 passed (10)
     Tests  118 passed (118)
```

The 5 new tests in `buildLocalAgentSystemPrompt` all pass. No existing `@neuve/shared` tests regressed.

`packages/agent/tests/detect-agents.test.ts` has 3 pre-existing failures on `main` (unrelated — they check a specific ordering of detected agents that conflicts with recent provider additions). Not introduced by this task.

## 6. Manual verification spec for the user

On a fresh `--agent local` run against a dev server:

1. Start Ollama and any local model per `packages/agent/src/acp-client.ts` `layerLocal` requirements.
2. Invoke `perf-agent -a local <test instruction>` against a page with `localhost` dev server.
3. Check `.perf-agent/local-agent.log`:
   - Should contain a line `"system prompt resolved" {"source":"incoming","length":<N>}` where `<N>` matches the length of `buildLocalAgentSystemPrompt()` output (roughly ~1.8 KB, far from the old `13736` seen when the remote execution prompt was being ignored).
   - Should **not** contain any `"ignoring incoming system prompt"` line.
4. Check supervisor-side logs (where `.perf-agent/logs.md` collects Backend logs): should contain `"ACP session system prompt resolved" {"provider":"local","length":<N>}` with the same `<N>`.
5. On a `--agent claude` or `--agent codex` run, `.perf-agent/local-agent.log` should not be produced (local-agent is not spawned), and the ACP backend log should show `"ACP session system prompt resolved" {"provider":"<provider>","length":<remote-prompt-length ~13 KB>}` confirming the remote prompt is unchanged for non-local backends.
6. Smoke: drive a trace via the local agent and observe that `trace analyze` is called once per insight listed in the trace response (this is the prompt-level intent; the programmatic enforcement is F-AutoDrill's scope).

## 7. Out of scope (confirmed untouched)

- Tool-loop drill-in enforcement — belongs to F-AutoDrill (task #19), lives in `packages/local-agent/src/tool-loop.ts`.
- Remote-agent prompt (`buildExecutionSystemPrompt`) — unchanged.
- Session-record storage — F-Catalog (task #20).
- No new agent backend types added.
