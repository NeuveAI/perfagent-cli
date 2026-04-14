export interface ParsedTraceInsight {
  insightSetId: string;
  insightName: string;
}

export interface ParsedTraceMetrics {
  url?: string;
  insightSetId: string;
  lcpMs?: number;
  fcpMs?: number;
  clsScore?: number;
  inpMs?: number;
  ttfbMs?: number;
  totalTransferSizeKb?: number;
  insights: ParsedTraceInsight[];
}

const TRACE_STOPPED_SENTINEL = "The performance trace has been stopped.";
const DETAILS_BOILERPLATE_HEADING = "## Details on call tree & network request formats:";
const INSIGHT_SET_HEADING_PREFIX = "## insight set id:";
const TOP_LEVEL_URL_PREFIX = "URL:";
const INSIGHT_NAME_PREFIX = "- insight name:";
const LCP_METRIC_PREFIX = "- LCP:";
const CLS_METRIC_PREFIX = "- CLS:";
const INP_METRIC_PREFIX = "- INP:";
const TTFB_BREAKDOWN_PREFIX = "- TTFB:";

const trimNumberWithMsSuffix = (value: string): number | undefined => {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*ms/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[1]);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
};

const parseClsValue = (value: string): number | undefined => {
  const match = value.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[1]);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
};

interface InsightSetBlock {
  insightSetId: string;
  bodyLines: string[];
}

const splitIntoInsightSetBlocks = (lines: string[]): InsightSetBlock[] => {
  const blocks: InsightSetBlock[] = [];
  let current: InsightSetBlock | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(INSIGHT_SET_HEADING_PREFIX)) {
      const insightSetId = trimmed.slice(INSIGHT_SET_HEADING_PREFIX.length).trim();
      current = { insightSetId, bodyLines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  return blocks;
};

const extractTopLevelUrl = (lines: string[]): string | undefined => {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(TOP_LEVEL_URL_PREFIX)) {
      return trimmed.slice(TOP_LEVEL_URL_PREFIX.length).trim();
    }
    if (trimmed.startsWith(INSIGHT_SET_HEADING_PREFIX)) return undefined;
  }
  return undefined;
};

const parseInsightSetBlock = (
  block: InsightSetBlock,
  topLevelUrl: string | undefined,
): ParsedTraceMetrics => {
  const metrics: ParsedTraceMetrics = {
    insightSetId: block.insightSetId,
    insights: [],
  };

  let blockUrl: string | undefined;

  for (const rawLine of block.bodyLines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith(TOP_LEVEL_URL_PREFIX) && blockUrl === undefined) {
      blockUrl = trimmed.slice(TOP_LEVEL_URL_PREFIX.length).trim();
      continue;
    }

    if (trimmed.startsWith(LCP_METRIC_PREFIX)) {
      metrics.lcpMs = trimNumberWithMsSuffix(trimmed.slice(LCP_METRIC_PREFIX.length));
      continue;
    }

    if (trimmed.startsWith(CLS_METRIC_PREFIX)) {
      metrics.clsScore = parseClsValue(trimmed.slice(CLS_METRIC_PREFIX.length));
      continue;
    }

    if (trimmed.startsWith(INP_METRIC_PREFIX)) {
      metrics.inpMs = trimNumberWithMsSuffix(trimmed.slice(INP_METRIC_PREFIX.length));
      continue;
    }

    if (trimmed.startsWith(TTFB_BREAKDOWN_PREFIX)) {
      metrics.ttfbMs = trimNumberWithMsSuffix(trimmed.slice(TTFB_BREAKDOWN_PREFIX.length));
      continue;
    }

    if (trimmed.startsWith(INSIGHT_NAME_PREFIX)) {
      const insightName = trimmed.slice(INSIGHT_NAME_PREFIX.length).trim();
      if (insightName.length > 0) {
        metrics.insights.push({ insightSetId: block.insightSetId, insightName });
      }
      continue;
    }
  }

  metrics.url = blockUrl ?? topLevelUrl;

  return metrics;
};

export const parseTraceOutput = (toolResultText: string): ParsedTraceMetrics[] => {
  if (!toolResultText || !toolResultText.includes(TRACE_STOPPED_SENTINEL)) return [];

  const boilerplateIndex = toolResultText.indexOf(DETAILS_BOILERPLATE_HEADING);
  const relevantText =
    boilerplateIndex >= 0 ? toolResultText.slice(0, boilerplateIndex) : toolResultText;

  const lines = relevantText.split(/\r?\n/);
  const topLevelUrl = extractTopLevelUrl(lines);
  const blocks = splitIntoInsightSetBlocks(lines);
  if (blocks.length === 0) return [];

  return blocks.map((block) => parseInsightSetBlock(block, topLevelUrl));
};
