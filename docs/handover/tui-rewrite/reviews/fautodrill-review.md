# Review: F-AutoDrill -- Programmatic trace analyze drill-ins in local-agent tool-loop

## Verdict: APPROVE

The core idea is sound: after a `trace stop` result arrives, parse the insight
list with `@neuve/shared/parse-trace-output`, then synthesize per-insight
`tool_call` + `tool_call_update` ACP events so the supervisor's existing
`ExecutedPerfPlan.addEvent` machinery turns each one into its own `ToolResult`
that the reporter's `isInsightDetailResult` already handles. Scope is correctly
limited to `packages/local-agent/src/tool-loop.ts` + a new workspace dep in
`packages/local-agent/package.json`. No reporter change needed — the engineer
correctly identified the existing per-ToolResult parse behaviour would handle
each drill-in.

### Findings

- [Critical] None.
- [Major] None.
- [Minor] **Brittle tool-name gate.** Detection uses
  `functionName === "trace"` (tool-loop.ts:207). The supervisor's
  `reporter.ts:56-57` already handles both `"trace"` and
  `toolName.startsWith("performance_")`, implying the tool name is not
  guaranteed forever. If chrome-devtools-mcp ever renames/adds a variant,
  auto-drill silently no-ops. Consider mirroring
  `isTraceToolName` (cheap: `name === "trace" || name.startsWith("performance_")`).
  Non-blocking — current MCP ships the tool as `"trace"`.
- [Minor] **Synthetic `tool_call`'s nested `rawInput` is invisible to
  `findPrecedingInsightSetId`.** `analyzeArgs` is shaped
  `{ action: { command, insightSetId, insightName } }`. `reporter.ts:85-92`
  inspects `decoded["insightName"]` at top level, so it cannot recover the
  `insightSetId` for synthetic calls (or for normal LLM-generated calls, which
  use the same nested shape). Result: `InsightDetail.insightSetId` ends up
  `Option.none()` for every auto-drill entry. This is a pre-existing reporter
  limitation — not introduced here. Filing as minor because it weakens the
  `enricher`'s future dedupe (`insight-enricher.ts:41-45` only uses
  `existingNames` when `insightSetId` is `none`, so dedupe still works).
- [Minor] **No duplicate guard for self-drilling agents.** The engineer
  acknowledges this in the diary: if a future agent routed through
  `runToolLoop` (other than the local one) also calls `trace analyze`, both
  the LLM-originated call and the auto-drill land as separate `ToolResult`
  events and therefore separate `InsightDetail`s. UI in
  `apps/cli-solid/src/routes/results/insights-overlay.tsx:31-38` iterates
  `insightDetails` directly with no dedupe, so duplicates would show up in
  the TUI list. Today `runToolLoop` has exactly one caller
  (`packages/local-agent/src/agent.ts`), so this is latent. A single-line
  guard later (e.g. `ToolLoopOptions.autoDrill: boolean`) would future-proof
  it; not blocking today.

### Verification

- `bunx tsc --noEmit -p packages/local-agent/tsconfig.json`: two errors,
  both in `src/ollama-client.ts` lines 29 and 36 (`num_ctx` / unused
  `@ts-expect-error`). Confirmed pre-existing via
  `git log -p packages/local-agent/src/ollama-client.ts` — they date to the
  original commit `e44cb93b` ("feat: add @neuve/local-agent ACP agent for
  Ollama") and are unrelated to this patch. `tool-loop.ts` itself is clean.
- `pnpm --filter @neuve/shared test`: 10 files, **118 passed** (matches the
  113 → 118 delta explained by F-Prompt's 5 new tests in `prompts.test.ts`).
- `pnpm --filter @neuve/supervisor test`: 9 files, **68 passed**.
- `pnpm --filter @neuve/local-agent test`: no test script / no tests
  directory — confirmed.
- `git diff packages/local-agent/src/tool-loop.ts
  packages/local-agent/package.json`: changes strictly within the claimed
  scope (the `package.json` adds a single `@neuve/shared: workspace:*`
  entry, the tool-loop patch is contained to the new helper + sentinel
  detection + drill-in loop). Other `git status` modifications (`agent.ts`,
  `system-prompt.ts`, `prompts.ts`, `prompts.test.ts`, `acp-client.ts`,
  `insight-enricher.ts`, session-history, execution-atom, run-test) belong
  to parallel tasks F-Prompt (#18) and F-Catalog (#20) — **no F-AutoDrill
  bleed into those files**, verified.

### Correctness spot-checks

1. **Detection fires only on stop, not start**: predicate is
   `!isError && functionName === "trace" &&
   baseMessageText.includes(TRACE_STOPPED_SENTINEL)`. The sentinel is only
   emitted by chrome-devtools-mcp's `trace stop` path. `start` without
   `autoStop` returns tracing status text without the sentinel, so
   `collectAutoDrillTargets` returns `[]`. `start` with `autoStop: true`
   returns stop-shaped output, which is the intended trigger. ✓
2. **`parseTraceOutput` shape**: confirmed at
   `packages/shared/src/parse-trace-output.ts:1-16` — returns
   `ParsedTraceMetrics[]` each with `insights: { insightSetId, insightName }[]`.
   Engineer's `collectAutoDrillTargets` traverses exactly this shape,
   deduped on `"${insightSetId}::${insightName}"`. ✓
3. **Synthetic events parseable by reporter**: `ToolResult.result =
   serializeToolResult(update.rawOutput)`
   (`packages/shared/src/models.ts:954`). Engineer passes
   `rawOutput: analyzeResult.text` (a string);
   `serializeToolResult` passes strings through verbatim
   (`models.ts:702-710`). The reporter's `isInsightDetailResult` checks
   `result.trim().startsWith("## Insight Title:")` — this is exactly what a
   successful `trace analyze` output starts with (per
   `parse-insight-detail.ts:10,80-87`). ✓
4. **ACP shape compliance**: `AcpToolCall` requires `sessionUpdate`,
   `toolCallId`, `title`, and accepts optional `kind`, `status`, `rawInput`,
   `content`, `rawOutput` (`models.ts:107-117`). `AcpToolCallUpdate` accepts
   same plus nullable forms (`models.ts:119-129`). Synthetic events set all
   required fields and the content uses the `{ type: "content", content: { type:
   "text", text } }` variant defined at `models.ts:63-67`. ✓
5. **Per-drill error isolation**: `try { analyzeResult = await
   mcpBridge.callTool(...) } catch { analyzeResult = { text, isError: true } }`
   ensures a thrown MCP error does not abort the loop. `mcpBridge` already
   returns `{ isError: true }` for validation errors without throwing, so
   both paths are covered. Errors still emit a `failed` `tool_call_update`
   and get surfaced to the LLM as
   `### ${insightName}: error — ${msg}`. ✓
6. **Abort propagation**: `signal.aborted` check at tool-loop.ts:219 runs
   before each drill-in. `mcpBridge.callTool` signature doesn't take a
   signal (mcp-bridge.ts:25), so an in-flight drill call cannot be
   interrupted mid-request — but this is identical to the existing
   non-drill path and is not a regression.
7. **Ordering**: engineer iterates `snapshots[].insights[]` in order,
   dedupe via `Set`; matches `parseTraceOutput`'s natural emission order.
   The LLM's final tool-result message joins analyses with `---` in the
   same order. ✓

### Style / CLAUDE.md compliance

- `interface AutoDrillTarget` uses `interface`, not `type`. ✓
- `"analyze" as const` is literal narrowing, not a type cast that subverts
  the type system — permitted by the `as` rule spirit. ✓
- No `null`. ✓
- Arrow function for `collectAutoDrillTargets`. ✓
- Descriptive variable names (`targets`, `analyzeArgs`, `analyzeCallId`,
  `analyzeResult`, `errorText`, `analyses`, `combinedLlmText`). ✓
- No added comments. ✓
- No new files, so no kebab-case question. ✓
- Logs via existing `log()` helper (not `console.log`); payloads contain
  only DevTools identifiers (insightSetId / insightName / booleans), no
  PII, no secrets. ✓

### Agreement with engineer's stated non-blocking note

Engineer's note: "auto-drill fires whenever any agent uses `runToolLoop` AND
returns a trace stop result — but `runToolLoop` is only invoked by
`packages/local-agent/src/agent.ts`, so in practice only the local agent."
Verified via `grep -r runToolLoop packages apps` — only two matches,
`tool-loop.ts` itself and `packages/local-agent/src/agent.ts`. Agree; the
duplicate-with-self-drilling-agent case is latent and can be addressed
later with a flag on `ToolLoopOptions`.

### Approval rationale

The patch implements the spec correctly, keeps scope tight, passes all
verifiable checks (types in-scope clean; pre-existing `ollama-client`
errors independently confirmed; shared 118/118; supervisor 68/68), and
the diary's choice to emit separate synthetic ACP events instead of
modifying the reporter is demonstrably the right call — verified by
tracing the data path from `rawOutput` → `ToolResult.result` →
`isInsightDetailResult`. The three minor findings are either latent
future-proofing concerns or pre-existing reporter limitations, none of
which block this change.
