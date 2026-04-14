import { useState } from "react";
import { Box, Text, useInput } from "ink";
import figures from "figures";
import { Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useAtom } from "@effect/atom-react";
import type { PerfReport } from "@neuve/supervisor";
import type {
  AnalysisStep,
  PerfMetricSnapshot,
  PerfRegression,
  TraceInsightRef,
} from "@neuve/shared/models";
import { copyToClipboard } from "../../utils/copy-to-clipboard";
import { trackEvent } from "../../utils/session-analytics";
import { useColors } from "../theme-context";
import { Logo } from "../ui/logo";
import { Image } from "../ui/image";
import { usePostPrComment } from "../../data/github-mutations";
import { useNavigationStore, screenForTestingOrPortPicker } from "../../stores/use-navigation";
import { usePlanExecutionStore } from "../../stores/use-plan-execution-store";
import { saveFlowFn } from "../../data/flow-storage-atom";
import { formatElapsedTime } from "../../utils/format-elapsed-time";
import { getStepElapsedMs, getTotalElapsedMs } from "../../utils/step-elapsed";
import { RuledBox } from "../ui/ruled-box";
import {
  classifyCwv,
  CWV_THRESHOLDS,
  formatCwvTarget,
  formatCwvValue,
  type CwvClassification,
  type CwvMetric,
} from "@neuve/shared/cwv-thresholds";

interface ResultsScreenProps {
  report: PerfReport;
  videoUrl?: string;
}

export const ResultsScreen = ({ report, videoUrl }: ResultsScreenProps) => {
  const COLORS = useColors();
  const setScreen = useNavigationStore((state) => state.setScreen);
  const [statusMessage, setStatusMessage] = useState<{ text: string; color: string } | undefined>(
    undefined,
  );
  const commentMutation = usePostPrComment();
  const [saveResult, triggerSave] = useAtom(saveFlowFn, { mode: "promiseExit" });

  const savePending = saveResult.waiting;
  const saveSucceeded = AsyncResult.isSuccess(saveResult);
  const hasPullRequest = Option.isSome(report.pullRequest);

  const handlePostPullRequestComment = () => {
    if (!Option.isSome(report.pullRequest)) return;
    trackEvent("results:posted_to_pr");
    commentMutation.mutate({
      pullRequest: report.pullRequest.value,
      body: report.toPlainText,
    });
  };

  const handleCopyToClipboard = () => {
    const didCopy = copyToClipboard(report.toPlainText);
    if (didCopy) {
      trackEvent("results:copied_to_clipboard");
      setStatusMessage({
        text: `${figures.tick} Copied test summary. Paste it into your chat or PR.`,
        color: COLORS.GREEN,
      });
    } else {
      setStatusMessage({
        text: `${figures.cross} Couldn't copy the test summary. Press y to try again.`,
        color: COLORS.RED,
      });
    }
  };

  const handleSaveFlow = async () => {
    if (savePending || saveSucceeded) return;
    trackEvent("flow:saved", { step_count: report.steps.length });
    await triggerSave({ plan: report });
  };

  const handleRestartFlow = () => {
    trackEvent("results:restarted");
    usePlanExecutionStore.getState().setExecutedPlan(undefined);
    setScreen(
      screenForTestingOrPortPicker({
        changesFor: report.changesFor,
        instruction: report.instruction,
      }),
    );
  };

  useInput((input) => {
    const normalizedInput = input.toLowerCase();

    if (normalizedInput === "y") {
      handleCopyToClipboard();
    }
    if (normalizedInput === "p") {
      handlePostPullRequestComment();
    }
    if (normalizedInput === "s") {
      handleSaveFlow();
    }
    if (normalizedInput === "r") {
      handleRestartFlow();
    }
  });

  const isPassed = report.status === "passed";
  const statusColor = isPassed ? COLORS.GREEN : COLORS.RED;
  const statusIcon = isPassed ? figures.tick : figures.cross;
  const statusLabel = isPassed ? "Passed" : "Failed";
  const totalElapsedMs = getTotalElapsedMs(report.steps);

  const hasMetrics = report.metrics.length > 0;
  const hasRegressions = report.regressions.length > 0;
  const hasToolResult = report.events.some((event) => event._tag === "ToolResult");
  const insights = collectTraceInsights(report.metrics);
  const hasInsights = insights.length > 0;
  const showMetricsFallback = !hasMetrics && !hasToolResult;
  const showToolsButNoTraceFallback = !hasMetrics && hasToolResult;

  return (
    <Box flexDirection="column" width="100%" paddingY={1} paddingX={1}>
      <Box>
        <Logo />
        <Text wrap="truncate">
          {" "}
          <Text color={COLORS.DIM}>{figures.pointerSmall}</Text>{" "}
          <Text color={COLORS.TEXT}>{report.instruction}</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={statusColor} bold>
          {statusIcon} {statusLabel}
        </Text>
        {showMetricsFallback && (
          <Text color={COLORS.DIM}>{"  "}Agent did not run any performance tools.</Text>
        )}
        {showToolsButNoTraceFallback && (
          <Text color={COLORS.DIM}>
            {"  "}Agent ran tools but didn{"\u2019"}t capture a performance trace. Check the trace
            command output in the raw events.
          </Text>
        )}
        {hasMetrics && (
          <Text color={COLORS.DIM}>
            {"  "}
            {report.metrics.length} trace{report.metrics.length === 1 ? "" : "s"} captured
          </Text>
        )}
      </Box>

      {hasMetrics && <PerfMetricsTable metrics={report.metrics} />}
      {hasInsights && <TraceInsightsList insights={insights} />}
      {hasRegressions && <RegressionsPanel regressions={report.regressions} />}

      <RuledBox color={COLORS.YELLOW} marginTop={1}>
        <Text color={COLORS.YELLOW} bold>
          Copy this summary now
        </Text>
        <Text color={COLORS.TEXT}>
          Press{" "}
          <Text color={COLORS.PRIMARY} bold>
            y
          </Text>{" "}
          to copy the test summary so you can paste it into your chat or PR.
        </Text>
        <Text color={COLORS.DIM}>
          Press{" "}
          <Text color={COLORS.PRIMARY} bold>
            s
          </Text>{" "}
          to save this flow or{" "}
          <Text color={COLORS.PRIMARY} bold>
            r
          </Text>{" "}
          to run it again.
        </Text>
        {hasPullRequest && (
          <Text color={COLORS.DIM}>
            Press{" "}
            <Text color={COLORS.PRIMARY} bold>
              p
            </Text>{" "}
            to post the summary to the PR.
          </Text>
        )}
      </RuledBox>

      <Box flexDirection="column" marginTop={1}>
        {report.steps.map((step: AnalysisStep, stepIndex: number) => {
          const stepElapsedMs = getStepElapsedMs(step);
          const stepElapsedLabel =
            stepElapsedMs !== undefined ? formatElapsedTime(stepElapsedMs) : undefined;
          const stepStatus = report.stepStatuses.get(step.id);
          const isFailed = stepStatus?.status === "failed";
          const isSkipped = stepStatus?.status === "skipped";
          const stepColor = isFailed ? COLORS.RED : isSkipped ? COLORS.YELLOW : COLORS.GREEN;
          const stepIcon = isFailed ? figures.cross : isSkipped ? figures.arrowRight : figures.tick;
          const num = `${stepIndex + 1}.`;

          return (
            <Box key={step.id} flexDirection="column">
              <Text>
                <Text color={COLORS.DIM}>
                  {"  "}
                  {num}
                </Text>
                <Text color={stepColor}>
                  {" "}
                  {stepIcon} {step.title}
                </Text>
                {stepElapsedLabel && <Text color={COLORS.DIM}> {stepElapsedLabel}</Text>}
              </Text>
              {(isFailed || isSkipped) && stepStatus?.summary && (
                <Text color={COLORS.DIM}>
                  {"     "}
                  {stepStatus.summary}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      {totalElapsedMs > 0 && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>Worked for {formatElapsedTime(totalElapsedMs)}</Text>
        </Box>
      )}

      {statusMessage && (
        <Box marginTop={1}>
          <Text color={statusMessage.color}>{statusMessage.text}</Text>
        </Box>
      )}

      {commentMutation.isPending && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>Posting to PR{figures.ellipsis}</Text>
        </Box>
      )}
      {commentMutation.isSuccess && (
        <Box marginTop={1}>
          <Text color={COLORS.GREEN}>{figures.tick} Posted to PR</Text>
        </Box>
      )}
      {commentMutation.isError && (
        <Box marginTop={1}>
          <Text color={COLORS.RED}>{figures.cross} Failed to post to PR</Text>
        </Box>
      )}

      {savePending && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>Saving flow{figures.ellipsis}</Text>
        </Box>
      )}
      {saveSucceeded && (
        <Box marginTop={1}>
          <Text color={COLORS.GREEN}>{figures.tick} Flow saved</Text>
        </Box>
      )}
      {AsyncResult.isFailure(saveResult) && (
        <Box marginTop={1}>
          <Text color={COLORS.RED}>{figures.cross} Failed to save flow</Text>
        </Box>
      )}

      {videoUrl && (
        <Box flexDirection="column" paddingX={1}>
          <Text color={COLORS.DIM}>
            Video:{" "}
            <Text color={COLORS.PRIMARY} bold>
              {videoUrl}
            </Text>
          </Text>
        </Box>
      )}

      {report.summary && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.TEXT} bold>
            Summary
          </Text>
          <Box marginTop={0} paddingLeft={1}>
            <Text color={COLORS.DIM} wrap="wrap">
              {report.summary}
            </Text>
          </Box>
        </Box>
      )}

      {report.screenshotPaths.map((screenshotPath) => (
        <Box key={screenshotPath} marginTop={1}>
          <Image src={screenshotPath} alt={`Screenshot: ${screenshotPath}`} />
        </Box>
      ))}
    </Box>
  );
};

const CWV_METRIC_ORDER: readonly CwvMetric[] = ["LCP", "FCP", "CLS", "INP", "TTFB"];

const METRIC_COLUMN_WIDTH = 7;
const VALUE_COLUMN_WIDTH = 9;
const TARGET_COLUMN_WIDTH = 9;
const STATUS_COLUMN_WIDTH = 18;

const padCell = (text: string, width: number): string => {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
};

const collectTraceInsights = (metrics: readonly PerfMetricSnapshot[]): TraceInsightRef[] => {
  const seen = new Set<string>();
  const ordered: TraceInsightRef[] = [];
  for (const metric of metrics) {
    for (const insight of metric.traceInsights) {
      if (seen.has(insight.insightName)) continue;
      seen.add(insight.insightName);
      ordered.push(insight);
    }
  }
  return ordered;
};

interface CwvRow {
  metric: CwvMetric;
  value: number;
  classification: CwvClassification;
}

const collectCwvRows = (snapshot: PerfMetricSnapshot): CwvRow[] => {
  const rows: CwvRow[] = [];
  for (const metric of CWV_METRIC_ORDER) {
    const value = getMetricValue(snapshot, metric);
    if (value === undefined) continue;
    rows.push({ metric, value, classification: classifyCwv(metric, value) });
  }
  return rows;
};

const getMetricValue = (
  snapshot: PerfMetricSnapshot,
  metric: CwvMetric,
): number | undefined => {
  if (metric === "LCP") return Option.getOrUndefined(snapshot.lcpMs);
  if (metric === "FCP") return Option.getOrUndefined(snapshot.fcpMs);
  if (metric === "CLS") return Option.getOrUndefined(snapshot.clsScore);
  if (metric === "INP") return Option.getOrUndefined(snapshot.inpMs);
  return Option.getOrUndefined(snapshot.ttfbMs);
};

interface PerfMetricsTableProps {
  metrics: readonly PerfMetricSnapshot[];
}

const PerfMetricsTable = ({ metrics }: PerfMetricsTableProps) => {
  const renderableSnapshots = metrics
    .map((snapshot) => ({ snapshot, rows: collectCwvRows(snapshot) }))
    .filter((entry) => entry.rows.length > 0);

  if (renderableSnapshots.length === 0) return undefined;

  return (
    <Box flexDirection="column" marginTop={1}>
      {renderableSnapshots.map((entry, index) => (
        <PerfMetricsTableSnapshot
          key={`${entry.snapshot.url}-${index}`}
          snapshot={entry.snapshot}
          rows={entry.rows}
        />
      ))}
    </Box>
  );
};

interface PerfMetricsTableSnapshotProps {
  snapshot: PerfMetricSnapshot;
  rows: readonly CwvRow[];
}

const PerfMetricsTableSnapshot = ({ snapshot, rows }: PerfMetricsTableSnapshotProps) => {
  const COLORS = useColors();
  const headerLine = `${padCell("Metric", METRIC_COLUMN_WIDTH)} \u2502 ${padCell(
    "Value",
    VALUE_COLUMN_WIDTH,
  )} \u2502 ${padCell("Target", TARGET_COLUMN_WIDTH)} \u2502 ${padCell(
    "Status",
    STATUS_COLUMN_WIDTH,
  )}`;
  const dividerLine = `${"\u2500".repeat(METRIC_COLUMN_WIDTH + 1)}\u253c${"\u2500".repeat(
    VALUE_COLUMN_WIDTH + 2,
  )}\u253c${"\u2500".repeat(TARGET_COLUMN_WIDTH + 2)}\u253c${"\u2500".repeat(
    STATUS_COLUMN_WIDTH + 1,
  )}`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.PRIMARY} bold>
        {snapshot.url}
      </Text>
      <Text color={COLORS.DIM}>{headerLine}</Text>
      <Text color={COLORS.DIM}>{dividerLine}</Text>
      {rows.map((row) => (
        <PerfMetricsTableRow key={row.metric} row={row} />
      ))}
    </Box>
  );
};

interface PerfMetricsTableRowProps {
  row: CwvRow;
}

const PerfMetricsTableRow = ({ row }: PerfMetricsTableRowProps) => {
  const COLORS = useColors();
  const statusColor = colorForClassification(row.classification, COLORS);
  const statusIcon = iconForClassification(row.classification);
  const statusLabel = `${statusIcon} ${row.classification}`;
  const metricCell = padCell(row.metric, METRIC_COLUMN_WIDTH);
  const valueCell = padCell(formatCwvValue(row.metric, row.value), VALUE_COLUMN_WIDTH);
  const targetCell = padCell(formatCwvTarget(row.metric), TARGET_COLUMN_WIDTH);
  const statusCell = padCell(statusLabel, STATUS_COLUMN_WIDTH);

  return (
    <Text>
      <Text color={COLORS.TEXT}>{metricCell}</Text>
      <Text color={COLORS.DIM}> {"\u2502"} </Text>
      <Text color={statusColor}>{valueCell}</Text>
      <Text color={COLORS.DIM}> {"\u2502"} </Text>
      <Text color={COLORS.DIM}>{targetCell}</Text>
      <Text color={COLORS.DIM}> {"\u2502"} </Text>
      <Text color={statusColor}>{statusCell}</Text>
    </Text>
  );
};

interface ThemeColors {
  GREEN: string;
  YELLOW: string;
  RED: string;
  DIM: string;
  TEXT: string;
  PRIMARY: string;
}

const colorForClassification = (
  classification: CwvClassification,
  colors: ThemeColors,
): string => {
  if (classification === "good") return colors.GREEN;
  if (classification === "needs-improvement") return colors.YELLOW;
  return colors.RED;
};

const iconForClassification = (classification: CwvClassification): string => {
  if (classification === "good") return figures.tick;
  if (classification === "needs-improvement") return figures.warning;
  return figures.cross;
};

interface TraceInsightsListProps {
  insights: readonly TraceInsightRef[];
}

const TraceInsightsList = ({ insights }: TraceInsightsListProps) => {
  const COLORS = useColors();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.TEXT} bold>
        Trace insights{" "}
        <Text color={COLORS.DIM}>(drill in via `trace analyze` with insightSetId):</Text>
      </Text>
      {insights.map((insight) => (
        <Text key={`${insight.insightSetId}-${insight.insightName}`}>
          <Text color={COLORS.DIM}> {figures.bullet}</Text>{" "}
          <Text color={COLORS.TEXT}>{insight.insightName}</Text>
        </Text>
      ))}
    </Box>
  );
};

interface RegressionsPanelProps {
  regressions: readonly PerfRegression[];
}

const RegressionsPanel = ({ regressions }: RegressionsPanelProps) => {
  const COLORS = useColors();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.TEXT} bold>
        Regressions:
      </Text>
      {regressions.map((regression, index) => (
        <RegressionRow
          key={`${regression.url}-${regression.metric}-${index}`}
          regression={regression}
        />
      ))}
    </Box>
  );
};

interface RegressionRowProps {
  regression: PerfRegression;
}

const REGRESSION_CRITICAL_ICON = "\u2717";
const REGRESSION_WARNING_ICON = "\u26a0";
const REGRESSION_INFO_ICON = "\u00b7";

const RegressionRow = ({ regression }: RegressionRowProps) => {
  const COLORS = useColors();
  const color = colorForSeverity(regression.severity, COLORS);
  const icon = iconForSeverity(regression.severity);
  const currentLabel = formatRegressionValue(regression.metric, regression.currentValue);
  const targetLabel = formatRegressionValue(regression.metric, regression.baselineValue);
  const deltaSign = regression.percentChange >= 0 ? "+" : "";
  const deltaLabel = `${deltaSign}${regression.percentChange.toFixed(0)}%`;

  return (
    <Text>
      <Text color={color}>
        {"  "}
        {icon}{" "}
      </Text>
      <Text color={COLORS.TEXT}>
        {regression.metric} on {regression.url}
      </Text>
      <Text color={COLORS.DIM}>
        {" "}
        {"\u2014"} {currentLabel} (target {targetLabel}, {deltaLabel}, {regression.severity})
      </Text>
    </Text>
  );
};

const colorForSeverity = (
  severity: PerfRegression["severity"],
  colors: ThemeColors,
): string => {
  if (severity === "critical") return colors.RED;
  if (severity === "warning") return colors.YELLOW;
  return colors.DIM;
};

const iconForSeverity = (severity: PerfRegression["severity"]): string => {
  if (severity === "critical") return REGRESSION_CRITICAL_ICON;
  if (severity === "warning") return REGRESSION_WARNING_ICON;
  return REGRESSION_INFO_ICON;
};

const formatRegressionValue = (metric: string, value: number): string => {
  const upperMetric = metric.toUpperCase();
  if (upperMetric in CWV_THRESHOLDS) {
    return formatCwvValue(upperMetric as CwvMetric, value);
  }
  return value.toString();
};
