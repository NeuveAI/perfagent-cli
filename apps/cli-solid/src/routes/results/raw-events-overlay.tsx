import { createSignal, createMemo, For, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { Match } from "effect";
import type { ExecutedPerfPlan, ExecutionEvent } from "@neuve/shared/models";
import { OverlayContainer } from "../../renderables/overlay-container";
import { formatToolCall } from "../../utils/format-tool-call";
import { truncateSingleLine } from "../testing/testing-helpers";
import { COLORS, TESTING_ARG_PREVIEW_MAX_CHARS } from "../../constants";

interface RawEventsOverlayProps {
  readonly executedPlan: ExecutedPerfPlan;
  readonly onClose: () => void;
}

interface EventRow {
  readonly tag: string;
  readonly label: string;
  readonly detail: string;
  readonly color: string;
}

const AGENT_TEXT_PREVIEW_MAX_CHARS = 80;
const OVERLAY_CHROME_ROWS = 6;
const MIN_VISIBLE_ROWS = 4;

const ARROW_LEFT = "\u2190";

const formatBytes = (length: number): string => {
  if (length >= 1024) return `${(length / 1024).toFixed(1)}kb`;
  return `${length}b`;
};

const formatEvent = (event: ExecutionEvent, stepNumberByStepId: Map<string, number>): EventRow =>
  Match.value(event).pipe(
    Match.tag("RunStarted", () => ({
      tag: "run",
      label: "start",
      detail: "run started",
      color: COLORS.DIM,
    })),
    Match.tag("StepStarted", (started) => {
      const stepNumber = stepNumberByStepId.get(started.stepId) ?? 0;
      return {
        tag: "step",
        label: `step ${stepNumber}`,
        detail: started.title,
        color: COLORS.PRIMARY,
      };
    }),
    Match.tag("StepCompleted", (completed) => {
      const stepNumber = stepNumberByStepId.get(completed.stepId) ?? 0;
      return {
        tag: "step",
        label: `step ${stepNumber} done`,
        detail: truncateSingleLine(completed.summary, TESTING_ARG_PREVIEW_MAX_CHARS),
        color: COLORS.GREEN,
      };
    }),
    Match.tag("StepFailed", (failed) => {
      const stepNumber = stepNumberByStepId.get(failed.stepId) ?? 0;
      return {
        tag: "step",
        label: `step ${stepNumber} failed`,
        detail: truncateSingleLine(failed.message, TESTING_ARG_PREVIEW_MAX_CHARS),
        color: COLORS.RED,
      };
    }),
    Match.tag("StepSkipped", (skipped) => {
      const stepNumber = stepNumberByStepId.get(skipped.stepId) ?? 0;
      return {
        tag: "step",
        label: `step ${stepNumber} skipped`,
        detail: truncateSingleLine(skipped.reason, TESTING_ARG_PREVIEW_MAX_CHARS),
        color: COLORS.YELLOW,
      };
    }),
    Match.tag("ToolCall", (call) => {
      const formatted = formatToolCall(call.toolName, call.input);
      const detail = formatted.args
        ? `${formatted.name}  ${formatted.args}`
        : formatted.name;
      return {
        tag: "tool",
        label: "tool",
        detail: truncateSingleLine(detail, TESTING_ARG_PREVIEW_MAX_CHARS),
        color: COLORS.TEXT,
      };
    }),
    Match.tag("ToolProgress", (progress) => ({
      tag: "tool",
      label: "tool...",
      detail: `${progress.toolName}  ${formatBytes(progress.outputSize)}`,
      color: COLORS.DIM,
    })),
    Match.tag("ToolResult", (result) => ({
      tag: "tool",
      label: `${ARROW_LEFT} tool`,
      detail: `${result.toolName}  ${formatBytes(result.result.length)}  ${result.isError ? "ERR" : "OK"}`,
      color: result.isError ? COLORS.RED : COLORS.GREEN,
    })),
    Match.tag("AgentText", (text) => ({
      tag: "agent",
      label: "say",
      detail: truncateSingleLine(text.text, AGENT_TEXT_PREVIEW_MAX_CHARS),
      color: COLORS.TEXT,
    })),
    Match.tag("AgentThinking", (thinking) => ({
      tag: "agent",
      label: "think",
      detail: truncateSingleLine(thinking.text, AGENT_TEXT_PREVIEW_MAX_CHARS),
      color: COLORS.DIM,
    })),
    Match.tag("RunFinished", (finished) => ({
      tag: "run",
      label: "finished",
      detail: `status=${finished.status}`,
      color: finished.status === "passed" ? COLORS.GREEN : COLORS.RED,
    })),
    Match.exhaustive,
  );

const buildStepNumberByStepId = (events: readonly ExecutionEvent[]): Map<string, number> => {
  const map = new Map<string, number>();
  let nextNumber = 1;
  for (const event of events) {
    if (event._tag === "StepStarted" && !map.has(event.stepId)) {
      map.set(event.stepId, nextNumber);
      nextNumber++;
    }
  }
  return map;
};

export const RawEventsOverlay = (props: RawEventsOverlayProps) => {
  const dimensions = useTerminalDimensions();

  const stepNumbers = createMemo(() => buildStepNumberByStepId(props.executedPlan.events));

  const rows = createMemo<readonly EventRow[]>(() =>
    props.executedPlan.events.map((event) => formatEvent(event, stepNumbers())),
  );

  const visibleRows = () =>
    Math.max(
      MIN_VISIBLE_ROWS,
      Math.floor(dimensions().height * 0.7) - OVERLAY_CHROME_ROWS,
    );

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [scrollOffset, setScrollOffset] = createSignal(0);

  const clampSelection = (index: number): number => {
    const total = rows().length;
    if (total === 0) return 0;
    if (index < 0) return 0;
    if (index >= total) return total - 1;
    return index;
  };

  const ensureVisible = (index: number): void => {
    const offset = scrollOffset();
    const limit = visibleRows();
    if (index < offset) {
      setScrollOffset(index);
      return;
    }
    if (index >= offset + limit) {
      setScrollOffset(index - limit + 1);
    }
  };

  const moveSelection = (delta: number): void => {
    const next = clampSelection(selectedIndex() + delta);
    setSelectedIndex(next);
    ensureVisible(next);
  };

  useKeyboard((event) => {
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
    if (event.name === "pagedown") {
      moveSelection(visibleRows());
      return;
    }
    if (event.name === "pageup") {
      moveSelection(-visibleRows());
      return;
    }
    if (event.name === "home") {
      setSelectedIndex(0);
      setScrollOffset(0);
      return;
    }
    if (event.name === "end") {
      const last = rows().length - 1;
      setSelectedIndex(Math.max(0, last));
      ensureVisible(Math.max(0, last));
      return;
    }
  });

  const visibleSlice = () => {
    const offset = scrollOffset();
    return rows().slice(offset, offset + visibleRows());
  };

  const totalCount = () => rows().length;

  return (
    <OverlayContainer
      title="Events Timeline"
      footerHint={"\u2191\u2193 scroll \u00b7 esc dismiss"}
      size="medium"
    >
      <Show when={totalCount() === 0}>
        <text style={{ fg: COLORS.DIM }}>No events recorded.</text>
      </Show>
      <Show when={totalCount() > 0}>
        <For each={visibleSlice()}>
          {(row, index) => {
            const actualIndex = () => index() + scrollOffset();
            const isSelected = () => actualIndex() === selectedIndex();
            return (
              <box>
                <text>
                  <span style={{ fg: isSelected() ? COLORS.PRIMARY : COLORS.DIM }}>
                    {isSelected() ? "\u25B8 " : "  "}
                  </span>
                  <span style={{ fg: COLORS.DIM }}>{row.label.padEnd(14, " ")}</span>
                  <span style={{ fg: row.color }}>{row.detail}</span>
                </text>
              </box>
            );
          }}
        </For>
        <box marginTop={1}>
          <text style={{ fg: COLORS.DIM }}>
            {`${Math.min(selectedIndex() + 1, totalCount())} / ${totalCount()}`}
          </text>
        </box>
      </Show>
    </OverlayContainer>
  );
};
