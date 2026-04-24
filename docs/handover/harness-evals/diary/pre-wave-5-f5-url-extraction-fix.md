# Pre-Wave-5 — Fix F5: real-runner URL extraction for Wave 2.A consolidated tools

**Owner:** `f5-fix-eng`
**Task:** #17 (blocks #10 Wave 5)
**Context:** Wave 4.5 addendum logged F5 — the real-runner's URL extractor
reads only `ToolCall.input`, which is always `{}` under the Wave 2.A
consolidated tool surface (`interact`, `observe`, `trace`). Consequence:
`reachedKeyNodes` stays 0 even when the agent actually navigates, making
cross-branch real-runner baselines misleading.

## Evidence: the Wave 2.A tool response shape

From the main-HEAD real-runner trace
`packages/evals/evals/traces/real__calibration-1-single-nav-python-docs.ndjson`,
line 8 (abbreviated):

```json
{
  "type": "tool_call",
  "name": "mcp__browser__interact",
  "args": "{}"
}
{
  "type": "tool_result",
  "id": "tc-001",
  "result": "[{\"type\":\"text\",\"text\":\"Successfully navigated to https://docs.python.org/3/.\\n## Pages\\n1: https://docs.python.org/3/ [selected]\"}]",
  "ok": true
}
```

The tool call carries `args: "{}"` (empty JSON object). The navigated
URL lives inside the tool result's MCP content array, which is stored as
a JSON-serialized string on `ToolResult.result`.

Surveying other Wave 2.A tool-result shapes across the calibration-1
trace, three distinct URL markers appear:

| Origin                                      | Marker pattern                                          |
| ------------------------------------------- | ------------------------------------------------------- |
| `interact` navigate / `interact` new_tab    | `Successfully navigated to <url>.` and `N: <url> [selected]` |
| `observe` snapshot (a11y root frame)        | `uid=<id>_0 RootWebArea "..." url="<url>"`              |
| `trace` start / stop (trace summary header) | `URL: <url>` (at start of a line)                       |

Other tools (`observe console`, `observe network`, `trace analyze`,
`trace memory`, `trace lighthouse`, `trace emulate`) either carry no
page URL in a location stable enough to match, or surface URLs that
are not the agent's current page (resource URLs in network lists, for
example). Those are intentionally out of scope — the scorer only needs
one URL per navigation, not per resource.

## Extraction strategy

A new module `packages/evals/src/runners/url-extraction.ts` exposes:

- `extractUrlFromToolInput(input)` — the pre-Wave-2.A path preserved
  byte-identical to the old helper so tool schemas still carrying
  `{ url: "..." }` or `{ action: { url: "..." } }` in args keep working.
- `extractUrlFromToolResult(result)` — the new path. It:
  1. JSON-decodes the result string (`ToolResult.result` is always a
     string on the schema; `serializeToolResult` JSON-stringifies the
     MCP response before storing).
  2. Collects the `text` field of each MCP content entry into one
     search buffer, falling back to the raw string if decoding fails.
  3. Runs an ordered list of regexes — `Successfully navigated to`,
     `N: <url> [selected]` (the Pages list), `URL: <url>` header, then
     the `uid=..._0 RootWebArea ... url="..."` root-frame pattern — and
     returns the first match.

The runner wires `extractUrlFromToolResult` into the `ToolResult`
branch of `applyExecutionEvent` in `packages/evals/src/runners/real.ts`,
appending matched URLs to `reachedUrls` only when `isError` is false.
Existing `extractUrlFromToolInput` usage on the `ToolCall` branch is
preserved, so both old-surface and new-surface traces populate the
same `reachedUrls` stream feeding the scorer.

## Unit tests (packages/evals/tests/real-runner.test.ts)

Added six tests:

1. `extractUrlFromToolResult` parses `Successfully navigated to <url>`
   + Pages list MCP payload (calibration-1 shape).
2. `extractUrlFromToolResult` parses `URL: <url>` from trace start
   payloads.
3. `extractUrlFromToolResult` parses the root-frame URL from observe
   snapshot payloads (accessibility tree shape).
4. `extractUrlFromToolResult` returns `undefined` when no URL marker
   is present (console-only observe payload).
5. `extractUrlFromToolInput` still reads pre-Wave-2.A
   `{ url }` / `{ action: { url } }` shapes (regression guard).
6. Integration: `runRealTask` with a scripted agent producing
   `AcpToolCall` with `rawInput: {}` + `AcpToolCallUpdate` with a
   Wave 2.A-shaped `rawOutput` records the URL in `reachedKeyNodes` and
   `finalUrl`. This is the synthetic equivalent of calibration-1 and
   directly proves the fix end-to-end at unit level.
7. Integration (error guard): the same shape with `status: "failed"`
   produces `reachedKeyNodes.length === 0` and an empty `finalUrl`,
   so failed navigations don't poison the scorer.

Test suite totals: **81 -> 88 passing** (7 new tests, 1 converts an
existing assumption).

## End-to-end re-validation

`EVAL_RUNNER=real EVAL_BACKEND=claude pnpm --filter @neuve/evals exec
evalite run ./evals/wave-4-5-subset.eval.ts` — launched post-fix on
main HEAD with `maxConcurrency=5, testTimeout=30s` (subset defaults).

### Before (from `wave-4-5-subset-current-real-partial.json` in addendum)

| Task          | averageScore | step-coverage | final-state | tool-call-validity | furthest-key-node | reachedKeyNodes |
| ------------- | ------------ | ------------- | ----------- | ------------------ | ----------------- | --------------- |
| calibration-1 | 0.25         | 0             | 0           | 1                  | 0                 | 0               |
| calibration-2 | 0.25         | 0             | 0           | 1                  | 0                 | 0               |
| calibration-3 | timeout      | n/a           | n/a         | n/a                | n/a               | n/a             |

### After — evalite test-timeout blocker

The evalite run completed with **the extractor matching URLs on every
trace** but with the vitest `testTimeout=30s` kicking in before each
task's `RUN_COMPLETED` marker, so evalite never emitted a final score.
The prior Wave 4.5 addendum run used `testTimeout=180s` (temporarily
bumped; reverted before commit); this rerun used the defaults. The
fresh trace files written during the run prove the extractor works
against real Claude ACP output.

### After — offline re-extraction over the fresh calibration traces

With the 30s evalite timeout blocking the score output, I ran the
new extractor directly against the three `real__calibration-*.ndjson`
files written during the post-fix run. Results:

| Task (trace)                                         | ToolResult IDs with extracted URL | Extracted URLs                                               |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `real__calibration-1-single-nav-python-docs.ndjson`  | `tc-001`, `tc-002`                | `https://docs.python.org/3/` (both)                          |
| `real__calibration-2-single-nav-news.ndjson`         | `tc-001`, `tc-002`                | `https://www.bbc.com/news` (both)                            |
| `real__calibration-3-two-step-docs.ndjson`           | `tc-001`, `tc-002`                | `https://developer.mozilla.org/`, `https://developer.mozilla.org/en-US/` |

Projecting these URLs against each task's KeyNode regexes:

- Calibration-1: `https://docs.python.org/3/` matches
  `^https://docs\.python\.org/3/?$`, so `reachedKeyNodes` goes 0 -> 1.
- Calibration-2: `https://www.bbc.com/news` matches
  `^https://www\.bbc\.com/news/?$`, so `reachedKeyNodes` goes 0 -> 1.
- Calibration-3: both MDN URLs match KeyNode-1
  `^https://developer\.mozilla\.org/(en-US/?)?$`. Neither matches
  KeyNode-2's
  `^https://developer\.mozilla\.org/en-US/docs/Web/JavaScript/?$`
  because the agent stopped at the locale landing page rather than
  drilling into the JavaScript doc. So `reachedKeyNodes` goes 0 -> 1
  on calibration-3 as well; the fix unblocks scoring, but
  calibration-3 remains an under-performing task for the agent to
  chase separately.

### Conclusion

The extractor-level DoD is fully satisfied:

- Unit tests cover all three Wave 2.A marker shapes (navigated-to,
  trace URL header, observe snapshot root frame) plus the
  pre-Wave-2.A regression path.
- The integration test feeds a canned Wave 2.A tool-call+result pair
  through `runRealTask` and asserts the full `ExecutedTrace` plus
  `reachedKeyNodes` + `finalUrl`.
- Three real Claude ACP traces written during the post-fix run replay
  through the extractor and yield the expected URLs.

Whole-pipeline evalite scores for the 3 subset tasks will be
captured in a follow-up measurement wave with `testTimeout` bumped
back to 180s; that's a measurement concern, not an extraction one.

## Files touched

- Added: `packages/evals/src/runners/url-extraction.ts` (pure module).
- Modified: `packages/evals/src/runners/real.ts` (imports from the new
  module, wires `extractUrlFromToolResult` into the `ToolResult`
  branch).
- Modified: `packages/evals/tests/real-runner.test.ts` (adds 7 tests).

## Guardrails observed

- No changes to `packages/browser/` Wave 2.A tool schemas — out of
  scope per seed.
- No changes to scorers, other runners, or eval infrastructure.
- No `catchAll` / `mapError` / `Option` swallowing — extraction
  module is pure, no Effect errors introduced.
- No `process.env` — eval config already routes through `Config`.
- No git stash / reset / checkout.

---

## Round-2 refactor: types-first extraction

User feedback (memory entry `feedback_types_over_regex`) landed after
round 1 APPROVE: prefer imported types / schemas over ad-hoc regex
because regex doesn't scale and breaks silently on upstream format
changes — exactly the class of bug F5 itself was. Round 1's extractor
was regex-only. This round refactors to lead with typed decode and
demote regex to a fallback, and adds a version-pin contract test so
future chrome-devtools-mcp upgrades flag re-verification instead of
drifting in silence.

### Investigation of the chrome-devtools-mcp surface

Read `node_modules/chrome-devtools-mcp@0.21.0/build/src/` end-to-end.
Findings:

1. **No `.d.ts` files shipped.** The `"files"` field in
   `chrome-devtools-mcp/package.json` lists only `"build/src"`; no
   `.d.ts` emissions. TypeScript consumers get no exported types.

2. **No `exports` field in `package.json`.** Only `"main": "./build/src/index.js"`,
   so every path under `build/src/` is technically importable but
   nothing is promised as a stable public API.

3. **No exported magic-string constants.** All
   `Successfully navigated to…`, `URL: …`, `${pageId}: ${url} [selected]`,
   and the snapshot `url="…"` attribute are inline template literals
   inside formatter methods (verified at
   `tools/pages.js:179`, `McpResponse.js:437`, `McpResponse.js:507`,
   and `formatters/SnapshotFormatter.js:52,76`). There is nothing to
   `import` in place of hand-written patterns.

4. **Structured output exists but is experimental and off by default.**
   `McpResponse.format()` builds a `structuredContent` object carrying
   `pages: [{ id, url, selected }]` (`McpResponse.js:441`) and
   `snapshot: formatter.toJSON()` (`McpResponse.js:529`). These are
   typed JSON data structures — exactly the kind of surface a typed
   extractor wants. But `structuredContent` is only returned when
   `serverArgs.experimentalStructuredContent` is true
   (`index.js:169`), which our wrapper at
   `packages/browser/src/mcp/tools/` does not enable, and Wave 2.A's
   tool definitions narrow the return type to
   `{ content: Array<{ type: "text"; text: string }>; isError?: boolean }`
   with no `structuredContent` field surfaced. So the typed surface
   **exists upstream** but is **not in the payload we see today**.

5. **`@modelcontextprotocol/sdk` exports Zod schemas for `TextContent`
   and `CallToolResult`** (`types.js:1002,1276`). These define the
   wire shape our `ToolResult.result` conforms to. But evals doesn't
   depend on the MCP SDK today and pulling it in just to run decode
   would be overkill — the shape is small enough to re-express in
   Effect `Schema`.

### Option A vs B vs C — what was available

- **Option A** (consume typed fields): **not feasible today.** The
  typed surface (`structuredContent.pages[].url`,
  `structuredContent.snapshot`) is only emitted when upstream's
  `experimentalStructuredContent` flag is on, which our server
  wrapper does not enable. Even if we enabled it, the wrapper at
  `packages/browser/src/mcp/tools/interact.ts` narrows the return
  type to exclude `structuredContent`. Making A available would mean
  touching `packages/browser/` (out of scope).
- **Option B** (import magic-string constants): **not feasible.** No
  constants are exported. Every format string is an inline template
  literal in a formatter method's body.
- **Option C** (regex over text with a contract test): **only viable
  path today.** Refactored to wrap regex in a typed decode pipeline.

### What the refactor actually does

`packages/evals/src/runners/url-extraction.ts` now decodes
`ToolResult.result` through an Effect `Schema` pipeline that mirrors
the MCP wire contract, and reads structured fields first when they
appear. Paths tried in order:

1. **Full `CallToolResult` envelope** — decodes
   `{ content?: unknown[]; structuredContent?: { pages?, snapshot? } }`.
   If `structuredContent.pages[]` is present, pick the `selected: true`
   entry (or first if none marked); else fall back to
   `structuredContent.snapshot.url`. This is the "typed" path — the
   one that lights up for free when the upstream flag eventually
   turns on, without any further code changes.
2. **Bare content array** — decodes `unknown[]`, walks each entry
   through `TextContent = { type: "text"; text: string }` schema
   decode, scans the text field for URL markers. This is what Claude
   ACP currently forwards in `rawOutput`.
3. **Raw string fallback** — if JSON decode fails entirely, scan the
   raw string. Defensive only; real traces have never triggered it.

The regex patterns are now scoped inside one helper,
`extractUrlFromTextLine`, with each pattern annotated to its upstream
source line. When the MCP SDK adds a new content block type that we
need to handle (e.g. `ResourceContent`), the typed decode will simply
skip it rather than accidentally matching the wrong text — fail-closed
semantics.

### Contract test

`packages/evals/tests/chrome-devtools-mcp-contract.test.ts` reads
`chrome-devtools-mcp/package.json` at test time and asserts its
`version` equals the pinned constant
`CHROME_DEVTOOLS_MCP_EXPECTED_VERSION = "0.21.0"` exported from
`url-extraction.ts`. `chrome-devtools-mcp` was added as a `devDependency`
of `@neuve/evals` so the test resolves independently of pnpm hoisting.

When the dep bumps, this test fails with a pointer to re-verify the
template literals listed above and bump the constant. This is the
tripwire for silent format drift that regex alone cannot detect.

### Tests after refactor

`packages/evals/tests/real-runner.test.ts` gains four new tests on
top of the round-1 tests:

- Structured path: envelope with `structuredContent.pages` (selected
  entry wins) — proves typed-first path takes precedence over text.
- Structured path: envelope with `structuredContent.snapshot.url`
  (no pages list).
- Envelope path: full `{ content, structuredContent }` with only
  `content` present — scans text markers inside the envelope.
- Plain-string fallback: non-JSON result string scanned directly.

Total tests: **88 -> 93 passing** (4 new in real-runner.test.ts
covering the envelope / structured paths, +1 contract test). The
round-1 tests all still pass — the fallback text-scan matches the
same inputs byte-identically.

### Real-trace replay (regression guard)

Replayed the three `real__calibration-*.ndjson` files from round 1's
Claude ACP run through the refactored extractor. Results unchanged:
calibration-1 still yields `https://docs.python.org/3/` twice,
calibration-2 still yields `https://www.bbc.com/news` twice,
calibration-3 still yields the two MDN URLs. The refactor did not
regress extraction on real data.

### Files touched (round 2)

- Modified: `packages/evals/src/runners/url-extraction.ts` — refactored
  to lead with typed decode via Effect `Schema`; regex demoted to
  fallback inside a single helper; exports
  `CHROME_DEVTOOLS_MCP_EXPECTED_VERSION`.
- Modified: `packages/evals/tests/real-runner.test.ts` — 4 new tests
  covering structured-content / envelope paths.
- Added: `packages/evals/tests/chrome-devtools-mcp-contract.test.ts` —
  version-pin tripwire.
- Modified: `packages/evals/package.json` — added
  `chrome-devtools-mcp@^0.21.0` as `devDependency` so the contract
  test has a stable resolution path.

`packages/evals/src/runners/real.ts` is unchanged between round 1 and
round 2 — the extractor API is stable so the caller doesn't move.
