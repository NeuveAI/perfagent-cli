# Perf Report Restructure — Round 2: Gaps & Bug Fixes

## Context

Round 1 (`.specs/perf-report-restructure.md`) wired the parser, reporter, and TUI for CWV output. Running it end-to-end exposed:

1. **Hot bug** — reporter filter uses raw DevTools MCP tool names (`performance_stop_trace`), but the local agent sees the 3 **macro** tools (`interact` / `observe` / `trace`). Captured `ToolResult.toolName` is `"trace"`. Filter never matches → "Agent ran 8 tools but did not capture a performance trace" even when it did.
2. **Insight drill-in never surfaced** — `performance_analyze_insight` text is dropped on the floor; we only show insight *names*.
3. **Console + network captures not modeled** — `observe console` / `observe network` text blobs live only in raw `ToolResult.result` strings; no parser, no domain model, no UI.
4. **`PerfRegression.metric` is a raw `Schema.String`** — should be a typed label so the reporter and TUI don't disagree on what `"LCP"` vs `"lcp"` means.
5. **CI JSON output is stale** — `CiResultOutput` still emits step checklists, not CWV metrics / regressions / captures.

---

## Fix-priority grouping

```
P0 HOT FIX
  #24 Reporter filter uses sentinel, not raw tool name

P1 SCHEMA TIGHTENING (parallel to P0)
  #25 Typed PerfMetricLabel enum, propagated into PerfRegression & reporter

P2 OBSERVABILITY CAPTURE (discovery-first, then fan-out)
  #26 Discovery: capture real outputs for list_console_messages,
      list_network_requests, performance_analyze_insight
   ├─→ #27a Parser: parse-console-output
   ├─→ #27b Parser: parse-network-requests
   └─→ #27c Parser: parse-insight-detail
         └─→ #28 Reporter populates consoleCaptures[], networkCaptures[],
                insightDetails[] on PerfReport
              └─→ #29 TUI renders console / network / insight-detail panels

P3 CI JSON OUTPUT (blocked by #25 + #28)
  #30 CiResultOutput emits metrics, regressions, captures

P4 VERIFICATION
  #31 End-to-end run against agent.perflab.io; confirm:
        - CWV table renders with real values
        - Console / network panels show captured content
        - Insight drill-in content visible
        - Saved flow round-trip still works
```

---

## Task specs

### #24 — Reporter filter uses sentinel (HOT FIX)

**File:** `packages/supervisor/src/reporter.ts`

**Change:** drop the tool-name prefix check. Filter `ToolResult` events by:
- `!isError`
- `result` contains sentinel `"The performance trace has been stopped."`

Optionally keep a cheap pre-filter of `toolName === "trace" || toolName.startsWith("performance_")` to avoid scanning unrelated tool bodies. Do not require the raw `performance_stop_trace` name.

**Tests:** add one test in `packages/supervisor/tests/reporter.test.ts` (create the file if it doesn't exist) asserting that a `ToolResult` with `toolName: "trace"` and a body containing the stopped-sentinel produces a populated `PerfReport.metrics`.

**Verify:** run end-to-end (manually) against `agent.perflab.io` to confirm CWV table renders after the agent's `trace stop`.

---

### #25 — Typed `PerfMetricLabel` enum

**Files:**
- `packages/shared/src/cwv-thresholds.ts`
- `packages/shared/src/models.ts`
- `packages/supervisor/src/reporter.ts`
- `apps/cli/src/components/screens/results-screen.tsx` (regression formatter)

**Add** in `cwv-thresholds.ts`:
```ts
export type PerfMetricLabel = CwvMetric | "TotalTransferSize";
export const PERF_METRIC_LABELS: readonly PerfMetricLabel[] = [
  "LCP", "FCP", "CLS", "INP", "TTFB", "TotalTransferSize",
];
```

**Change** `PerfRegression.metric` schema from `Schema.String` to `Schema.Literals([...PERF_METRIC_LABELS])`.

**Replace** reporter's local `BUDGET_FIELDS` label strings with imports from the enum. The reporter already produces matching labels (`"LCP"`, `"TotalTransferSize"` etc.), so no data migration is needed — this is a type-tightening change.

**TUI** `formatRegressionValue` (currently case-insensitive lookup) can now do a direct typed lookup. Remove the string-fallback branch.

**Verify:** `pnpm typecheck` + reporter tests still pass.

---

### #26 — Discovery: real outputs for console / network / insight-detail

**Owner:** `discovery` agent. Mirror the pattern of Round 1's `#16`.

**Capture verbatim:**
1. `list_console_messages` — including errors, warnings, and info levels if possible
2. `list_network_requests` — include at least one image, one XHR/fetch, and one failed request if the target page has them
3. `performance_analyze_insight` — for at least 2 insights (e.g. `LCPBreakdown` was captured in round 1 — also grab `DocumentLatency` and `RenderBlocking` which have different body shapes per round-1 notes)

**Path:** prefer Path B (add temporary `console.error` with sentinel prefix to `packages/browser/src/devtools-client.ts` `callTool`, run `perf-agent tui -a local -u https://agent.perflab.io`, tail the log). Revert the debug prints before finishing.

**Output:** extend or sibling `.specs/trace-output-format.md` — prefer a sibling file `.specs/observability-output-format.md` so each spec stays focused. Cover:
- 1 verbatim example per tool (pretty-printed if JSON, as-is if text)
- Field reference table per tool (field, type, unit, always-present, maps-to)
- Edge cases (what does `list_console_messages` look like for a clean page?)

**Revert** any debug prints before finishing.

---

### #27a — `parseConsoleOutput()`

**Owner:** `data-pipeline`. **Depends on:** #26.

**Create** `packages/shared/src/parse-console-output.ts`:

```ts
export interface ParsedConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  source?: string;    // "console-api" | "network" | "javascript" | …
  url?: string;       // file URL if stack trace is present
}

export const parseConsoleOutput: (toolResultText: string) => ParsedConsoleEntry[];
```

**Tests:** at least 4 — happy path from #26 sample, empty list, malformed input returns `[]`, error-only vs mixed levels.

---

### #27b — `parseNetworkRequests()`

**Owner:** `data-pipeline`. **Depends on:** #26.

**Create** `packages/shared/src/parse-network-requests.ts`:

```ts
export interface ParsedNetworkRequest {
  url: string;
  method: string;
  status?: number;
  resourceType?: "document" | "stylesheet" | "script" | "image" | "font" | "fetch" | "xhr" | "other";
  transferSizeKb?: number;
  durationMs?: number;
  failed?: boolean;
}

export const parseNetworkRequests: (toolResultText: string) => ParsedNetworkRequest[];
```

**Tests:** at least 4 — happy path, empty list, malformed, one failed request.

---

### #27c — `parseInsightDetail()`

**Owner:** `data-pipeline`. **Depends on:** #26.

**Create** `packages/shared/src/parse-insight-detail.ts`:

```ts
export interface ParsedInsightDetail {
  insightName: string;           // "LCPBreakdown" | "DocumentLatency" | …
  title: string;                 // "## Insight Title:"
  summary: string;               // "## Insight Summary:"
  analysis: string;              // raw "## Detailed analysis:" body
  estimatedSavings?: string;     // raw string or undefined when "none"
  externalResources: string[];   // URLs under "## External resources:"
}

export const parseInsightDetail: (toolResultText: string) => ParsedInsightDetail | undefined;
```

Narrative text is fine to keep as a single `analysis` blob (don't attempt to parse LCP phase percentages, etc. — future work).

**Tests:** at least 3 — LCPBreakdown sample, DocumentLatency sample, non-insight text returns `undefined`.

---

### #28 — Reporter populates captures on `PerfReport`

**Owner:** `data-pipeline`. **Depends on:** #27a, #27b, #27c, #25.

**Schema changes** in `packages/shared/src/models.ts` — extend `PerfReport`:

```ts
consoleCaptures: Schema.Array(ConsoleCapture),   // { url, entries: ParsedConsoleEntry[] }
networkCaptures: Schema.Array(NetworkCapture),   // { url, requests: ParsedNetworkRequest[] }
insightDetails: Schema.Array(InsightDetail),     // { insightSetId, insightName, title, summary, analysis, ... }
```

Define `ConsoleCapture`, `NetworkCapture`, `InsightDetail` as `Schema.Class` siblings of `PerfMetricSnapshot`.

**Reporter rewrite** in `packages/supervisor/src/reporter.ts`:
- Filter `ToolResult` events for each of: `observe console` (or `list_console_messages`), `observe network` (or `list_network_requests`), `trace analyze` (or `performance_analyze_insight`)
- Use the **same sentinel-or-loose-tool-name** strategy from #24 — sentinels:
  - Console: distinctive header line (discover in #26, e.g. `"Console messages:"`)
  - Network: distinctive header line (discover in #26)
  - Insight detail: `"## Insight Title:"`
- Call the respective parser, build the capture objects, populate the new fields

**Verify:** extend `packages/supervisor/tests/reporter.test.ts` to assert that a report with all three types of tool results produces populated `consoleCaptures`, `networkCaptures`, `insightDetails`.

---

### #29 — TUI renders console / network / insight-detail panels

**Owner:** `ui-presentation`. **Depends on:** #28 schema.

**File:** `apps/cli/src/components/screens/results-screen.tsx`.

**Add three new collapsible sections** below the existing Regressions panel:

1. **Console messages** — grouped by `url`, collapsible. Show count by level (e.g. `"3 errors, 5 warnings"`). If expanded, list entries with color-coded level prefix (red error, yellow warn, default info/log, dim debug). Truncate long lines to terminal width - 4.
2. **Network requests** — grouped by `url`, collapsible. Header shows totals (e.g. `"48 requests, 1.2 MB transferred"`). If expanded, list requests with: method, status (green 2xx, yellow 3xx, red 4xx/5xx), resource-type tag, transfer size, duration. Highlight failed requests.
3. **Insight drill-ins** — one collapsible block per `InsightDetail`. Header: `insightName` + title. Body: summary + analysis (wrap at terminal width).

Use `Box` + `Text` from Ink. Expand/collapse via keyboard:
- `c` toggles all console panels
- `n` toggles all network panels
- `i` toggles all insight panels
- Update the modeline (`apps/cli/src/components/ui/modeline.tsx`) footer hints with the new keys

No ternaries in JSX — use `&&` or helper components. No `useMemo`/`useCallback`/`React.memo` (React Compiler).

Skip each panel when the corresponding capture array is empty.

**Verify:** `pnpm typecheck && pnpm build`. Visual verification via E2E #31.

---

### #30 — CI JSON output emits perf data

**Owner:** `data-pipeline`. **Depends on:** #25, #28.

**File:** `packages/shared/src/models.ts` — `CiResultOutput` (currently at ~line 1183).

**Add** alongside the existing fields:

```ts
metrics: Schema.Array(PerfMetricSnapshot),
regressions: Schema.Array(PerfRegression),
insightNames: Schema.Array(Schema.String),   // deduped drill-in candidates
```

Remove `steps: Schema.Array(CiStepResult)` — keep `CiStepResult` temporarily if any code in `packages/supervisor/` still builds it, but drop from the output schema. Grep first to confirm no consumer reads it.

**Update emitter** — find where `CiResultOutput` is constructed (likely in `packages/supervisor/src/reporter.ts` or a sibling file in the supervisor package) and wire the new fields from `PerfReport`.

**Verify:** supervisor tests pass; if a `ci-result-output.test.ts` exists, update its expected JSON shape.

---

### #31 — End-to-end verification

**Owner:** Lead.

**Steps:**
1. `pnpm check` — typecheck + lint + format + tests green
2. `perf-agent tui -a local -u https://agent.perflab.io` with the original query: *"verify the performance of agent.perflab.io from main page to chat page and enter a basic chat query. Lets evaluate the core web-vitals and see what insights we have"*
3. Confirm:
   - CWV metrics table renders with real values (not the "didn't capture a trace" fallback)
   - `c`, `n`, `i` keys expand console / network / insight panels
   - At least one insight drill-in shows `## Detailed analysis:` content
   - Saved flow (`s` in footer) still works; reload the flow and re-run

If any step fails, file a follow-up task.

---

## Dependency summary

| Task | Owner | Blocks | Depends on | Parallel with |
|------|-------|--------|------------|---------------|
| #24 | data-pipeline | #31 | — | #25, #26 |
| #25 | data-pipeline | #28, #30, #31 | — | #24, #26 |
| #26 | discovery | #27a, #27b, #27c | — | #24, #25 |
| #27a | data-pipeline | #28 | #26 | #27b, #27c |
| #27b | data-pipeline | #28 | #26 | #27a, #27c |
| #27c | data-pipeline | #28 | #26 | #27a, #27b |
| #28 | data-pipeline | #29, #30, #31 | #27a, #27b, #27c, #25 | — |
| #29 | ui-presentation | #31 | #28 (schema) | #30 |
| #30 | data-pipeline | #31 | #25, #28 | #29 |
| #31 | Lead | — | #24, #29, #30 | — |

Two streams run in parallel after #26 completes: `data-pipeline` owns the parser + reporter + CI work (sequential within stream after #27 fans back in), `ui-presentation` owns the TUI. Lead integrates at #31.

---

## Risk register

- **Console/network tool output is large** — long pages can emit hundreds of requests. Keep parsed arrays bounded (consider a cap like 500 entries; log a truncation notice). Avoid storing full response bodies in `ParsedNetworkRequest`.
- **Macro-tool names may vary** — the agent can call `observe` / `trace` / `interact` with different command values. Use **sentinel-based discrimination** in the reporter filter instead of relying on tool-name equality. Confirm sentinels in #26.
- **Schema change cascade** — adding fields to `PerfReport` may break serialized flows. Verify `flow-storage.ts` (and its tests) still round-trip. Nothing currently writes `PerfReport` to disk, but `SavedFlowFileData` includes `PerfPlan` — grep before changing anything upstream of `PerfReport`.
- **Insight drill-in may not be triggered by the current system prompt** — if the agent doesn't call `trace analyze`, the insightDetails array will be empty even when CWVs are captured. #28 must tolerate that gracefully; #31 must note whether the agent exercised the drill-in.
- **TUI width** — 3 more collapsible panels on narrow terminals will require forgiving layout. Keep default state collapsed; only expand on explicit key press.
