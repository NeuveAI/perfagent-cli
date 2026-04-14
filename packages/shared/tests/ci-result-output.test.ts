import { describe, expect, it } from "vite-plus/test";
import { DateTime, Option, Schema } from "effect";
import {
  CiResultOutput,
  PerfMetricSnapshot,
  PerfRegression,
  TraceInsightRef,
} from "../src/models";

const exampleCollectedAt = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

const exampleMetric = new PerfMetricSnapshot({
  url: "https://example.com",
  lcpMs: Option.some(2400),
  fcpMs: Option.some(1800),
  clsScore: Option.some(0.02),
  inpMs: Option.some(150),
  ttfbMs: Option.some(300),
  totalTransferSizeKb: Option.some(520),
  traceInsights: [
    new TraceInsightRef({ insightSetId: "set-1", insightName: "LCPBreakdown" }),
    new TraceInsightRef({ insightSetId: "set-1", insightName: "RenderBlocking" }),
  ],
  collectedAt: exampleCollectedAt,
});

const exampleRegression = new PerfRegression({
  url: "https://example.com",
  metric: "LCP",
  baselineValue: 2000,
  currentValue: 2400,
  percentChange: 20,
  severity: "warning",
});

describe("CiResultOutput", () => {
  it("creates a passing result with perf data and rollup counters", () => {
    const result = new CiResultOutput({
      version: "0.1.0",
      status: "passed",
      title: "Verify landing page performance",
      duration_ms: 4100,
      metrics: [exampleMetric],
      regressions: [],
      insightNames: ["LCPBreakdown", "RenderBlocking"],
      consoleCaptureCount: 3,
      networkRequestCount: 42,
      failedRequestCount: 0,
      insightDetailCount: 2,
      artifacts: { video: "/tmp/video.mp4" },
      summary: "LCP 2400ms (target 2500ms)",
    });
    expect(result.status).toBe("passed");
    expect(result.metrics.length).toBe(1);
    expect(result.regressions.length).toBe(0);
    expect(result.insightNames).toEqual(["LCPBreakdown", "RenderBlocking"]);
    expect(result.consoleCaptureCount).toBe(3);
    expect(result.networkRequestCount).toBe(42);
    expect(result.failedRequestCount).toBe(0);
    expect(result.insightDetailCount).toBe(2);
    expect(result.artifacts.video).toBe("/tmp/video.mp4");
  });

  it("creates a failing result with regressions", () => {
    const result = new CiResultOutput({
      version: "0.1.0",
      status: "failed",
      title: "Verify landing page performance",
      duration_ms: 2000,
      metrics: [exampleMetric],
      regressions: [exampleRegression],
      insightNames: ["LCPBreakdown"],
      consoleCaptureCount: 0,
      networkRequestCount: 10,
      failedRequestCount: 2,
      insightDetailCount: 1,
      artifacts: {},
      summary: "LCP regressed 20% (warning)",
    });
    expect(result.status).toBe("failed");
    expect(result.regressions[0].metric).toBe("LCP");
    expect(result.regressions[0].severity).toBe("warning");
    expect(result.failedRequestCount).toBe(2);
  });

  it("encodes to JSON via Schema.encodeSync", () => {
    const result = new CiResultOutput({
      version: "0.1.0",
      status: "passed",
      title: "Test",
      duration_ms: 1000,
      metrics: [exampleMetric],
      regressions: [],
      insightNames: ["LCPBreakdown"],
      consoleCaptureCount: 1,
      networkRequestCount: 5,
      failedRequestCount: 0,
      insightDetailCount: 1,
      artifacts: { video: "/tmp/v.mp4", replay: "/tmp/r.html" },
      summary: "ok",
    });
    const encoded = Schema.encodeSync(CiResultOutput)(result);
    expect(encoded.version).toBe("0.1.0");
    expect(encoded.status).toBe("passed");
    expect(encoded.metrics.length).toBe(1);
    expect(encoded.metrics[0].url).toBe("https://example.com");
    expect(encoded.insightNames).toEqual(["LCPBreakdown"]);
    expect(encoded.consoleCaptureCount).toBe(1);
    expect(encoded.networkRequestCount).toBe(5);
    expect(encoded.failedRequestCount).toBe(0);
    expect(encoded.insightDetailCount).toBe(1);
    expect(encoded.artifacts.video).toBe("/tmp/v.mp4");
    expect(encoded.artifacts.replay).toBe("/tmp/r.html");
  });

  it("round-trips metrics and regressions through encode and decode", () => {
    const original = new CiResultOutput({
      version: "0.1.0",
      status: "failed",
      title: "Test run",
      duration_ms: 5000,
      metrics: [exampleMetric],
      regressions: [exampleRegression],
      insightNames: ["LCPBreakdown", "RenderBlocking"],
      consoleCaptureCount: 2,
      networkRequestCount: 7,
      failedRequestCount: 1,
      insightDetailCount: 2,
      artifacts: {},
      summary: "regression detected",
    });
    const encoded = Schema.encodeSync(CiResultOutput)(original);
    const decoded = Schema.decodeSync(CiResultOutput)(encoded);
    expect(decoded.version).toBe(original.version);
    expect(decoded.status).toBe(original.status);
    expect(decoded.metrics.length).toBe(1);
    expect(decoded.metrics[0].url).toBe("https://example.com");
    expect(decoded.regressions.length).toBe(1);
    expect(decoded.regressions[0].metric).toBe("LCP");
    expect(decoded.insightNames).toEqual(["LCPBreakdown", "RenderBlocking"]);
    expect(decoded.consoleCaptureCount).toBe(2);
    expect(decoded.networkRequestCount).toBe(7);
    expect(decoded.failedRequestCount).toBe(1);
    expect(decoded.insightDetailCount).toBe(2);
  });
});
