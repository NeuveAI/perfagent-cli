# Perf Report Artifacts — on-disk format

Every successful perf run persists a report to disk. A second agent harness (Claude Code, Codex, Cursor, …) with the perf-agent MCP can pick up a past report and reason about it **without re-running the trace**. Use this when the user asks follow-up questions about the most recent perf run, or when comparing multiple runs.

## Location

Reports live under the project's git root:

```
<repo-root>/.perf-agent/reports/
├── 2026-04-14T09-12-30Z-example-com.json    # timestamped JSON (schema-encoded)
├── 2026-04-14T09-12-30Z-example-com.md      # timestamped Markdown rollup
├── 2026-04-14T09-45-02Z-example-com.json    # newer run
├── 2026-04-14T09-45-02Z-example-com.md
├── latest.json     -> 2026-04-14T09-45-02Z-example-com.json   # symlink (or copy)
└── latest.md       -> 2026-04-14T09-45-02Z-example-com.md
```

- **Filename pattern**: `{YYYY-MM-DDThh-mm-ssZ}-{slug}.{json,md}`. The slug is derived from the first metric URL's `host + path` (or report title as fallback).
- **`latest.json` / `latest.md`** are always the most recent run. On platforms where `symlink` is refused (some Windows filesystems) the CLI falls back to a plain file copy — consumers should treat both paths as regular readable files either way.
- **When is a report NOT written?** If the run produced zero metrics, zero console captures, and zero network captures, persistence is skipped. The run was a no-op.
- Source: `packages/supervisor/src/report-storage.ts`.

## Reading a report from another agent

```
# Get the full JSON of the last run
cat .perf-agent/reports/latest.json

# List runs in chronological order
ls -1 .perf-agent/reports/*.json

# Human-readable version
cat .perf-agent/reports/latest.md
```

You can answer "what was the LCP on the last perf run?" without touching the browser. If you need data that isn't in the report (e.g. a fresh interaction INP) you must run a new trace.

## JSON schema — top-level fields

The JSON is produced by `Schema.encodeSync(PerfReport)`. `PerfReport` is a superclass chain: `PerfPlanDraft → PerfPlan → ExecutedPerfPlan → PerfReport`. Fields from all levels appear flattened in the JSON.

| Field | Type | Purpose |
|---|---|---|
| `id` | string (`PlanId` brand) | Unique plan id for the run |
| `title` | string | Human title of the plan |
| `instruction` | string | The user's original instruction fed to the planner |
| `rationale` | string | Planner's rationale for the generated steps |
| `changesFor` | tagged union (`WorkingTree` / `Branch` / `Changes` / `Commit`) | What change scope was profiled |
| `currentBranch` | string | Git branch at the time of the run |
| `diffPreview` | string | Preview of the diff the plan was built from |
| `fileStats` | array of `{ relativePath, added, removed }` | Lines touched per file |
| `baseUrl` | `Option<string>` | Root URL the plan was written for |
| `isHeadless` | boolean | Whether Chrome ran headless |
| `cookieBrowserKeys` | string[] | Browser cookie profiles injected |
| `targetUrls` | string[] | URLs the plan intended to profile |
| `perfBudget` | `Option<PerfBudget>` | Per-metric budget attached to the plan |
| `steps` | `AnalysisStep[]` | The planned analysis steps + their terminal status |
| `events` | `ExecutionEvent[]` | Ordered tool-call / step-status events from the run |
| `summary` | string | Final narrative summary the agent wrote |
| `screenshotPaths` | string[] | Paths to screenshots captured during the run |
| `pullRequest` | `Option<PullRequest>` | Linked PR metadata when the run was scoped to a PR |
| `metrics` | `PerfMetricSnapshot[]` | Per-URL Core Web Vitals (primary data) |
| `regressions` | `PerfRegression[]` | Regressions detected against `perfBudget` |
| `consoleCaptures` | `ConsoleCapture[]` | Console logs grouped by URL |
| `networkCaptures` | `NetworkCapture[]` | Network requests grouped by URL |
| `insightDetails` | `InsightDetail[]` | Drill-down bodies for each analyzed insight |

### `PerfMetricSnapshot`

One per profiled URL. The Core Web Vitals live here.

| Field | Type | Unit | Purpose |
|---|---|---|---|
| `url` | string | — | URL profiled |
| `lcpMs` | `Option<number>` | ms | Largest Contentful Paint |
| `fcpMs` | `Option<number>` | ms | First Contentful Paint (usually absent — devtools-mcp does not emit FCP in the trace summary; see `.specs/trace-output-format.md`) |
| `clsScore` | `Option<number>` | unitless | Cumulative Layout Shift (`.toFixed(2)`) |
| `inpMs` | `Option<number>` | ms | Interaction to Next Paint (only when an interaction occurred during the trace) |
| `ttfbMs` | `Option<number>` | ms | Time to First Byte (captured as the LCP-breakdown TTFB phase) |
| `totalTransferSizeKb` | `Option<number>` | KB | Page weight (usually absent — not emitted by `performance_stop_trace`) |
| `traceInsights` | `TraceInsightRef[]` | — | Pointers to insights fired for this URL: `{ insightSetId, insightName }` |
| `collectedAt` | ISO-8601 UTC string | — | When the snapshot was taken |

### `TraceInsightRef`

Identifies a specific insight in the trace output. Both fields are required to re-run `trace analyze`.

| Field | Type | Purpose |
|---|---|---|
| `insightSetId` | string | e.g. `NAVIGATION_0` — selects the navigation / insight set |
| `insightName` | string | e.g. `LCPBreakdown` — see `references/insight-catalog.md` |

### `InsightDetail`

Captured when the agent drills into an insight via `trace analyze`. This is the richest textual data in the report.

| Field | Type | Purpose |
|---|---|---|
| `insightSetId` | `Option<string>` | Which set this detail came from |
| `insightName` | string | Machine name (e.g. `RenderBlocking`) |
| `title` | string | Human title from the insight output (e.g. "LCP breakdown") |
| `summary` | string | Static description for the insight class |
| `analysis` | string | Full `## Detailed analysis:` body — Markdown-ish text |
| `estimatedSavings` | `Option<string>` | e.g. `"FCP 0 ms, LCP 0 ms"` or absent |
| `externalResources` | string[] | Documentation URLs from `## External resources:` |
| `collectedAt` | ISO-8601 UTC string | When the insight was analyzed |

### `PerfRegression`

Emitted when a budget is attached and a metric exceeds it.

| Field | Type | Purpose |
|---|---|---|
| `url` | string | URL where the regression occurred |
| `metric` | `"LCP" \| "FCP" \| "CLS" \| "INP" \| "TTFB" \| "TotalTransferSize"` | Which metric regressed |
| `baselineValue` | number | Budget target |
| `currentValue` | number | Observed value |
| `percentChange` | number | `(current - baseline) / baseline * 100` |
| `severity` | `"info" \| "warning" \| "critical"` | Only `critical` flips `status` to `failed` |

### `ConsoleCapture` / `ConsoleEntry`

```
ConsoleCapture  = { url, entries: ConsoleEntry[], collectedAt }
ConsoleEntry    = { level: "log"|"info"|"warn"|"error"|"debug", text, source?, url? }
```

### `NetworkCapture` / `NetworkRequest`

```
NetworkCapture  = { url, requests: NetworkRequest[], collectedAt }
NetworkRequest  = { url, method, status?, statusText?, resourceType?, transferSizeKb?, durationMs?, failed }
```

## Option encoding — two shapes depending on the field

Most `Option<T>` fields on `PerfReport` and its children use the `Schema.OptionFromUndefinedOr(T)` codec, which means:

- `Option.some(value)` → the raw `value`
- `Option.none()` → **the field is simply absent from the JSON** (no property at all, or `undefined` if preserved)

This applies to every `Option<T>` field on `PerfMetricSnapshot` (`lcpMs`, `fcpMs`, `clsScore`, `inpMs`, `ttfbMs`, `totalTransferSizeKb`), `PerfBudget` (same list), `PerfPlanDraft.baseUrl` / `.perfBudget`, and `InsightDetail.insightSetId` / `.estimatedSavings`.

The exception is `PerfReport.pullRequest`, declared with the plain `Schema.Option(...)` codec. That one encodes:

- `Option.some({ ... })` → `{ ... }` (the wrapped value)
- `Option.none()` → a tagged marker object: `{"_id":"Option","_tag":"None"}`

When reading reports from jq or another agent:

```jq
# Most Option fields: just check for presence, or `!= null`
jq '.metrics[0].lcpMs // "not captured"' latest.json

# The pullRequest field is the one that uses the tagged form — normalize it:
jq '.pullRequest | if type == "object" and ._tag == "None" then null else . end' latest.json
```

**Round-trip caveat**: the encoded JSON is NOT guaranteed to round-trip through `Schema.decodeSync(PerfReport)` — the `pullRequest` tagged encoding is asymmetric in Effect v4 beta. Parse the JSON with standard `JSON.parse` and read fields directly; do not rely on full schema decode unless you have custom handling for `pullRequest`.

## Example jq queries

```bash
# LCP of the latest run
jq '.metrics[0].lcpMs' .perf-agent/reports/latest.json

# All URLs profiled
jq '[.metrics[].url]' .perf-agent/reports/latest.json

# Every insight fired, grouped by URL
jq '.metrics[] | {url, insights: [.traceInsights[] | "\(.insightSetId)/\(.insightName)"]}' \
  .perf-agent/reports/latest.json

# Runs with critical regressions (scan history)
for f in .perf-agent/reports/2*.json; do
  crit=$(jq '[.regressions[] | select(.severity=="critical")] | length' "$f")
  [ "$crit" -gt 0 ] && echo "$f -> $crit critical regression(s)"
done

# Extract every `RenderBlocking` analysis body across runs (for trend analysis)
for f in .perf-agent/reports/2*.json; do
  jq -r --arg name "RenderBlocking" \
    '.insightDetails[] | select(.insightName==$name) | "=== \(input_filename) ===\n\(.analysis)"' "$f"
done
```

## Markdown rollup (`.md` sibling)

Human-readable mirror of the JSON. Sections, in order:

1. Title line with status icon (check / cross) and title
2. Metadata bullet list (status, persisted-at ISO timestamp, URLs, step count, tool-event count)
3. `## Summary` — the report's narrative summary
4. `## Metrics` — per-URL table of CWV values with targets and pass/fail classification
5. `## Regressions` — table if any budget was exceeded
6. `## Insight Details` — each `InsightDetail` rendered with summary, analysis (truncated to `REPORT_ANALYSIS_PREVIEW_CHARS`), and external resource links
7. `## Console` — per-URL count by level + preview entries (capped at `REPORT_MAX_CONSOLE_ENTRIES_IN_MARKDOWN`)
8. `## Network` — per-URL totals + failed count + preview requests (capped at `REPORT_MAX_NETWORK_ENTRIES_IN_MARKDOWN`)
9. `## Plan output` — the full `report.toPlainText` inside a code fence

Use the `.md` for quick grep and human browsing; use the `.json` for programmatic queries.

## How an agent should use these artifacts

1. **Follow-up questions about "the last perf run"**: read `latest.json`. Do not re-profile unless the user asks or the fingerprint changed.
2. **Comparing runs**: walk the timestamped files chronologically. Keys to diff: `metrics[*].lcpMs`, `metrics[*].clsScore`, `regressions`, unique insight names (computable from `metrics[*].traceInsights`).
3. **Explaining an insight that was analyzed**: find the matching entry in `insightDetails[]` by `insightName`. The `analysis` field contains the full DevTools output — usually the best data to quote.
4. **Missing data**: if a metric field is absent from the JSON (or `undefined` / `null`), it was not captured in that run (commonly INP for cold reloads, or `totalTransferSizeKb` always). Do NOT invent a value — say it was not captured and offer to run a new trace. Only `pullRequest` encodes absence as the tagged marker `{"_id":"Option","_tag":"None"}` (see §Option encoding).

## Canonical upstream references

- Tool output shapes: `.specs/trace-output-format.md`, `.specs/observability-output-format.md`.
- DevTools MCP tool reference: upstream `chrome-devtools-mcp/docs/tool-reference.md` (`performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `list_console_messages`, `list_network_requests`).
