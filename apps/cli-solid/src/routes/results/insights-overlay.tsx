import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
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

const MISSING_ANALYSIS_NOTICE =
  "No detailed analysis captured. Re-run with `trace analyze` to get the full breakdown.";

const getInsightLabel = (detail: InsightDetail): string =>
  detail.title.length > 0 ? detail.title : detail.insightName;

type DisplayList =
  | { readonly kind: "details"; readonly items: readonly InsightDetail[] }
  | { readonly kind: "references"; readonly items: readonly string[] }
  | { readonly kind: "empty" };

export const InsightsOverlay = (props: InsightsOverlayProps) => {
  const dimensions = useTerminalDimensions();

  const displayList = createMemo<DisplayList>(() => {
    if (props.report.insightDetails.length > 0) {
      return { kind: "details", items: props.report.insightDetails };
    }
    if (props.report.uniqueInsightNames.length > 0) {
      return { kind: "references", items: props.report.uniqueInsightNames };
    }
    return { kind: "empty" };
  });

  const itemCount = () => {
    const list = displayList();
    if (list.kind === "empty") return 0;
    return list.items.length;
  };

  const detailItems = (): readonly InsightDetail[] | undefined => {
    const list = displayList();
    return list.kind === "details" ? list.items : undefined;
  };

  const referenceItems = (): readonly string[] | undefined => {
    const list = displayList();
    return list.kind === "references" ? list.items : undefined;
  };

  const isEmpty = () => displayList().kind === "empty";

  const [mode, setMode] = createSignal<"list" | "detail">("list");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [analysisScroll, setAnalysisScroll] = createSignal(0);

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

  const analysisLines = createMemo<readonly string[]>(() => {
    const detail = selectedDetail();
    if (!detail) return [];
    return detail.analysis.split("\n");
  });

  const maxAnalysisScroll = () =>
    Math.max(0, analysisLines().length - visibleRows());

  const clampAnalysisScroll = (value: number): number => {
    const limit = maxAnalysisScroll();
    if (value < 0) return 0;
    if (value > limit) return limit;
    return value;
  };

  const scrollAnalysis = (delta: number): void => {
    setAnalysisScroll((previous) => clampAnalysisScroll(previous + delta));
  };

  const openDetail = (): void => {
    if (itemCount() === 0) return;
    setAnalysisScroll(0);
    setMode("detail");
  };

  const returnToList = (): void => {
    setMode("list");
    setAnalysisScroll(0);
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
      scrollAnalysis(1);
      return;
    }
    if (event.name === "up" || event.name === "k") {
      scrollAnalysis(-1);
      return;
    }
    if (event.name === "pagedown") {
      scrollAnalysis(visibleRows());
      return;
    }
    if (event.name === "pageup") {
      scrollAnalysis(-visibleRows());
      return;
    }
  });

  const visibleAnalysisSlice = () => {
    const offset = analysisScroll();
    return analysisLines().slice(offset, offset + visibleRows());
  };

  const listFooter = () => "\u2191\u2193 navigate \u00b7 enter open \u00b7 esc dismiss";
  const detailFooter = () => "\u2191\u2193 scroll \u00b7 esc back";

  const renderRow = (label: string, index: number) => {
    const isSelected = () => index === selectedIndex();
    const numberLabel = `${index + 1}.`.padEnd(4, " ");
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

  return (
    <OverlayContainer
      title="Insights"
      footerHint={mode() === "list" ? listFooter() : detailFooter()}
      size="xlarge"
    >
      <Show when={isEmpty()}>
        <text style={{ fg: COLORS.DIM }}>No insights available.</text>
      </Show>
      <Show when={!isEmpty()}>
        <Switch>
          <Match when={mode() === "list"}>
            <Show when={detailItems()}>
              {(items) => (
                <For each={items()}>
                  {(detail, index) => renderRow(getInsightLabel(detail), index())}
                </For>
              )}
            </Show>
            <Show when={referenceItems()}>
              {(items) => (
                <For each={items()}>
                  {(name, index) => renderRow(name, index())}
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
                    <box marginTop={1} flexDirection="column">
                      <For each={visibleAnalysisSlice()}>
                        {(line) => (
                          <box>
                            <text style={{ fg: COLORS.TEXT }}>{line.length > 0 ? line : " "}</text>
                          </box>
                        )}
                      </For>
                      <Show when={analysisLines().length > visibleRows()}>
                        <box marginTop={1}>
                          <text style={{ fg: COLORS.DIM }}>
                            {`line ${analysisScroll() + 1} / ${analysisLines().length}`}
                          </text>
                        </box>
                      </Show>
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
