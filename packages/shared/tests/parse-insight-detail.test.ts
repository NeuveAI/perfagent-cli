import { describe, expect, it } from "vite-plus/test";
import { parseInsightDetail } from "../src/parse-insight-detail";

const lcpBreakdownPayload = `## Insight Title: LCP breakdown

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
`;

const documentLatencyPayload = `## Insight Title: Document request latency

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
- content-encoding: br
- content-type: text/html; charset=utf-8

The result of the checks for this insight are:
- The request was not redirected: PASSED
- Server responded quickly: PASSED
- Compression was applied: PASSED

## Estimated savings: FCP 0 ms, LCP 0 ms

## External resources:
- https://developer.chrome.com/docs/performance/insights/document-latency
- https://web.dev/articles/optimize-ttfb
`;

const renderBlockingPayload = `## Insight Title: Render-blocking requests

## Insight Summary:
This insight identifies network requests that were render-blocking. Render-blocking requests are impactful because they are deemed critical to the page and therefore the browser stops rendering the page until it has dealt with these resources. For this insight make sure you fully inspect the details of each render-blocking network request and prioritize your suggestions to the user based on the impact of each render-blocking request.

## Detailed analysis:
Here is a list of the network requests that were render-blocking on this page and their duration:


Network requests data:



allUrls = [0: https://agent.perflab.io/_next/static/css/07f1586a3ae3b690.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY, 1: https://agent.perflab.io/, 2: https://agent.perflab.io/_next/static/css/39acbe2d004e163a.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY]

0;s-525;16 ms;16 ms;16 ms;19 ms;3 ms;0.3 ms;2 ms;200;text/css;VeryHigh;VeryHigh;VeryHigh;t;h2;f;1;[];[cache-control: public,max-age=31536000,immutable]
2;s-528;16 ms;16 ms;16 ms;19 ms;3 ms;0.3 ms;2 ms;200;text/css;VeryHigh;VeryHigh;VeryHigh;t;h2;f;1;[];[cache-control: public,max-age=31536000,immutable]

## Estimated savings: FCP 0 ms, LCP 0 ms

## External resources:
- https://developer.chrome.com/docs/performance/insights/render-blocking
- https://web.dev/articles/lcp
- https://web.dev/articles/optimize-lcp
`;

describe("parseInsightDetail", () => {
  it("parses an LCPBreakdown insight", () => {
    const parsed = parseInsightDetail(lcpBreakdownPayload);
    expect(parsed).toBeDefined();
    if (!parsed) return;
    expect(parsed.insightName).toBe("LCPBreakdown");
    expect(parsed.title).toBe("LCP breakdown");
    expect(parsed.summary).toContain("This insight is used to analyze the time spent");
    expect(parsed.analysis).toContain("- Time to first byte: 7 ms (7.4% of total LCP time)");
    expect(parsed.analysis).toContain("- Element render delay: 92 ms (92.6% of total LCP time)");
    expect(parsed.estimatedSavings).toBeUndefined();
    expect(parsed.externalResources).toEqual([
      "https://developer.chrome.com/docs/performance/insights/lcp-breakdown",
      "https://web.dev/articles/lcp",
      "https://web.dev/articles/optimize-lcp",
    ]);
  });

  it("parses a DocumentLatency insight without tearing the nested ## sub-header", () => {
    const parsed = parseInsightDetail(documentLatencyPayload);
    expect(parsed).toBeDefined();
    if (!parsed) return;
    expect(parsed.insightName).toBe("DocumentLatency");
    expect(parsed.title).toBe("Document request latency");
    expect(parsed.analysis).toContain("## Document network request: https://agent.perflab.io/");
    expect(parsed.analysis).toContain("The request was not redirected: PASSED");
    expect(parsed.estimatedSavings).toBe("FCP 0 ms, LCP 0 ms");
    expect(parsed.externalResources.length).toBeGreaterThan(0);
    expect(parsed.externalResources).toContain(
      "https://developer.chrome.com/docs/performance/insights/document-latency",
    );
  });

  it("parses a RenderBlocking insight and preserves positional rows verbatim", () => {
    const parsed = parseInsightDetail(renderBlockingPayload);
    expect(parsed).toBeDefined();
    if (!parsed) return;
    expect(parsed.insightName).toBe("RenderBlocking");
    expect(parsed.title).toBe("Render-blocking requests");
    expect(parsed.analysis).toContain(
      "0;s-525;16 ms;16 ms;16 ms;19 ms;3 ms;0.3 ms;2 ms;200;text/css;VeryHigh;VeryHigh;VeryHigh;t;h2;f;1;[];[cache-control: public,max-age=31536000,immutable]",
    );
    expect(parsed.analysis).toContain(
      "2;s-528;16 ms;16 ms;16 ms;19 ms;3 ms;0.3 ms;2 ms;200;text/css;VeryHigh;VeryHigh;VeryHigh;t;h2;f;1;[];[cache-control: public,max-age=31536000,immutable]",
    );
    expect(parsed.analysis).toContain("allUrls = [0:");
    expect(parsed.estimatedSavings).toBe("FCP 0 ms, LCP 0 ms");
    expect(parsed.externalResources).toHaveLength(3);
  });

  it("returns undefined for non-insight input", () => {
    expect(parseInsightDetail("")).toBeUndefined();
    expect(parseInsightDetail("# Random heading\nSome other content")).toBeUndefined();
    expect(
      parseInsightDetail("The performance trace has been stopped.\n## Summary of..."),
    ).toBeUndefined();
  });
});
