import { createMemo, createSignal, For, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { AskResult } from "@neuve/perf-agent-cli/data/ask-report-atom";
import { OverlayContainer } from "../../renderables/overlay-container";
import { SpinnerSpan } from "../../renderables/spinner";
import { Input } from "../../renderables/input";
import { COLORS } from "../../constants";

interface AskPanelProps {
  readonly history: readonly AskResult[];
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onSubmit: (question: string) => void;
  readonly onClose: () => void;
}

interface HistoryLine {
  readonly kind: "question" | "answer" | "blank";
  readonly text: string;
}

const OVERLAY_CHROME_ROWS = 8;
const MIN_VISIBLE_ROWS = 4;

const buildHistoryLines = (history: readonly AskResult[]): readonly HistoryLine[] => {
  const lines: HistoryLine[] = [];
  for (const entry of history) {
    lines.push({ kind: "question", text: `Q: ${entry.question}` });
    const answerLines = entry.answer.split(/\r?\n/);
    for (let index = 0; index < answerLines.length; index++) {
      const prefix = index === 0 ? "A: " : "   ";
      lines.push({ kind: "answer", text: `${prefix}${answerLines[index]}` });
    }
    lines.push({ kind: "blank", text: "" });
  }
  return lines;
};

export const AskPanel = (props: AskPanelProps) => {
  const dimensions = useTerminalDimensions();
  const [inputValue, setInputValue] = createSignal("");
  const [scrollOffset, setScrollOffset] = createSignal(0);

  const lines = createMemo<readonly HistoryLine[]>(() => buildHistoryLines(props.history));

  const visibleRows = () =>
    Math.max(MIN_VISIBLE_ROWS, Math.floor(dimensions().height * 0.7) - OVERLAY_CHROME_ROWS);

  const maxScrollOffset = () => Math.max(0, lines().length - visibleRows());

  const clampScroll = (offset: number): number => {
    const max = maxScrollOffset();
    if (offset < 0) return 0;
    if (offset > max) return max;
    return offset;
  };

  const scrollBy = (delta: number): void => {
    setScrollOffset((current) => clampScroll(current + delta));
  };

  const visibleSlice = () => {
    const offset = clampScroll(scrollOffset());
    return lines().slice(offset, offset + visibleRows());
  };

  const lineColor = (kind: HistoryLine["kind"]): string =>
    kind === "question" ? COLORS.PRIMARY : COLORS.TEXT;

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onClose();
      event.preventDefault();
      return;
    }
    if (event.name === "up" && lines().length > visibleRows()) {
      scrollBy(-1);
      return;
    }
    if (event.name === "down" && lines().length > visibleRows()) {
      scrollBy(1);
      return;
    }
    if (event.name === "pageup" && lines().length > visibleRows()) {
      scrollBy(-visibleRows());
      return;
    }
    if (event.name === "pagedown" && lines().length > visibleRows()) {
      scrollBy(visibleRows());
      return;
    }
  });

  const handleSubmit = (value: string): void => {
    if (props.pending) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setInputValue("");
    props.onSubmit(trimmed);
  };

  return (
    <OverlayContainer
      title="Ask follow-up"
      footerHint={"enter submit \u00b7 esc close"}
      size="large"
    >
      <box flexGrow={1} flexDirection="column">
        <Show when={lines().length === 0}>
          <text style={{ fg: COLORS.DIM }}>
            {"No questions yet. Type a follow-up below and press enter."}
          </text>
        </Show>
        <Show when={lines().length > 0}>
          <For each={visibleSlice()}>
            {(line) => (
              <box>
                <text style={{ fg: lineColor(line.kind) }}>{line.text}</text>
              </box>
            )}
          </For>
        </Show>
      </box>

      <Show when={props.error !== undefined}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.RED }}>{props.error}</text>
        </box>
      </Show>

      <box marginTop={1}>
        <Show when={props.pending}>
          <text>
            <SpinnerSpan />
            <span style={{ fg: COLORS.DIM }}>{" Thinking\u2026"}</span>
          </text>
        </Show>
        <Show when={!props.pending}>
          <box>
            <text style={{ fg: COLORS.PRIMARY }}>{"> "}</text>
            <Input
              focus
              value={inputValue()}
              placeholder="Ask a follow-up about this report"
              onChange={setInputValue}
              onSubmit={handleSubmit}
            />
          </box>
        </Show>
      </box>
    </OverlayContainer>
  );
};
