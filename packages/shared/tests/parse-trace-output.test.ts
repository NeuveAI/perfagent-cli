import { describe, expect, it } from "vite-plus/test";
import { parseTraceOutput } from "../src/parse-trace-output";

const happyPathPayload = `The performance trace has been stopped.
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
    description: Each subpart has specific improvement strategies.
    relevant trace bounds: {min: 2424992414386, max: 2424992514157}
    example question: Help me optimize my LCP score
  - insight name: CLSCulprits
    description: Layout shifts.
    relevant trace bounds: {min: 2424993502311, max: 2424994502311}
    example question: Help me optimize my CLS score
  - insight name: RenderBlocking
    description: Requests are blocking the page's initial render.
    relevant trace bounds: {min: 2424992433454, max: 2424992437454}
    estimated metric savings: FCP 0 ms, LCP 0 ms
    example question: Show me the most impactful render-blocking requests that I should focus on
  - insight name: NetworkDependencyTree
    description: Avoid chaining critical requests.
    relevant trace bounds: {min: 2424992414722, max: 2424992472899}
    example question: How do I optimize my network dependency tree?

## Details on call tree & network request formats:
Information on performance traces may contain main thread activity represented as call frames and network requests.

Each call frame is presented in the following format:
`;

describe("parseTraceOutput", () => {
  it("returns empty array for empty string", () => {
    expect(parseTraceOutput("")).toEqual([]);
  });

  it("returns empty array when sentinel is missing", () => {
    const markdown = "# Random heading\nURL: https://example.com\n## insight set id: NAVIGATION_0";
    expect(parseTraceOutput(markdown)).toEqual([]);
  });

  it("parses the full happy-path payload with every field", () => {
    const result = parseTraceOutput(happyPathPayload);
    expect(result).toHaveLength(1);
    const [snapshot] = result;
    expect(snapshot.insightSetId).toBe("NAVIGATION_0");
    expect(snapshot.url).toBe("https://agent.perflab.io/");
    expect(snapshot.lcpMs).toBe(100);
    expect(snapshot.clsScore).toBe(0);
    expect(snapshot.ttfbMs).toBe(7);
    expect(snapshot.inpMs).toBeUndefined();
    expect(snapshot.fcpMs).toBeUndefined();
    expect(snapshot.totalTransferSizeKb).toBeUndefined();
    expect(snapshot.insights).toEqual([
      { insightSetId: "NAVIGATION_0", insightName: "LCPBreakdown" },
      { insightSetId: "NAVIGATION_0", insightName: "CLSCulprits" },
      { insightSetId: "NAVIGATION_0", insightName: "RenderBlocking" },
      { insightSetId: "NAVIGATION_0", insightName: "NetworkDependencyTree" },
    ]);
  });

  it("stops reading at the boilerplate heading", () => {
    const payload = `${happyPathPayload}
  - insight name: ShouldNotBeIncluded
`;
    const result = parseTraceOutput(payload);
    expect(
      result[0].insights.find((insight) => insight.insightName === "ShouldNotBeIncluded"),
    ).toBeUndefined();
  });

  it("leaves lcpMs undefined when LCP line is absent", () => {
    const payload = `The performance trace has been stopped.
## Summary of Performance trace findings:
URL: https://example.com/

## insight set id: NAVIGATION_0

URL: https://example.com/
Metrics (lab / observed):
  - CLS: 0.05
Available insights:
  - insight name: CLSCulprits
`;
    const result = parseTraceOutput(payload);
    expect(result).toHaveLength(1);
    expect(result[0].lcpMs).toBeUndefined();
    expect(result[0].clsScore).toBe(0.05);
    expect(result[0].insights).toEqual([
      { insightSetId: "NAVIGATION_0", insightName: "CLSCulprits" },
    ]);
  });

  it("leaves inpMs undefined when INP line is absent", () => {
    const result = parseTraceOutput(happyPathPayload);
    expect(result[0].inpMs).toBeUndefined();
  });

  it("parses INP when present", () => {
    const payload = `The performance trace has been stopped.
## Summary of Performance trace findings:
URL: https://example.com/

## insight set id: NAVIGATION_0

URL: https://example.com/
Metrics (lab / observed):
  - LCP: 1500 ms, event: (eventKey: x, ts: 1)
  - INP: 220 ms, event: (eventKey: y, ts: 2)
  - CLS: 0.01
Available insights:
  - insight name: INPBreakdown
`;
    const result = parseTraceOutput(payload);
    expect(result[0].inpMs).toBe(220);
    expect(result[0].lcpMs).toBe(1500);
  });

  it("returns multiple snapshots when multiple insight sets are present", () => {
    const payload = `The performance trace has been stopped.
## Summary of Performance trace findings:
URL: https://example.com/

## insight set id: NAVIGATION_0

URL: https://example.com/
Metrics (lab / observed):
  - LCP: 200 ms, event: (eventKey: a, ts: 1)
  - LCP breakdown:
    - TTFB: 50 ms, bounds: {min: 0, max: 1}
  - CLS: 0.00
Available insights:
  - insight name: LCPBreakdown

## insight set id: NAVIGATION_1

URL: https://example.com/next
Metrics (lab / observed):
  - LCP: 400 ms, event: (eventKey: b, ts: 2)
  - LCP breakdown:
    - TTFB: 80 ms, bounds: {min: 2, max: 3}
  - CLS: 0.02
Available insights:
  - insight name: RenderBlocking
  - insight name: DocumentLatency
`;
    const result = parseTraceOutput(payload);
    expect(result).toHaveLength(2);
    expect(result[0].insightSetId).toBe("NAVIGATION_0");
    expect(result[0].url).toBe("https://example.com/");
    expect(result[0].lcpMs).toBe(200);
    expect(result[0].ttfbMs).toBe(50);
    expect(result[1].insightSetId).toBe("NAVIGATION_1");
    expect(result[1].url).toBe("https://example.com/next");
    expect(result[1].lcpMs).toBe(400);
    expect(result[1].ttfbMs).toBe(80);
    expect(result[1].insights).toEqual([
      { insightSetId: "NAVIGATION_1", insightName: "RenderBlocking" },
      { insightSetId: "NAVIGATION_1", insightName: "DocumentLatency" },
    ]);
  });

  it("returns empty insights list when no insight names fire", () => {
    const payload = `The performance trace has been stopped.
## Summary of Performance trace findings:
URL: https://example.com/

## insight set id: NAVIGATION_0

URL: https://example.com/
Metrics (lab / observed):
  - LCP: 100 ms
  - CLS: 0.00
Available insights:
`;
    const result = parseTraceOutput(payload);
    expect(result).toHaveLength(1);
    expect(result[0].insights).toEqual([]);
  });

  it("falls back to top-level URL when per-insight-set URL is missing", () => {
    const payload = `The performance trace has been stopped.
## Summary of Performance trace findings:
URL: https://top.example/

## insight set id: NAVIGATION_0

Metrics (lab / observed):
  - LCP: 100 ms
Available insights:
  - insight name: LCPBreakdown
`;
    const result = parseTraceOutput(payload);
    expect(result[0].url).toBe("https://top.example/");
  });
});
