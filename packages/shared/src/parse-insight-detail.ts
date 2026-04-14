export interface ParsedInsightDetail {
  insightName: string;
  title: string;
  summary: string;
  analysis: string;
  estimatedSavings?: string;
  externalResources: string[];
}

const TITLE_HEADING = "## Insight Title:";
const SUMMARY_HEADING = "## Insight Summary:";
const ANALYSIS_HEADING = "## Detailed analysis:";
const SAVINGS_HEADING = "## Estimated savings:";
const RESOURCES_HEADING = "## External resources:";

const KNOWN_INSIGHT_NAMES = [
  "Cache",
  "CharacterSet",
  "CLSCulprits",
  "DocumentLatency",
  "DOMSize",
  "DuplicatedJavaScript",
  "FontDisplay",
  "ForcedReflow",
  "ImageDelivery",
  "INPBreakdown",
  "LCPBreakdown",
  "LCPDiscovery",
  "LegacyJavaScript",
  "ModernHTTP",
  "NetworkDependencyTree",
  "RenderBlocking",
  "SlowCSSSelector",
  "ThirdParties",
  "Viewport",
] as const;

const TITLE_TO_INSIGHT_NAME: Record<string, string> = {
  "lcp breakdown": "LCPBreakdown",
  "lcp discovery": "LCPDiscovery",
  "document request latency": "DocumentLatency",
  "render-blocking requests": "RenderBlocking",
  "layout shift culprits": "CLSCulprits",
  "network dependency tree": "NetworkDependencyTree",
  "inp breakdown": "INPBreakdown",
  "font display": "FontDisplay",
  "forced reflow": "ForcedReflow",
  "image delivery": "ImageDelivery",
  "legacy javascript": "LegacyJavaScript",
  "duplicated javascript": "DuplicatedJavaScript",
  "modern http": "ModernHTTP",
  "third parties": "ThirdParties",
  cache: "Cache",
  "character set": "CharacterSet",
  "dom size": "DOMSize",
  "slow css selector": "SlowCSSSelector",
  viewport: "Viewport",
};

const deriveInsightName = (title: string): string => {
  const normalized = title.toLowerCase().trim();
  const mapped = TITLE_TO_INSIGHT_NAME[normalized];
  if (mapped) return mapped;
  const collapsed = title.replace(/\s+/g, "");
  const match = KNOWN_INSIGHT_NAMES.find(
    (name) => name.toLowerCase() === collapsed.toLowerCase(),
  );
  if (match) return match;
  return collapsed;
};

interface SectionSpans {
  titleStart: number;
  summaryStart?: number;
  analysisStart?: number;
  savingsStart?: number;
  resourcesStart?: number;
}

const findSectionStarts = (lines: string[]): SectionSpans | undefined => {
  const spans: SectionSpans = { titleStart: -1 };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith(TITLE_HEADING) && spans.titleStart === -1) {
      spans.titleStart = index;
      continue;
    }
    if (line.startsWith(SUMMARY_HEADING) && spans.summaryStart === undefined) {
      spans.summaryStart = index;
      continue;
    }
    if (line.startsWith(ANALYSIS_HEADING) && spans.analysisStart === undefined) {
      spans.analysisStart = index;
      continue;
    }
    if (line.startsWith(SAVINGS_HEADING) && spans.savingsStart === undefined) {
      spans.savingsStart = index;
      continue;
    }
    if (line.startsWith(RESOURCES_HEADING) && spans.resourcesStart === undefined) {
      spans.resourcesStart = index;
      continue;
    }
  }
  if (spans.titleStart === -1) return undefined;
  return spans;
};

const sliceSectionBody = (
  lines: string[],
  start: number | undefined,
  end: number | undefined,
  headingPrefix: string,
): string => {
  if (start === undefined) return "";
  const firstLine = lines[start];
  const inline = firstLine.slice(headingPrefix.length).trim();
  const endIndex = end ?? lines.length;
  const rest = lines.slice(start + 1, endIndex).join("\n");
  if (inline.length === 0) return rest.trim();
  if (rest.length === 0) return inline;
  return `${inline}\n${rest}`.trim();
};

const extractExternalResources = (body: string): string[] => {
  if (body.length === 0) return [];
  const urls: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^[-*]\s+(https?:\/\/\S+)/);
    if (match) urls.push(match[1]);
  }
  return urls;
};

export const parseInsightDetail = (
  toolResultText: string,
): ParsedInsightDetail | undefined => {
  if (!toolResultText) return undefined;
  const trimmedStart = toolResultText.replace(/^\s+/, "");
  if (!trimmedStart.startsWith(TITLE_HEADING)) return undefined;

  const lines = toolResultText.split(/\r?\n/);
  const spans = findSectionStarts(lines);
  if (!spans) return undefined;

  const titleEnd =
    spans.summaryStart ??
    spans.analysisStart ??
    spans.savingsStart ??
    spans.resourcesStart ??
    lines.length;
  const summaryEnd =
    spans.analysisStart ?? spans.savingsStart ?? spans.resourcesStart ?? lines.length;
  const analysisEnd = spans.savingsStart ?? spans.resourcesStart ?? lines.length;
  const savingsEnd = spans.resourcesStart ?? lines.length;
  const resourcesEnd = lines.length;

  const title = sliceSectionBody(lines, spans.titleStart, titleEnd, TITLE_HEADING);
  const summary = sliceSectionBody(lines, spans.summaryStart, summaryEnd, SUMMARY_HEADING);
  const analysis = sliceSectionBody(
    lines,
    spans.analysisStart,
    analysisEnd,
    ANALYSIS_HEADING,
  );
  const savingsRaw = sliceSectionBody(
    lines,
    spans.savingsStart,
    savingsEnd,
    SAVINGS_HEADING,
  );
  const resourcesBody = sliceSectionBody(
    lines,
    spans.resourcesStart,
    resourcesEnd,
    RESOURCES_HEADING,
  );

  const estimatedSavings =
    savingsRaw.length === 0 || savingsRaw.toLowerCase() === "none" ? undefined : savingsRaw;
  const externalResources = extractExternalResources(resourcesBody);
  const insightName = deriveInsightName(title);

  return {
    insightName,
    title,
    summary,
    analysis,
    estimatedSavings,
    externalResources,
  };
};
