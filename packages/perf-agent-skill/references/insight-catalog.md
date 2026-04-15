# DevTools Insight Catalog

The `trace analyze` macro tool dispatches to `performance_analyze_insight` on `chrome-devtools-mcp`. Each call needs **two** identifiers together: an `insightSetId` (e.g. `NAVIGATION_0`) selecting the navigation, and an `insightName` (below) selecting the analysis to run. See upstream: `chrome-devtools-mcp/docs/tool-reference.md` (`performance_analyze_insight`).

When `trace stop` returns, the `Available insights` block lists the insights that fired for that navigation. `chrome-devtools-mcp` skips any insight whose state is `pass`, so only actionable insights appear — there is no "empty" signal to chase.

The full list below mirrors `.specs/trace-output-format.md` §"Insight IDs — critical detail". Each row is one valid `insightName` argument.

| Insight name | What it measures | Typical fix direction |
|---|---|---|
| `Cache` | HTTP caching headers on static resources (missing `Cache-Control`, short max-age, non-immutable hashed assets) | Add long-lived `Cache-Control: public, max-age=…, immutable` for fingerprinted assets; ensure CDN respects cache directives. |
| `CharacterSet` | Missing or late `<meta charset>` causing re-parse | Put `<meta charset="utf-8">` as the first child of `<head>`. |
| `CLSCulprits` | Which layout shifts contributed most to CLS, grouped by cluster | Reserve space (explicit `width`/`height` on media, `aspect-ratio` CSS, skeleton placeholders). Avoid inserting above-the-fold DOM after layout. |
| `DocumentLatency` | Server response: redirects, slow TTFB, missing compression | Remove redirects, move to the edge / CDN, enable Brotli/gzip, ensure bfcache eligibility. |
| `DOMSize` | Extremely large DOMs slowing layout & style recalc | Virtualize long lists, remove dead nodes, avoid deeply nested wrappers. |
| `DuplicatedJavaScript` | Same module shipped more than once via different bundles | Hoist to a shared chunk; audit `node_modules` duplication; check peer-deps. |
| `FontDisplay` | Custom fonts blocking text render (no `font-display: swap`) | Add `font-display: swap` (or `optional`), preload critical fonts, subset/self-host. |
| `ForcedReflow` | JavaScript synchronously reading layout after mutating DOM in the same task | Batch reads before writes, use `requestAnimationFrame`, avoid layout-thrash patterns in loops. |
| `ImageDelivery` | Oversized images, missing modern formats, missing responsive `srcset` | Serve WebP/AVIF, add `srcset`/`sizes`, match intrinsic size to rendered size, lazy-load below the fold (never the LCP image). |
| `INPBreakdown` | Worst interaction during the trace — input delay, processing, presentation | Defer non-essential work out of event handlers; break long tasks with `scheduler.yield()`; memoize expensive React trees. |
| `LCPBreakdown` | The four LCP subparts: TTFB, resource load delay, resource load duration, element render delay | See `references/lcp-debugging.md` — primary LCP diagnostic. |
| `LCPDiscovery` | Whether the LCP resource is discoverable from initial HTML | See `references/lcp-debugging.md` — often fixed with `<link rel="preload" fetchpriority="high">` and removing lazy-loading from the LCP image. |
| `LegacyJavaScript` | ES5/pre-modern polyfills shipped to modern browsers | Ship `type="module"`, configure modern-only bundle, drop unnecessary polyfills. |
| `ModernHTTP` | Critical resources on HTTP/1.1 or without HTTP/3 | Move origin to HTTP/2 or HTTP/3; enable on the CDN. |
| `NetworkDependencyTree` | Critical request chain depth — each level blocks the next | Flatten chains; preload second-level critical resources; inline very small critical CSS. |
| `RenderBlocking` | Resources in the critical path that block first render | Defer non-critical CSS/JS (`media` queries, `defer`, `async`), inline critical CSS. |
| `SlowCSSSelector` | Selectors causing slow style recalculation | Simplify deeply nested / universal selectors; avoid `:has()` on hot paths. |
| `ThirdParties` | Cost of third-party scripts (analytics, tag managers, widgets) | Delay via `loading="lazy"` iframes, Partytown, or conditional loading; audit cumulative main-thread cost. |
| `Viewport` | Mobile viewport meta tag missing or misconfigured | Add `<meta name="viewport" content="width=device-width, initial-scale=1">`. |

## How to drill into an insight from a persisted report

If a past report is in `.perf-agent/reports/latest.json`:

1. Find the URL you care about: `jq '.metrics[].url' latest.json`.
2. List insights that fired for it: `jq '.metrics[] | select(.url=="https://…") | .traceInsights' latest.json` — yields `{ insightSetId, insightName }` pairs.
3. If the agent already analyzed it, the full body lives in `insightDetails[]` — look by `insightName`:

   ```bash
   jq '.insightDetails[] | select(.insightName=="LCPBreakdown")' latest.json
   ```

   The `analysis` field is the verbatim `## Detailed analysis:` section from chrome-devtools-mcp.
4. If the insight fired but was NOT analyzed in the stored run, and the user wants a drill-down, you need a fresh trace + `trace analyze` call — the stored `traceInsights` reference is not replayable on its own (`insightSetId` is trace-bound).

## Insight output format (what `trace analyze` returns)

Every `trace analyze` response has five Markdown sections (verbatim from DevTools):

1. `## Insight Title:` — human title (e.g. "LCP breakdown")
2. `## Insight Summary:` — static description of the insight class
3. `## Detailed analysis:` — the per-trace body, shape varies per insight
4. `## Estimated savings:` — either `none` or `FCP X ms, LCP Y ms[, CLS Z]`
5. `## External resources:` — bullet list of documentation URLs

See `.specs/trace-output-format.md` §"Example 3" for a verbatim `LCPBreakdown` sample and per-insight body-shape notes. For `DocumentLatency`, `RenderBlocking`, and `INPBreakdown` see `.specs/observability-output-format.md`.
