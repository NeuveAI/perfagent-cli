import { DateTime, Effect, Layer, Option, ServiceMap } from "effect";
import {
  type ExecutedPerfPlan,
  PerfMetricSnapshot,
  PerfRegression,
  PerfReport,
  TraceInsightRef,
  type PerfBudget,
} from "@neuve/shared/models";
import { type ParsedTraceMetrics, parseTraceOutput } from "@neuve/shared/parse-trace-output";
import {
  CWV_METRICS,
  CWV_THRESHOLDS,
  type CwvMetric,
  classifyCwv,
  formatCwvValue,
} from "@neuve/shared/cwv-thresholds";

const TRACE_STOPPED_SENTINEL = "The performance trace has been stopped.";
const TRACE_TOOL_NAME_PREFIXES = ["performance_start_trace", "performance_stop_trace"];

interface BudgetField {
  key: "lcpMs" | "fcpMs" | "clsScore" | "inpMs" | "ttfbMs" | "totalTransferSizeKb";
  label: string;
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
  TRACE_TOOL_NAME_PREFIXES.some((prefix) => toolName.startsWith(prefix));

const optionalNumber = (value: number | undefined): Option.Option<number> =>
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

const uniqueInsightNames = (snapshots: readonly PerfMetricSnapshot[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const snapshot of snapshots) {
    for (const insight of snapshot.traceInsights) {
      if (seen.has(insight.insightName)) continue;
      seen.add(insight.insightName);
      ordered.push(insight.insightName);
    }
  }
  return ordered;
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

  const insightNames = uniqueInsightNames(snapshots);
  if (insightNames.length > 0) {
    lines.push(`Insights available: ${insightNames.join(", ")}`);
  }

  return lines.join("\n");
};

export class Reporter extends ServiceMap.Service<Reporter>()("@supervisor/Reporter", {
  make: Effect.gen(function* () {
    const report = Effect.fn("Reporter.report")(function* (executed: ExecutedPerfPlan) {
      const toolResults = executed.events.filter(
        (event) => event._tag === "ToolResult" && !event.isError,
      );

      const traceToolResults = toolResults.filter(
        (event) =>
          event._tag === "ToolResult" &&
          isTraceToolName(event.toolName) &&
          event.result.includes(TRACE_STOPPED_SENTINEL),
      );

      const fallbackUrl = executed.targetUrls[0] ?? "unknown";
      const collectedAt = yield* DateTime.now;

      const metrics: PerfMetricSnapshot[] = [];
      for (const event of traceToolResults) {
        if (event._tag !== "ToolResult") continue;
        const parsedList = parseTraceOutput(event.result);
        for (const parsed of parsedList) {
          metrics.push(toSnapshot(parsed, fallbackUrl, collectedAt));
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
      const summary = buildPerfSummary(metrics, regressions, toolResults.length, hasBudget);

      const report = new PerfReport({
        ...executed,
        summary,
        screenshotPaths,
        pullRequest: Option.none(),
        metrics,
        regressions,
      });

      yield* Effect.logInfo("Report generated", {
        status: report.status,
        metricCount: metrics.length,
        regressionCount: regressions.length,
        screenshotCount: screenshotPaths.length,
      });

      return report;
    });

    return { report } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make);
}
