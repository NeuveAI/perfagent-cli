# F-AutoDrill Diary

## Task

Small local models (gemma4:e4b) sometimes skip drilling into each insight after
`trace start/stop`, leaving `insightDetails` empty even though
`uniqueInsightNames` has entries. Make this independent of model compliance by
auto-injecting `trace analyze` calls for each insight inside the local-agent
tool-loop, after a `trace` call returns a result containing the trace-stop
sentinel.

## Investigation summary

### Trace stop output shape

A successful `trace` call (with `command: "start"`, `autoStop: true`) produces a
result text that begins with the sentinel `The performance trace has been
stopped.` and is structured as:

```
The performance trace has been stopped.
## Summary of Performance trace findings:
URL: https://agent.perflab.io/
...
## insight set id: NAVIGATION_0

URL: https://agent.perflab.io/
...
Available insights:
  - insight name: LCPBreakdown
    ...
  - insight name: CLSCulprits
    ...
```

`@neuve/shared/parse-trace-output` already parses this format (`parseTraceOutput`
at packages/shared/src/parse-trace-output.ts:129). It returns an array of
`ParsedTraceMetrics` (one per insight-set block) each containing an
`insights: ParsedTraceInsight[]` with `{ insightSetId, insightName }` pairs.
This is exactly what I need for the drill-in loop.

### Analyze output shape

A `trace analyze` call returns one insight detail per call. The result text
starts with `## Insight Title: <human-friendly title>` and contains sections
(`## Insight Summary`, `## Detailed analysis`, `## Estimated savings`,
`## External resources`). `@neuve/shared/parse-insight-detail.ts::parseInsightDetail`
parses exactly one insight per text input (it only picks up the first
`## Insight Title:` occurrence — see line 84 "if spans.titleStart === -1").

### Reporter parsing behavior — critical constraint

`packages/supervisor/src/reporter.ts` (line 368-389) iterates `ExecutionEvent`s
and for each `ToolResult` whose text `isInsightDetailResult` (starts with
`## Insight Title:`), it calls `parseInsightDetail` once and pushes ONE
`InsightDetail` into the report.

**Implication:** If I simply concatenate multiple analyze results into one fat
`ToolResult` via `combinedLlmText`, the reporter would only capture the first
insight. I would also need to teach the reporter to split-and-parse multiple
`## Insight Title:` blocks per result.

**Solution chosen (no reporter change):** emit *separate* synthetic
`tool_call` + `tool_call_update` ACP events per insight. The supervisor's
`ExecutedPerfPlan.addEvent` (packages/shared/src/models.ts:874) converts each
pair into a `ToolCall` event + a `ToolResult` event, so the reporter's existing
per-result parsing works unchanged. Every synthetic call uses `title: "trace"`
with `rawInput: { action: { command: "analyze", insightSetId, insightName } }`
so it is indistinguishable from a real LLM-initiated analyze call.

Separately, the LLM's message history still sees ONE fat tool-result message
(the original `trace stop` text plus all analyses joined by `\n\n---\n\n`)
so the model has full context without needing to drill in itself.

### Reporter NOT modified

Not required and out of scope — per-tool-result parsing already handles the
per-insight drill-in pattern correctly because we emit separate `ToolResult`
events.

## Detection predicate

`!isError && functionName === "trace" && baseMessageText.includes(TRACE_STOPPED_SENTINEL)`

Where `TRACE_STOPPED_SENTINEL = "The performance trace has been stopped."` —
same string used by `packages/supervisor/src/reporter.ts:36` and
`packages/shared/src/parse-trace-output.ts:18`.

If `parseTraceOutput` returns zero insights (e.g. an unknown format), the
auto-drill-in loop simply does nothing and the LLM gets the original result
text unchanged — no harm done.

## Insertion point

`packages/local-agent/src/tool-loop.ts:204-292` — inside the per-tool-call
block, immediately AFTER the original `tool_call_update` for the `trace` call
is emitted, and BEFORE the tool-result message is pushed into the LLM's
`messages` array.

The auto-drill-in loop:

1. Parses the trace-stop result with `parseTraceOutput` to get
   `{ insightSetId, insightName }[]` (deduped via `Set` keyed by the pair).
2. Per target:
   - Generates a unique `analyzeCallId` (`auto-drill-<id>-<name>-<uuid>`).
   - Logs `auto-drill-in start`.
   - Emits `tool_call` ACP update with `title: "trace"`,
     `rawInput: { action: { command: "analyze", insightSetId, insightName } }`.
   - Calls `mcpBridge.callTool("trace", analyzeArgs)` wrapped in `try/catch`
     so a thrown error doesn't abort the outer tool-loop turn.
   - Emits `tool_call_update` with the result and `status: "completed"` (or
     `"failed"` on error).
   - Logs `auto-drill-in complete`.
   - Appends to the `analyses` array (error case uses
     `### {insightName}: error — {message}`).
3. Builds `combinedLlmText` = original trace stop text + `\n\n---\n\n` joins.

## Error handling

- **Parse failure / no insights:** `collectAutoDrillTargets` returns `[]`,
  the loop runs zero iterations, the LLM receives the original text — no-op.
- **Individual analyze call failure:** caught via both `mcpBridge`'s
  `isError: true` convention AND a `try/catch` around the call for hard throws.
  The error message is embedded into the combined result with a
  `### {insightName}: error — {message}` header; the LLM still gets visibility
  into which drill-ins failed. The outer tool-loop keeps iterating through the
  remaining insights.
- **Abort signal:** each iteration checks `signal.aborted` and bails out
  cleanly, matching the parent loop's pattern.

## Logs added

Using existing `log()` from `packages/local-agent/src/log.ts`:

- `"auto-drill-in planned"` — one entry per trace-stop detection, lists all
  target insight names.
- `"auto-drill-in start"` — one per drill-in, includes `insightSetId`,
  `insightName`, `tool: "trace"`, `auto: true`.
- `"auto-drill-in complete"` — one per drill-in, includes `isError`,
  `textLength` for quick size sanity-check.

## Reporter companion change

**None required.** See Investigation summary above — emitting separate
synthetic ACP events per insight avoids any reporter work.

## Package dependency change

Added `@neuve/shared: "workspace:*"` to
`packages/local-agent/package.json` (only imported
`@neuve/shared/parse-trace-output`).

## Typecheck

`bunx tsc --noEmit` in `packages/local-agent` — clean for `src/tool-loop.ts`.
Two pre-existing errors in `src/ollama-client.ts` (lines 29, 36) about Ollama's
`num_ctx` extension field; unrelated to this change and present on `main`.

## Test output

- `pnpm --filter @neuve/shared test` — 10 files, 113 tests passing.
- `pnpm --filter @neuve/supervisor test` — 9 files, 68 tests passing.
- `pnpm test` at repo root — one unrelated failure in `@neuve/cookies`
  (`Chrome: extracted cookies have valid expiry timestamps`) because of the
  local Chrome profile state on this machine; not caused by this change. No
  local-agent tests exist (package has no tests directory).

## Manual verification spec

1. Start ollama and pull `gemma4:e4b`:
   ```bash
   ollama pull gemma4:e4b
   ollama serve
   ```
2. From repo root:
   ```bash
   rm -f .perf-agent/local-agent.log
   perf-agent tui -a local -u https://agent.perflab.io
   ```
3. After the run completes, inspect `.perf-agent/reports/latest.json`:
   - `jq '.insightDetails | length' .perf-agent/reports/latest.json` — must be
     **> 0** (previously was 0 with the local agent).
   - `jq '[.insightDetails[] | .insightName] | unique'` — should include
     `LCPBreakdown`, `CLSCulprits`, `RenderBlocking`, `NetworkDependencyTree`
     (the four from a typical agent.perflab.io trace).
   - `jq '[.events[] | select(._tag=="ToolCall" and .toolName=="trace") | .input]'`
     — should show ONE `start` call plus N `analyze` calls, where N equals the
     number of insights. The `analyze` calls are synthetic (emitted by the
     tool-loop, not by the LLM), but from the supervisor's perspective they are
     indistinguishable.
4. Inspect `.perf-agent/local-agent.log`:
   ```bash
   grep "auto-drill-in" .perf-agent/local-agent.log
   ```
   Should show `auto-drill-in planned` once, and `auto-drill-in start` +
   `auto-drill-in complete` pairs for each insight.
5. Sanity check against a non-local agent (`perf-agent tui -a claude -u ...`):
   the gating `functionName === "trace"` + sentinel check is still hit, but
   Claude typically drills in itself. The auto-drill fires regardless and
   produces duplicate analyses — by design (the model-generated analyze calls
   are independent events). For now this is acceptable: duplicates don't break
   the reporter (deduping on `insightName` happens implicitly because
   `InsightDetail` is pushed per `ToolResult` and UI only shows unique names),
   and the fix is explicitly about making local-agent independent of model
   compliance.

   **Note for team-lead:** If duplication with smart agents proves noisy, we
   can later gate the auto-drill-in on a `isLocalAgent` flag threaded through
   `ToolLoopOptions`. Not done here — the local-agent is the only caller of
   `runToolLoop` today (see `packages/local-agent/src/agent.ts:129`), so in
   practice no other agent hits this code path.
