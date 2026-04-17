import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { RGBA, ScrollBoxRenderable, SyntaxStyle } from "@opentui/core";
import { Option } from "effect";
import type { InsightDetail, PerfReport } from "@neuve/shared/models";
import { OverlayContainer } from "../../renderables/overlay-container";
import { COLORS } from "../../constants";

interface InsightsOverlayProps {
  readonly report: PerfReport;
  readonly onClose: () => void;
}

const OVERLAY_CHROME_ROWS = 10;
const MIN_VISIBLE_ROWS = 4;
const SEMICOLON_CODE_FENCE_THRESHOLD = 5;
const UNKNOWN_URL_HEADER = "(unknown URL)";

const MISSING_ANALYSIS_NOTICE =
  "No detailed analysis captured. Re-run with `trace analyze` to get the full breakdown.";

const getInsightLabel = (detail: InsightDetail): string =>
  detail.title.length > 0 ? detail.title : detail.insightName;

let markdownSyntaxStyle: SyntaxStyle | undefined;
const getMarkdownSyntaxStyle = (): SyntaxStyle => {
  if (!markdownSyntaxStyle) {
    markdownSyntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: RGBA.fromHex(COLORS.TEXT) },
    });
  }
  return markdownSyntaxStyle;
};

const countSemicolons = (line: string): number => {
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line.charCodeAt(index) === 59) count += 1;
  }
  return count;
};

const wrapSemicolonRunsInCodeFence = (analysis: string): string => {
  const lines = analysis.split("\n");
  const output: string[] = [];
  let runStart = -1;
  const flushRun = (endExclusive: number) => {
    if (runStart === -1) return;
    output.push("```");
    for (let index = runStart; index < endExclusive; index += 1) {
      output.push(lines[index] ?? "");
    }
    output.push("```");
    runStart = -1;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const isDataLine = countSemicolons(line) >= SEMICOLON_CODE_FENCE_THRESHOLD;
    if (isDataLine) {
      if (runStart === -1) runStart = index;
      continue;
    }
    flushRun(index);
    output.push(line);
  }
  flushRun(lines.length);
  return output.join("\n");
};

interface GroupedDetailItem {
  readonly kind: "detail";
  readonly detail: InsightDetail;
  readonly itemIndex: number;
}

interface GroupedReferenceItem {
  readonly kind: "reference";
  readonly name: string;
  readonly itemIndex: number;
}

interface GroupedHeaderRow {
  readonly kind: "header";
  readonly url: string;
}

type GroupedRow = GroupedHeaderRow | GroupedDetailItem | GroupedReferenceItem;

type DisplayList =
  | {
      readonly kind: "details";
      readonly rows: readonly GroupedRow[];
      readonly items: readonly InsightDetail[];
    }
  | {
      readonly kind: "references";
      readonly rows: readonly GroupedRow[];
      readonly items: readonly string[];
    }
  | { readonly kind: "empty" };

const UNGROUPED_KEY = "__ungrouped__";

const buildUrlByInsightSetId = (report: PerfReport): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const snapshot of report.metrics) {
    for (const insight of snapshot.traceInsights) {
      if (!map.has(insight.insightSetId)) {
        map.set(insight.insightSetId, snapshot.url);
      }
    }
  }
  return map;
};

const buildDetailRows = (
  details: readonly InsightDetail[],
  urlByInsightSetId: ReadonlyMap<string, string>,
): readonly GroupedRow[] => {
  const groups = new Map<string, InsightDetail[]>();
  const order: string[] = [];

  for (const detail of details) {
    const insightSetId = Option.getOrUndefined(detail.insightSetId);
    const url = insightSetId ? urlByInsightSetId.get(insightSetId) : undefined;
    const key = url ?? UNGROUPED_KEY;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(detail);
  }

  const hasAnyGroup = order.some((key) => key !== UNGROUPED_KEY);
  const rows: GroupedRow[] = [];
  let itemIndex = 0;
  for (const key of order) {
    const bucket = groups.get(key);
    if (!bucket) continue;
    if (hasAnyGroup) {
      const headerUrl = key === UNGROUPED_KEY ? UNKNOWN_URL_HEADER : key;
      rows.push({ kind: "header", url: headerUrl });
    }
    for (const detail of bucket) {
      rows.push({ kind: "detail", detail, itemIndex });
      itemIndex += 1;
    }
  }
  return rows;
};

const buildReferenceRows = (report: PerfReport): readonly GroupedRow[] => {
  const groups: Array<{ url: string; names: string[] }> = [];
  const seenAcrossAll = new Set<string>();
  for (const snapshot of report.metrics) {
    const names: string[] = [];
    for (const insight of snapshot.traceInsights) {
      if (seenAcrossAll.has(insight.insightName)) continue;
      seenAcrossAll.add(insight.insightName);
      names.push(insight.insightName);
    }
    if (names.length > 0) {
      groups.push({ url: snapshot.url, names });
    }
  }

  const rows: GroupedRow[] = [];
  const hasMultipleGroups = groups.length > 1;
  let itemIndex = 0;
  for (const group of groups) {
    if (hasMultipleGroups) {
      rows.push({ kind: "header", url: group.url });
    }
    for (const name of group.names) {
      rows.push({ kind: "reference", name, itemIndex });
      itemIndex += 1;
    }
  }
  return rows;
};

export const InsightsOverlay = (props: InsightsOverlayProps) => {
  const dimensions = useTerminalDimensions();
  let analysisScrollBox: ScrollBoxRenderable | undefined;

  const displayList = createMemo<DisplayList>(() => {
    const urlByInsightSetId = buildUrlByInsightSetId(props.report);
    if (props.report.insightDetails.length > 0) {
      const rows = buildDetailRows(props.report.insightDetails, urlByInsightSetId);
      const items = rows.flatMap((row) => (row.kind === "detail" ? [row.detail] : []));
      return { kind: "details", rows, items };
    }
    if (props.report.uniqueInsightNames.length > 0) {
      const rows = buildReferenceRows(props.report);
      if (rows.length === 0) return { kind: "empty" };
      const items = rows.flatMap((row) => (row.kind === "reference" ? [row.name] : []));
      return { kind: "references", rows, items };
    }
    return { kind: "empty" };
  });

  const itemCount = () => {
    const list = displayList();
    if (list.kind === "empty") return 0;
    return list.items.length;
  };

  const detailRows = (): readonly GroupedRow[] | undefined => {
    const list = displayList();
    return list.kind === "details" ? list.rows : undefined;
  };

  const referenceRows = (): readonly GroupedRow[] | undefined => {
    const list = displayList();
    return list.kind === "references" ? list.rows : undefined;
  };

  const isEmpty = () => displayList().kind === "empty";

  const [mode, setMode] = createSignal<"list" | "detail">("list");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const visibleRows = () =>
    Math.max(
      MIN_VISIBLE_ROWS,
      Math.floor(dimensions().height * 0.7) - OVERLAY_CHROME_ROWS,
    );

  const clampSelection = (index: number): number => {
    const total = itemCount();
    if (total === 0) return 0;
    if (index < 0) return 0;
    if (index >= total) return total - 1;
    return index;
  };

  const moveSelection = (delta: number): void => {
    setSelectedIndex((previous) => clampSelection(previous + delta));
  };

  const selectedDetail = () => {
    const list = displayList();
    if (list.kind !== "details") return undefined;
    return list.items[selectedIndex()];
  };

  const selectedReferenceName = () => {
    const list = displayList();
    if (list.kind !== "references") return undefined;
    return list.items[selectedIndex()];
  };

  const analysisContent = createMemo<string>(() => {
    const detail = selectedDetail();
    if (!detail) return "";
    return wrapSemicolonRunsInCodeFence(detail.analysis);
  });

  const scrollAnalysisBy = (delta: number): void => {
    if (!analysisScrollBox) return;
    analysisScrollBox.scrollBy(delta, "step");
  };

  const scrollAnalysisViewport = (delta: number): void => {
    if (!analysisScrollBox) return;
    analysisScrollBox.scrollBy(delta, "viewport");
  };

  const resetAnalysisScroll = (): void => {
    if (!analysisScrollBox) return;
    analysisScrollBox.scrollTop = 0;
  };

  const openDetail = (): void => {
    if (itemCount() === 0) return;
    setMode("detail");
    queueMicrotask(() => resetAnalysisScroll());
  };

  const returnToList = (): void => {
    setMode("list");
  };

  useKeyboard((event) => {
    if (mode() === "list") {
      if (event.name === "escape") {
        props.onClose();
        event.preventDefault();
        return;
      }
      if (event.name === "down" || event.name === "j") {
        moveSelection(1);
        return;
      }
      if (event.name === "up" || event.name === "k") {
        moveSelection(-1);
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        openDetail();
        return;
      }
      return;
    }
    if (event.name === "escape") {
      returnToList();
      event.preventDefault();
      return;
    }
    if (event.name === "down" || event.name === "j") {
      scrollAnalysisBy(1);
      return;
    }
    if (event.name === "up" || event.name === "k") {
      scrollAnalysisBy(-1);
      return;
    }
    if (event.name === "pagedown") {
      scrollAnalysisViewport(1);
      return;
    }
    if (event.name === "pageup") {
      scrollAnalysisViewport(-1);
      return;
    }
  });

  const listFooter = () => "\u2191\u2193 navigate \u00b7 enter open \u00b7 esc dismiss";
  const detailFooter = () => "\u2191\u2193 scroll \u00b7 esc back";
  const emptyFooter = () => "esc dismiss";

  const footerHint = () => {
    if (isEmpty()) return emptyFooter();
    return mode() === "list" ? listFooter() : detailFooter();
  };

  const renderItemRow = (label: string, itemIndex: number) => {
    const isSelected = () => itemIndex === selectedIndex();
    const numberLabel = `${itemIndex + 1}.`.padEnd(4, " ");
    return (
      <box>
        <text>
          <span style={{ fg: isSelected() ? COLORS.PRIMARY : COLORS.DIM }}>
            {isSelected() ? "\u25B8 " : "  "}
          </span>
          <span style={{ fg: COLORS.DIM }}>{numberLabel}</span>
          <span style={{ fg: isSelected() ? COLORS.TEXT : COLORS.DIM }}>{label}</span>
        </text>
      </box>
    );
  };

  const renderHeaderRow = (url: string) => (
    <box marginTop={1}>
      <text>
        <span style={{ fg: COLORS.PRIMARY, bold: true }}>{url}</span>
      </text>
    </box>
  );

  return (
    <OverlayContainer title="Insights" footerHint={footerHint()} size="xlarge">
      <Show when={isEmpty()}>
        <text style={{ fg: COLORS.DIM }}>No insights available.</text>
      </Show>
      <Show when={!isEmpty()}>
        <Switch>
          <Match when={mode() === "list"}>
            <Show when={detailRows()}>
              {(rows) => (
                <For each={rows()}>
                  {(row) => (
                    <Switch>
                      <Match when={row.kind === "header" ? row : undefined}>
                        {(header) => renderHeaderRow(header().url)}
                      </Match>
                      <Match when={row.kind === "detail" ? row : undefined}>
                        {(detailRow) =>
                          renderItemRow(getInsightLabel(detailRow().detail), detailRow().itemIndex)
                        }
                      </Match>
                    </Switch>
                  )}
                </For>
              )}
            </Show>
            <Show when={referenceRows()}>
              {(rows) => (
                <For each={rows()}>
                  {(row) => (
                    <Switch>
                      <Match when={row.kind === "header" ? row : undefined}>
                        {(header) => renderHeaderRow(header().url)}
                      </Match>
                      <Match when={row.kind === "reference" ? row : undefined}>
                        {(referenceRow) =>
                          renderItemRow(referenceRow().name, referenceRow().itemIndex)
                        }
                      </Match>
                    </Switch>
                  )}
                </For>
              )}
            </Show>
          </Match>
          <Match when={mode() === "detail"}>
            <Show when={selectedDetail()}>
              {(detail) => {
                const savings = () => Option.getOrUndefined(detail().estimatedSavings);
                const resources = () => detail().externalResources;
                return (
                  <box flexDirection="column">
                    <box>
                      <text>
                        <span style={{ fg: COLORS.SELECTION, bold: true }}>
                          {getInsightLabel(detail())}
                        </span>
                      </text>
                    </box>
                    <Show when={detail().summary.length > 0}>
                      <box marginTop={1}>
                        <text style={{ fg: COLORS.DIM }}>{detail().summary}</text>
                      </box>
                    </Show>
                    <box marginTop={1} flexDirection="column" height={visibleRows()}>
                      <scrollbox
                        ref={(renderable: ScrollBoxRenderable) => {
                          analysisScrollBox = renderable;
                        }}
                        style={{ width: "100%", height: "100%", flexGrow: 1 }}
                      >
                        <markdown
                          content={analysisContent()}
                          syntaxStyle={getMarkdownSyntaxStyle()}
                          fg={COLORS.TEXT}
                        />
                      </scrollbox>
                    </box>
                    <Show when={savings()}>
                      {(value) => (
                        <box marginTop={1}>
                          <text>
                            <span style={{ fg: COLORS.DIM }}>{"savings: "}</span>
                            <span style={{ fg: COLORS.TEXT }}>{value()}</span>
                          </text>
                        </box>
                      )}
                    </Show>
                    <Show when={resources().length > 0}>
                      <box marginTop={1} flexDirection="column">
                        <text style={{ fg: COLORS.DIM }}>{"resources:"}</text>
                        <For each={resources()}>
                          {(resource) => (
                            <box>
                              <text style={{ fg: COLORS.DIM }}>{`  \u2022 ${resource}`}</text>
                            </box>
                          )}
                        </For>
                      </box>
                    </Show>
                  </box>
                );
              }}
            </Show>
            <Show when={selectedReferenceName()}>
              {(name) => (
                <box flexDirection="column">
                  <box>
                    <text>
                      <span style={{ fg: COLORS.SELECTION, bold: true }}>{name()}</span>
                    </text>
                  </box>
                  <box marginTop={1}>
                    <text style={{ fg: COLORS.DIM }}>{MISSING_ANALYSIS_NOTICE}</text>
                  </box>
                </box>
              )}
            </Show>
          </Match>
        </Switch>
      </Show>
    </OverlayContainer>
  );
};
