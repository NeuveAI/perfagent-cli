# Observability Output Formats — `chrome-devtools-mcp@0.21.0`

Captured on 2026-04-14 via Path B (direct MCP stdio client — see `.specs/trace-output-format.md` for the pattern). Each tool result arrives as `{ content: [{ type: "text", text: <string> }] }`. The `text` blob is plain text (not JSON). `structuredContent` is emitted by the server but `DevToolsClient.callTool` does not forward it — parsers must decode the text.

Covers: `list_console_messages`, `list_network_requests`, `performance_analyze_insight` (`DocumentLatency`, `RenderBlocking`). For `performance_start_trace` / `performance_stop_trace` / `performance_analyze_insight/LCPBreakdown` see `trace-output-format.md`.

---

## 1. `list_console_messages`

### Example 1a — multi-level page (error + warn + info + log + thrown Error + browser-generated 404 error)

Navigated to `https://httpbin.org/html`, injected via `evaluate_script`:

```
console.error("synthetic error: something broke");
console.warn("synthetic warning: be careful");
console.info("synthetic info message");
console.log("synthetic log message");
console.error(new Error("stack trace error test").stack);
```

Verbatim `content[0].text`:

```
## Console messages
Showing 1-6 of 6 (Page 1 of 1).
msgid=1 [error] synthetic error: something broke (1 args)
msgid=2 [warn] synthetic warning: be careful (1 args)
msgid=3 [info] synthetic info message (1 args)
msgid=4 [log] synthetic log message (1 args)
msgid=5 [error] Error: stack trace error test
    at pptr:evaluateHandle;performEvaluation%20(file%3A%2F%2F%2FUsers%2Fvinicius%2F.nvm%2Fversions%2Fnode%2Fv22.14.0%2Flib%2Fnode_modules%2Fchrome-devtools-mcp%2Fbuild%2Fsrc%2Ftools%2Fscript.js%3A80%3A34):1:200
    at pptr:evaluate;file%3A%2F%2F%2FUsers%2Fvinicius%2F.nvm%2Fversions%2Fnode%2Fv22.14.0%2Flib%2Fnode_modules%2Fchrome-devtools-mcp%2Fbuild%2Fsrc%2Ftools%2Fscript.js%3A83%3A46:3:45 (1 args)
msgid=6 [error] Failed to load resource: the server responded with a status of 404 () (0 args)
```

### Example 1b — clean page (`about:blank`, no console activity)

```
## Console messages
<no console messages found>
```

### Sentinel

The most distinctive first-line discriminator for a console result is the header:

```
## Console messages
```

Followed immediately by **either** `Showing <start>-<end> of <total> (Page <p> of <pages>).` **or** the literal string `<no console messages found>`. Either of these second-line shapes cements the payload as a `list_console_messages` result. No other devtools-mcp tool emits `## Console messages` + that pagination line.

### Field reference table (per entry)

The default concise format is one line per message:

```
msgid=<n> [<type>] <text> (<argsCount> args)
```

Source: `chrome-devtools-mcp/build/src/formatters/ConsoleFormatter.js#148`:
`msgid=${msg.id} [${msg.type}] ${msg.text} (${msg.argsCount} args)`

| Field        | Type    | Unit | Always present? | Example       | Maps to `ParsedConsoleEntry` field |
|--------------|---------|------|-----------------|---------------|------------------------------------|
| `msgid`      | integer | —    | Yes             | `1`           | (internal; not preserved)          |
| `[<type>]`   | enum    | —    | Yes             | `[error]`     | `level` (see enum below)           |
| `<text>`     | string  | —    | Yes (may be empty when the message is an uncaught error whose text is just the Error message — see msgid=5, msgid=6) | `synthetic error: something broke` | `text`      |
| `(<n> args)` | integer | —    | Yes             | `(1 args)`    | (informational; drop or ignore)    |
| `source`     | —       | —    | **Never emitted in concise format.** Source info is embedded in the text for thrown errors (stack-trace lines beginning with `    at `), but there is no dedicated `source` field in the default `list_console_messages` output | — | Set `source = undefined` — parser cannot populate this from the default format |
| `url`        | —       | —    | **Never emitted in concise format.** Same caveat as `source` | — | Set `url = undefined` |

**Type (level) enum** observed & declared in source:
`log`, `info`, `warn`, `error`, `debug`, `trace`, `dir`, `dirxml`, `table`, `clear`, `startGroup`, `startGroupCollapsed`, `endGroup`, `assert`, `profile`, `profileEnd`, `count`, `timeEnd`, `verbose` (this is the Puppeteer `ConsoleMessageType` union passed straight through via `msg.type()`). For our parser we only care about mapping `error`/`warn`/`info`/`log|debug|verbose` into a `level` enum; treat unknown types as `log`.

### Edge cases

- **Stack traces are multi-line within a single message entry.** `msgid=5` above spans 3 text lines. Lines 2+ are indented with `    at ` (4 spaces + `at `). Parsers must NOT split the payload naively on `\n` — they must group lines into entries by detecting the `msgid=<n> [<level>]` line-start pattern. Any line *not* matching that pattern is a continuation of the previous message (stack frame, cause, etc.).
- **Stack-trace frame URLs are percent-encoded** (note `file%3A%2F%2F%2FUsers%2F…`). Don't try to decode them into source: they're Puppeteer pseudo-URLs (`pptr:evaluateHandle;…`) pointing into chrome-devtools-mcp's own `script.js`, not user code. The `fetchDetailedData` code path in `ConsoleFormatter.js` *can* emit real source-mapped frames, but `list_console_messages` calls it with detailed=off and never produces user-readable URLs.
- **Stack-trace truncation:** source enforces `STACK_TRACE_MAX_LINES = 50`, appending `... and <n> more frames` and `Note: line and column numbers use 1-based indexing` when exceeded. Only visible under `get_console_message` (detailed); `list_console_messages` concise mode omits the stack entirely except when the `text` itself contains newlines (uncaught errors, as in msgid=5).
- **Browser-generated messages** (e.g. `Failed to load resource: … 404`) appear with `argsCount = 0` and no stack trace; they carry the browser's message verbatim as `<text>` on one line.
- **Pagination:** `pageSize`/`pageIdx` params exist (source: `build/src/tools/console.js` — same `#dataWithPagination` helper as network). When `pageSize < total`, extra lines `Next page: <n>` / `Previous page: <n>` appear after the `Showing …` line. Parser should consume until it hits a blank line or EOF; trailing pagination-navigation lines are not entries and must be skipped.
- **No maximum entry cap** apart from user-specified `pageSize`; by default the server returns every buffered message in one response.
- **Empty page format** is the literal string `<no console messages found>` (in angle brackets), **not** `No console messages.` (source `McpResponse.js#605`).

---

## 2. `list_network_requests`

### Example 2a — diverse resource types (homepage of a Next.js app — 32 requests of HTML / CSS / JS / webmanifest / PNG / SVG)

Verbatim `content[0].text` (captured against `https://agent.perflab.io/` — trimmed here for brevity to the first 8 and last 3 lines; full capture was 32 `reqid=` lines):

```
## Network requests
Showing 1-32 of 32 (Page 1 of 1).
reqid=1 GET https://agent.perflab.io/ [200]
reqid=2 GET https://agent.perflab.io/_next/static/css/07f1586a3ae3b690.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=3 GET https://agent.perflab.io/_next/static/css/39acbe2d004e163a.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=4 GET https://agent.perflab.io/_next/static/chunks/webpack-fef28fa7711482ab.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
…
reqid=13 GET https://agent.perflab.io/site.webmanifest [200]
reqid=15 GET https://agent.perflab.io/favicons/favicon.svg [200]
reqid=17 GET https://agent.perflab.io/site.webmanifest [304]
reqid=19 GET https://agent.perflab.io/favicons/android-chrome-192x192.png [200]
reqid=32 GET https://agent.perflab.io/_next/static/chunks/app/(user)/chat/page-1628216deed1a2d5.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
```

### Example 2b — with failures (mix of 200 / 404 / 500 / DNS failure)

Verbatim `content[0].text`:

```
## Network requests
Showing 1-5 of 5 (Page 1 of 5).
reqid=1 GET https://httpbin.org/html [200]
reqid=2 GET https://httpbin.org/favicon.ico [404]
reqid=3 GET https://httpbin.org/status/404 [404]
reqid=4 GET https://httpbin.org/status/500 [500]
reqid=5 GET https://nonexistent.invalid.example/x [net::ERR_NAME_NOT_RESOLVED]
```

### Sentinel

```
## Network requests
```

Followed by either `Showing <start>-<end> of <total> (Page <p> of <pages>).` or the literal `No requests found.` (source `McpResponse.js#591`). This two-line prefix reliably identifies a `list_network_requests` payload.

### Field reference table (per request)

Source: `chrome-devtools-mcp/build/src/formatters/NetworkFormatter.js#165`:
``reqid=${data.requestId} ${data.method} ${data.url} [${data.status}]${data.selectedInDevToolsUI ? ' [selected in the DevTools Network panel]' : ''}``

The concise one-liner is:

```
reqid=<n> <METHOD> <URL> [<status>][ [selected in the DevTools Network panel]]
```

| Field             | Type     | Unit | Always present? | Example                       | Maps to `ParsedNetworkRequest` field |
|-------------------|----------|------|-----------------|-------------------------------|--------------------------------------|
| `reqid`           | integer  | —    | Yes             | `5`                           | (internal id; not surfaced)          |
| `method`          | string   | —    | Yes             | `GET`, `POST`, `OPTIONS`      | `method`                             |
| `url`             | string   | —    | Yes (may contain URL-encoded spaces & query strings with `=` and `?`) | `https://httpbin.org/status/404` | `url` |
| `status` (numeric)| integer  | —    | Only when HTTP response received | `200`, `404`, `304`, `500` | `status`                     |
| `status` (failure)| string   | —    | Only when request failed before receiving a response | `net::ERR_NAME_NOT_RESOLVED`, `net::ERR_CONNECTION_REFUSED`, `net::ERR_ABORTED` | `failure` flag + preserve as `failureReason` |
| `status` (pending)| literal  | —    | Only for in-flight requests at moment of capture | `pending` | set `failed=false`, `status=undefined` |
| `[selected in the DevTools Network panel]` | flag | — | Only for the currently selected request | (suffix)            | ignore                               |
| `resourceType`    | —        | —    | **NEVER emitted** in the default concise output. The server receives it as a filter input param (`document`/`stylesheet`/`image`/`media`/`font`/`script`/`xhr`/`fetch`/`prefetch`/`eventsource`/`websocket`/`manifest`/`texttrack`/`signedexchange`/`ping`/`cspviolationreport`/`preflight`/`fedcm`/`other` — source `tools/network.js#9-29`) but does not echo it in the response. | —  | Parser must **infer** `resourceType` from URL extension / MIME mapping, or leave `undefined` |
| `transferSizeKb`  | —        | —    | **NEVER emitted.** Transfer-size data is only available via `get_network_request` (detailed) or inside `performance_stop_trace`'s Network-request positional encoding. | — | Set `transferSizeKb = undefined` |
| `durationMs`      | —        | —    | **NEVER emitted** in concise list output. Same caveat. | — | Set `durationMs = undefined` |

**Derived `failed` flag:** `failed = true` when the bracketed `[<status>]` contents either (a) parse as an integer `>= 400`, OR (b) begin with the prefix `net::ERR_`. `failed = false` when the integer status is `< 400` or when status is the literal `pending`. Note `304 Not Modified` is **not** a failure (`<400`).

### Edge cases

- **Failure representation.** A DNS / connection-level failure has **no numeric status at all**: the bracketed segment contains the Chromium network error token directly (`[net::ERR_NAME_NOT_RESOLVED]`, `[net::ERR_CONNECTION_REFUSED]`, `[net::ERR_ABORTED]`, `[net::ERR_CERT_…]`, etc.). Source: `NetworkFormatter.js#127-137` (`#getStatusFromRequest`). The regex must accept either `\d+` or `net::ERR_[A-Z_]+` or the literal `pending` inside the brackets.
- **URL contains `[` or `]`** — theoretically possible (percent-encoded usually), and would confuse a naïve `\[([^\]]+)\]$` status matcher. Safer approach: match the trailing `\[[^\]]+\]` once at end of line (`$`). All observed URLs had encoded brackets.
- **No `resourceType` in the response.** This is the biggest gotcha — downstream reporters that want per-type aggregation must either (a) pass `resourceTypes: [...]` as a filter and issue one `list_network_requests` per type, then merge, or (b) derive resourceType from the URL extension (`.css` → stylesheet, `.js` → script, `.png|.jpg|.webp|.svg` → image, `.woff2?` → font, else `other`). Option (b) is what the parser should do.
- **No byte sizes or durations** in the concise list output. If the reporter needs page-weight totals, it must call `get_network_request` per `reqid` (N round-trips) or extract sizes from the `performance_stop_trace` Network-requests positional encoding (see `trace-output-format.md` §"Network requests are formatted like this"). For a minimum-viable parser, both fields can stay `undefined` and the UI should handle it.
- **Empty-page format** is the literal `No requests found.` (source `McpResponse.js#591`) — different from the console tool's `<no console messages found>`. Parsers must special-case both.
- **Pagination:** default is a single page with all entries. When `pageSize` is set, trailing `Next page: <n>` and/or `Previous page: <n>` lines appear after the `Showing …` line. Parser must skip these lines; they are not requests.
- **Preserved requests:** when `includePreservedRequests: true`, entries from the previous 3 navigations appear in the same list with no textual marker distinguishing them from current-navigation entries.
- **Query strings and fragments** are preserved verbatim in the URL segment; they often contain `?dpl=dpl_22hnh6…` or `#hash` — the URL parser must not split on `?` or `#`.

---

## 3. `performance_analyze_insight` — `DocumentLatency` and `RenderBlocking`

### Example 3a — `DocumentLatency` (on `https://agent.perflab.io/`)

Verbatim `content[0].text`:

```
## Insight Title: Document request latency

## Insight Summary:
This insight checks that the first request is responded to promptly. We use the following criteria to check this:
1. Was the initial request redirected?
2. Did the server respond in 600ms or less? We want developers to aim for as close to 100ms as possible, but our threshold for this insight is 600ms.
3. Was there compression applied to the response to minimize the transfer size?

## Detailed analysis:
The Largest Contentful Paint (LCP) time for this navigation was 112 ms.
The LCP element (P class='text-foreground max-w-xl text-lg opacity-90', nodeId: 322) is text and was not fetched from the network.

## Document network request: https://agent.perflab.io/
eventKey: s-426
Timings:
- Queued at: 0.3 ms
- Request sent at: 1 ms
- Download complete at: 14 ms
- Main thread processing completed at: 19 ms
Durations:
- Download time: 0.2 ms
- Main thread processing time: 5 ms
- Total duration: 19 ms
Redirects: no redirects
Status code: 200
MIME Type: text/html
Protocol: h2
Priority: VeryHigh
Render-blocking: No
From a service worker: No
Initiators (root request to the request that directly loaded this one): none
Response headers
- cache-control: public, max-age=0, must-revalidate
- x-vercel-cache: <redacted>
- content-encoding: br
- etag: <redacted>
- age: 2250778
- x-matched-path: <redacted>
- access-control-allow-origin: *
- x-nextjs-stale-time: <redacted>
- date: Tue, 14 Apr 2026 17:34:33 GMT
- x-nextjs-prerender: <redacted>
- content-disposition: inline
- content-type: text/html; charset=utf-8
- server: Vercel
- x-vercel-id: <redacted>
- vary: RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch

The result of the checks for this insight are:
- The request was not redirected: PASSED
- Server responded quickly: PASSED
- Compression was applied: PASSED

## Estimated savings: FCP 0 ms, LCP 0 ms

## External resources:
- https://developer.chrome.com/docs/performance/insights/document-latency
- https://web.dev/articles/optimize-ttfb
```

### Example 3b — `RenderBlocking` (on `https://agent.perflab.io/`)

Verbatim `content[0].text`:

```
## Insight Title: Render-blocking requests

## Insight Summary:
This insight identifies network requests that were render-blocking. Render-blocking requests are impactful because they are deemed critical to the page and therefore the browser stops rendering the page until it has dealt with these resources. For this insight make sure you fully inspect the details of each render-blocking network request and prioritize your suggestions to the user based on the impact of each render-blocking request.

## Detailed analysis:
Here is a list of the network requests that were render-blocking on this page and their duration:


Network requests data:



allUrls = [0: https://agent.perflab.io/_next/static/css/07f1586a3ae3b690.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY, 1: https://agent.perflab.io/, 2: https://agent.perflab.io/_next/static/css/39acbe2d004e163a.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY]

0;s-525;16 ms;16 ms;16 ms;19 ms;3 ms;0.3 ms;2 ms;200;text/css;VeryHigh;VeryHigh;VeryHigh;t;h2;f;1;[];[cache-control: public,max-age=31536000,immutable|content-encoding: br|x-vercel-cache: <redacted>|etag: <redacted>|age: 8081|x-matched-path: <redacted>|accept-ranges: bytes|access-control-allow-origin: *|content-length: <redacted>|date: Tue, 14 Apr 2026 17:34:31 GMT|content-disposition: inline; filename="07f1586a3ae3b690.css"|content-type: text/css; charset=utf-8|server: Vercel|last-modified: Tue, 14 Apr 2026 15:19:50 GMT|x-vercel-id: <redacted>]
2;s-528;16 ms;16 ms;16 ms;19 ms;3 ms;0.3 ms;2 ms;200;text/css;VeryHigh;VeryHigh;VeryHigh;t;h2;f;1;[];[cache-control: public,max-age=31536000,immutable|content-encoding: br|x-vercel-cache: <redacted>|etag: <redacted>|age: 8081|x-matched-path: <redacted>|accept-ranges: bytes|access-control-allow-origin: *|content-length: <redacted>|date: Tue, 14 Apr 2026 17:34:31 GMT|content-disposition: inline; filename="39acbe2d004e163a.css"|content-type: text/css; charset=utf-8|server: Vercel|last-modified: Tue, 14 Apr 2026 15:19:50 GMT|x-vercel-id: <redacted>]

## Estimated savings: FCP 0 ms, LCP 0 ms

## External resources:
- https://developer.chrome.com/docs/performance/insights/render-blocking
- https://web.dev/articles/lcp
- https://web.dev/articles/optimize-lcp
```

### Reference table — common insight structure

All `performance_analyze_insight` results share this five-section skeleton (same as `LCPBreakdown` in `trace-output-format.md`):

| Heading                                 | Always present? | Content                                                                                 | Notes                                                                                        |
|-----------------------------------------|-----------------|-----------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| `## Insight Title: <title>`             | Yes             | Human-readable title (e.g. `Document request latency`, `Render-blocking requests`)      | Differs from machine `insightName` (`DocumentLatency`, `RenderBlocking`).                    |
| `## Insight Summary:` (body)            | Yes             | Static description. Mirrors the `description:` line from the `performance_stop_trace` insight listing. For `DocumentLatency` it's a numbered list. | Single paragraph or numbered list. No structured data.                                       |
| `## Detailed analysis:` (body)          | Yes             | **Per-insight body — structure varies wildly.** May be empty (one blank line) when the insight fired but had no concrete findings. | Keep as an opaque blob — do not parse. See "Per-insight body notes" below.                  |
| `## Estimated savings: <value>`         | Yes             | Either `none` (literal) **or** `FCP <n> ms, LCP <n> ms[, CLS <n>]`.                     | Same grammar as the `estimated metric savings:` line in `stop_trace`. Values are integers.   |
| `## External resources:`                | Yes             | Bullet list of doc URLs, each line prefixed with `- `.                                  | Arbitrary URL count (observed 2–3).                                                          |

### Per-insight body notes (`## Detailed analysis:` contents)

- **`DocumentLatency`.** Two LCP context lines (`The Largest Contentful Paint (LCP) time…`, `The LCP element (…) is text|an image…`), then a **nested** `## Document network request: <url>` sub-block (a third-level heading using the same `##` prefix — note: it's `##`, not `###`, so a naive "split on `##`" parser will tear the body apart — **parse by known section titles, not by `^##`**). The request block has fixed-order fields: `eventKey`, `Timings:` (4 bullet lines), `Durations:` (3 bullet lines), `Redirects:`, `Status code:`, `MIME Type:`, `Protocol:`, `Priority:`, `Render-blocking:`, `From a service worker:`, `Initiators (…):`. Then `Response headers` followed by `- <name>: <value>` bullets (variable count). Closes with `The result of the checks for this insight are:` + a bullet list of `- <check>: <PASSED|FAILED>`.
- **`RenderBlocking`.** Intro sentence `Here is a list of the network requests that were render-blocking on this page and their duration:` (or `There are no network requests that are render-blocking.` when empty). Then `Network requests data:` followed by blank lines and the **`allUrls = [...]`** declaration (index-to-URL mapping, bracketed, comma-separated `<index>: <url>` pairs) and one row per render-blocking request using the **positional semicolon-delimited encoding** (19 fields per row, last two are bracketed `[]`-lists). The field legend is *not* included in the insight body — it's attached to the `performance_stop_trace` response boilerplate. Parser for Task #17/#18 should **not** decode the positional row; keep the whole analysis body as a text blob. The row grammar (from the stop_trace legend) is: `urlIndex;eventKey;queuedTime;requestSentTime;downloadCompleteTime;processingCompleteTime;totalDuration;downloadDuration;mainThreadProcessingDuration;statusCode;mimeType;priority;initialPriority;finalPriority;renderBlocking;protocol;fromServiceWorker;initiators;redirects:[[…]];responseHeaders:[…|…]`.

### Edge cases

- **Empty detailed analysis.** When the insight fires but has nothing to report (e.g. no render-blocking requests were found), `## Detailed analysis:` is followed by either a blank body (whitespace/newlines only — observed on a second capture against `about:blank`) **or** the literal sentence `There are no network requests that are render-blocking.` (observed on agent.perflab.io when the insight *is* scheduled but finds nothing). Parsers must treat empty-body as valid, not as a decode error.
- **`Estimated savings: none` vs `FCP 0 ms, LCP 0 ms`.** These are semantically equivalent ("no measurable savings available") but emit different tokens; the parser must normalise both to the same "no savings" representation.
- **Double `##` nesting.** As noted above, `DocumentLatency` nests a `## Document network request:` header *inside* `## Detailed analysis:`. Do not rely on `##` being top-level section markers; work from a fixed list of known top-level section titles (`## Insight Title:`, `## Insight Summary:`, `## Detailed analysis:`, `## Estimated savings:`, `## External resources:`) and treat everything between them as body, even other `##` lines.
- **Sentinel for reporter filter.** The first line of every `performance_analyze_insight` response always begins with `## Insight Title: `. That exact prefix is the discriminator.

---

## 4. Notes for downstream parsers

- **Multi-line fields exist in all three tools.** Console stack traces span multiple lines; insight "Detailed analysis" blocks span dozens of lines. Never tokenise output by splitting on `\n` and assuming one entry per line. Parse by locating top-level sentinel headers (`## Console messages`, `## Network requests`, `## Insight Title:`) and then delegating to per-section parsers that understand their internal structure.
- **Numeric units: always ` ms` or `%` or decimal-with-no-suffix.** Every duration in insight bodies ends with the literal ` ms` (space-ms) and is `parseFloat`-able once the suffix is stripped. Sub-millisecond values appear as decimals (`0.2 ms`, `0.3 ms`) **not** as `μs` or seconds. CLS is a bare `.toFixed(2)` decimal. No mixed-unit encodings, no scientific notation, no `2.4s`.
- **Timestamps in `Trace bounds:` / `ts:` / `Bounds:` are Chromium monotonic-clock microseconds** (not epoch ms, not ISO8601). Downstream UI should treat these as opaque correlation keys, not as wall-clock times. The only ISO8601 timestamps are inside HTTP `date:` response headers (insight bodies).
- **Truncation markers.** Console tool truncates stacks at 50 frames (`... and <n> more frames` + `Note: line and column numbers use 1-based indexing`). Network tool does not truncate URLs in concise mode (TODO-marked in source `NetworkFormatter.js#164`). Body inlines in `get_network_request` are capped at 10 000 chars with trailing `... <truncated>`. None of these affect `list_console_messages` / `list_network_requests` / `performance_analyze_insight`'s default output except the console stack cap.
- **Empty-case strings differ per tool.** Console → `<no console messages found>` (angle-bracketed literal). Network → `No requests found.` (sentence with period). Insight with empty analysis → either a blank body or a full prose sentence. Parsers must enumerate each case explicitly; a shared "empty detector" will miss at least one.
- **`resourceType` is never in `list_network_requests` output.** If Task #28's ParsedNetworkRequest carries a `resourceType` field, the parser must derive it (URL extension or MIME heuristic) — or leave it `undefined` and document this limitation. Do not invent values.

---

## Source references

- Console concise format: `node_modules/chrome-devtools-mcp/build/src/formatters/ConsoleFormatter.js#148`.
- Network concise format: `node_modules/chrome-devtools-mcp/build/src/formatters/NetworkFormatter.js#165`.
- Empty-case strings: `node_modules/chrome-devtools-mcp/build/src/McpResponse.js#591` (network), `#605` (console).
- Filterable resource types enum: `node_modules/chrome-devtools-mcp/build/src/tools/network.js#9-29`.
- Insight formatter framework: `node_modules/chrome-devtools-mcp/build/src/third_party/index.js#174659-175200` (see also `trace-output-format.md` §"Source references").
- Client call site (confirms we consume only `content[0].text`): `packages/browser/src/devtools-client.ts#56-83`.
