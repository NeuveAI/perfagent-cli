import { createSignal, onCleanup, For, Show } from "solid-js";
import { Exit } from "effect";
import type { PerfReport } from "@neuve/supervisor";
import type { AnalysisStep } from "@neuve/shared/models";
import { saveFlowFn } from "@neuve/perf-agent-cli/data/flow-storage-atom";
import { useNavigation, screenForTestingOrPortPicker } from "../../context/navigation";
import { useToast } from "../../context/toast";
import { atomFnToPromise } from "../../adapters/effect-atom";
import { Logo } from "../../renderables/logo";
import { RuledBox } from "../../renderables/ruled-box";
import { MetricsTable } from "./metrics-table";
import { RawEventsOverlay } from "./raw-events-overlay";
import { InsightsOverlay } from "./insights-overlay";
import { copyToClipboard } from "../../utils/copy-to-clipboard";
import { getStepElapsedMs, getTotalElapsedMs } from "../../utils/step-elapsed";
import { formatElapsedTime } from "../../utils/format-elapsed-time";
import { COLORS } from "../../constants";

const TICK = "\u2714";
const CROSS = "\u2718";
const ARROW_RIGHT = "\u2192";
const POINTER = "\u25B8";

interface ResultsScreenProps {
  readonly report: PerfReport;
  readonly videoUrl?: string;
}

export const ResultsScreen = (props: ResultsScreenProps) => {
  const navigation = useNavigation();
  const toast = useToast();

  const [statusMessage, setStatusMessage] = createSignal<
    { text: string; color: string } | undefined
  >(undefined);
  const [savePending, setSavePending] = createSignal(false);
  const [saveSucceeded, setSaveSucceeded] = createSignal(false);
  const [saveFailed, setSaveFailed] = createSignal(false);

  const isPassed = () => props.report.status === "passed";
  const statusColor = () => (isPassed() ? COLORS.GREEN : COLORS.RED);
  const statusIcon = () => (isPassed() ? TICK : CROSS);
  const statusLabel = () => (isPassed() ? "Passed" : "Failed");
  const totalElapsedMs = () => getTotalElapsedMs(props.report.steps);

  const hasMetrics = () => props.report.metrics.length > 0;
  const hasToolResult = () => props.report.events.some((event) => event._tag === "ToolResult");
  const showMetricsFallback = () => !hasMetrics() && !hasToolResult();
  const showToolsButNoTraceFallback = () => !hasMetrics() && hasToolResult();

  const handleCopy = () => {
    const didCopy = copyToClipboard(props.report.toPlainText);
    if (didCopy) {
      setStatusMessage({
        text: `${TICK} Copied test summary. Paste it into your chat or PR.`,
        color: COLORS.GREEN,
      });
    } else {
      setStatusMessage({
        text: `${CROSS} Couldn\u2019t copy the test summary. Press y to try again.`,
        color: COLORS.RED,
      });
    }
  };

  const handleSave = async () => {
    if (savePending() || saveSucceeded()) return;
    setSavePending(true);
    setSaveFailed(false);
    const trigger = atomFnToPromise(saveFlowFn);
    const exit = await trigger({ plan: props.report });
    setSavePending(false);
    if (Exit.isSuccess(exit)) {
      setSaveSucceeded(true);
      toast.show("Flow saved");
    } else {
      setSaveFailed(true);
    }
  };

  const handleRestart = () => {
    navigation.setScreen(
      screenForTestingOrPortPicker({
        changesFor: props.report.changesFor,
        instruction: props.report.instruction,
      }),
    );
  };

  setResultsActions({ onCopy: handleCopy, onSave: handleSave, onRestart: handleRestart });
  onCleanup(clearResultsActions);

  return (
    <box flexDirection="column" width="100%" paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
      {/* Header */}
      <box>
        <Logo />
        <text>
          <span style={{ fg: COLORS.DIM }}>{` ${POINTER} `}</span>
          <span style={{ fg: COLORS.TEXT }}>{props.report.instruction}</span>
        </text>
      </box>

      {/* Status */}
      <box marginTop={1}>
        <text>
          <span style={{ fg: statusColor(), bold: true }}>{`${statusIcon()} ${statusLabel()}`}</span>
          <Show when={showMetricsFallback()}>
            <span style={{ fg: COLORS.DIM }}>{"  Agent did not run any performance tools."}</span>
          </Show>
          <Show when={showToolsButNoTraceFallback()}>
            <span style={{ fg: COLORS.DIM }}>
              {"  Agent ran tools but didn\u2019t capture a performance trace."}
            </span>
          </Show>
          <Show when={hasMetrics()}>
            <span style={{ fg: COLORS.DIM }}>
              {`  ${props.report.metrics.length} trace${props.report.metrics.length === 1 ? "" : "s"} captured`}
            </span>
          </Show>
        </text>
      </box>

      {/* CWV Metrics Table */}
      <Show when={hasMetrics()}>
        <MetricsTable metrics={props.report.metrics} />
      </Show>

      {/* Copy summary callout */}
      <RuledBox color={COLORS.YELLOW}>
        <text><span style={{ fg: COLORS.YELLOW, bold: true }}>Copy this summary now</span></text>
        <text>
          <span style={{ fg: COLORS.TEXT }}>{"Press "}</span>
          <span style={{ fg: COLORS.PRIMARY, bold: true }}>y</span>
          <span style={{ fg: COLORS.TEXT }}>{" to copy the test summary so you can paste it into your chat or PR."}</span>
        </text>
        <text>
          <span style={{ fg: COLORS.DIM }}>{"Press "}</span>
          <span style={{ fg: COLORS.PRIMARY, bold: true }}>s</span>
          <span style={{ fg: COLORS.DIM }}>{" to save this flow or "}</span>
          <span style={{ fg: COLORS.PRIMARY, bold: true }}>r</span>
          <span style={{ fg: COLORS.DIM }}>{" to run it again."}</span>
        </text>
      </RuledBox>

      {/* Step list */}
      <box flexDirection="column" marginTop={1}>
        <For each={props.report.steps}>
          {(step, stepIndex) => <StepRow step={step} stepIndex={stepIndex()} report={props.report} />}
        </For>
      </box>

      {/* Total elapsed time */}
      <Show when={totalElapsedMs() > 0}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.DIM }}>{`Worked for ${formatElapsedTime(totalElapsedMs())}`}</text>
        </box>
      </Show>

      {/* Copy status message */}
      <Show when={statusMessage()}>
        {(message) => (
          <box marginTop={1}>
            <text style={{ fg: message().color }}>{message().text}</text>
          </box>
        )}
      </Show>

      {/* Save status */}
      <Show when={savePending()}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.DIM }}>{"Saving flow\u2026"}</text>
        </box>
      </Show>
      <Show when={saveSucceeded()}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.GREEN }}>{`${TICK} Flow saved`}</text>
        </box>
      </Show>
      <Show when={saveFailed()}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.RED }}>{`${CROSS} Failed to save flow`}</text>
        </box>
      </Show>

      {/* Video URL */}
      <Show when={props.videoUrl}>
        {(url) => (
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            <text>
              <span style={{ fg: COLORS.DIM }}>{"Video: "}</span>
              <span style={{ fg: COLORS.PRIMARY, bold: true }}>{url()}</span>
            </text>
          </box>
        )}
      </Show>

      {/* Summary */}
      <Show when={props.report.summary}>
        <box flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
          <text><span style={{ fg: COLORS.TEXT, bold: true }}>Summary</span></text>
          <box marginTop={0} paddingLeft={1}>
            <text style={{ fg: COLORS.DIM }}>{props.report.summary}</text>
          </box>
        </box>
      </Show>

      <Show when={navigation.overlay() === "rawEvents"}>
        <RawEventsOverlay
          executedPlan={props.report}
          onClose={() => navigation.setOverlay(undefined)}
        />
      </Show>

      <Show when={navigation.overlay() === "insights"}>
        <InsightsOverlay report={props.report} onClose={() => navigation.setOverlay(undefined)} />
      </Show>
    </box>
  );
};

interface ResultsActions {
  readonly onCopy: () => void;
  readonly onSave: () => void;
  readonly onRestart: () => void;
}

let currentActions: ResultsActions | undefined;

export const setResultsActions = (actions: ResultsActions): void => {
  currentActions = actions;
};

export const clearResultsActions = (): void => {
  currentActions = undefined;
};

export const getResultsActions = (): ResultsActions | undefined => currentActions;

interface StepRowProps {
  readonly step: AnalysisStep;
  readonly stepIndex: number;
  readonly report: PerfReport;
}

const StepRow = (props: StepRowProps) => {
  const num = () => `${props.stepIndex + 1}.`;
  const stepStatus = () => props.report.stepStatuses.get(props.step.id);
  const isFailed = () => stepStatus()?.status === "failed";
  const isSkipped = () => stepStatus()?.status === "skipped";
  const stepColor = () => {
    if (isFailed()) return COLORS.RED;
    if (isSkipped()) return COLORS.YELLOW;
    return COLORS.GREEN;
  };
  const stepIcon = () => {
    if (isFailed()) return CROSS;
    if (isSkipped()) return ARROW_RIGHT;
    return TICK;
  };
  const stepElapsedMs = () => getStepElapsedMs(props.step);
  const stepElapsedLabel = () => {
    const ms = stepElapsedMs();
    return ms !== undefined ? formatElapsedTime(ms) : undefined;
  };

  return (
    <box flexDirection="column">
      <text>
        <span style={{ fg: COLORS.DIM }}>{`  ${num()}`}</span>
        <span style={{ fg: stepColor() }}>{` ${stepIcon()} ${props.step.title}`}</span>
        <Show when={stepElapsedLabel()}>
          {(label) => <span style={{ fg: COLORS.DIM }}>{` ${label()}`}</span>}
        </Show>
      </text>
      <Show when={(isFailed() || isSkipped()) && stepStatus()?.summary}>
        {(summary) => <text style={{ fg: COLORS.DIM }}>{`     ${summary()}`}</text>}
      </Show>
    </box>
  );
};
