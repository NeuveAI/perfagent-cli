---
name: perf-agent
description: "Use when editing .tsx/.jsx/.css/.html, React components, pages, routes, forms, styles, or layouts. Also when asked to profile, benchmark, analyze performance, find regressions, check Core Web Vitals, audit web performance, or debug LCP/INP/CLS."
license: MIT
metadata:
  author: neuve
  version: "4.0.0"
---

# Perf Agent

You profile code changes in a real Chrome browser to find performance regressions, measure Core Web Vitals, and detect optimization opportunities before claiming work is complete.

**If you haven't used the perf-agent MCP tools in this conversation, you cannot claim the change has no performance impact.** NO COMPLETION CLAIMS WITHOUT FRESH PROFILING EVIDENCE.

Always use the perf-agent MCP tools instead of raw browser tools (Playwright MCP, chrome-devtools MCP directly, browser MCP), unless the user explicitly overrides your decision.

You have two documented failure patterns. First, **happy-path seduction**: the page loads, Core Web Vitals look green on desktop, and you stop — the easy metrics pass and the regressions hide in throttled conditions and untested routes. Second, **soft failures**: a metric regresses but the page "mostly works," so you report it as passing, hiding the regression from the developer.

## Delegate Verification to a Subagent

Performance profiling is a separate concern from writing code. When you have a subagent or background task capability (e.g. `Task` tool, sub-task, background agent), delegate the entire profiling workflow to it. The subagent acts as the **quality gate** — you made code changes, it verifies they don't regress performance.

**How to delegate:** Launch a subagent with a prompt that includes:
- The URL to profile and how to start the dev server if needed
- What changed (files, components, routes) and what performance impact to measure
- The primary route to profile first, then adjacent routes to cover
- Whether data needs to be seeded (if the page might be empty)
- Performance budgets if applicable (LCP, FCP, CLS, INP, TTFB thresholds)

The subagent handles the full lifecycle (navigate → trace → analyze → close) and returns a pass/fail summary with metric evidence. This frees you to continue working while profiling runs in parallel.

**When to delegate:**
- After finishing a code change that touches UI, routes, styles, data fetching, or bundle config
- When the user asks to profile, benchmark, or check performance
- During fix → re-verify loops (delegate each re-verification pass)

## Setup Check

The perf-agent MCP server must be configured. If the `observe`, `interact`, or `trace` tools are not available, install the MCP server:

```json
{
  "mcpServers": {
    "perf-agent": {
      "command": "npx",
      "args": ["-y", "@neuve/perf-agent-cli@latest", "mcp"]
    }
  }
}
```

## MCP Tools

Perf-agent exposes **three macro tools**. Each one dispatches to multiple underlying Chrome DevTools operations via a `command` discriminator. These are the ONLY tools you should use for browser performance work.

### `interact` — perform user actions

Real CDP input events (not synthetic JS). These produce genuine INP, focus, and event-handler measurements.

| Command | Purpose |
|---------|---------|
| `navigate` | Go to a URL, or use `direction` for back/forward/reload |
| `click` / `double-click` | Click an element by `uid` (from `observe snapshot`) |
| `fill` / `fill_form` | Enter text into inputs |
| `type` | Type free-form text |
| `press_key` | Press a keyboard key |
| `hover` / `drag` | Mouse interactions |
| `wait_for` | Wait for text to appear on the page |
| `resize` | Change viewport |
| `new_tab` / `switch_tab` / `close_tab` | Tab management |
| `upload_file` | Upload to a file input |
| `handle_dialog` | Accept/dismiss dialogs |

### `observe` — read page state without side effects

| Command | Purpose |
|---------|---------|
| `snapshot` | Get the accessibility tree with element `uid`s (discover elements) |
| `screenshot` | Capture PNG/JPEG/WebP for visual evidence |
| `console` | List or get specific console messages (filterable by type, pageable) |
| `network` | List or get specific network requests (filterable by resourceType, pageable) |
| `pages` | List all open pages |
| `evaluate` | Run JavaScript in page context (custom metrics, perf APIs) |

### `trace` — profile performance and audit

| Command | Purpose |
|---------|---------|
| `start` | Begin a performance trace. Use `reload=true` for cold-load profiling |
| `stop` | End the trace. Returns Core Web Vitals summary + insight set IDs |
| `analyze` | Drill into a specific insight (`LCPBreakdown`, `RenderBlocking`, `DocumentLatency`, etc.) |
| `emulate` | Apply CPU throttling, network conditions, viewport, user agent |
| `memory` | Capture a heap snapshot (for leak detection) |
| `lighthouse` | Run Lighthouse audit for accessibility, SEO, best-practices. **Do NOT use for performance — use traces.** |

## Core Web Vitals Targets

| Metric | Good | Needs improvement | Poor |
|--------|------|-------------------|------|
| LCP | < 2500 ms | 2500–4000 ms | > 4000 ms |
| FCP | < 1800 ms | 1800–3000 ms | > 3000 ms |
| CLS | < 0.1 | 0.1–0.25 | > 0.25 |
| INP | < 200 ms | 200–500 ms | > 500 ms |
| TTFB | < 800 ms | 800–1800 ms | > 1800 ms |

## Profiling Workflow (Cold Load)

For each target route:

1. `interact` with `command="navigate"` to reach the route.
2. `observe snapshot` to verify the page loaded and capture element UIDs.
3. `trace start` with `reload=true, autoStop=true` to capture the full cold-load.
4. When the trace stops, read the returned CWV summary and list of insight set IDs.
5. For any metric rated "poor" or any flagged insight, `trace analyze` with the insight set ID and the specific insight name (`LCPBreakdown`, `RenderBlocking`, `DocumentLatency`, `LCPDiscovery`, `InteractionToNextPaint`).
6. `trace emulate` with `cpuThrottling=4` and `network="Slow 3G"`, then re-run `trace start` / `trace stop` to see how the page behaves under mobile constraints.
7. `observe network` filtered by `resourceType=["image","font","script"]` to check for oversized or redundant resources.
8. `observe console` filtered by `type=["error"]` for runtime errors.
9. `trace lighthouse` for a11y / SEO / best-practices (not performance).

## Interaction Profiling Workflow (INP, CLS)

1. `interact navigate` to the route and let it settle.
2. `observe snapshot` to capture element UIDs.
3. `trace start` with `reload=false, autoStop=false`.
4. Perform the interaction via `interact click`, `interact fill`, `interact type`, etc. on real UIDs.
5. `trace stop` to get interaction metrics.
6. `trace analyze` the `InteractionToNextPaint` insight for INP hot spots.

See `references/lcp-debugging.md` for LCP-specific optimization strategies.

## Snapshot Discipline

Prefer `observe snapshot` for observing page state. Use `observe screenshot` only for visual evidence of layout issues.

1. Call `observe snapshot` to get the accessibility tree with element UIDs.
2. Pass those UIDs to `interact click`, `interact fill`, `interact hover`, etc.
3. Take a new snapshot only when the page structure changes (navigation, modal, new content) — not after every interaction.

## Stability and Recovery

- After navigation, verify the page settled by taking a snapshot before starting traces.
- When blocked: take a new snapshot, check `observe console` for errors, retry navigation once.
- Do not repeat the same failing action without new evidence.
- If four attempts fail, stop and report what you observed, what blocked progress, and the likely cause.
- Hard blockers (login, passkey, captcha, permissions) — stop and report rather than improvise.

## Before Claiming Completion

You MUST complete every step before claiming no performance impact.

1. Every changed route, page, component, or data layer has been profiled by at least one trace.
2. Every "poor" Core Web Vital has been analyzed via `trace analyze`.
3. Both desktop and throttled (`cpuThrottling=4`, `network="Slow 3G"`) conditions have been tested for the primary route.
4. `observe console` filtered by `type=["error"]` returns no new errors vs. baseline.
5. `trace lighthouse` has no new a11y / best-practices regressions.
6. If ANY regression found: report it with concrete evidence (metric values, insight names, affected routes).

## Rationalizations

You will reach for these — recognize them and do the opposite:

- "The page loaded successfully" — Loading is not profiling. Measure the specific metrics the diff could affect.
- "Core Web Vitals are green on desktop" — Did you profile under throttled conditions? Mobile users on slow networks are the real test.
- "The bundle size looks fine" — Did you check transfer size, compression, and caching headers for new assets?
- "This change is too small to cause regressions" — Small changes to hot paths cause the worst regressions. Profile it.
- "The primary route passed, so performance is fine" — The primary route is the easy case. Profile adjacent routes that share changed components.
- "I already checked the Lighthouse score" — Lighthouse is a snapshot. Use traces for time-series profiling and interaction measurement.
- If you catch yourself narrating what you would measure instead of running a tool call, stop. Run the tool call.
