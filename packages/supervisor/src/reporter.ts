import { DateTime, Effect, Layer, Option, Predicate, ServiceMap } from "effect";
import {
  ConsoleCapture,
  ConsoleEntry,
  collectUniqueInsightNames,
  type ExecutedPerfPlan,
  type ExecutionEvent,
  InsightDetail,
  NetworkCapture,
  NetworkRequest,
  PerfMetricSnapshot,
  PerfRegression,
  PerfReport,
  TraceInsightRef,
  type PerfBudget,
} from "@neuve/shared/models";
import { type ParsedTraceMetrics, parseTraceOutput } from "@neuve/shared/parse-trace-output";
import {
  type ParsedConsoleEntry,
  parseConsoleOutput,
} from "@neuve/shared/parse-console-output";
import {
  type ParsedNetworkRequest,
  parseNetworkRequests,
} from "@neuve/shared/parse-network-requests";
import { parseInsightDetail } from "@neuve/shared/parse-insight-detail";
import {
  CWV_METRICS,
  CWV_THRESHOLDS,
  type CwvMetric,
  type PerfMetricLabel,
  classifyCwv,
  formatCwvValue,
} from "@neuve/shared/cwv-thresholds";

const TRACE_STOPPED_SENTINEL = "The performance trace has been stopped.";
const CONSOLE_HEADING_SENTINEL = "## Console messages";
const CONSOLE_EMPTY_SENTINEL = "<no console messages found>";
const NETWORK_HEADING_SENTINEL = "## Network requests";
const NETWORK_EMPTY_SENTINEL = "No requests found.";

interface BudgetField {
  key: "lcpMs" | "fcpMs" | "clsScore" | "inpMs" | "ttfbMs" | "totalTransferSizeKb";
  label: PerfMetricLabel;
}

const BUDGET_FIELDS: BudgetField[] = [
  { key: "lcpMs", label: "LCP" },
  { key: "fcpMs", label: "FCP" },
  { key: "clsScore", label: "CLS" },
  { key: "inpMs", label: "INP" },
  { key: "ttfbMs", label: "TTFB" },
  { key: "totalTransferSizeKb", label: "TotalTransferSize" },
];

const isTraceToolName = (toolName: string): boolean =>
  toolName === "trace" || toolName.startsWith("performance_");

const decodeToolCallInput = (input: unknown): Record<string, unknown> | undefined => {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      return Predicate.isObject(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
  if (Predicate.isObject(input)) return input as Record<string, unknown>;
  return undefined;
};

const extractNavigationUrl = (input: unknown): string | undefined => {
  const decoded = decodeToolCallInput(input);
  if (!decoded) return undefined;
  const topUrl = decoded["url"];
  if (typeof topUrl === "string" && topUrl.length > 0) return topUrl;
  const command = decoded["command"];
  if (typeof command === "string" && command === "navigate") {
    const nestedUrl = decoded["url"];
    if (typeof nestedUrl === "string" && nestedUrl.length > 0) return nestedUrl;
  }
  return undefined;
};

const extractInsightSetId = (input: unknown, insightName: string): string | undefined => {
  const decoded = decodeToolCallInput(input);
  if (!decoded) return undefined;
  const candidateName = decoded["insightName"];
  if (typeof candidateName !== "string" || candidateName !== insightName) return undefined;
  const insightSetId = decoded["insightSetId"];
  return typeof insightSetId === "string" && insightSetId.length > 0 ? insightSetId : undefined;
};

const findPrecedingInsightSetId = (
  events: readonly ExecutionEvent[],
  eventIndex: number,
  insightName: string,
): string | undefined => {
  for (let index = eventIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event._tag !== "ToolCall") continue;
    const insightSetId = extractInsightSetId(event.input, insightName);
    if (insightSetId) return insightSetId;
  }
  return undefined;
};

const toConsoleEntry = (parsed: ParsedConsoleEntry): ConsoleEntry =>
  new ConsoleEntry({
    level: parsed.level,
    text: parsed.text,
    source: optionalString(parsed.source),
    url: optionalString(parsed.url),
  });

const toNetworkRequest = (parsed: ParsedNetworkRequest): NetworkRequest =>
  new NetworkRequest({
    url: parsed.url,
    method: parsed.method,
    status: optionalNumber(parsed.status),
    statusText: optionalString(parsed.statusText),
    resourceType: optionalString(parsed.resourceType),
    transferSizeKb: optionalNumber(parsed.transferSizeKb),
    durationMs: optionalNumber(parsed.durationMs),
    failed: parsed.failed ?? false,
  });

const isConsoleResult = (result: string): boolean =>
  result.includes(CONSOLE_HEADING_SENTINEL) && !result.includes(CONSOLE_EMPTY_SENTINEL);

const isNetworkResult = (result: string): boolean =>
  result.includes(NETWORK_HEADING_SENTINEL) && !result.includes(NETWORK_EMPTY_SENTINEL);

const isInsightDetailResult = (result: string): boolean =>
  result.trim().startsWith("## Insight Title:");

const optionalNumber = (value: number | undefined): Option.Option<number> =>
  value === undefined ? Option.none() : Option.some(value);

const optionalString = (value: string | undefined): Option.Option<string> =>
  value === undefined ? Option.none() : Option.some(value);

const toSnapshot = (
  parsed: ParsedTraceMetrics,
  fallbackUrl: string,
  collectedAt: DateTime.Utc,
): PerfMetricSnapshot =>
  new PerfMetricSnapshot({
    url: parsed.url ?? fallbackUrl,
    lcpMs: optionalNumber(parsed.lcpMs),
    fcpMs: optionalNumber(parsed.fcpMs),
    clsScore: optionalNumber(parsed.clsScore),
    inpMs: optionalNumber(parsed.inpMs),
    ttfbMs: optionalNumber(parsed.ttfbMs),
    totalTransferSizeKb: optionalNumber(parsed.totalTransferSizeKb),
    traceInsights: parsed.insights.map(
      (insight) =>
        new TraceInsightRef({
          insightSetId: insight.insightSetId,
          insightName: insight.insightName,
        }),
    ),
    collectedAt,
  });

const getMeasuredValue = (
  snapshot: PerfMetricSnapshot,
  key: BudgetField["key"],
): number | undefined => Option.getOrUndefined(snapshot[key]);

const getBudgetValue = (budget: PerfBudget, key: BudgetField["key"]): number | undefined =>
  Option.getOrUndefined(budget[key]);

const computeSeverity = (
  measured: number,
  budget: number,
): "info" | "warning" | "critical" | undefined => {
  if (measured > 2 * budget) return "critical";
  if (measured > budget) return "warning";
  if (measured > 0.9 * budget) return "info";
  return undefined;
};

const buildRegressions = (
  snapshots: readonly PerfMetricSnapshot[],
  budget: PerfBudget,
): PerfRegression[] => {
  const regressions: PerfRegression[] = [];
  for (const snapshot of snapshots) {
    for (const field of BUDGET_FIELDS) {
      const budgetValue = getBudgetValue(budget, field.key);
      const measured = getMeasuredValue(snapshot, field.key);
      if (budgetValue === undefined || measured === undefined) continue;
      if (budgetValue <= 0) continue;
      const severity = computeSeverity(measured, budgetValue);
      if (!severity) continue;
      regressions.push(
        new PerfRegression({
          url: snapshot.url,
          metric: field.label,
          baselineValue: budgetValue,
          currentValue: measured,
          percentChange: ((measured - budgetValue) / budgetValue) * 100,
          severity,
        }),
      );
    }
  }
  return regressions;
};

const qualityIcon = (quality: "good" | "needs-improvement" | "poor"): string => {
  if (quality === "good") return "\u2713";
  if (quality === "needs-improvement") return "\u26A0";
  return "\u2717";
};

const aggregateWorstQuality = (
  snapshots: readonly PerfMetricSnapshot[],
  metric: CwvMetric,
): { value: number; quality: "good" | "needs-improvement" | "poor" } | undefined => {
  const threshold = CWV_THRESHOLDS[metric];
  let worst: { value: number; quality: "good" | "needs-improvement" | "poor" } | undefined;
  for (const snapshot of snapshots) {
    const value = Option.getOrUndefined(snapshot[threshold.key]);
    if (value === undefined) continue;
    const quality = classifyCwv(metric, value);
    if (
      !worst ||
      (quality === "poor" && worst.quality !== "poor") ||
      (quality === "needs-improvement" && worst.quality === "good")
    ) {
      worst = { value, quality };
    }
  }
  return worst;
};

const formatMetricSummary = (snapshots: readonly PerfMetricSnapshot[]): string => {
  const parts: string[] = [];
  for (const metric of CWV_METRICS) {
    const aggregated = aggregateWorstQuality(snapshots, metric);
    if (!aggregated) continue;
    const icon = qualityIcon(aggregated.quality);
    parts.push(`${metric}: ${formatCwvValue(metric, aggregated.value)} ${icon}`);
  }
  return parts.join("  ");
};

const safeUrlPath = (rawUrl: string): string => {
  const parsed = URL.canParse(rawUrl) ? new URL(rawUrl) : undefined;
  if (!parsed) return rawUrl;
  return parsed.pathname.length > 0 ? parsed.pathname : rawUrl;
};

const formatRegressionSummary = (
  regressions: readonly PerfRegression[],
  hasBudget: boolean,
): string | undefined => {
  if (regressions.length === 0) {
    return hasBudget ? "No regressions vs. budget." : undefined;
  }
  const parts = regressions.map(
    (regression) => `${regression.metric} on ${safeUrlPath(regression.url)} (${regression.severity})`,
  );
  return `${regressions.length} regression${regressions.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
};

const uniqueUrls = (snapshots: readonly PerfMetricSnapshot[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.url)) continue;
    seen.add(snapshot.url);
    ordered.push(snapshot.url);
  }
  return ordered;
};

const buildPerfSummary = (
  snapshots: readonly PerfMetricSnapshot[],
  regressions: readonly PerfRegression[],
  toolResultCount: number,
  hasBudget: boolean,
): string => {
  if (snapshots.length === 0 && toolResultCount === 0) {
    return "Agent did not run any performance tools.";
  }
  if (snapshots.length === 0) {
    return `Agent ran ${toolResultCount} tool${toolResultCount === 1 ? "" : "s"} but did not capture a performance trace. Results may be in console/network output.`;
  }

  const urls = uniqueUrls(snapshots);
  const urlList = urls.join(", ");
  const headline = `Captured ${snapshots.length} trace${snapshots.length === 1 ? "" : "s"} across ${urlList}.`;
  const metricsLine = formatMetricSummary(snapshots);
  const regressionLine = formatRegressionSummary(regressions, hasBudget);

  const lines: string[] = [headline];
  if (metricsLine.length > 0) lines.push(metricsLine);
  if (regressionLine !== undefined) lines.push(regressionLine);

  const insightNames = collectUniqueInsightNames(snapshots);
  if (insightNames.length > 0) {
    lines.push(`Insights available: ${insightNames.join(", ")}`);
  }

  return lines.join("\n");
};

export class Reporter extends ServiceMap.Service<Reporter>()("@supervisor/Reporter", {
  make: Effect.gen(function* () {
    const report = Effect.fn("Reporter.report")(function* (executed: ExecutedPerfPlan) {
      const fallbackUrl = executed.targetUrls[0] ?? "unknown";
      const collectedAt = yield* DateTime.now;

      const metrics: PerfMetricSnapshot[] = [];
      const consoleCaptures: ConsoleCapture[] = [];
      const networkCaptures: NetworkCapture[] = [];
      const insightDetails: InsightDetail[] = [];

      let toolResultCount = 0;
      let lastKnownUrl = fallbackUrl;

      for (let eventIndex = 0; eventIndex < executed.events.length; eventIndex += 1) {
        const event = executed.events[eventIndex];

        if (event._tag === "ToolCall") {
          const navigationUrl = extractNavigationUrl(event.input);
          if (navigationUrl) lastKnownUrl = navigationUrl;
          continue;
        }

        if (event._tag !== "ToolResult" || event.isError) continue;
        toolResultCount += 1;

        if (
          isTraceToolName(event.toolName) &&
          event.result.includes(TRACE_STOPPED_SENTINEL)
        ) {
          const parsedList = parseTraceOutput(event.result);
          for (const parsed of parsedList) {
            metrics.push(toSnapshot(parsed, fallbackUrl, collectedAt));
          }
          continue;
        }

        if (isConsoleResult(event.result)) {
          const entries = parseConsoleOutput(event.result).map(toConsoleEntry);
          if (entries.length > 0) {
            consoleCaptures.push(
              new ConsoleCapture({ url: lastKnownUrl, entries, collectedAt }),
            );
          }
          continue;
        }

        if (isNetworkResult(event.result)) {
          const requests = parseNetworkRequests(event.result).map(toNetworkRequest);
          if (requests.length > 0) {
            networkCaptures.push(
              new NetworkCapture({ url: lastKnownUrl, requests, collectedAt }),
            );
          }
          continue;
        }

        if (isInsightDetailResult(event.result)) {
          const parsed = parseInsightDetail(event.result);
          if (!parsed) continue;
          const insightSetId = findPrecedingInsightSetId(
            executed.events,
            eventIndex,
            parsed.insightName,
          );
          insightDetails.push(
            new InsightDetail({
              insightSetId: optionalString(insightSetId),
              insightName: parsed.insightName,
              title: parsed.title,
              summary: parsed.summary,
              analysis: parsed.analysis,
              estimatedSavings: optionalString(parsed.estimatedSavings),
              externalResources: parsed.externalResources,
              collectedAt,
            }),
          );
          continue;
        }
      }

      const regressions = Option.match(executed.perfBudget, {
        onNone: () => [] as PerfRegression[],
        onSome: (budget) => buildRegressions(metrics, budget),
      });

      const screenshotPaths = executed.events
        .filter(
          (event) =>
            event._tag === "ToolResult" &&
            event.toolName.endsWith("__screenshot") &&
            !event.isError,
        )
        .map((event) => (event._tag === "ToolResult" ? event.result : ""))
        .filter(Boolean);

      const hasBudget = Option.isSome(executed.perfBudget);
      const summary = buildPerfSummary(metrics, regressions, toolResultCount, hasBudget);

      const report = new PerfReport({
        ...executed,
        summary,
        screenshotPaths,
        pullRequest: Option.none(),
        metrics,
        regressions,
        consoleCaptures,
        networkCaptures,
        insightDetails,
      });

      yield* Effect.logInfo("Report generated", {
        status: report.status,
        metricCount: metrics.length,
        regressionCount: regressions.length,
        screenshotCount: screenshotPaths.length,
        consoleCaptureCount: consoleCaptures.length,
        networkCaptureCount: networkCaptures.length,
        insightDetailCount: insightDetails.length,
      });

      return report;
    });

    return { report } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make);
}
