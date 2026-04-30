export type CwvMetric = "LCP" | "FCP" | "CLS" | "INP" | "TTFB";

export type PerfMetricLabel = CwvMetric | "TotalTransferSize";

export const PERF_METRIC_LABELS: readonly PerfMetricLabel[] = [
  "LCP",
  "FCP",
  "CLS",
  "INP",
  "TTFB",
  "TotalTransferSize",
];

export type CwvClassification = "good" | "needs-improvement" | "poor";

export type CwvMetricKey = "lcpMs" | "fcpMs" | "clsScore" | "inpMs" | "ttfbMs";

export interface CwvThreshold {
  metric: CwvMetric;
  key: CwvMetricKey;
  goodMax: number;
  poorMin: number;
  unit: "ms" | "score";
}

const LCP_GOOD_MAX_MS = 2500;
const LCP_POOR_MIN_MS = 4000;
const FCP_GOOD_MAX_MS = 1800;
const FCP_POOR_MIN_MS = 3000;
const CLS_GOOD_MAX_SCORE = 0.1;
const CLS_POOR_MIN_SCORE = 0.25;
const INP_GOOD_MAX_MS = 200;
const INP_POOR_MIN_MS = 500;
const TTFB_GOOD_MAX_MS = 800;
const TTFB_POOR_MIN_MS = 1800;

const SECOND_THRESHOLD_MS = 1000;

export const CWV_THRESHOLDS: Record<CwvMetric, CwvThreshold> = {
  LCP: {
    metric: "LCP",
    key: "lcpMs",
    goodMax: LCP_GOOD_MAX_MS,
    poorMin: LCP_POOR_MIN_MS,
    unit: "ms",
  },
  FCP: {
    metric: "FCP",
    key: "fcpMs",
    goodMax: FCP_GOOD_MAX_MS,
    poorMin: FCP_POOR_MIN_MS,
    unit: "ms",
  },
  CLS: {
    metric: "CLS",
    key: "clsScore",
    goodMax: CLS_GOOD_MAX_SCORE,
    poorMin: CLS_POOR_MIN_SCORE,
    unit: "score",
  },
  INP: {
    metric: "INP",
    key: "inpMs",
    goodMax: INP_GOOD_MAX_MS,
    poorMin: INP_POOR_MIN_MS,
    unit: "ms",
  },
  TTFB: {
    metric: "TTFB",
    key: "ttfbMs",
    goodMax: TTFB_GOOD_MAX_MS,
    poorMin: TTFB_POOR_MIN_MS,
    unit: "ms",
  },
};

export const CWV_METRICS: readonly CwvMetric[] = ["LCP", "FCP", "CLS", "INP", "TTFB"];

export const classifyCwv = (metric: CwvMetric, value: number): CwvClassification => {
  const threshold = CWV_THRESHOLDS[metric];
  if (value <= threshold.goodMax) return "good";
  if (value >= threshold.poorMin) return "poor";
  return "needs-improvement";
};

export const formatCwvValue = (metric: CwvMetric, value: number): string => {
  const threshold = CWV_THRESHOLDS[metric];
  if (threshold.unit === "score") {
    return value.toFixed(2);
  }
  if (value >= SECOND_THRESHOLD_MS) {
    return `${(value / SECOND_THRESHOLD_MS).toFixed(1)} s`;
  }
  return `${Math.round(value)} ms`;
};

export const formatCwvTarget = (metric: CwvMetric): string => {
  const threshold = CWV_THRESHOLDS[metric];
  if (threshold.unit === "score") {
    return `< ${threshold.goodMax}`;
  }
  if (threshold.goodMax >= SECOND_THRESHOLD_MS) {
    return `< ${(threshold.goodMax / SECOND_THRESHOLD_MS).toFixed(1)} s`;
  }
  return `< ${threshold.goodMax} ms`;
};
