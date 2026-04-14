import { describe, expect, it } from "vite-plus/test";
import { Effect, Option } from "effect";
import {
  AnalysisStep,
  ChangesFor,
  ExecutedPerfPlan,
  type ExecutionEvent,
  PerfPlan,
  PlanId,
  StepId,
  ToolCall,
  ToolResult,
} from "@neuve/shared/models";
import { Reporter } from "../src/reporter";

const makePlan = (): PerfPlan =>
  new PerfPlan({
    id: PlanId.makeUnsafe("plan-01"),
    title: "Perf plan",
    rationale: "Testing trace capture",
    steps: [
      new AnalysisStep({
        id: StepId.makeUnsafe("step-01"),
        title: "Record a trace",
        instruction: "Use the trace tool",
        expectedOutcome: "LCP captured",
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

const makeExecutedPlan = (events: readonly ExecutionEvent[]): ExecutedPerfPlan =>
  new ExecutedPerfPlan({ ...makePlan(), events });

const TRACE_PAYLOAD = [
  "The performance trace has been stopped.",
  "URL: https://example.com/",
  "## insight set id: NAVIGATION_0",
  "URL: https://example.com/",
  "  - LCP: 1500 ms, event: (eventKey: x, ts: 1)",
  "  - CLS: 0.02",
].join("\n");

const CONSOLE_PAYLOAD = [
  "## Console messages",
  "Showing 1-2 of 2 (Page 1 of 1).",
  "msgid=1 [error] synthetic error: something broke (1 args)",
  "msgid=2 [warn] synthetic warning: be careful (1 args)",
].join("\n");

const NETWORK_PAYLOAD = [
  "## Network requests",
  "Showing 1-1 of 1 (Page 1 of 1).",
  "reqid=1 GET https://example.com/ [200]",
].join("\n");

const INSIGHT_PAYLOAD = [
  "## Insight Title: LCP breakdown",
  "",
  "## Insight Summary:",
  "Summary body.",
  "",
  "## Detailed analysis:",
  "Analysis body.",
  "",
  "## Estimated savings: FCP 0 ms, LCP 0 ms",
  "",
  "## External resources:",
  "- https://web.dev/articles/lcp",
].join("\n");

describe("Reporter", () => {
  it("extracts metrics from macro trace tool results", async () => {
    const toolResult = new ToolResult({
      toolName: "trace",
      result: TRACE_PAYLOAD,
      isError: false,
    });

    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        return yield* reporter.report(makeExecutedPlan([toolResult]));
      }).pipe(Effect.provide(Reporter.layer)),
    );

    expect(report.metrics.length).toBe(1);
    expect(Option.getOrUndefined(report.metrics[0].lcpMs)).toBe(1500);
    expect(Option.getOrUndefined(report.metrics[0].clsScore)).toBe(0.02);
    expect(report.metrics[0].url).toBe("https://example.com/");
    expect(report.status).toBe("passed");
  });

  it("captures console, network, and insight detail from observability tool results", async () => {
    const navigateCall = new ToolCall({
      toolName: "interact",
      input: JSON.stringify({ command: "navigate", url: "https://example.com/" }),
    });
    const insightCall = new ToolCall({
      toolName: "trace",
      input: JSON.stringify({
        command: "analyze",
        insightSetId: "NAVIGATION_0",
        insightName: "LCPBreakdown",
      }),
    });

    const consoleResult = new ToolResult({
      toolName: "observe",
      result: CONSOLE_PAYLOAD,
      isError: false,
    });
    const networkResult = new ToolResult({
      toolName: "observe",
      result: NETWORK_PAYLOAD,
      isError: false,
    });
    const insightResult = new ToolResult({
      toolName: "trace",
      result: INSIGHT_PAYLOAD,
      isError: false,
    });

    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        return yield* reporter.report(
          makeExecutedPlan([
            navigateCall,
            consoleResult,
            networkResult,
            insightCall,
            insightResult,
          ]),
        );
      }).pipe(Effect.provide(Reporter.layer)),
    );

    expect(report.consoleCaptures.length).toBe(1);
    expect(report.consoleCaptures[0].entries.length).toBe(2);
    expect(report.consoleCaptures[0].url).toBe("https://example.com/");
    expect(report.consoleCaptures[0].entries[0].level).toBe("error");

    expect(report.networkCaptures.length).toBe(1);
    expect(report.networkCaptures[0].requests.length).toBe(1);
    expect(report.networkCaptures[0].url).toBe("https://example.com/");
    expect(report.networkCaptures[0].requests[0].method).toBe("GET");

    expect(report.insightDetails.length).toBe(1);
    expect(report.insightDetails[0].insightName).toBe("LCPBreakdown");
    expect(Option.getOrUndefined(report.insightDetails[0].insightSetId)).toBe("NAVIGATION_0");
  });
});
