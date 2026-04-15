import { useState } from "react";
import { Box, Text, useInput } from "ink";
import figures from "figures";
import { Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useAtom } from "@effect/atom-react";
import type { PerfReport } from "@neuve/supervisor";
import type {
  AnalysisStep,
  ConsoleCapture,
  ConsoleEntry,
  ExecutionEvent,
  InsightDetail,
  NetworkCapture,
  NetworkRequest,
  PerfMetricSnapshot,
  PerfRegression,
} from "@neuve/shared/models";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions";
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
import { ErrorBoundary } from "../ui/error-boundary";
import {
  classifyCwv,
  formatCwvTarget,
  formatCwvValue,
  type CwvClassification,
  type CwvMetric,
  type PerfMetricLabel,
} from "@neuve/shared/cwv-thresholds";

interface ResultsScreenProps {
  report: PerfReport;
  videoUrl?: string;
}

export const ResultsScreen = ({ report, videoUrl }: ResultsScreenProps) => {
  const COLORS = useColors();
  const setScreen = useNavigationStore((state) => state.setScreen);
  const setOverlayOpen = useNavigationStore((state) => state.setOverlayOpen);
  const [statusMessage, setStatusMessage] = useState<{ text: string; color: string } | undefined>(
    undefined,
  );
  const [showConsole, setShowConsole] = useState<boolean>(false);
  const [showNetwork, setShowNetwork] = useState<boolean>(false);
  const [showInsights, setShowInsights] = useState<boolean>(false);
  const [showRawEvents, setShowRawEvents] = useState<boolean>(false);
  const [rawScrollOffset, setRawScrollOffset] = useState<number>(0);

  const openRawEvents = () => {
    setShowRawEvents(true);
    setRawScrollOffset(0);
    setOverlayOpen(true);
  };

  const closeRawEvents = () => {
    setShowRawEvents(false);
    setRawScrollOffset(0);
    setOverlayOpen(false);
  };
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

  useInput((input, key) => {
    const normalizedInput = input.toLowerCase();

    if (showRawEvents) {
      if (key.escape) {
        closeRawEvents();
        return;
      }
      if (key.downArrow || normalizedInput === "j") {
        setRawScrollOffset((previous) => previous + 1);
        return;
      }
      if (key.upArrow || normalizedInput === "k") {
        setRawScrollOffset((previous) => Math.max(0, previous - 1));
        return;
      }
      if (key.pageDown || (key.ctrl && input === "d")) {
        setRawScrollOffset((previous) => previous + RAW_EVENTS_PAGE_STEP);
        return;
      }
      if (key.pageUp || (key.ctrl && input === "u")) {
        setRawScrollOffset((previous) => Math.max(0, previous - RAW_EVENTS_PAGE_STEP));
        return;
      }
      if (key.ctrl && input === "o") {
        closeRawEvents();
        return;
      }
      return;
    }

    if (key.ctrl && input === "o") {
      trackEvent("results:opened_raw_events");
      openRawEvents();
      return;
    }
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
    if (normalizedInput === "c") {
      setShowConsole((previous) => !previous);
    }
    if (normalizedInput === "n") {
      setShowNetwork((previous) => !previous);
    }
    if (normalizedInput === "i") {
      setShowInsights((previous) => !previous);
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
  const insightNames = report.uniqueInsightNames;
  const hasInsights = insightNames.length > 0;
  const hasConsoleCaptures = report.consoleCaptures.some((capture) => capture.entries.length > 0);
  const hasNetworkCaptures = report.networkCaptures.some(
    (capture) => capture.requests.length > 0,
  );
  const hasInsightDetails = report.insightDetails.length > 0;
  const showMetricsFallback = !hasMetrics && !hasToolResult;
  const showToolsButNoTraceFallback = !hasMetrics && hasToolResult;

  if (showRawEvents) {
    return (
      <ErrorBoundary label="Raw-events view">
        <RawEventsView
          events={report.events}
          consoleCaptures={report.consoleCaptures}
          networkCaptures={report.networkCaptures}
          insightDetails={report.insightDetails}
          instruction={report.instruction}
          scrollOffset={rawScrollOffset}
        />
      </ErrorBoundary>
    );
  }

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
      {hasInsights && <TraceInsightsList insightNames={insightNames} />}
      {hasRegressions && <RegressionsPanel regressions={report.regressions} />}
      {hasConsoleCaptures && (
        <ConsoleCapturesPanel captures={report.consoleCaptures} expanded={showConsole} />
      )}
      {hasNetworkCaptures && (
        <NetworkCapturesPanel captures={report.networkCaptures} expanded={showNetwork} />
      )}
      {hasInsightDetails && (
        <InsightDetailsPanel details={report.insightDetails} expanded={showInsights} />
      )}

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
  insightNames: readonly string[];
}

const TraceInsightsList = ({ insightNames }: TraceInsightsListProps) => {
  const COLORS = useColors();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.TEXT} bold>
        Trace insights{" "}
        <Text color={COLORS.DIM}>(drill in via `trace analyze` with insightSetId):</Text>
      </Text>
      {insightNames.map((insightName) => (
        <Text key={insightName}>
          <Text color={COLORS.DIM}> {figures.bullet}</Text>{" "}
          <Text color={COLORS.TEXT}>{insightName}</Text>
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

const TRANSFER_SIZE_DECIMALS = 0;

const formatRegressionValue = (metric: PerfMetricLabel, value: number): string => {
  if (metric === "TotalTransferSize") {
    return `${value.toFixed(TRANSFER_SIZE_DECIMALS)} KB`;
  }
  return formatCwvValue(metric, value);
};

const CONSOLE_LEVEL_RANK: Record<ConsoleEntry["level"], number> = {
  error: 0,
  warn: 1,
  log: 2,
  info: 3,
  debug: 4,
};

const CONSOLE_LEVEL_LABEL_WIDTH = 9;
const CONSOLE_TEXT_TRIM_PADDING = 14;
const CONSOLE_TEXT_MIN_WIDTH = 20;

const truncateText = (text: string, maxWidth: number): string => {
  if (!Number.isFinite(maxWidth) || maxWidth <= 1) return text;
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, Math.max(1, maxWidth - 1))}\u2026`;
};

interface ConsoleSummary {
  total: number;
  errors: number;
  warnings: number;
  info: number;
}

const summarizeConsole = (captures: readonly ConsoleCapture[]): ConsoleSummary => {
  let total = 0;
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const capture of captures) {
    for (const entry of capture.entries) {
      total += 1;
      if (entry.level === "error") errors += 1;
      else if (entry.level === "warn") warnings += 1;
      else info += 1;
    }
  }
  return { total, errors, warnings, info };
};

interface ConsoleCapturesPanelProps {
  captures: readonly ConsoleCapture[];
  expanded: boolean;
}

const ConsoleCapturesPanel = ({ captures, expanded }: ConsoleCapturesPanelProps) => {
  const COLORS = useColors();
  const summary = summarizeConsole(captures);
  const hintLabel = expanded ? "c to collapse" : "c to expand";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={COLORS.TEXT} bold>
          Console messages{" "}
        </Text>
        <Text color={COLORS.DIM}>
          (total {summary.total}: {summary.errors} error{summary.errors === 1 ? "" : "s"},{" "}
          {summary.warnings} warning{summary.warnings === 1 ? "" : "s"}, {summary.info} info){" "}
          [{hintLabel}]
        </Text>
      </Text>
      {expanded && (
        <Box flexDirection="column" marginTop={1}>
          {captures.map((capture, captureIndex) => (
            <ConsoleCaptureBlock
              key={`${capture.url}-${captureIndex}`}
              capture={capture}
              isLast={captureIndex === captures.length - 1}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

interface ConsoleCaptureBlockProps {
  capture: ConsoleCapture;
  isLast: boolean;
}

const ConsoleCaptureBlock = ({ capture, isLast }: ConsoleCaptureBlockProps) => {
  const COLORS = useColors();
  if (capture.entries.length === 0) return undefined;
  const sortedEntries = [...capture.entries].sort(
    (left, right) => CONSOLE_LEVEL_RANK[left.level] - CONSOLE_LEVEL_RANK[right.level],
  );
  const terminalColumns = process.stdout.columns ?? 80;
  const maxTextWidth = Math.max(
    CONSOLE_TEXT_MIN_WIDTH,
    terminalColumns - CONSOLE_TEXT_TRIM_PADDING,
  );

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1}>
      <Text color={COLORS.PRIMARY} bold>
        {capture.url}
      </Text>
      {sortedEntries.map((entry, entryIndex) => (
        <ConsoleEntryRow
          key={`${entry.level}-${entryIndex}`}
          entry={entry}
          maxTextWidth={maxTextWidth}
        />
      ))}
    </Box>
  );
};

interface ConsoleEntryRowProps {
  entry: ConsoleEntry;
  maxTextWidth: number;
}

const ConsoleEntryRow = ({ entry, maxTextWidth }: ConsoleEntryRowProps) => {
  const COLORS = useColors();
  const levelLabel = `[${entry.level.toUpperCase()}]`;
  const paddedLevel = levelLabel + " ".repeat(Math.max(0, CONSOLE_LEVEL_LABEL_WIDTH - levelLabel.length));
  const levelColor = consoleLevelColor(entry.level, COLORS);
  const entryUrl = Option.getOrUndefined(entry.url);
  const trimmedText = truncateText(entry.text, maxTextWidth);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLORS.DIM}>{"  "}</Text>
        <Text color={levelColor}>{paddedLevel}</Text>
        <Text color={COLORS.TEXT}> {trimmedText}</Text>
      </Text>
      {entryUrl && (
        <Text color={COLORS.DIM}>
          {"            "}
          {entryUrl}
        </Text>
      )}
    </Box>
  );
};

const consoleLevelColor = (level: ConsoleEntry["level"], colors: ThemeColors): string => {
  if (level === "error") return colors.RED;
  if (level === "warn") return colors.YELLOW;
  if (level === "debug") return colors.DIM;
  return colors.TEXT;
};

interface NetworkSummary {
  total: number;
  failed: number;
}

const summarizeNetwork = (captures: readonly NetworkCapture[]): NetworkSummary => {
  let total = 0;
  let failed = 0;
  for (const capture of captures) {
    for (const request of capture.requests) {
      total += 1;
      if (request.failed) failed += 1;
    }
  }
  return { total, failed };
};

interface NetworkCapturesPanelProps {
  captures: readonly NetworkCapture[];
  expanded: boolean;
}

const NetworkCapturesPanel = ({ captures, expanded }: NetworkCapturesPanelProps) => {
  const COLORS = useColors();
  const summary = summarizeNetwork(captures);
  const hintLabel = expanded ? "n to collapse" : "n to expand";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={COLORS.TEXT} bold>
          Network requests{" "}
        </Text>
        <Text color={COLORS.DIM}>
          ({summary.total} total, {summary.failed} failed) [{hintLabel}]
        </Text>
      </Text>
      {expanded && (
        <Box flexDirection="column" marginTop={1}>
          {captures.map((capture, captureIndex) => (
            <NetworkCaptureBlock
              key={`${capture.url}-${captureIndex}`}
              capture={capture}
              isLast={captureIndex === captures.length - 1}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

interface NetworkCaptureBlockProps {
  capture: NetworkCapture;
  isLast: boolean;
}

const NETWORK_STATUS_WIDTH = 3;
const NETWORK_METHOD_WIDTH = 5;
const NETWORK_URL_COLUMN_PADDING = 20;
const NETWORK_URL_MIN_WIDTH = 30;

const NetworkCaptureBlock = ({ capture, isLast }: NetworkCaptureBlockProps) => {
  const COLORS = useColors();
  if (capture.requests.length === 0) return undefined;
  const terminalColumns = process.stdout.columns ?? 80;
  const urlMaxWidth = Math.max(
    NETWORK_URL_MIN_WIDTH,
    terminalColumns - NETWORK_URL_COLUMN_PADDING,
  );

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1}>
      <Text color={COLORS.PRIMARY} bold>
        {capture.url}
      </Text>
      {capture.requests.map((request, requestIndex) => (
        <NetworkRequestRow
          key={`${request.url}-${requestIndex}`}
          request={request}
          urlMaxWidth={urlMaxWidth}
        />
      ))}
    </Box>
  );
};

interface NetworkRequestRowProps {
  request: NetworkRequest;
  urlMaxWidth: number;
}

const formatNetworkStatus = (request: NetworkRequest): string => {
  const status = Option.getOrUndefined(request.status);
  if (status !== undefined) return padCell(String(status), NETWORK_STATUS_WIDTH);
  return padCell("ERR", NETWORK_STATUS_WIDTH);
};

const networkStatusColor = (request: NetworkRequest, colors: ThemeColors): string => {
  const status = Option.getOrUndefined(request.status);
  if (status === undefined) return colors.RED;
  if (status >= 400) return colors.RED;
  if (status >= 300) return colors.YELLOW;
  if (status >= 200) return colors.GREEN;
  return colors.DIM;
};

const NetworkRequestRow = ({ request, urlMaxWidth }: NetworkRequestRowProps) => {
  const COLORS = useColors();
  const statusCell = formatNetworkStatus(request);
  const statusColor = networkStatusColor(request, COLORS);
  const methodCell = padCell(request.method.toUpperCase(), NETWORK_METHOD_WIDTH);
  const urlCell = truncateText(request.url, urlMaxWidth);
  const rowColor = request.failed ? COLORS.RED : COLORS.TEXT;

  return (
    <Text>
      <Text color={COLORS.DIM}>{"  "}</Text>
      <Text color={statusColor}>{statusCell}</Text>
      <Text color={COLORS.DIM}> </Text>
      <Text color={rowColor}>{methodCell}</Text>
      <Text color={rowColor}> {urlCell}</Text>
      {request.failed && <Text color={COLORS.RED}> [failed]</Text>}
    </Text>
  );
};

interface InsightDetailsPanelProps {
  details: readonly InsightDetail[];
  expanded: boolean;
}

const InsightDetailsPanel = ({ details, expanded }: InsightDetailsPanelProps) => {
  const COLORS = useColors();
  const hintLabel = expanded ? "i to collapse" : "i to expand";
  const namePreview = details.map((detail) => detail.insightName).join(", ");

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={COLORS.TEXT} bold>
          Insight details{" "}
        </Text>
        <Text color={COLORS.DIM}>
          ({details.length}: {namePreview}) [{hintLabel}]
        </Text>
      </Text>
      {expanded && (
        <Box flexDirection="column" marginTop={1}>
          {details.map((detail, detailIndex) => (
            <InsightDetailBlock
              key={`${detail.insightName}-${detailIndex}`}
              detail={detail}
              isLast={detailIndex === details.length - 1}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

interface InsightDetailBlockProps {
  detail: InsightDetail;
  isLast: boolean;
}

const InsightDetailBlock = ({ detail, isLast }: InsightDetailBlockProps) => {
  const COLORS = useColors();
  const insightSetId = Option.getOrUndefined(detail.insightSetId);
  const estimatedSavings = Option.getOrUndefined(detail.estimatedSavings);
  const hasResources = detail.externalResources.length > 0;

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1}>
      <Text>
        <Text color={COLORS.YELLOW}>{"\u25b8 "}</Text>
        <Text color={COLORS.TEXT} bold>
          {detail.insightName}
        </Text>
        <Text color={COLORS.DIM}> {"\u2014"} {detail.title}</Text>
        {insightSetId && <Text color={COLORS.DIM}> ({insightSetId})</Text>}
      </Text>
      <Box paddingLeft={2} flexDirection="column">
        <Text color={COLORS.TEXT} wrap="wrap">
          {detail.summary}
        </Text>
        <Box marginTop={1}>
          <Text color={COLORS.DIM} wrap="wrap">
            {detail.analysis}
          </Text>
        </Box>
        {estimatedSavings && (
          <Text color={COLORS.DIM}>Estimated savings: {estimatedSavings}</Text>
        )}
        {hasResources && (
          <Text color={COLORS.DIM} wrap="wrap">
            Resources: {detail.externalResources.join(" \u00b7 ")}
          </Text>
        )}
      </Box>
    </Box>
  );
};

const RAW_EVENTS_PAGE_STEP = 10;
const RAW_TOOL_INPUT_MAX_CHARS = 500;
const RAW_TOOL_OUTPUT_MAX_CHARS = 500;
const RAW_JSON_INDENT_SPACES = 2;
const RAW_VIEW_CHROME_ROWS = 8;
const RAW_VIEW_MIN_VISIBLE_ROWS = 10;
const RAW_VIEW_MIN_CONTENT_WIDTH_COLS = 40;
const RAW_VIEW_CONTENT_WIDTH_MARGIN_COLS = 2;
const RAW_TOOL_INDENT_MARGIN_COLS = 4;
const RAW_NETWORK_URL_MIN_WIDTH_COLS = 20;
const RAW_NETWORK_STATUS_MIN_WIDTH_COLS = 10;
const RAW_INSIGHT_BODY_INDENT_COLS = 2;

interface RawLine {
  text: string;
  color?: string;
  bold?: boolean;
}

const renderRawLineText = (text: string): string => {
  if (text.length === 0) return " ";
  return text;
};

interface RawEventsViewProps {
  events: readonly ExecutionEvent[];
  consoleCaptures: readonly ConsoleCapture[];
  networkCaptures: readonly NetworkCapture[];
  insightDetails: readonly InsightDetail[];
  instruction: string;
  scrollOffset: number;
}

const RawEventsView = ({
  events,
  consoleCaptures,
  networkCaptures,
  insightDetails,
  instruction,
  scrollOffset,
}: RawEventsViewProps) => {
  const COLORS = useColors();
  const [columns, rows] = useStdoutDimensions();
  const safeColumns = Number.isFinite(columns) && columns > 0 ? columns : RAW_VIEW_MIN_CONTENT_WIDTH_COLS;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : RAW_VIEW_MIN_VISIBLE_ROWS;
  const contentWidth = Math.max(
    RAW_VIEW_MIN_CONTENT_WIDTH_COLS,
    safeColumns - RAW_VIEW_CONTENT_WIDTH_MARGIN_COLS,
  );
  const lines = buildRawLines({
    events,
    consoleCaptures,
    networkCaptures,
    insightDetails,
    colors: COLORS,
    maxWidth: contentWidth,
  });
  const visibleRows = Math.max(RAW_VIEW_MIN_VISIBLE_ROWS, safeRows - RAW_VIEW_CHROME_ROWS);
  const totalLines = lines.length;
  const maxScroll = Math.max(0, totalLines - visibleRows);
  const safeScrollOffset = Number.isFinite(scrollOffset) ? Math.max(0, Math.floor(scrollOffset)) : 0;
  const clampedOffset = Math.min(safeScrollOffset, maxScroll);
  const visibleLines = lines.slice(clampedOffset, clampedOffset + visibleRows);
  const lastVisibleLine = Math.min(totalLines, clampedOffset + visibleRows);
  const positionLabel =
    totalLines === 0 ? "empty" : `${clampedOffset + 1}-${lastVisibleLine} / ${totalLines}`;

  return (
    <Box flexDirection="column" width="100%" paddingY={1} paddingX={1}>
      <Box>
        <Logo />
        <Text wrap="truncate">
          {" "}
          <Text color={COLORS.DIM}>{figures.pointerSmall}</Text>{" "}
          <Text color={COLORS.TEXT}>{instruction}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.YELLOW} bold>
          Raw events
        </Text>
        <Text color={COLORS.DIM}>
          {"  "}
          {positionLabel}
          {"  "}[
          <Text color={COLORS.PRIMARY} bold>
            {"\u2191\u2193"}
          </Text>
          {" scroll  "}
          <Text color={COLORS.PRIMARY} bold>
            pgup/pgdn
          </Text>
          {" page  "}
          <Text color={COLORS.PRIMARY} bold>
            esc
          </Text>
          {" back]"}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {totalLines === 0 && (
          <Text color={COLORS.DIM}>No detailed events captured.</Text>
        )}
        {visibleLines.map((line, index) => (
          <Text
            key={`raw-${clampedOffset + index}`}
            color={line.color ?? COLORS.TEXT}
            bold={line.bold === true}
            wrap="truncate"
          >
            {renderRawLineText(line.text)}
          </Text>
        ))}
      </Box>
    </Box>
  );
};

interface BuildRawLinesArgs {
  events: readonly ExecutionEvent[];
  consoleCaptures: readonly ConsoleCapture[];
  networkCaptures: readonly NetworkCapture[];
  insightDetails: readonly InsightDetail[];
  colors: ReturnType<typeof useColors>;
  maxWidth: number;
}

const buildRawLines = ({
  events,
  consoleCaptures,
  networkCaptures,
  insightDetails,
  colors,
  maxWidth,
}: BuildRawLinesArgs): RawLine[] => {
  const lines: RawLine[] = [];
  appendToolEventLines(lines, events, colors, maxWidth);
  appendConsoleLines(lines, consoleCaptures, colors, maxWidth);
  appendNetworkLines(lines, networkCaptures, colors, maxWidth);
  appendInsightLines(lines, insightDetails, colors, maxWidth);
  return lines;
};

const appendSectionHeader = (
  lines: RawLine[],
  title: string,
  color: string,
  maxWidth: number,
) => {
  if (lines.length > 0) lines.push({ text: "" });
  lines.push({ text: title, color, bold: true });
  lines.push({
    text: "\u2500".repeat(Math.min(maxWidth, title.length + 4)),
    color,
  });
};

const appendToolEventLines = (
  lines: RawLine[],
  events: readonly ExecutionEvent[],
  colors: ReturnType<typeof useColors>,
  maxWidth: number,
) => {
  const toolEvents = events.filter(
    (event) =>
      event._tag === "ToolCall" ||
      event._tag === "ToolResult" ||
      event._tag === "ToolProgress",
  );
  if (toolEvents.length === 0) return;

  appendSectionHeader(
    lines,
    `Tool events (${toolEvents.length})`,
    colors.YELLOW,
    maxWidth,
  );

  for (const event of toolEvents) {
    if (event._tag === "ToolCall") {
      lines.push({
        text: `${figures.arrowRight} call  ${event.toolName}`,
        color: colors.PRIMARY,
        bold: true,
      });
      const inputText = formatToolInput(event.input);
      for (const line of wrapPlain(inputText, maxWidth - RAW_TOOL_INDENT_MARGIN_COLS)) {
        lines.push({ text: `    ${line}`, color: colors.DIM });
      }
      continue;
    }
    if (event._tag === "ToolResult") {
      const icon = event.isError ? figures.cross : figures.tick;
      const statusColor = event.isError ? colors.RED : colors.GREEN;
      lines.push({
        text: `${icon} result ${event.toolName}`,
        color: statusColor,
        bold: true,
      });
      const truncated = truncateText(event.result, RAW_TOOL_OUTPUT_MAX_CHARS);
      for (const line of wrapPlain(truncated, maxWidth - RAW_TOOL_INDENT_MARGIN_COLS)) {
        lines.push({ text: `    ${line}`, color: colors.DIM });
      }
      continue;
    }
    lines.push({
      text: `  ${figures.ellipsis} progress ${event.toolName} (${event.outputSize} bytes)`,
      color: colors.DIM,
    });
  }
};

const appendConsoleLines = (
  lines: RawLine[],
  captures: readonly ConsoleCapture[],
  colors: ReturnType<typeof useColors>,
  maxWidth: number,
) => {
  let totalEntries = 0;
  for (const capture of captures) totalEntries += capture.entries.length;
  if (totalEntries === 0) return;

  appendSectionHeader(
    lines,
    `Console captures (${totalEntries})`,
    colors.YELLOW,
    maxWidth,
  );

  const themeColors: ThemeColors = {
    GREEN: colors.GREEN,
    YELLOW: colors.YELLOW,
    RED: colors.RED,
    DIM: colors.DIM,
    TEXT: colors.TEXT,
    PRIMARY: colors.PRIMARY,
  };

  for (const capture of captures) {
    if (capture.entries.length === 0) continue;
    lines.push({ text: capture.url, color: colors.PRIMARY, bold: true });
    for (const entry of capture.entries) {
      const level = `[${entry.level.toUpperCase()}]`;
      const padded = level + " ".repeat(Math.max(0, CONSOLE_LEVEL_LABEL_WIDTH - level.length));
      const levelColor = consoleLevelColor(entry.level, themeColors);
      const prefix = `  ${padded} `;
      const availableWidth = Math.max(RAW_NETWORK_STATUS_MIN_WIDTH_COLS, maxWidth - prefix.length);
      const wrapped = wrapPlain(entry.text, availableWidth);
      if (wrapped.length === 0) {
        lines.push({ text: prefix, color: levelColor });
      }
      wrapped.forEach((segment, index) => {
        const linePrefix = index === 0 ? prefix : " ".repeat(prefix.length);
        lines.push({ text: `${linePrefix}${segment}`, color: levelColor });
      });
      const entryUrl = Option.getOrUndefined(entry.url);
      if (entryUrl) {
        lines.push({
          text: `  ${" ".repeat(CONSOLE_LEVEL_LABEL_WIDTH)} ${truncateText(
            entryUrl,
            Math.max(
              RAW_NETWORK_STATUS_MIN_WIDTH_COLS,
              maxWidth - CONSOLE_LEVEL_LABEL_WIDTH - RAW_TOOL_INDENT_MARGIN_COLS,
            ),
          )}`,
          color: colors.DIM,
        });
      }
    }
    lines.push({ text: "" });
  }
};

const appendNetworkLines = (
  lines: RawLine[],
  captures: readonly NetworkCapture[],
  colors: ReturnType<typeof useColors>,
  maxWidth: number,
) => {
  let totalRequests = 0;
  for (const capture of captures) totalRequests += capture.requests.length;
  if (totalRequests === 0) return;

  appendSectionHeader(
    lines,
    `Network captures (${totalRequests})`,
    colors.YELLOW,
    maxWidth,
  );

  const themeColors: ThemeColors = {
    GREEN: colors.GREEN,
    YELLOW: colors.YELLOW,
    RED: colors.RED,
    DIM: colors.DIM,
    TEXT: colors.TEXT,
    PRIMARY: colors.PRIMARY,
  };

  for (const capture of captures) {
    if (capture.requests.length === 0) continue;
    lines.push({ text: capture.url, color: colors.PRIMARY, bold: true });
    for (const request of capture.requests) {
      const status = formatNetworkStatus(request);
      const method = padCell(request.method.toUpperCase(), NETWORK_METHOD_WIDTH);
      const durationMs = Option.getOrUndefined(request.durationMs);
      const transferKb = Option.getOrUndefined(request.transferSizeKb);
      const extras: string[] = [];
      if (durationMs !== undefined) extras.push(`${Math.round(durationMs)}ms`);
      if (transferKb !== undefined) extras.push(`${transferKb.toFixed(0)}KB`);
      if (request.failed) extras.push("failed");
      const extrasLabel = extras.length > 0 ? ` [${extras.join(", ")}]` : "";
      const prefix = `  ${status} ${method} `;
      const urlMax = Math.max(
        RAW_NETWORK_URL_MIN_WIDTH_COLS,
        maxWidth - prefix.length - extrasLabel.length,
      );
      const urlCell = truncateText(request.url, urlMax);
      const lineColor = request.failed
        ? colors.RED
        : networkStatusColor(request, themeColors);
      lines.push({
        text: `${prefix}${urlCell}${extrasLabel}`,
        color: lineColor,
      });
    }
    lines.push({ text: "" });
  }
};

const appendInsightLines = (
  lines: RawLine[],
  details: readonly InsightDetail[],
  colors: ReturnType<typeof useColors>,
  maxWidth: number,
) => {
  if (details.length === 0) return;

  appendSectionHeader(
    lines,
    `Insight details (${details.length})`,
    colors.YELLOW,
    maxWidth,
  );

  for (const detail of details) {
    lines.push({
      text: `${figures.pointerSmall} ${detail.insightName} \u2014 ${detail.title}`,
      color: colors.TEXT,
      bold: true,
    });
    const insightSetId = Option.getOrUndefined(detail.insightSetId);
    if (insightSetId) {
      lines.push({ text: `  (${insightSetId})`, color: colors.DIM });
    }
    for (const line of wrapPlain(detail.summary, maxWidth - RAW_INSIGHT_BODY_INDENT_COLS)) {
      lines.push({ text: `  ${line}`, color: colors.TEXT });
    }
    lines.push({ text: "" });
    for (const line of wrapPlain(detail.analysis, maxWidth - RAW_INSIGHT_BODY_INDENT_COLS)) {
      lines.push({ text: `  ${line}`, color: colors.DIM });
    }
    const estimatedSavings = Option.getOrUndefined(detail.estimatedSavings);
    if (estimatedSavings) {
      lines.push({
        text: `  Estimated savings: ${estimatedSavings}`,
        color: colors.DIM,
      });
    }
    if (detail.externalResources.length > 0) {
      for (const line of wrapPlain(
        `Resources: ${detail.externalResources.join(" \u00b7 ")}`,
        maxWidth - RAW_INSIGHT_BODY_INDENT_COLS,
      )) {
        lines.push({ text: `  ${line}`, color: colors.DIM });
      }
    }
    lines.push({ text: "" });
  }
};

const formatToolInput = (input: unknown): string => {
  if (input === undefined) return "(no input)";
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      const pretty = JSON.stringify(parsed, undefined, RAW_JSON_INDENT_SPACES);
      if (pretty !== undefined) return truncateText(pretty, RAW_TOOL_INPUT_MAX_CHARS);
    } catch {
      return truncateText(input, RAW_TOOL_INPUT_MAX_CHARS);
    }
    return truncateText(input, RAW_TOOL_INPUT_MAX_CHARS);
  }
  try {
    const json = JSON.stringify(input, undefined, RAW_JSON_INDENT_SPACES);
    if (json === undefined) return "(no input)";
    return truncateText(json, RAW_TOOL_INPUT_MAX_CHARS);
  } catch {
    return truncateText(String(input), RAW_TOOL_INPUT_MAX_CHARS);
  }
};

const wrapPlain = (text: string, maxWidth: number): string[] => {
  const sourceLines = text.split("\n");
  if (!Number.isFinite(maxWidth) || maxWidth < 1) return sourceLines;
  const result: string[] = [];
  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      result.push("");
      continue;
    }
    let remaining = sourceLine;
    while (remaining.length > maxWidth) {
      result.push(remaining.slice(0, maxWidth));
      remaining = remaining.slice(maxWidth);
    }
    if (remaining.length > 0) result.push(remaining);
  }
  return result;
};
