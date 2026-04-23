import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useInput } from "ink";
import figures from "figures";
import { Cause, DateTime, Option, Predicate } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";

import {
  type ChangesFor,
  type SavedFlow,
  AnalysisStep,
  type ExecutedPerfPlan,
  type ExecutionEvent,
} from "@neuve/shared/models";
import {
  TESTING_ARG_PREVIEW_MAX_CHARS,
  TESTING_RESULT_PREVIEW_MAX_CHARS,
  TESTING_TIMER_UPDATE_INTERVAL_MS,
  TESTING_TOOL_TEXT_CHAR_LIMIT,
} from "../../constants";
import { useColors, theme } from "../theme-context";
import InkSpinner from "ink-spinner";
import { Spinner } from "../ui/spinner";
import { TextShimmer } from "../ui/text-shimmer";
import { Logo } from "../ui/logo";
import { usePlanExecutionStore } from "../../stores/use-plan-execution-store";
import { usePreferencesStore } from "../../stores/use-preferences";
import { useNavigationStore, Screen } from "../../stores/use-navigation";
import cliTruncate from "cli-truncate";
import { formatElapsedTime } from "../../utils/format-elapsed-time";
import { Image } from "../ui/image";
import { ErrorMessage } from "../ui/error-message";
import { executeFn, screenshotPathsAtom } from "../../data/execution-atom";
import { agentConfigOptionsAtom } from "../../data/config-options";
import { agentProviderAtom } from "../../data/runtime";
import { trackEvent } from "../../utils/session-analytics";
import { formatToolCall, type FormattedToolCall } from "../../utils/format-tool-call";
import { useScrollableList } from "../../hooks/use-scrollable-list";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions";

import type { DevServerHint } from "../../stores/use-navigation";

interface TestingScreenProps {
  changesFor: ChangesFor;
  instruction: string;
  savedFlow?: SavedFlow;
  cookieBrowserKeys?: readonly string[];
  baseUrls?: readonly string[];
  devServerHints?: readonly DevServerHint[];
}

interface ToolCallDisplay {
  tool: FormattedToolCall;
  isRunning: boolean;
  resultTokens: number | undefined;
  rawInput: unknown;
  resultText: string | undefined;
  resultIsError: boolean;
  progressBytes: number | undefined;
}

const MAX_VISIBLE_TOOL_CALLS = 5;
const APPROX_CHARS_PER_TOKEN = 4;
const EXPANDED_VIEWPORT_OVERHEAD = 6;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
};

const formatStreamingBytes = (bytes: number): string => {
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  if (bytes >= BYTES_PER_KB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${bytes} B`;
};

const truncateSingleLine = (text: string, maxChars: number): string => {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) return singleLine;
  return `${singleLine.slice(0, Math.max(1, maxChars - 1))}\u2026`;
};

const parseRawInput = (rawInput: unknown): Record<string, unknown> => {
  if (typeof rawInput === "string") {
    try {
      const parsed: unknown = JSON.parse(rawInput);
      if (Predicate.isObject(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (Predicate.isObject(rawInput)) return rawInput as Record<string, unknown>;
  return {};
};

const getActionObject = (input: Record<string, unknown>): Record<string, unknown> | undefined => {
  const action = input["action"];
  if (Predicate.isObject(action)) return action as Record<string, unknown>;
  return undefined;
};

const formatCommandPreview = (rawInput: unknown): string => {
  const input = parseRawInput(rawInput);
  const action = getActionObject(input);
  if (action && typeof action["command"] === "string") return action["command"];
  if (typeof input["command"] === "string") return input["command"];
  return "";
};

const ARGS_SKIP_KEYS = new Set(["command", "includeSnapshot"]);

const ARGS_PRIMARY_KEYS_BY_COMMAND: Record<string, readonly string[]> = {
  navigate: ["url", "direction"],
  click: ["uid"],
  type: ["text"],
  fill: ["uid", "value"],
  press_key: ["key"],
  hover: ["uid"],
  drag: ["fromUid", "toUid"],
  upload_file: ["uid", "filePath"],
  handle_dialog: ["accept"],
  wait_for: ["text"],
  resize: ["width", "height"],
  new_tab: ["url"],
  screenshot: ["uid", "fullPage"],
  snapshot: ["verbose"],
  evaluate: ["function"],
  network: ["reqid", "resourceTypes"],
  console: ["msgid", "types"],
  analyze: ["insightSetId", "insightName"],
  start: ["reload", "autoStop"],
  emulate: ["cpuThrottling", "network"],
};

const formatScalarValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return "";
};

const formatArgsPreview = (rawInput: unknown, command: string): string => {
  const input = parseRawInput(rawInput);
  const source = getActionObject(input) ?? input;
  const primaryKeys = ARGS_PRIMARY_KEYS_BY_COMMAND[command] ?? [];
  const parts: string[] = [];

  for (const key of primaryKeys) {
    if (!(key in source)) continue;
    const formatted = formatScalarValue(source[key]);
    if (!formatted) continue;
    if (primaryKeys.length === 1) {
      parts.push(formatted);
    } else {
      parts.push(`${key}=${formatted}`);
    }
  }

  if (parts.length === 0) {
    for (const [key, value] of Object.entries(source)) {
      if (ARGS_SKIP_KEYS.has(key)) continue;
      const formatted = formatScalarValue(value);
      if (!formatted) continue;
      parts.push(`${key}=${formatted}`);
      if (parts.length >= 2) break;
    }
  }

  return truncateSingleLine(parts.join(" "), TESTING_ARG_PREVIEW_MAX_CHARS);
};

const formatResultPreview = (result: string): string =>
  truncateSingleLine(result, TESTING_RESULT_PREVIEW_MAX_CHARS);

const collectToolCalls = (
  events: readonly ExecutionEvent[],
  fromIndex: number,
  toIndex: number = events.length,
): ToolCallDisplay[] => {
  const calls: ToolCallDisplay[] = [];

  for (let index = fromIndex; index < toIndex; index++) {
    const event = events[index];
    if (event._tag === "ToolCall") {
      calls.push({
        tool: formatToolCall(event.toolName, event.input),
        isRunning: false,
        resultTokens: undefined,
        rawInput: event.input,
        resultText: undefined,
        resultIsError: false,
        progressBytes: undefined,
      });
    }
    if (event._tag === "ToolProgress" && calls.length > 0) {
      const lastCall = calls[calls.length - 1];
      calls[calls.length - 1] = {
        ...lastCall,
        resultTokens: Math.round(event.outputSize / APPROX_CHARS_PER_TOKEN),
        progressBytes: event.outputSize,
      };
    }
    if (event._tag === "ToolResult" && calls.length > 0) {
      const lastCall = calls[calls.length - 1];
      calls[calls.length - 1] = {
        ...lastCall,
        resultTokens: Math.round(event.result.length / APPROX_CHARS_PER_TOKEN),
        resultText: event.result,
        resultIsError: event.isError,
      };
    }
  }

  return calls;
};

const markLastCallRunning = (
  calls: ToolCallDisplay[],
  events: readonly ExecutionEvent[],
): ToolCallDisplay[] => {
  if (calls.length === 0) return calls;
  const lastEvent = events.at(-1);
  const isLastDone = lastEvent?._tag === "ToolResult";
  const result = [...calls];
  result[result.length - 1] = {
    ...result[result.length - 1],
    isRunning: !isLastDone,
  };
  return result;
};

const getActiveStepToolCalls = (
  events: readonly ExecutionEvent[],
  showAll = false,
): ToolCallDisplay[] => {
  let lastStepStartIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]._tag === "StepStarted") {
      lastStepStartIndex = index;
      break;
    }
  }
  if (lastStepStartIndex === -1) return [];
  const calls = collectToolCalls(events, lastStepStartIndex + 1);
  const marked = markLastCallRunning(calls, events);
  return showAll ? marked : marked.slice(-MAX_VISIBLE_TOOL_CALLS);
};

const getPlanningToolCalls = (
  events: readonly ExecutionEvent[],
  showAll = false,
): ToolCallDisplay[] => {
  const calls = collectToolCalls(events, 0);
  const marked = markLastCallRunning(calls, events);
  return showAll ? marked : marked.slice(-MAX_VISIBLE_TOOL_CALLS);
};

const findStepEventRange = (
  events: readonly ExecutionEvent[],
  stepIndex: number,
): [number, number] => {
  let currentStep = -1;
  let startIndex = 0;

  for (let index = 0; index < events.length; index++) {
    if (events[index]._tag === "StepStarted") {
      currentStep++;
      if (currentStep === stepIndex) startIndex = index + 1;
      if (currentStep === stepIndex + 1) return [startIndex, index];
    }
  }

  return [startIndex, events.length];
};

const getCompletedStepToolCalls = (
  events: readonly ExecutionEvent[],
  stepIndex: number,
): ToolCallDisplay[] => {
  const [from, to] = findStepEventRange(events, stepIndex);
  return collectToolCalls(events, from, to);
};

const ToolCallBlock = ({
  display,
  indent,
}: {
  readonly display: ToolCallDisplay;
  readonly indent: string;
}) => {
  const COLORS = useColors();
  return (
    <Text color={COLORS.DIM} wrap="truncate">
      {indent}
      {figures.lineVertical} <Text color={COLORS.TEXT}>{display.tool.name}</Text>(
      {display.tool.args})
      {display.isRunning && (
        <Text>
          {" "}
          <InkSpinner type="line" />
        </Text>
      )}
      {display.resultTokens !== undefined &&
        ` ${figures.arrowDown} ${formatTokenCount(display.resultTokens)} tokens`}
    </Text>
  );
};

const getStepElapsedMs = (step: AnalysisStep): number | undefined => {
  if (Option.isNone(step.startedAt)) return undefined;
  const endMs = Option.isSome(step.endedAt)
    ? DateTime.toEpochMillis(step.endedAt.value)
    : Date.now();
  return endMs - DateTime.toEpochMillis(step.startedAt.value);
};

const buildToolCallRows = (
  toolCalls: ToolCallDisplay[],
  indent: string,
  keyPrefix: string,
  colors: ReturnType<typeof useColors>,
): React.ReactElement[] => {
  const rows: React.ReactElement[] = [];
  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
    const display = toolCalls[toolIndex];
    const baseKey = `${keyPrefix}-t${toolIndex}`;
    const commandPreview = formatCommandPreview(display.rawInput);
    const argsPreview = commandPreview
      ? formatArgsPreview(display.rawInput, commandPreview)
      : display.tool.args;
    const hasResult = display.resultText !== undefined;
    const statusGlyph = display.resultIsError ? figures.cross : figures.tick;
    const statusColor = display.resultIsError ? colors.RED : colors.GREEN;

    rows.push(
      <Text key={`${baseKey}-head`} color={colors.DIM} wrap="truncate">
        {indent}
        {figures.lineVertical}{" "}
        {display.isRunning && (
          <Text>
            <InkSpinner type="line" />
          </Text>
        )}
        {hasResult && <Text color={statusColor}>{statusGlyph}</Text>}
        {!display.isRunning && !hasResult && <Text color={colors.DIM}>{figures.circle}</Text>}
        <Text> </Text>
        <Text color={colors.TEXT}>{display.tool.name}</Text>
        {commandPreview && (
          <Text>
            {"  "}
            <Text color={colors.PRIMARY}>{commandPreview}</Text>
          </Text>
        )}
        {argsPreview && (
          <Text>
            {"  "}
            <Text color={colors.TEXT}>{argsPreview}</Text>
          </Text>
        )}
        {!hasResult && display.progressBytes !== undefined && (
          <Text color={colors.DIM}>
            {"  "}
            {figures.pointerSmall} {formatStreamingBytes(display.progressBytes)} streaming
          </Text>
        )}
        {hasResult && display.resultTokens !== undefined && (
          <Text color={colors.DIM}>
            {" "}
            {figures.arrowDown} {formatTokenCount(display.resultTokens)} tokens
          </Text>
        )}
      </Text>,
    );

    if (display.tool.multilineArgs) {
      const lines = display.tool.multilineArgs.split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        rows.push(
          <Text key={`${baseKey}-m${lineIndex}`} color={colors.DIM} wrap="truncate">
            {indent}
            {figures.lineVertical} {"    "}
            <Text color={colors.TEXT}>{lines[lineIndex]}</Text>
          </Text>,
        );
      }
    }

    if (hasResult && display.resultText) {
      const resultPreview = formatResultPreview(display.resultText);
      if (resultPreview) {
        rows.push(
          <Text key={`${baseKey}-res`} color={colors.DIM} wrap="truncate">
            {indent}
            {figures.lineVertical} {"  "}
            <Text color={colors.DIM}>
              {figures.arrowRight} {resultPreview}
            </Text>
          </Text>,
        );
      }
    }
  }
  return rows;
};

export const TestingScreen = ({
  changesFor,
  instruction,
  savedFlow,
  cookieBrowserKeys = [],
  baseUrls,
  devServerHints,
}: TestingScreenProps) => {
  const setScreen = useNavigationStore((state) => state.setScreen);
  const COLORS = useColors();
  const [, terminalRows] = useStdoutDimensions();

  const agentProviderValue = useAtomValue(agentProviderAtom);
  const agentBackend = Option.isSome(agentProviderValue) ? agentProviderValue.value : "claude";
  const setConfigOptions = useAtomSet(agentConfigOptionsAtom);
  const modelPreferenceConfigId = usePreferencesStore(
    (state) => state.modelPreferences[agentBackend]?.configId,
  );
  const modelPreferenceValue = usePreferencesStore(
    (state) => state.modelPreferences[agentBackend]?.value,
  );
  const browserHeaded = usePreferencesStore((state) => state.browserHeaded);
  const browserProfile = usePreferencesStore((state) => state.browserProfile);
  const cdpUrl = usePreferencesStore((state) => state.cdpUrl);
  const plannerMode = usePreferencesStore((state) => state.plannerMode);
  const toggleNotifications = usePreferencesStore((state) => state.toggleNotifications);
  const [executionResult, triggerExecute] = useAtom(executeFn, {
    mode: "promiseExit",
  });
  const screenshotPaths = useAtomValue(screenshotPathsAtom);

  const isExecuting = AsyncResult.isWaiting(executionResult);
  const isExecutionComplete = AsyncResult.isSuccess(executionResult);
  const report = isExecutionComplete ? executionResult.value.report : undefined;

  const [executedPlan, setExecutedPlan] = useState<ExecutedPerfPlan | undefined>(undefined);
  const [runStartedAt, setRunStartedAt] = useState<number | undefined>(undefined);
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const expanded = usePlanExecutionStore((state) => state.expanded);
  const setExpanded = usePlanExecutionStore((state) => state.setExpanded);
  const toggleExpanded = usePlanExecutionStore((state) => state.toggleExpanded);

  const elapsedTimeLabel = formatElapsedTime(elapsedTimeMs);
  const totalCount = executedPlan?.steps ? executedPlan.steps.length : 0;

  // Build flat rows for expanded scrollable view
  const expandedRows: React.ReactElement[] = [];
  if (expanded && executedPlan) {
    const steps = executedPlan.steps ?? [];

    if (steps.length === 0 && isExecuting) {
      const toolCalls = getPlanningToolCalls(executedPlan.events, true);
      expandedRows.push(...buildToolCallRows(toolCalls, "  ", "planning", COLORS));
    }

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const label = Option.isSome(step.summary) ? step.summary.value : step.title;
      const stepElapsedMs = getStepElapsedMs(step);
      const stepElapsedLabel =
        stepElapsedMs !== undefined ? formatElapsedTime(stepElapsedMs) : undefined;
      const num = `${stepIndex + 1}.`;

      if (step.status === "active") {
        expandedRows.push(
          <Box key={`step-${stepIndex}`}>
            <Text color={COLORS.DIM}>
              {"  "}
              {num}{" "}
            </Text>
            <Spinner />
            <Text> </Text>
            <TextShimmer
              text={`${step.title} ${elapsedTimeLabel}`}
              baseColor={theme.shimmerBase}
              highlightColor={theme.shimmerHighlight}
            />
          </Box>,
        );
        const toolCalls = getActiveStepToolCalls(executedPlan.events, true);
        expandedRows.push(...buildToolCallRows(toolCalls, "     ", `s${stepIndex}`, COLORS));
      } else if (step.status === "passed") {
        expandedRows.push(
          <Text key={`step-${stepIndex}`}>
            <Text color={COLORS.DIM}>
              {"  "}
              {num}
            </Text>
            <Text color={COLORS.GREEN}>
              {" "}
              {figures.tick} {cliTruncate(label, TESTING_TOOL_TEXT_CHAR_LIMIT)}
            </Text>
            {stepElapsedLabel && <Text color={COLORS.DIM}> {stepElapsedLabel}</Text>}
          </Text>,
        );
        const toolCalls = getCompletedStepToolCalls(executedPlan.events, stepIndex);
        expandedRows.push(...buildToolCallRows(toolCalls, "     ", `s${stepIndex}`, COLORS));
      } else if (step.status === "failed") {
        expandedRows.push(
          <Text key={`step-${stepIndex}`}>
            <Text color={COLORS.DIM}>
              {"  "}
              {num}
            </Text>
            <Text color={COLORS.RED}>
              {" "}
              {figures.cross} {cliTruncate(label, TESTING_TOOL_TEXT_CHAR_LIMIT)}
            </Text>
            {stepElapsedLabel && <Text color={COLORS.DIM}> {stepElapsedLabel}</Text>}
          </Text>,
        );
        const toolCalls = getCompletedStepToolCalls(executedPlan.events, stepIndex);
        expandedRows.push(...buildToolCallRows(toolCalls, "     ", `s${stepIndex}`, COLORS));
      } else if (step.status === "skipped") {
        expandedRows.push(
          <Text key={`step-${stepIndex}`}>
            <Text color={COLORS.DIM}>
              {"  "}
              {num}
            </Text>
            <Text color={COLORS.YELLOW}>
              {" "}
              {figures.arrowRight} {cliTruncate(label, TESTING_TOOL_TEXT_CHAR_LIMIT)}
            </Text>
            {stepElapsedLabel && <Text color={COLORS.DIM}> {stepElapsedLabel}</Text>}
          </Text>,
        );
      } else {
        expandedRows.push(
          <Text key={`step-${stepIndex}`} color={COLORS.DIM}>
            {"  "}
            {num} {figures.circle} {step.title}
          </Text>,
        );
      }
    }
  }

  const visibleCount = Math.max(1, terminalRows - EXPANDED_VIEWPORT_OVERHEAD);
  const expandedScroll = useScrollableList({
    itemCount: expandedRows.length,
    visibleCount,
  });

  // Snap to bottom when first expanding
  const wasExpandedRef = useRef(false);
  useEffect(() => {
    if (expanded && !wasExpandedRef.current && expandedRows.length > 0) {
      expandedScroll.setHighlightedIndex(expandedRows.length - 1);
    }
    wasExpandedRef.current = expanded;
  }, [expanded, expandedRows.length, expandedScroll]);

  useEffect(() => {
    setRunStartedAt(Date.now());

    const baseUrl = baseUrls && baseUrls.length > 0 ? baseUrls.join(", ") : undefined;

    triggerExecute({
      options: {
        changesFor,
        instruction,
        isHeadless: !browserHeaded,
        cdpUrl,
        profileName: browserProfile,
        cookieBrowserKeys: [...cookieBrowserKeys],
        savedFlow,
        baseUrl,
        devServerHints: devServerHints ? [...devServerHints] : undefined,
        modelPreference:
          modelPreferenceConfigId && modelPreferenceValue
            ? { configId: modelPreferenceConfigId, value: modelPreferenceValue }
            : undefined,
        plannerMode,
      },
      agentBackend,
      onUpdate: setExecutedPlan,
      onConfigOptions: (configOptions) => {
        setConfigOptions((previous) => ({
          ...previous,
          [agentBackend]: [...configOptions],
        }));
      },
    });

    return () => {
      triggerExecute(Atom.Interrupt);
    };
  }, [
    triggerExecute,
    agentBackend,
    browserHeaded,
    browserProfile,
    cdpUrl,
    changesFor,
    instruction,
    savedFlow,
    cookieBrowserKeys,
    baseUrls,
    devServerHints,
    modelPreferenceConfigId,
    modelPreferenceValue,
    plannerMode,
    setConfigOptions,
  ]);

  const videoUrl = isExecutionComplete ? executionResult.value.videoUrl : undefined;

  useEffect(() => {
    if (isExecutionComplete && executedPlan && report) {
      usePlanExecutionStore.getState().setExecutedPlan(executedPlan);
      setScreen(Screen.Results({ report, videoUrl }));
    }
  }, [isExecutionComplete, executedPlan, report, videoUrl, setScreen]);

  const goToMain = () => {
    usePlanExecutionStore.getState().setExecutedPlan(undefined);
    setScreen(Screen.Main());
  };

  useEffect(() => {
    if (runStartedAt === undefined) return;
    if (!isExecuting) return;
    const interval = setInterval(() => {
      setElapsedTimeMs(Date.now() - runStartedAt);
    }, TESTING_TIMER_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runStartedAt, isExecuting]);

  useInput((input, key) => {
    const normalizedInput = input.toLowerCase();

    if (showCancelConfirmation) {
      if (key.return || normalizedInput === "y") {
        setShowCancelConfirmation(false);
        trackEvent("analysis:cancelled");
        goToMain();
        return;
      }
      if (key.escape || normalizedInput === "n") {
        setShowCancelConfirmation(false);
      }
      return;
    }

    if (key.ctrl && input === "o") {
      toggleExpanded();
      return;
    }

    if (key.ctrl && input === "n") {
      toggleNotifications();
      return;
    }

    if (expanded) {
      if (expandedScroll.handleNavigation(input, key)) return;
      if (key.escape) {
        setExpanded(false);
        return;
      }
      return;
    }

    if (key.escape) {
      if (AsyncResult.isFailure(executionResult)) {
        goToMain();
        return;
      }
      if (isExecuting) {
        setShowCancelConfirmation(true);
        return;
      }
      if (executedPlan && report) {
        usePlanExecutionStore.getState().setExecutedPlan(executedPlan);
        setScreen(Screen.Results({ report, videoUrl }));
        return;
      }
      goToMain();
    }
  });

  const visibleExpandedRows = expandedRows.slice(
    expandedScroll.scrollOffset,
    expandedScroll.scrollOffset + visibleCount,
  );

  return (
    <>
      <Static items={[...screenshotPaths]}>
        {(screenshotPath) => (
          <Box key={screenshotPath} paddingX={1}>
            <Image src={screenshotPath} alt={screenshotPath} />
          </Box>
        )}
      </Static>
      <Box flexDirection="column" width="100%">
        <Box flexDirection="column" width="100%" paddingY={1} paddingX={1}>
          <Box>
            <Logo />
            <Text wrap="truncate">
              {" "}
              <Text color={COLORS.DIM}>{figures.pointerSmall}</Text>{" "}
              <Text color={COLORS.TEXT}>{instruction}</Text>
            </Text>
          </Box>

          {expanded && (
            <Box flexDirection="column" marginTop={1}>
              {visibleExpandedRows}
            </Box>
          )}
          {!expanded && (
            <>
              {totalCount === 0 &&
                isExecuting &&
                (() => {
                  const toolCalls = executedPlan
                    ? getPlanningToolCalls(executedPlan.events, false)
                    : [];
                  return (
                    <Box marginTop={1} flexDirection="column">
                      <Box>
                        <Spinner />
                        <Text> </Text>
                        <TextShimmer
                          text={`Starting${figures.ellipsis} ${elapsedTimeLabel}`}
                          baseColor={theme.shimmerBase}
                          highlightColor={theme.shimmerHighlight}
                        />
                      </Box>
                      {toolCalls.map((tool, toolIndex) => (
                        <ToolCallBlock key={toolIndex} display={tool} indent={"  "} />
                      ))}
                    </Box>
                  );
                })()}

              <Box flexDirection="column" marginTop={1}>
                {(executedPlan?.steps ?? []).map((step: AnalysisStep, stepIndex: number) => {
                  const label = Option.isSome(step.summary) ? step.summary.value : step.title;
                  const stepElapsedMs = getStepElapsedMs(step);
                  const stepElapsedLabel =
                    stepElapsedMs !== undefined ? formatElapsedTime(stepElapsedMs) : undefined;
                  const num = `${stepIndex + 1}.`;

                  if (step.status === "active") {
                    const toolCalls = executedPlan
                      ? getActiveStepToolCalls(executedPlan.events, false)
                      : [];
                    return (
                      <Box key={step.id} flexDirection="column">
                        <Box>
                          <Text color={COLORS.DIM}>
                            {"  "}
                            {num}{" "}
                          </Text>
                          <Spinner />
                          <Text> </Text>
                          <TextShimmer
                            text={`${step.title} ${elapsedTimeLabel}`}
                            baseColor={theme.shimmerBase}
                            highlightColor={theme.shimmerHighlight}
                          />
                        </Box>
                        {toolCalls.map((tool, toolIndex) => (
                          <ToolCallBlock key={toolIndex} display={tool} indent={"     "} />
                        ))}
                      </Box>
                    );
                  }

                  if (step.status === "passed") {
                    return (
                      <Text key={step.id}>
                        <Text color={COLORS.DIM}>
                          {"  "}
                          {num}
                        </Text>
                        <Text color={COLORS.GREEN}>
                          {" "}
                          {figures.tick} {cliTruncate(label, TESTING_TOOL_TEXT_CHAR_LIMIT)}
                        </Text>
                        {stepElapsedLabel && <Text color={COLORS.DIM}> {stepElapsedLabel}</Text>}
                      </Text>
                    );
                  }

                  if (step.status === "failed") {
                    return (
                      <Text key={step.id}>
                        <Text color={COLORS.DIM}>
                          {"  "}
                          {num}
                        </Text>
                        <Text color={COLORS.RED}>
                          {" "}
                          {figures.cross} {cliTruncate(label, TESTING_TOOL_TEXT_CHAR_LIMIT)}
                        </Text>
                        {stepElapsedLabel && <Text color={COLORS.DIM}> {stepElapsedLabel}</Text>}
                      </Text>
                    );
                  }

                  if (step.status === "skipped") {
                    return (
                      <Text key={step.id}>
                        <Text color={COLORS.DIM}>
                          {"  "}
                          {num}
                        </Text>
                        <Text color={COLORS.YELLOW}>
                          {" "}
                          {figures.arrowRight} {cliTruncate(label, TESTING_TOOL_TEXT_CHAR_LIMIT)}
                        </Text>
                        {stepElapsedLabel && <Text color={COLORS.DIM}> {stepElapsedLabel}</Text>}
                      </Text>
                    );
                  }

                  return (
                    <Text key={step.id} color={COLORS.DIM}>
                      {"  "}
                      {num} {figures.circle} {step.title}
                    </Text>
                  );
                })}
              </Box>
            </>
          )}

          {showCancelConfirmation && (
            <Box marginTop={1}>
              <Text color={COLORS.YELLOW}>
                Stop run? <Text color={COLORS.PRIMARY}>enter</Text> to stop,{" "}
                <Text color={COLORS.PRIMARY}>esc</Text> to dismiss
              </Text>
            </Box>
          )}
        </Box>

        {AsyncResult.builder(executionResult)
          .onError((error) => {
            if (!error) return null;
            return <ErrorMessage type="error" error={error} />;
          })
          .onDefect((defect) => (
            <ErrorMessage
              type="defect"
              error={{
                _tag: "Defect",
                message: Cause.pretty(Cause.fail(defect)),
              }}
            />
          ))
          .orNull()}
      </Box>
    </>
  );
};
