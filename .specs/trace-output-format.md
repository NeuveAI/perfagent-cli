# Trace Output Format — `chrome-devtools-mcp@0.21.0`

Captured on 2026-04-14 against `https://agent.perflab.io/` using the MCP client directly (Path B). Each `ToolResult` arrives as a standard MCP `CallToolResult` — an array of content blocks; the performance tools always return a single `{ type: "text", text: string }` block. The `text` payload is plain Markdown-ish text (not JSON) and that's the string the executor captures as `ToolResult.result`.

The downstream parser should treat `content[0].text` as the only source of truth and parse it as text. There is a `structuredContent` field on the raw MCP response (see `McpResponse.js#format`) that also carries `traceSummary` + `traceInsights[]`, but the `@modelcontextprotocol/sdk` client surface used by `DevToolsClient.callTool` ignores it (only `content` is forwarded), so the parser must cope with text.

---

## Example 1 — `performance_start_trace`

There are two observed shapes depending on whether the caller sets `autoStop`.

### 1a. With `autoStop: true` (our default in `DevToolsClient.startTrace`)

`performance_start_trace` internally runs the full start → navigate → wait → stop → parse pipeline, so the response is **identical** to a `performance_stop_trace` response (see Example 2). This means if you only ever call `startTrace({ reload: true, autoStop: true })`, you'll never see a separate stop_trace event — the start_trace result itself carries the CWV summary. The reporter must be ready to parse CWV out of either tool's result string.

### 1b. With `autoStop: false`

Trivial acknowledgement, no data.

```json
{
  "content": [
    {
      "type": "text",
      "text": "The performance trace is being recorded. Use performance_stop_trace to stop it."
    }
  ]
}
```

**Useful for the reporter?** No — purely a status acknowledgement. Only `autoStop: true` / subsequent `stop_trace` carry data.

**Note:** If an invocation errors (e.g. Chrome profile already in use), `isError: true` is set and the `text` is a human-readable error. Example observed during capture:

```json
{
  "content": [
    {
      "type": "text",
      "text": "The browser is already running for /Users/vinicius/.cache/chrome-devtools-mcp/chrome-profile. Use --isolated to run multiple browser instances.\nCause: ..."
    }
  ],
  "isError": true
}
```

Our `DevToolsClient.callTool` already converts `isError: true` into a `DevToolsToolError`, so the reporter will never see those strings.

---

## Example 2 — `performance_stop_trace`  *(the critical one)*

Full verbatim text from `content[0].text` (newlines rendered). This is what `parseTraceOutput` must chew on.

```
The performance trace has been stopped.
## Summary of Performance trace findings:
URL: https://agent.perflab.io/
Trace bounds: {min: 2424992414386, max: 2424998473669}
CPU throttling: none
Network throttling: none

# Available insight sets

The following is a list of insight sets. An insight set covers a specific part of the trace, split by navigations. The insights within each insight set are specific to that part of the trace. Be sure to consider the insight set id and bounds when calling functions. If no specific insight set or navigation is mentioned, assume the user is referring to the first one.

## insight set id: NAVIGATION_0

URL: https://agent.perflab.io/
Bounds: {min: 2424992414386, max: 2424998473669}
Metrics (lab / observed):
  - LCP: 100 ms, event: (eventKey: r-5608, ts: 2424992514157), nodeId: 321
  - LCP breakdown:
    - TTFB: 7 ms, bounds: {min: 2424992414386, max: 2424992421798}
    - Render delay: 92 ms, bounds: {min: 2424992421798, max: 2424992514157}
  - CLS: 0.00, event: (eventKey: s-20667, ts: 2424993502311)
Metrics (field / real users): n/a – no data for this page in CrUX
Available insights:
  - insight name: LCPBreakdown
    description: Each [subpart has specific improvement strategies](https://developer.chrome.com/docs/performance/insights/lcp-breakdown). Ideally, most of the LCP time should be spent on loading the resources, not within delays.
    relevant trace bounds: {min: 2424992414386, max: 2424992514157}
    example question: Help me optimize my LCP score
    example question: Which LCP phase was most problematic?
    example question: What can I do to reduce the LCP time for this page load?
  - insight name: CLSCulprits
    description: Layout shifts occur when elements move absent any user interaction. ...
    relevant trace bounds: {min: 2424993502311, max: 2424994502311}
    example question: Help me optimize my CLS score
    example question: How can I prevent layout shifts on this page?
  - insight name: RenderBlocking
    description: Requests are blocking the page's initial render, which may delay LCP. ...
    relevant trace bounds: {min: 2424992433454, max: 2424992437454}
    estimated metric savings: FCP 0 ms, LCP 0 ms
    example question: Show me the most impactful render-blocking requests that I should focus on
    example question: How can I reduce the number of render-blocking requests?
  - insight name: NetworkDependencyTree
    description: [Avoid chaining critical requests](https://developer.chrome.com/docs/performance/insights/network-dependency-tree) ...
    relevant trace bounds: {min: 2424992414722, max: 2424992472899}
    example question: How do I optimize my network dependency tree?

## Details on call tree & network request formats:
Information on performance traces may contain main thread activity represented as call frames and network requests.

Each call frame is presented in the following format:

'id;eventKey;name;duration;selfTime;urlIndex;childRange;[line];[column];[S]'

Key definitions:
... [long format description continues for ~70 lines: call frame legend + network request legend]
```

**Format observations:**

1. It is **plain text**, not JSON. There is Markdown-style heading structure (`#`, `##`) but no code fences. No JSON object appears anywhere in the payload.
2. The first sentinel line is always `The performance trace has been stopped.` — a good "is this a trace result?" discriminator for `parseTraceOutput`.
3. The `## Summary of Performance trace findings:` heading and its block (`URL:`, `Trace bounds:`, `CPU throttling:`, `Network throttling:`) are always present.
4. The **"Available insight sets"** section contains zero or more `## insight set id: <ID>` blocks. Each insight set has its own URL, Bounds, Metrics, and Available-insights sub-list. Multiple navigations = multiple insight sets in the same single response.
5. The trailing `## Details on call tree & network request formats:` section is pure boilerplate documentation — every trace response ships it, regardless of the trace. Parsers should stop reading at that heading to avoid wasting work.

### Field reference — metrics section

Per insight set, the metrics block starts with `Metrics (lab / observed):` followed by indented bullets. Example lines:

| Field   | Line pattern                                                                             | Type   | Unit      | Always present?                        | Maps to                                   |
|---------|------------------------------------------------------------------------------------------|--------|-----------|----------------------------------------|-------------------------------------------|
| `URL`   | `URL: <url>` (both at top level and per insight set)                                     | string | —         | Yes (top-level always; per insight set always) | `PerfMetricSnapshot.url`                  |
| `LCP`   | `  - LCP: <n> ms, event: (eventKey: <key>, ts: <ts>)[, nodeId: <id>]`                    | number | ms        | Only when the page fires LCP            | `PerfMetricSnapshot.lcpMs`                |
| `LCP breakdown.TTFB`        | `    - TTFB: <n> ms, bounds: {min: <ts>, max: <ts>}`                         | number | ms        | Only when there is an LCP               | `PerfMetricSnapshot.ttfbMs` (LCP phase)   |
| `LCP breakdown.Load delay` | `    - Load delay: <n> ms, bounds: ...`                                      | number | ms        | Only when LCP element is a resource     | sub-field of LCPBreakdown insight         |
| `LCP breakdown.Load duration` | `    - Load duration: <n> ms, bounds: ...`                                | number | ms        | Only when LCP element is a resource     | sub-field of LCPBreakdown insight         |
| `LCP breakdown.Render delay` | `    - Render delay: <n> ms, bounds: ...`                                  | number | ms        | Only when there is an LCP               | sub-field of LCPBreakdown insight         |
| `INP`   | `  - INP: <n> ms, event: (eventKey: <key>, ts: <ts>)`                                    | number | ms        | **Only when an interaction occurred** during the trace — omitted for headless reloads that never receive user input | `PerfMetricSnapshot.inpMs` |
| `CLS`   | `  - CLS: <n>[, event: (eventKey: <key>, ts: <ts>)]`                                     | number | score (unitless, fixed(2)) | Always when trace captured (may be `0.00`) | `PerfMetricSnapshot.clsScore` |
| `FCP`   | *not present* in the trace summary text                                                  | —      | —         | **Never** — see notes below             | (derive from `estimated metric savings: FCP …` or leave `undefined`) |
| `TTFB` (navigation, not LCP phase) | *not present as a standalone metric* — only appears as an LCP breakdown phase | — | — | Never as a top-level line | reuse `LCP breakdown.TTFB` as `ttfbMs` |
| `insight set id` | `## insight set id: <ID>`                                                       | string | —         | At least one when a trace was parsed    | `PerfMetricSnapshot.traceInsights[]` (along with the insight names below — see §Insight IDs) |
| `insight name` | `  - insight name: <Name>`                                                        | string | —         | One line per insight in the set         | Feeds `ParsedTraceMetrics.insightIds`     |
| `estimated metric savings` | `    estimated metric savings: FCP <n> ms, LCP <n> ms[, CLS <n>]`           | string | ms/score  | Only on insights that compute savings   | Informational; could surface as `PerfInsightSummary.estimatedImpact` later |
| `Trace bounds` | `Trace bounds: {min: <ts>, max: <ts>}`                                            | number | microseconds (monotonic clock) | Always                     | Currently unused; useful for correlating multiple traces |
| `CPU throttling` | `CPU throttling: none` or `CPU throttling: 4x`                                  | string | multiplier | Always                                  | Could feed `PerfMetricSnapshot.context`   |
| `Network throttling` | `Network throttling: none` or `Network throttling: Slow 3G` (INFERRED)      | string | label      | Always                                  | Ditto                                     |
| `Metrics (field / real users)` | `  - LCP: <n> ms (scope: <origin|url>)` when CrUX data exists, else `n/a – no data for this page in CrUX` | number | ms (or unitless for CLS) | Usually `n/a` — only populated when Chrome's CrUX API has data for the origin | Could feed a future `fieldMetrics` panel |

**Units**: All timing values are **numbers followed by a unit suffix (` ms`)**. Numbers are emitted as already-rounded integers (e.g. `7 ms`, not `0.007 s`). CLS is a bare decimal with `.toFixed(2)` (e.g. `0.00`, `0.05`). The parser should strip the ` ms` suffix and `parseFloat` the number.

**Never emit seconds.** Source code (`node_modules/chrome-devtools-mcp/build/src/third_party/index.js` line 173773) confirms `${Math.round(fieldMetric.value / 1000)} ms` for field metrics and `Math.round(lcp.value / 1000)` for lab metrics. For sub-millisecond durations the formatter falls back to `µs` (microseconds); observed example: `downloadDuration` of `98 μs` inside the RenderBlocking insight — this only appears inside detailed insight output, not in the CWV summary block.

**`totalTransferSizeKb` / page weight**: Not emitted anywhere in `performance_stop_trace`. The only place to harvest transfer sizes is per-request data in the `RenderBlocking` / `NetworkDependencyTree` insight output, or via a separate `list_network_requests` call. Leave `undefined` in `ParsedTraceMetrics` for now.

### Insight IDs — critical detail

Two distinct identifiers are used:

1. **Insight set ID** (`NAVIGATION_0`, `NAVIGATION_1`, …) — identifies a navigation/insight-set pair. Appears in `## insight set id: NAVIGATION_N`. This is what `performance_analyze_insight` wants as `insightSetId`.
2. **Insight name** (`LCPBreakdown`, `RenderBlocking`, `DocumentLatency`, `CLSCulprits`, `NetworkDependencyTree`, …) — identifies the analysis to run. Appears as `insight name: <Name>`. This is what `performance_analyze_insight` wants as `insightName`.

Neither is a free-form "insight ID". To actually drill into an insight the agent must pass **both**. The existing spec's `insightIds: string[]` should therefore probably be `{ insightSetId: string; insightName: string }[]` — flag this for Task #17.

Full list of insight names observed + enumerated in the chrome-devtools-mcp source:

`Cache`, `CharacterSet`, `CLSCulprits`, `DocumentLatency`, `DOMSize`, `DuplicatedJavaScript`, `FontDisplay`, `ForcedReflow`, `ImageDelivery`, `INPBreakdown`, `LCPBreakdown`, `LCPDiscovery`, `LegacyJavaScript`, `ModernHTTP`, `NetworkDependencyTree`, `RenderBlocking`, `SlowCSSSelector`, `ThirdParties`, `Viewport`.

Chrome-devtools-mcp skips any insight whose `state === "pass"`, so the list only contains fired insights. An "empty" insights section looks like:

```
Available insights:
```

(literally the heading followed by nothing — observed behaviour is that when no insights fired the heading still prints with no bullets under it).

---

## Example 3 — `performance_analyze_insight` — `LCPBreakdown`

Verbatim `content[0].text` from the observed capture:

```
## Insight Title: LCP breakdown

## Insight Summary:
This insight is used to analyze the time spent that contributed to the final LCP time and identify which of the 4 phases (or 2 if there was no LCP resource) are contributing most to the delay in rendering the LCP element.

## Detailed analysis:
The Largest Contentful Paint (LCP) time for this navigation was 100 ms.
The LCP element (P class='text-foreground max-w-xl text-lg opacity-90', nodeId: 321) is text and was not fetched from the network.

We can break this time down into the 2 phases that combine to make the LCP time:

- Time to first byte: 7 ms (7.4% of total LCP time)
- Element render delay: 92 ms (92.6% of total LCP time)

## Estimated savings: none

## External resources:
- https://developer.chrome.com/docs/performance/insights/lcp-breakdown
- https://web.dev/articles/lcp
- https://web.dev/articles/optimize-lcp
```

### Format

Narrative Markdown text; not structured JSON. Five sections, always in this order:

| Heading                 | Content                                                                                                    | Always present?                                           |
|-------------------------|------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|
| `## Insight Title:`     | Human title (differs from the machine `insightName` — e.g. `LCPBreakdown` → "LCP breakdown")               | Yes                                                       |
| `## Insight Summary:`   | Static insight description (mirrors the `description:` line in the stop_trace output)                       | Yes                                                       |
| `## Detailed analysis:` | Per-insight body. Structure varies wildly — see below.                                                      | Yes (may be empty string if the insight has no data)      |
| `## Estimated savings:` | Either `none` or `FCP <n> ms, LCP <n> ms[, CLS <n>]`                                                        | Yes                                                       |
| `## External resources:`| Bullet list of documentation URLs                                                                           | Yes                                                       |

**"Detailed analysis" shape per insight name:**

- **LCPBreakdown** — one-line LCP value, LCP element description, then a bullet list of phase breakdowns with `(X.Y% of total LCP time)`. 2 phases when LCP is text, 4 phases when LCP is an image (TTFB / Load delay / Load duration / Render delay — source line 174834-174851 confirms).
- **DocumentLatency** — LCP context line, then `## Document network request:` block with request headers + timings, then a `checklist` with PASS/FAILED results (`The request was not redirected`, `Server responded quickly`, `Compression was applied`). Observed verbatim in the same capture.
- **RenderBlocking** — `Here is a list of the network requests that were render-blocking…` then a semicolon-separated "Network requests data" block using the call-frame/network-request encoding documented at the end of every stop_trace response. The schema is dense and positional (`urlIndex;eventKey;queuedTime;…;responseHeaders:[…]`) — if the reporter ever needs render-blocking URLs it must decode this format; for #17/#18 we only need the insight name, not its body.
- **CLSCulprits** — narrative of the worst cluster with shift-by-shift root causes; no reliable machine-parsable fields.
- Other insight names follow similar narrative patterns (see `node_modules/chrome-devtools-mcp/build/src/third_party/index.js#174659-175200`).

**Useful for the reporter?** For Task #17 the only required data from `performance_analyze_insight` is that the call succeeded — the full text is a candidate to surface to the user verbatim in a future "insight detail" drill-in, but parsing it is out of scope.

---

## Edge cases / notes

- **Pages without LCP** — `Metrics (lab / observed):` block still renders, but the `- LCP:` line is omitted and `- LCP breakdown:` is absent. If CLS and INP are also missing the formatter emits `Metrics (lab / observed): n/a` (see source line 173874). Parser must tolerate "metrics block exists but no metrics under it".
- **Pages without interaction** — INP is omitted (not printed as `0`). A headless reload with `autoStop: true` will never yield INP. This is expected, not a parse failure.
- **No CrUX data** — `Metrics (field / real users): n/a – no data for this page in CrUX` replaces the whole field block. Parser can ignore this.
- **Metric values are numbers, not strings with units** in the sense that the value is always a rounded integer followed by a literal ` ms` suffix (or a `.toFixed(2)` decimal for CLS). Not scientific notation, not `2.4s`, not seconds. Observed: `LCP: 100 ms`. `parseFloat` after stripping ` ms` is sufficient.
- **Response shape** — always `content: [{ type: "text", text: "…" }]`. Never multiple blocks for the performance tools (the code appends an images array separately, but none of these three tools attach images). `structuredContent` also exists on the transport (source `McpResponse.js#608-622`) but the `@modelcontextprotocol/sdk` `client.callTool` result used by our `DevToolsClient` does not expose it — parser design must stick to text.
- **URL correlation** — `performance_stop_trace` embeds the measured URL **twice** (once at top level `URL: <url>` and once per insight set `URL: <url>`). The reporter does *not* need to correlate with the preceding `navigate_page` call to figure out which page was measured — the data is in the trace payload itself. This removes the "track current URL as reporter state" risk flagged in the restructure spec.
- **`autoStop: true` conflation** — because `performance_start_trace` with `autoStop: true` returns the same CWV-bearing payload as `performance_stop_trace`, the reporter's `ToolResult` filter in Task #18 must match **both** `toolName === "performance_start_trace"` *and* `toolName === "performance_stop_trace"` (and only parse the result when the body contains `The performance trace has been stopped.`). Single-filter-on-stop-only will miss traces.
- **Timestamps are microseconds** (monotonic clock) — `Trace bounds: {min: 2424984699464, max: 2424989773359}` is microseconds since the Chromium process started. Not epoch, not ms. Don't try to treat these as human times.
- **Markdown-ish, not strict Markdown** — the formatter uses `#` / `##` / `###` for sections, indented bullets with literal 2-space prefixes, but embedded fragments like `{min: …, max: …}` and `(eventKey: …, ts: …)` are free-form text. A regex-line-based parser is adequate; an md-to-AST library is not needed.
- **Error responses** — `{ content: [{ type: "text", text: "..." }], isError: true }`. Our `DevToolsClient.callTool` already converts `isError: true` into a tagged `DevToolsToolError`, so the reporter only sees success payloads.
- **"No handler registered for issue code PerformanceIssue"** — benign stderr warning from chrome-devtools-mcp; does not affect the result payload.

---

## Source references

- Response shape: `node_modules/chrome-devtools-mcp/build/src/McpResponse.js` (lines 608-622).
- Stop-trace pipeline: `node_modules/chrome-devtools-mcp/build/src/tools/performance.js` (lines 128-163).
- Summary text generator: `node_modules/chrome-devtools-mcp/build/src/third_party/index.js` (lines 173819-173914, `formatTraceSummary`).
- Per-insight formatters: `node_modules/chrome-devtools-mcp/build/src/third_party/index.js` (lines 174659-175200, `PerformanceInsightFormatter.formatInsight` + specialised bodies).
- Client call site: `packages/browser/src/devtools-client.ts` (lines 56-83) — confirms we consume only `content` (`typedResult.content`), not `structuredContent`.
