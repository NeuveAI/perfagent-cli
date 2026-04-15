import { describe, expect, it } from "vite-plus/test";
import { DateTime, Effect, Layer, Option } from "effect";
import { DevToolsClient, DevToolsToolError } from "@neuve/devtools";
import {
  AnalysisStep,
  ChangesFor,
  ExecutedPerfPlan,
  PerfMetricSnapshot,
  PerfPlan,
  PerfReport,
  PlanId,
  StepId,
  TraceInsightRef,
} from "@neuve/shared/models";
import { InsightEnricher } from "../src/insight-enricher";

const INSIGHT_LCP_PAYLOAD = [
  "## Insight Title: LCP breakdown",
  "",
  "## Insight Summary:",
  "LCP took too long because the TTFB was high.",
  "",
  "## Detailed analysis:",
  "The largest contentful paint completed at 2.5s.",
  "",
  "## Estimated savings: FCP 100 ms, LCP 400 ms",
  "",
  "## External resources:",
  "- https://web.dev/articles/lcp",
].join("\n");

const INSIGHT_RENDER_BLOCKING_PAYLOAD = [
  "## Insight Title: Render-blocking requests",
  "",
  "## Insight Summary:",
  "Several render-blocking requests delayed the first paint.",
  "",
  "## Detailed analysis:",
  "2 CSS files and 1 JS file blocked rendering.",
  "",
  "## Estimated savings: FCP 200 ms",
  "",
  "## External resources:",
].join("\n");

const makeStubDevToolsLayer = (
  responses: Map<string, string>,
  calls: Array<{ insightSetId: string; insightName: string }>,
) =>
  Layer.succeed(DevToolsClient, {
    callTool: (toolName: string, args: Record<string, unknown> = {}) =>
      Effect.gen(function* () {
        const insightSetId = String(args.insightSetId ?? "");
        const insightName = String(args.insightName ?? "");
        calls.push({ insightSetId, insightName });
        const key = `${insightSetId}::${insightName}`;
        const payload = responses.get(key);
        if (payload === undefined) {
          return yield* Effect.die(
            new Error(`No stub response for tool=${toolName} key=${key}`),
          );
        }
        return {
          content: [{ type: "text", text: payload }],
          isError: false,
        };
      }),
    listTools: () => Effect.succeed([]),
    navigate: () => Effect.die(new Error("not implemented")),
    startTrace: () => Effect.die(new Error("not implemented")),
    stopTrace: () => Effect.die(new Error("not implemented")),
    analyzeInsight: () => Effect.die(new Error("not implemented")),
    takeScreenshot: () => Effect.die(new Error("not implemented")),
    takeSnapshot: () => Effect.die(new Error("not implemented")),
    emulate: () => Effect.die(new Error("not implemented")),
    takeMemorySnapshot: () => Effect.die(new Error("not implemented")),
    lighthouseAudit: () => Effect.die(new Error("not implemented")),
    evaluateScript: () => Effect.die(new Error("not implemented")),
    listNetworkRequests: () => Effect.die(new Error("not implemented")),
    listConsoleMessages: () => Effect.die(new Error("not implemented")),
    closePage: () => Effect.die(new Error("not implemented")),
  } as unknown as DevToolsClient["Service"]);

const makeReport = async (refs: readonly TraceInsightRef[]): Promise<PerfReport> => {
  const collectedAt = await Effect.runPromise(DateTime.now);
  const plan = new PerfPlan({
    id: PlanId.makeUnsafe("plan-enrich"),
    title: "Enrich plan",
    rationale: "Verify enrichment",
    steps: [
      new AnalysisStep({
        id: StepId.makeUnsafe("step-enrich"),
        title: "Capture trace",
        instruction: "Capture a performance trace",
        expectedOutcome: "Insights available",
        routeHint: Option.none(),
        status: "passed",
        summary: Option.none(),
        startedAt: Option.none(),
        endedAt: Option.none(),
      }),
    ],
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    currentBranch: "main",
    diffPreview: "",
    fileStats: [],
    instruction: "trace the page",
    baseUrl: Option.none(),
    isHeadless: false,
    cookieBrowserKeys: [],
    targetUrls: ["https://example.com/"],
    perfBudget: Option.none(),
  });

  const executed = new ExecutedPerfPlan({ ...plan, events: [] });

  const snapshot = new PerfMetricSnapshot({
    url: "https://example.com/",
    lcpMs: Option.some(2500),
    fcpMs: Option.none(),
    clsScore: Option.none(),
    inpMs: Option.none(),
    ttfbMs: Option.none(),
    totalTransferSizeKb: Option.none(),
    traceInsights: [...refs],
    collectedAt,
  });

  return new PerfReport({
    ...executed,
    summary: "",
    screenshotPaths: [],
    pullRequest: Option.none(),
    metrics: [snapshot],
    regressions: [],
    consoleCaptures: [],
    networkCaptures: [],
    insightDetails: [],
  });
};

describe("InsightEnricher", () => {
  it("enriches every insight ref that is missing a detail body", async () => {
    const refs = [
      new TraceInsightRef({ insightSetId: "NAVIGATION_0", insightName: "LCPBreakdown" }),
      new TraceInsightRef({ insightSetId: "NAVIGATION_0", insightName: "RenderBlocking" }),
    ];

    const report = await makeReport(refs);

    const responses = new Map<string, string>([
      ["NAVIGATION_0::LCPBreakdown", INSIGHT_LCP_PAYLOAD],
      ["NAVIGATION_0::RenderBlocking", INSIGHT_RENDER_BLOCKING_PAYLOAD],
    ]);
    const calls: Array<{ insightSetId: string; insightName: string }> = [];

    const enriched = await Effect.runPromise(
      Effect.gen(function* () {
        const enricher = yield* InsightEnricher;
        return yield* enricher.enrich(report);
      }).pipe(
        Effect.provide(InsightEnricher.layer.pipe(Layer.provide(makeStubDevToolsLayer(responses, calls)))),
      ),
    );

    expect(enriched.insightDetails.length).toBe(2);
    expect(calls.length).toBe(2);

    const names = enriched.insightDetails.map((detail) => detail.insightName).sort();
    expect(names).toEqual(["LCPBreakdown", "RenderBlocking"]);

    const lcp = enriched.insightDetails.find((detail) => detail.insightName === "LCPBreakdown");
    expect(lcp).toBeDefined();
    if (!lcp) return;
    expect(Option.getOrUndefined(lcp.insightSetId)).toBe("NAVIGATION_0");
    expect(lcp.title).toBe("LCP breakdown");
    expect(Option.getOrUndefined(lcp.estimatedSavings)).toBe("FCP 100 ms, LCP 400 ms");
    expect(lcp.externalResources).toEqual(["https://web.dev/articles/lcp"]);
  });

  it("skips refs that already have a matching detail", async () => {
    const refs = [
      new TraceInsightRef({ insightSetId: "NAVIGATION_0", insightName: "LCPBreakdown" }),
      new TraceInsightRef({ insightSetId: "NAVIGATION_0", insightName: "RenderBlocking" }),
    ];

    const report = await makeReport(refs);
    const collectedAt = await Effect.runPromise(DateTime.now);
    const reportWithOneExisting = new PerfReport({
      ...report,
      insightDetails: [
        ...report.insightDetails,
        {
          insightSetId: Option.some("NAVIGATION_0"),
          insightName: "LCPBreakdown",
          title: "LCP breakdown",
          summary: "already captured",
          analysis: "already captured",
          estimatedSavings: Option.none(),
          externalResources: [],
          collectedAt,
        },
      ],
    });

    const responses = new Map<string, string>([
      ["NAVIGATION_0::RenderBlocking", INSIGHT_RENDER_BLOCKING_PAYLOAD],
    ]);
    const calls: Array<{ insightSetId: string; insightName: string }> = [];

    const enriched = await Effect.runPromise(
      Effect.gen(function* () {
        const enricher = yield* InsightEnricher;
        return yield* enricher.enrich(reportWithOneExisting);
      }).pipe(
        Effect.provide(InsightEnricher.layer.pipe(Layer.provide(makeStubDevToolsLayer(responses, calls)))),
      ),
    );

    expect(enriched.insightDetails.length).toBe(2);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ insightSetId: "NAVIGATION_0", insightName: "RenderBlocking" });
  });

  it("degrades gracefully when DevToolsClient.callTool fails for some refs", async () => {
    const refs = [
      new TraceInsightRef({ insightSetId: "NAVIGATION_0", insightName: "LCPBreakdown" }),
      new TraceInsightRef({ insightSetId: "NAVIGATION_0", insightName: "RenderBlocking" }),
    ];

    const report = await makeReport(refs);
    const calls: Array<{ insightSetId: string; insightName: string }> = [];

    const flakyDevToolsLayer = Layer.succeed(DevToolsClient, {
      callTool: (_toolName: string, args: Record<string, unknown> = {}) =>
        Effect.gen(function* () {
          const insightSetId = String(args.insightSetId ?? "");
          const insightName = String(args.insightName ?? "");
          calls.push({ insightSetId, insightName });
          if (insightName === "RenderBlocking") {
            return yield* new DevToolsToolError({
              tool: "performance_analyze_insight",
              cause: "insightSetId expired",
            }).asEffect();
          }
          return {
            content: [{ type: "text", text: INSIGHT_LCP_PAYLOAD }],
            isError: false,
          };
        }),
      listTools: () => Effect.succeed([]),
      navigate: () => Effect.die(new Error("not implemented")),
      startTrace: () => Effect.die(new Error("not implemented")),
      stopTrace: () => Effect.die(new Error("not implemented")),
      analyzeInsight: () => Effect.die(new Error("not implemented")),
      takeScreenshot: () => Effect.die(new Error("not implemented")),
      takeSnapshot: () => Effect.die(new Error("not implemented")),
      emulate: () => Effect.die(new Error("not implemented")),
      takeMemorySnapshot: () => Effect.die(new Error("not implemented")),
      lighthouseAudit: () => Effect.die(new Error("not implemented")),
      evaluateScript: () => Effect.die(new Error("not implemented")),
      listNetworkRequests: () => Effect.die(new Error("not implemented")),
      listConsoleMessages: () => Effect.die(new Error("not implemented")),
      closePage: () => Effect.die(new Error("not implemented")),
    } as unknown as DevToolsClient["Service"]);

    const enriched = await Effect.runPromise(
      Effect.gen(function* () {
        const enricher = yield* InsightEnricher;
        return yield* enricher.enrich(report);
      }).pipe(Effect.provide(InsightEnricher.layer.pipe(Layer.provide(flakyDevToolsLayer)))),
    );

    // Both refs were attempted; only the success produced a detail.
    expect(calls.length).toBe(2);
    expect(enriched.insightDetails.length).toBe(1);
    expect(enriched.insightDetails[0].insightName).toBe("LCPBreakdown");
  });

  it("returns the input report unchanged when no insight refs are present", async () => {
    const report = await makeReport([]);
    const calls: Array<{ insightSetId: string; insightName: string }> = [];

    const enriched = await Effect.runPromise(
      Effect.gen(function* () {
        const enricher = yield* InsightEnricher;
        return yield* enricher.enrich(report);
      }).pipe(
        Effect.provide(
          InsightEnricher.layer.pipe(Layer.provide(makeStubDevToolsLayer(new Map(), calls))),
        ),
      ),
    );

    expect(enriched).toBe(report);
    expect(calls.length).toBe(0);
  });
});
