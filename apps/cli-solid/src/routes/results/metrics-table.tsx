import { For, Show } from "solid-js";
import { Option } from "effect";
import type { PerfMetricSnapshot } from "@neuve/shared/models";
import {
  classifyCwv,
  formatCwvTarget,
  formatCwvValue,
  type CwvClassification,
  type CwvMetric,
} from "@neuve/shared/cwv-thresholds";
import { COLORS } from "../../constants";

const CWV_METRIC_ORDER: readonly CwvMetric[] = ["LCP", "FCP", "CLS", "INP", "TTFB"];

const METRIC_COLUMN_WIDTH = 7;
const VALUE_COLUMN_WIDTH = 9;
const TARGET_COLUMN_WIDTH = 9;
const STATUS_COLUMN_WIDTH = 18;

const TICK = "\u2714";
const WARNING = "\u26A0";
const CROSS = "\u2718";

interface CwvRow {
  readonly metric: CwvMetric;
  readonly value: number;
  readonly classification: CwvClassification;
}

const padCell = (text: string, width: number): string => {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
};

const getMetricValue = (snapshot: PerfMetricSnapshot, metric: CwvMetric): number | undefined => {
  if (metric === "LCP") return Option.getOrUndefined(snapshot.lcpMs);
  if (metric === "FCP") return Option.getOrUndefined(snapshot.fcpMs);
  if (metric === "CLS") return Option.getOrUndefined(snapshot.clsScore);
  if (metric === "INP") return Option.getOrUndefined(snapshot.inpMs);
  return Option.getOrUndefined(snapshot.ttfbMs);
};

const collectCwvRows = (snapshot: PerfMetricSnapshot): CwvRow[] => {
  const rows: CwvRow[] = [];
  for (const metric of CWV_METRIC_ORDER) {
    const value = getMetricValue(snapshot, metric);
    if (value === undefined) continue;
    rows.push({ metric, value, classification: classifyCwv(metric, value) });
  }
  return rows;
};

const colorForClassification = (classification: CwvClassification): string => {
  if (classification === "good") return COLORS.GREEN;
  if (classification === "needs-improvement") return COLORS.YELLOW;
  return COLORS.RED;
};

const iconForClassification = (classification: CwvClassification): string => {
  if (classification === "good") return TICK;
  if (classification === "needs-improvement") return WARNING;
  return CROSS;
};

interface MetricsTableProps {
  readonly metrics: readonly PerfMetricSnapshot[];
}

export const MetricsTable = (props: MetricsTableProps) => {
  const renderableSnapshots = () =>
    props.metrics
      .map((snapshot) => ({ snapshot, rows: collectCwvRows(snapshot) }))
      .filter((entry) => entry.rows.length > 0);

  return (
    <Show when={renderableSnapshots().length > 0}>
      <box flexDirection="column" marginTop={1}>
        <For each={renderableSnapshots()}>
          {(entry) => <SnapshotTable snapshot={entry.snapshot} rows={entry.rows} />}
        </For>
      </box>
    </Show>
  );
};

interface SnapshotTableProps {
  readonly snapshot: PerfMetricSnapshot;
  readonly rows: readonly CwvRow[];
}

const SnapshotTable = (props: SnapshotTableProps) => {
  const headerLine = () =>
    `${padCell("Metric", METRIC_COLUMN_WIDTH)} \u2502 ${padCell("Value", VALUE_COLUMN_WIDTH)} \u2502 ${padCell("Target", TARGET_COLUMN_WIDTH)} \u2502 ${padCell("Status", STATUS_COLUMN_WIDTH)}`;
  const dividerLine = () =>
    `${"\u2500".repeat(METRIC_COLUMN_WIDTH + 1)}\u253c${"\u2500".repeat(VALUE_COLUMN_WIDTH + 2)}\u253c${"\u2500".repeat(TARGET_COLUMN_WIDTH + 2)}\u253c${"\u2500".repeat(STATUS_COLUMN_WIDTH + 1)}`;

  return (
    <box flexDirection="column" marginBottom={1}>
      <text><span style={{ fg: COLORS.PRIMARY, bold: true }}>{props.snapshot.url}</span></text>
      <text style={{ fg: COLORS.DIM }}>{headerLine()}</text>
      <text style={{ fg: COLORS.DIM }}>{dividerLine()}</text>
      <For each={props.rows}>{(row) => <MetricRow row={row} />}</For>
    </box>
  );
};

interface MetricRowProps {
  readonly row: CwvRow;
}

const MetricRow = (props: MetricRowProps) => {
  const statusColor = () => colorForClassification(props.row.classification);
  const statusIcon = () => iconForClassification(props.row.classification);
  const statusLabel = () => `${statusIcon()} ${props.row.classification}`;

  const metricCell = () => padCell(props.row.metric, METRIC_COLUMN_WIDTH);
  const valueCell = () => padCell(formatCwvValue(props.row.metric, props.row.value), VALUE_COLUMN_WIDTH);
  const targetCell = () => padCell(formatCwvTarget(props.row.metric), TARGET_COLUMN_WIDTH);
  const statusCell = () => padCell(statusLabel(), STATUS_COLUMN_WIDTH);

  return (
    <text>
      <span style={{ fg: COLORS.TEXT }}>{metricCell()}</span>
      <span style={{ fg: COLORS.DIM }}>{" \u2502 "}</span>
      <span style={{ fg: statusColor() }}>{valueCell()}</span>
      <span style={{ fg: COLORS.DIM }}>{" \u2502 "}</span>
      <span style={{ fg: COLORS.DIM }}>{targetCell()}</span>
      <span style={{ fg: COLORS.DIM }}>{" \u2502 "}</span>
      <span style={{ fg: statusColor() }}>{statusCell()}</span>
    </text>
  );
};
