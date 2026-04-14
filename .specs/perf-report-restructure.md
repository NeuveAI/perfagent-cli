# Restructure Perf Report: Pipe DevTools Tool Results into CWV-First Output

## Context

After the Expect → perf-agent pivot, the **report/output layer** is still wired for the old QA-testing flow. When a user runs a performance analysis:

1. The local-agent fires `interact` / `observe` / `trace` tool calls (confirmed working via `.perf-agent/local-agent.log`).
2. Chrome DevTools MCP returns trace data with Core Web Vitals and insight set IDs.
3. The supervisor's executor captures these as `ToolResult` events (confirmed in `packages/supervisor/src/executor.ts:878-889`).
4. **But** the Reporter discards tool results, hardcodes `metrics: [], regressions: []`, and produces a test-step-oriented summary.
5. **And** the TUI results screen only renders `report.steps[]` as a checklist, ignoring `report.metrics[]` and `report.regressions[]` entirely.

End user symptom: "Passed — agent did not execute any test steps" / "Summary: Agent completed without executing any test steps" — even though the agent successfully ran traces against Chrome.

**Goal:** Restructure the output layer so `trace` / `observe` tool results flow into a CWV-first report with metric values, insight summaries, and threshold comparisons — instead of the legacy test-step checklist.

---

## Root Cause (from survey)

| Layer | State | Problem |
|-------|-------|---------|
| `PerfReport` model (`packages/shared/src/models.ts:1071-1109`) | ✅ All fields exist (`metrics`, `regressions`, `traceInsights`) | Never populated |
| Executor (`packages/supervisor/src/executor.ts:844-907`) | ✅ Captures `tool_call` / `tool_call_update` as `ToolResult` events with serialized JSON result strings | None |
| Reporter (`packages/supervisor/src/reporter.ts`) | ❌ Ignores `ToolResult` events, hardcodes empty metrics/regressions, step-centric summary | Needs parser + rewrite |
| Trace tool output shape | ❌ Format not documented in this repo | Needs discovery |
| Results screen (`apps/cli/src/components/screens/results-screen.tsx`) | ❌ Zero CWV / insight / regression rendering; "no test steps" fallback when `steps.length === 0` | Needs perf-first redesign |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ ACP session update: tool_call_update(status: "completed")      │
│   └─ content[0].text = "LCP: 2400ms ... insights: [...]"      │  <── raw DevTools MCP output
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ Executor.addEvent → ToolResult { toolName, result: string }    │  <── already works
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ Reporter.report                                                │
│   ├─ parseTraceOutput(toolResult.result) → CWV + insight IDs  │  <── NEW
│   ├─ populate PerfReport.metrics[]                             │  <── NEW
│   ├─ detect regressions vs. baseline (if any)                  │  <── NEW
│   └─ build perf-focused summary (pass/fail vs. CWV targets)    │  <── NEW
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ TUI results-screen.tsx                                         │
│   ├─ CWV table (LCP / FCP / CLS / INP / TTFB)                 │  <── NEW
│   ├─ Insights list (name + impact)                             │  <── NEW
│   ├─ Regressions panel (metric, delta %, severity)             │  <── NEW
│   └─ Fallback only when NO tool results exist                  │  <── FIX
└────────────────────────────────────────────────────────────────┘
```

---

## Task Graph

```
#16 Capture trace output format (DISCOVERY — unblocks everything)
 │
 ├─→ #17 parseTraceOutput() + tests
 │    └─→ #18 Reporter: populate metrics/regressions
 │         └─→ #19 Reporter: perf-centric summary
 │
 └─→ (in parallel, consumes PerfReport schema)
      #20 TUI: CWV metrics table
       └─→ #21 TUI: insights + regressions

         ▼
      #22 End-to-end verification (Lead)
```

Tasks #17-19 and #20-21 run **in parallel** after #16 is done. They meet at the `PerfReport` schema, which is already defined.

---

## Task Specifications

### #16 — Capture trace output format (discovery)

**Owner:** `discovery` agent.
**Blocks:** #17, #20.

**Work:**
1. Run `perf-agent tui -a local -u https://agent.perflab.io` (or any URL) with a prompt that triggers `trace start` → `trace stop`.
2. Before running, add `console.error(JSON.stringify(result, null, 2))` in `packages/browser/src/devtools-client.ts` `callTool` function, OR tail `.perf-agent/local-agent.log` which already logs tool responses.
3. Capture at minimum:
   - `performance_start_trace` response
   - `performance_stop_trace` response (the critical one — contains CWV + insight IDs)
   - `performance_analyze_insight` response for one insight (e.g. `LCPBreakdown`)
4. Document the exact shape — field names, units (ms? seconds?), whether values are strings or numbers, insight ID structure.

**Output:** `.specs/trace-output-format.md` with:
- 3 annotated example payloads (pretty-printed)
- Field-by-field reference table (name, type, unit, always-present?)
- Notes on any edge cases (e.g., missing metrics when a page doesn't fire LCP)

**Revert** any temporary debug prints before finishing.

---

### #17 — parseTraceOutput()

**Owner:** `data-pipeline` agent.
**Blocks:** #18.
**Depends on:** #16.

**Create:** `packages/shared/src/parse-trace-output.ts`

**Signature:**

```ts
export interface ParsedTraceMetrics {
  url?: string;
  lcpMs?: number;
  fcpMs?: number;
  clsScore?: number;
  inpMs?: number;
  ttfbMs?: number;
  totalTransferSizeKb?: number;
  insightIds: string[]; // insight set IDs that can be passed to trace analyze
}

export const parseTraceOutput: (toolResultText: string) => ParsedTraceMetrics | undefined;
```

**Requirements:**
- Accept the raw `result` string from a `performance_stop_trace` `ToolResult`.
- Handle both JSON and text shapes gracefully (whichever #16 reveals — likely a mix).
- Return `undefined` if the string clearly isn't a trace output.
- Never throw — missing fields should just be `undefined` in the returned object.
- Must use `interface`, arrow functions only, no `type` aliases. No barrel files.

**Tests:** `packages/shared/tests/parse-trace-output.test.ts` — at least:
- Round-trip of each example captured in #16.
- Malformed input returns `undefined`.
- Partial payload (missing INP, for example) returns a partial object.

---

### #18 — Reporter: populate metrics/regressions

**Owner:** `data-pipeline` agent.
**Blocks:** #19, #22.
**Depends on:** #17.

**Modify:** `packages/supervisor/src/reporter.ts`

**Changes:**
1. Filter `report.events` for `ToolResult` where `toolName` includes `performance_stop_trace` and `isError === false`.
2. For each, call `parseTraceOutput` (from #17), map the result into a `PerfMetricSnapshot`:
   - `url`: derive from the most recent preceding `ToolResult` where `toolName === "navigate_page"` (parse its input from the matching `ToolCall` event) or the original `targetUrls`, fallback to `"unknown"`.
   - `lcpMs` / `fcpMs` / `clsScore` / `inpMs` / `ttfbMs` / `totalTransferSizeKb`: from parsed output.
   - `traceInsights`: populate with the `insightIds` array (the `PerfMetricSnapshot.traceInsights` schema field).
   - `collectedAt`: `new Date().toISOString()` or the event's timestamp if available.
3. Populate `PerfReport.metrics` with all snapshots (one per `performance_stop_trace` call).
4. For regressions: if `PerfBudget` fields are set on the plan, compare and emit `PerfRegression` entries with `severity`:
   - `critical` if value > 2× budget
   - `warning` if value > budget but ≤ 2× budget
   - `info` for borderline (> 90% of budget)
   - Use `baselineValue = budget`, `currentValue = measured`, `percentChange = ((measured - budget) / budget) * 100`.
5. Leave `PerfReport.regressions` as `[]` if no budget configured (don't invent a baseline).

**Effect patterns:** use `Effect.fn`, `Effect.gen`, `Effect.forEach`. No explicit return types. Use `Option` not `null`.

---

### #19 — Reporter: perf-centric summary

**Owner:** `data-pipeline` agent.
**Depends on:** #18.

**Modify:** the summary-string construction in `packages/supervisor/src/reporter.ts`.

**Replace** "N steps completed / M failed" style with:
- If `metrics.length === 0` **and** no `ToolResult` events exist: "Agent did not run any performance tools."
- If `metrics.length === 0` **but** `ToolResult` events exist: "Agent ran {toolCount} tools but did not capture a performance trace. Results may be in console/network output."
- Otherwise: one-line CWV table + any regressions. e.g.

  ```
  Captured 2 traces across https://example.com, https://example.com/chat.
  LCP: 2.4s ✓  FCP: 1.2s ✓  CLS: 0.05 ✓  INP: 180ms ✓  TTFB: 420ms ✓
  No regressions vs. budget.
  ```

- Include insight IDs if present: "Insights available: LCPBreakdown, RenderBlocking, DocumentLatency".
- Use `success` / `warning` / `error` classification based on whether any metric exceeds its CWV "poor" threshold (the legacy `PassFail` model still fits here: all good → pass, any poor → fail).

**Note:** Keep the existing `status` field semantics (`pass` / `fail`) — just drive them from CWV thresholds instead of step counts.

---

### #20 — TUI: CWV metrics table

**Owner:** `ui-presentation` agent.
**Blocks:** #21, #22.
**Can start in parallel with #17-19.**

**Modify:** `apps/cli/src/components/screens/results-screen.tsx`

**Changes:**
1. Add a new section rendered when `report.metrics.length > 0`, positioned **above** the existing step list. Component name: `<PerfMetricsTable report={report} />` inline in the same file.
2. Render a compact table per metric snapshot:
   ```
   https://example.com
   ───────────────────────────────────────────
   Metric  │ Value    │ Target   │ Status
   ────────┼──────────┼──────────┼─────────
   LCP     │ 2.4 s    │ < 2.5 s  │ ✓ good
   FCP     │ 1.2 s    │ < 1.8 s  │ ✓ good
   CLS     │ 0.05     │ < 0.1    │ ✓ good
   INP     │ 180 ms   │ < 200 ms │ ✓ good
   TTFB    │ 420 ms   │ < 800 ms │ ✓ good
   ```
3. Use `Box` + `Text` from Ink. Use colors: green for good, yellow for needs-improvement, red for poor. No ternaries in JSX (use `&&`).
4. Skip rows where the metric is `undefined` (not all pages emit every metric).
5. If `metrics.length === 0`, do not render this component.

**Thresholds** (constants in the same file or a new `apps/cli/src/utils/cwv-thresholds.ts`):

| Metric | Good | Poor |
|--------|------|------|
| LCP    | 2500 | 4000 |
| FCP    | 1800 | 3000 |
| CLS    | 0.1  | 0.25 |
| INP    | 200  | 500  |
| TTFB   | 800  | 1800 |

---

### #21 — TUI: insights + regressions

**Owner:** `ui-presentation` agent.
**Depends on:** #20.

**Modify:** `apps/cli/src/components/screens/results-screen.tsx`

**Add two sections:**

1. **Insights list** — below the CWV table, render `metric.traceInsights` as a bullet list:
   ```
   Trace insights (drill in via `trace analyze` with insightSetId):
     • LCPBreakdown
     • RenderBlocking
     • DocumentLatency
   ```
   Skip if all snapshots have empty `traceInsights`.

2. **Regressions panel** — render `report.regressions[]` with severity-colored bullets:
   ```
   Regressions:
     ✗ LCP on /chat — 3200ms (target 2500ms, +28% critical)
     ⚠ INP on /      —  380ms (target 200ms, +90% warning)
   ```
   Red for critical, yellow for warning, dim for info. Skip if empty.

**Also fix:** Remove the "agent did not execute any test steps" message when `report.metrics.length > 0` OR when `report.events` contains any `ToolResult`. The fallback should only show in the true no-tool-output case.

---

### #22 — End-to-end verification

**Owner:** Lead (me).
**Depends on:** #18, #19, #21.

**Steps:**
1. `pnpm typecheck && pnpm build` — all green.
2. Run `perf-agent tui -a local -u https://agent.perflab.io` with the original user query: *"verify the performance of agent.perflab.io from main page to chat page and enter a basic chat query. Lets evaluate the core web-vitals and see what insights we have"*.
3. Confirm the TUI shows:
   - A CWV metrics table with real numbers (not "no test steps").
   - At least one URL's CWV snapshot.
   - Insight IDs if any traces produced insights.
4. Verify `.perf-agent/local-agent.log` shows the tool flow is unchanged (no regressions in the agent side).
5. Unit tests in `@neuve/shared` for the parser pass (`pnpm --filter @neuve/shared test`).

If any step fails, file a follow-up task referencing the specific break.

---

## Dependencies Summary

| Task | Blocks | Depends on | Parallelizable? |
|------|--------|------------|-----------------|
| #16 | #17, #20 | — | First — gates everything |
| #17 | #18 | #16 | Sequential in data-pipeline stream |
| #18 | #19, #22 | #17 | Sequential in data-pipeline stream |
| #19 | #22 | #18 | Sequential in data-pipeline stream |
| #20 | #21, #22 | #16 | Yes — parallel with #17-19 |
| #21 | #22 | #20 | Sequential in ui-presentation stream |
| #22 | — | #19, #21 | Lead only |

Two parallel streams after #16: `data-pipeline` (#17 → #18 → #19) and `ui-presentation` (#20 → #21). Meet at `PerfReport` schema (already defined), integrate at #22.

---

## Risks

- **Trace output format surprises** — if chrome-devtools-mcp returns heavily nested structures or non-JSON text, the parser may need a more robust approach. #16 mitigates by capturing real examples first.
- **Multiple URL traces** — reporter needs to correctly associate each `performance_stop_trace` with its preceding `navigate_page`. If this matching is fragile, consider tracking "current URL" as reporter state.
- **Empty `totalTransferSizeKb`** — may not be in the stop_trace output at all. Acceptable to leave `undefined`; harvest from `list_network_requests` later as a separate feature.
- **TUI width constraints** — CWV table on narrow terminals may need truncation. Keep the layout forgiving.
