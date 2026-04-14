# LCP Debugging & Optimization

Largest Contentful Paint (LCP) measures how quickly a page's main content becomes visible. It's the time from navigation start until the largest image or text block renders in the viewport.

- **Good**: ≤ 2.5 s
- **Needs improvement**: 2.5 – 4.0 s
- **Poor**: > 4.0 s

On 73% of mobile pages the LCP element is an image. Understanding which **subpart** dominates your LCP is the key to effective optimization.

## LCP Subparts Breakdown

Every page's LCP breaks down into four sequential subparts with no gaps or overlaps.

| Subpart | Ideal % of LCP | What it measures |
|---------|---------------|------------------|
| Time to First Byte (TTFB) | ~40% | Navigation start → first byte of HTML |
| Resource load delay | < 10% | TTFB → browser starts loading the LCP resource |
| Resource load duration | ~40% | Time to download the LCP resource |
| Element render delay | < 10% | Resource downloaded → element rendered |

If either **delay** subpart is large relative to the total LCP, that's the first place to optimize.

**Common pitfall**: optimizing one subpart (e.g. compressing an image to reduce load duration) without checking others. If render delay is the real bottleneck, a smaller image won't help — the saved time just shifts to render delay.

## Debugging Workflow with perf-agent

### Step 1 — Record a cold-load trace

```
interact  {command: "navigate", url: "https://example.com"}
trace     {command: "start", reload: true, autoStop: true}
```

The trace auto-stops and returns Core Web Vitals plus a list of `insightSetId` values. Note them — you'll need them in Step 2.

### Step 2 — Analyze LCP-specific insights

Call `trace` with `command: "analyze"` and each of these insight names against your insight set ID:

- **`LCPBreakdown`** — The four LCP subparts with timing for each. Your primary diagnostic.
- **`DocumentLatency`** — Server response time issues affecting TTFB.
- **`RenderBlocking`** — Resources blocking the LCP element from rendering.
- **`LCPDiscovery`** — Whether the LCP resource was discoverable early in HTML.

### Step 3 — Identify the LCP element

```
observe  {command: "evaluate", function: "() => { const po = new PerformanceObserver(() => {}); po.observe({type:'largest-contentful-paint',buffered:true}); const entries = po.takeRecords(); const last = entries[entries.length-1]; return {element: last?.element?.tagName, url: last?.url, size: last?.size, startTime: last?.startTime}; }"}
```

If `url` is non-empty, that's the resource to examine. If empty, the LCP element is text — focus on render delay and web font loading.

### Step 4 — Check the network waterfall

```
observe  {command: "network", resourceTypes: ["image", "font"]}
```

For the LCP resource:

- **Start Time** — If it's much later than the first resource, you have **resource load delay** to eliminate.
- **Duration** — A large value suggests the file is too big or the server is slow (**resource load duration**).

### Step 5 — Re-test under throttled conditions

```
trace  {command: "emulate", cpuThrottling: 4, network: "Slow 3G"}
trace  {command: "start", reload: true, autoStop: true}
```

Lab tests on unthrottled desktop hide real-world regressions. Always verify under mobile-equivalent constraints.

## Optimization Strategies (ordered by typical impact)

### 1. Eliminate Resource Load Delay (target: < 10%)

The most common bottleneck. The LCP resource should start loading immediately.

- **Root cause**: LCP image loaded via JS/CSS, `data-src` usage, or `loading="lazy"`.
- **Fix**: Use standard `<img>` with `src`. **Never** lazy-load the LCP image.
- **Fix**: Add `<link rel="preload" fetchpriority="high">` if the image isn't discoverable in HTML.
- **Fix**: Add `fetchpriority="high"` to the LCP `<img>` tag.

### 2. Eliminate Element Render Delay (target: < 10%)

The element should render immediately after loading.

- **Root cause**: Large stylesheets, synchronous scripts in `<head>`, main-thread blocking.
- **Fix**: Inline critical CSS, defer non-critical CSS/JS.
- **Fix**: Break up long tasks blocking the main thread.
- **Fix**: Use Server-Side Rendering (SSR) so the element exists in initial HTML.

### 3. Reduce Resource Load Duration (target: ~40%)

- **Fix**: Use modern formats (WebP, AVIF) and responsive images (`srcset`).
- **Fix**: Serve from a CDN.
- **Fix**: Set `Cache-Control` headers.
- **Fix**: Use `font-display: swap` if LCP is text blocked by a web font.

### 4. Reduce TTFB (target: ~40%)

- **Fix**: Minimize redirects and optimize server response time.
- **Fix**: Cache HTML at the edge (CDN).
- **Fix**: Ensure pages are eligible for back/forward cache (bfcache).

## Verifying Fixes

Re-run the trace after each fix and compare the new subpart breakdown. The bottleneck should shrink.

```
trace  {command: "start", reload: true, autoStop: true}
trace  {command: "analyze", insightSetId: "...", insightName: "LCPBreakdown"}
```
