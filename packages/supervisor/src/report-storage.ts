import { DateTime, Effect, FileSystem, Layer, Option, Schema, ServiceMap } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as path from "node:path";
import { PerfReport } from "@neuve/shared/models";
import {
  CWV_METRICS,
  CWV_THRESHOLDS,
  classifyCwv,
  formatCwvTarget,
  formatCwvValue,
} from "@neuve/shared/cwv-thresholds";
import { ensureStateDir } from "./utils/ensure-state-dir";
import { GitRepoRoot } from "./git/git";
import {
  REPORT_ANALYSIS_PREVIEW_CHARS,
  REPORT_DEFAULT_SLUG,
  REPORT_DIRECTORY_NAME,
  REPORT_JSON_INDENT,
  REPORT_LATEST_JSON_NAME,
  REPORT_LATEST_MARKDOWN_NAME,
  REPORT_MAX_CONSOLE_ENTRIES_IN_MARKDOWN,
  REPORT_MAX_NETWORK_ENTRIES_IN_MARKDOWN,
  REPORT_SLUG_MAX_LENGTH,
} from "./constants";

export interface PersistedReport {
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly latestJsonPath: string;
  readonly latestMarkdownPath: string;
  readonly slug: string;
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, REPORT_SLUG_MAX_LENGTH)
    .replace(/-$/, "");

const formatTimestampForFilename = (dateTime: DateTime.Utc): string => {
  const iso = DateTime.formatIso(dateTime);
  const withoutMs = iso.replace(/\.\d+Z$/, "Z");
  return withoutMs.replace(/:/g, "-");
};

const safeHostPath = (rawUrl: string): string | undefined => {
  if (!URL.canParse(rawUrl)) return undefined;
  const parsed = new URL(rawUrl);
  const host = parsed.hostname;
  const pathSegment = parsed.pathname.length > 1 ? parsed.pathname : "";
  return `${host}${pathSegment}`;
};

const deriveSlug = (report: PerfReport): string => {
  const firstMetric = report.metrics[0];
  if (firstMetric) {
    const hostPath = safeHostPath(firstMetric.url);
    if (hostPath) {
      const slug = slugify(hostPath);
      if (slug.length > 0) return slug;
    }
  }
  if (report.title.length > 0) {
    const slug = slugify(report.title);
    if (slug.length > 0) return slug;
  }
  return REPORT_DEFAULT_SLUG;
};

const shouldSkip = (report: PerfReport): boolean =>
  report.metrics.length === 0 &&
  report.consoleCaptures.length === 0 &&
  report.networkCaptures.length === 0;

const formatIsoReadable = (dateTime: DateTime.Utc): string => DateTime.formatIso(dateTime);

const formatMetricsSection = (report: PerfReport): string => {
  if (report.metrics.length === 0) return "";
  const lines: string[] = ["## Metrics", ""];
  for (const snapshot of report.metrics) {
    lines.push(`### ${snapshot.url}`);
    lines.push("");
    lines.push("| Metric | Value | Target | Status |");
    lines.push("|--------|-------|--------|--------|");
    for (const metric of CWV_METRICS) {
      const threshold = CWV_THRESHOLDS[metric];
      const value = Option.getOrUndefined(snapshot[threshold.key]);
      if (value === undefined) continue;
      const classification = classifyCwv(metric, value);
      lines.push(
        `| ${metric} | ${formatCwvValue(metric, value)} | ${formatCwvTarget(metric)} | ${classification} |`,
      );
    }
    const transferSize = Option.getOrUndefined(snapshot.totalTransferSizeKb);
    if (transferSize !== undefined) {
      lines.push(`| TotalTransferSize | ${transferSize.toFixed(1)} KB | - | - |`);
    }
    if (snapshot.traceInsights.length > 0) {
      const insightList = snapshot.traceInsights
        .map((insight) => `${insight.insightName} (${insight.insightSetId})`)
        .join(", ");
      lines.push("");
      lines.push(`Trace insights: ${insightList}`);
    }
    lines.push("");
  }
  return lines.join("\n");
};

const formatRegressionsSection = (report: PerfReport): string => {
  if (report.regressions.length === 0) return "";
  const lines: string[] = ["## Regressions", ""];
  lines.push("| Metric | URL | Current | Budget | Change | Severity |");
  lines.push("|--------|-----|---------|--------|--------|----------|");
  for (const regression of report.regressions) {
    const percentSign = regression.percentChange >= 0 ? "+" : "";
    lines.push(
      `| ${regression.metric} | ${regression.url} | ${regression.currentValue} | ${regression.baselineValue} | ${percentSign}${regression.percentChange.toFixed(0)}% | ${regression.severity} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}\n\n... (truncated, original ${text.length} chars)`;

const formatInsightDetailsSection = (report: PerfReport): string => {
  if (report.insightDetails.length === 0) return "";
  const lines: string[] = ["## Insight Details", ""];
  for (const detail of report.insightDetails) {
    const setId = Option.getOrUndefined(detail.insightSetId);
    const savings = Option.getOrUndefined(detail.estimatedSavings);
    lines.push(`### ${detail.title}`);
    lines.push("");
    lines.push(`- Insight: \`${detail.insightName}\``);
    if (setId) lines.push(`- Insight set: \`${setId}\``);
    if (savings) lines.push(`- Estimated savings: ${savings}`);
    lines.push("");
    lines.push("**Summary**");
    lines.push("");
    lines.push(detail.summary);
    lines.push("");
    lines.push("**Analysis**");
    lines.push("");
    lines.push(truncate(detail.analysis, REPORT_ANALYSIS_PREVIEW_CHARS));
    lines.push("");
    if (detail.externalResources.length > 0) {
      lines.push("**Resources**");
      lines.push("");
      for (const resource of detail.externalResources) {
        lines.push(`- ${resource}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
};

const formatConsoleSection = (report: PerfReport): string => {
  if (report.consoleCaptures.length === 0) return "";
  const lines: string[] = ["## Console", ""];
  for (const capture of report.consoleCaptures) {
    const counts: Record<string, number> = { log: 0, info: 0, warn: 0, error: 0, debug: 0 };
    for (const entry of capture.entries) counts[entry.level] += 1;
    const countParts = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([level, count]) => `${level}: ${count}`)
      .join(", ");
    lines.push(`### ${capture.url}`);
    lines.push("");
    lines.push(`Totals: ${countParts || "(none)"}`);
    lines.push("");
    const previewEntries = capture.entries.slice(0, REPORT_MAX_CONSOLE_ENTRIES_IN_MARKDOWN);
    for (const entry of previewEntries) {
      lines.push(`- [${entry.level}] ${entry.text}`);
    }
    const remaining = capture.entries.length - previewEntries.length;
    if (remaining > 0) lines.push(`- (and ${remaining} more)`);
    lines.push("");
  }
  return lines.join("\n");
};

const formatNetworkSection = (report: PerfReport): string => {
  if (report.networkCaptures.length === 0) return "";
  const lines: string[] = ["## Network", ""];
  for (const capture of report.networkCaptures) {
    const total = capture.requests.length;
    const failed = capture.requests.filter((request) => request.failed).length;
    lines.push(`### ${capture.url}`);
    lines.push("");
    lines.push(`Totals: ${total} requests, ${failed} failed`);
    lines.push("");
    const previewRequests = capture.requests.slice(0, REPORT_MAX_NETWORK_ENTRIES_IN_MARKDOWN);
    for (const request of previewRequests) {
      const status = Option.getOrElse(request.status, () => 0);
      const statusLabel = status === 0 ? "-" : String(status);
      const failedTag = request.failed ? " (failed)" : "";
      lines.push(`- ${request.method} ${request.url} [${statusLabel}]${failedTag}`);
    }
    const remaining = capture.requests.length - previewRequests.length;
    if (remaining > 0) lines.push(`- (and ${remaining} more)`);
    lines.push("");
  }
  return lines.join("\n");
};

const formatMarkdown = (report: PerfReport, persistedAt: DateTime.Utc): string => {
  const statusIcon = report.status === "passed" ? "\u2705" : "\u274C";
  const urls =
    report.targetUrls.length > 0
      ? report.targetUrls.join(", ")
      : report.metrics.map((snapshot) => snapshot.url).join(", ");
  const sections: string[] = [];
  sections.push(`# ${statusIcon} ${report.title}`);
  sections.push("");
  sections.push(`- Status: **${report.status.toUpperCase()}**`);
  sections.push(`- Persisted at: ${formatIsoReadable(persistedAt)}`);
  if (urls.length > 0) sections.push(`- URLs: ${urls}`);
  sections.push(`- Steps: ${report.steps.length}`);
  sections.push(`- Tool events: ${report.events.length}`);
  sections.push("");
  if (report.summary.trim().length > 0) {
    sections.push("## Summary");
    sections.push("");
    sections.push(report.summary);
    sections.push("");
  }
  const metricsSection = formatMetricsSection(report);
  if (metricsSection) sections.push(metricsSection);
  const regressionsSection = formatRegressionsSection(report);
  if (regressionsSection) sections.push(regressionsSection);
  const insightsSection = formatInsightDetailsSection(report);
  if (insightsSection) sections.push(insightsSection);
  const consoleSection = formatConsoleSection(report);
  if (consoleSection) sections.push(consoleSection);
  const networkSection = formatNetworkSection(report);
  if (networkSection) sections.push(networkSection);
  sections.push("## Plan output");
  sections.push("");
  sections.push("```");
  sections.push(report.toPlainText);
  sections.push("```");
  sections.push("");
  return `${sections.join("\n").trimEnd()}\n`;
};

const encodeReportJson = (report: PerfReport): string => {
  const encoded = Schema.encodeSync(PerfReport)(report);
  return `${JSON.stringify(encoded, undefined, REPORT_JSON_INDENT)}\n`;
};

export class ReportStorage extends ServiceMap.Service<ReportStorage>()(
  "@supervisor/ReportStorage",
  {
    make: Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;

      const getReportsDirectory = Effect.gen(function* () {
        const repoRoot = yield* GitRepoRoot;
        const stateDir = yield* ensureStateDir(fileSystem, repoRoot);
        return path.join(stateDir, REPORT_DIRECTORY_NAME);
      });

      const writeAtomic = Effect.fn("ReportStorage.writeAtomic")(function* (
        filePath: string,
        contents: string,
      ) {
        const tempPath = `${filePath}.tmp`;
        yield* fileSystem.writeFileString(tempPath, contents);
        yield* fileSystem.rename(tempPath, filePath);
      });

      const refreshLatestSymlink = Effect.fn("ReportStorage.refreshLatestSymlink")(function* (
        targetFile: string,
        latestPath: string,
      ) {
        const latestExists = yield* fileSystem
          .exists(latestPath)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)));
        if (latestExists) {
          yield* fileSystem
            .remove(latestPath)
            .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));
        }
        const targetBasename = path.basename(targetFile);
        // Symlink can be rejected on some platforms (e.g. Windows without dev mode,
        // certain filesystems): the OS surfaces this as `BadArgument`. Fall back
        // to a copy in that case. Other PlatformError reasons (permission denied,
        // disk full, etc.) propagate so the outer saveSafe logs a clear warning.
        yield* fileSystem
          .symlink(targetBasename, latestPath)
          .pipe(
            Effect.catchReason("PlatformError", "BadArgument", () =>
              fileSystem.copyFile(targetFile, latestPath),
            ),
          );
      });

      const save = Effect.fn("ReportStorage.save")(function* (report: PerfReport) {
        if (shouldSkip(report)) {
          yield* Effect.logDebug("Report persistence skipped (no metrics, console, or network)", {
            reportId: report.id,
          });
          return Option.none<PersistedReport>();
        }

        const reportsDir = yield* getReportsDirectory;
        // recursive:true handles AlreadyExists; only swallow that case, not real
        // failures (permission denied, read-only fs) which should propagate.
        yield* fileSystem
          .makeDirectory(reportsDir, { recursive: true })
          .pipe(Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void));

        const persistedAt = yield* DateTime.now;
        const timestamp = formatTimestampForFilename(persistedAt);
        const slug = deriveSlug(report);
        const baseName = `${timestamp}-${slug}`;
        const jsonPath = path.join(reportsDir, `${baseName}.json`);
        const markdownPath = path.join(reportsDir, `${baseName}.md`);
        const latestJsonPath = path.join(reportsDir, REPORT_LATEST_JSON_NAME);
        const latestMarkdownPath = path.join(reportsDir, REPORT_LATEST_MARKDOWN_NAME);

        const jsonContents = encodeReportJson(report);
        const markdownContents = formatMarkdown(report, persistedAt);

        yield* writeAtomic(jsonPath, jsonContents);
        yield* writeAtomic(markdownPath, markdownContents);
        yield* refreshLatestSymlink(jsonPath, latestJsonPath);
        yield* refreshLatestSymlink(markdownPath, latestMarkdownPath);

        yield* Effect.logInfo("Report persisted", {
          slug,
          status: report.status,
          jsonPath,
          markdownPath,
          metricCount: report.metrics.length,
        });

        return Option.some({
          jsonPath,
          markdownPath,
          latestJsonPath,
          latestMarkdownPath,
          slug,
        } satisfies PersistedReport);
      });

      const saveSafe = Effect.fn("ReportStorage.saveSafe")(function* (report: PerfReport) {
        return yield* save(report).pipe(
          Effect.catchTag("PlatformError", (error) =>
            Effect.logWarning("Report persistence failed", {
              reportId: report.id,
              reason: error.reason,
              message: error.message,
            }).pipe(Effect.as(Option.none<PersistedReport>())),
          ),
        );
      });

      return { save, saveSafe } as const;
    }),
  },
) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(NodeServices.layer));
}
