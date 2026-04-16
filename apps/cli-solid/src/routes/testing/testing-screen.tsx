import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Exit, Option, DateTime, Predicate } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import type {
  ChangesFor,
  SavedFlow,
  ExecutedPerfPlan,
  ExecutionEvent,
  AnalysisStep,
} from "@neuve/shared/models";
import type { DevServerHint } from "@neuve/shared/prompts";
import { executeFn } from "@neuve/perf-agent-cli/data/execution-atom";
import type { ExecutionResult } from "@neuve/perf-agent-cli/data/execution-atom";
import { agentConfigOptionsAtom } from "@neuve/perf-agent-cli/data/config-options";
import { useNavigation, Screen } from "../../context/navigation";
import { useAgent } from "../../context/agent";
import { atomFnToPromise, atomSet, atomGet } from "../../adapters/effect-atom";
import { Logo } from "../../renderables/logo";
import { Spinner } from "../../renderables/spinner";
import { formatElapsedTime } from "../../utils/format-elapsed-time";
import { formatToolCall } from "../../utils/format-tool-call";
import type { FormattedToolCall } from "../../utils/format-tool-call";
import {
  COLORS,
  TESTING_TOOL_TEXT_CHAR_LIMIT,
  TESTING_RESULT_PREVIEW_MAX_CHARS,
  TESTING_ARG_PREVIEW_MAX_CHARS,
  TESTING_TIMER_UPDATE_INTERVAL_MS,
  MAX_VISIBLE_TOOL_CALLS,
} from "../../constants";

const TICK = "\u2714";
const CROSS = "\u2718";
const CIRCLE = "\u25CB";
const ARROW_RIGHT = "\u2192";
const POINTER = "\u25B8";
const PIPE = "\u2502";
const ARROW_DOWN = "\u2193";
const ELLIPSIS = "\u2026";
const APPROX_CHARS_PER_TOKEN = 4;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

interface TestingScreenProps {
  readonly changesFor: ChangesFor;
  readonly instruction: string;
  readonly savedFlow?: SavedFlow;
  readonly cookieBrowserKeys?: readonly string[];
  readonly baseUrls?: readonly string[];
  readonly devServerHints?: readonly DevServerHint[];
}

interface ToolCallDisplay {
  readonly tool: FormattedToolCall;
  readonly isRunning: boolean;
  readonly resultTokens: number | undefined;
  readonly rawInput: unknown;
  readonly resultText: string | undefined;
  readonly resultIsError: boolean;
  readonly progressBytes: number | undefined;
}

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

const truncateLabel = (text: string): string => {
  if (text.length <= TESTING_TOOL_TEXT_CHAR_LIMIT) return text;
  return `${text.slice(0, Math.max(1, TESTING_TOOL_TEXT_CHAR_LIMIT - 1))}\u2026`;
};

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

const getActiveStepToolCalls = (events: readonly ExecutionEvent[]): ToolCallDisplay[] => {
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
  return marked.slice(-MAX_VISIBLE_TOOL_CALLS);
};

const getPlanningToolCalls = (events: readonly ExecutionEvent[]): ToolCallDisplay[] => {
  const calls = collectToolCalls(events, 0);
  const marked = markLastCallRunning(calls, events);
  return marked.slice(-MAX_VISIBLE_TOOL_CALLS);
};

const getStepElapsedMs = (step: AnalysisStep): number | undefined => {
  if (Option.isNone(step.startedAt)) return undefined;
  const endMs = Option.isSome(step.endedAt)
    ? DateTime.toEpochMillis(step.endedAt.value)
    : Date.now();
  return endMs - DateTime.toEpochMillis(step.startedAt.value);
};

export const TestingScreen = (props: TestingScreenProps) => {
  const navigation = useNavigation();
  const agent = useAgent();

  const [executedPlan, setExecutedPlan] = createSignal<ExecutedPerfPlan | undefined>(undefined);
  const [runStartedAt, setRunStartedAt] = createSignal<number | undefined>(undefined);
  const [elapsedTimeMs, setElapsedTimeMs] = createSignal(0);
  const [showCancelConfirmation, setShowCancelConfirmation] = createSignal(false);
  const [isExecuting, setIsExecuting] = createSignal(true);
  const [executionError, setExecutionError] = createSignal<string | undefined>(undefined);

  const elapsedTimeLabel = () => formatElapsedTime(elapsedTimeMs());
  const totalCount = () => executedPlan()?.steps?.length ?? 0;

  createEffect(() => {
    const startTime = Date.now();
    setRunStartedAt(startTime);

    const agentBackend = agent.agentBackend();
    const modelPrefs = agent.modelPreferences();
    const modelPref = modelPrefs[agentBackend];

    const baseUrl =
      props.baseUrls && props.baseUrls.length > 0 ? props.baseUrls.join(", ") : undefined;

    const trigger = atomFnToPromise(executeFn);
    const promise = trigger({
      options: {
        changesFor: props.changesFor,
        instruction: props.instruction,
        isHeadless: true,
        cdpUrl: undefined,
        profileName: undefined,
        cookieBrowserKeys: props.cookieBrowserKeys ? [...props.cookieBrowserKeys] : [],
        savedFlow: props.savedFlow,
        baseUrl,
        devServerHints: props.devServerHints ? [...props.devServerHints] : undefined,
        modelPreference:
          modelPref ? { configId: modelPref.configId, value: modelPref.value } : undefined,
      },
      agentBackend,
      onUpdate: setExecutedPlan,
      onConfigOptions: (configOptions) => {
        const previous = atomGet(agentConfigOptionsAtom);
        atomSet(agentConfigOptionsAtom, {
          ...previous,
          [agentBackend]: [...configOptions],
        });
      },
    });

    promise.then((exit) => {
      setIsExecuting(false);
      if (Exit.isSuccess(exit)) {
        const result = exit.value as ExecutionResult;
        navigation.setScreen(Screen.Results({ report: result.report, videoUrl: result.videoUrl }));
      } else {
        const prettyError = String(exit.cause);
        setExecutionError(prettyError);
      }
    });

    onCleanup(() => {
      atomSet(executeFn, Atom.Interrupt);
    });
  });

  createEffect(() => {
    const started = runStartedAt();
    if (started === undefined) return;
    if (!isExecuting()) return;

    const interval = setInterval(() => {
      setElapsedTimeMs(Date.now() - started);
    }, TESTING_TIMER_UPDATE_INTERVAL_MS);

    onCleanup(() => clearInterval(interval));
  });

  const goToMain = () => {
    navigation.setScreen(Screen.Main());
  };

  useKeyboard((event) => {
    if (showCancelConfirmation()) {
      if (event.name === "return" || event.name === "y") {
        setShowCancelConfirmation(false);
        goToMain();
        return;
      }
      if (event.name === "escape" || event.name === "n") {
        setShowCancelConfirmation(false);
        return;
      }
      return;
    }

    if (event.name === "escape") {
      if (executionError()) {
        goToMain();
        return;
      }
      if (isExecuting()) {
        setShowCancelConfirmation(true);
        return;
      }
      goToMain();
    }
  });

  const planningToolCalls = () => {
    const plan = executedPlan();
    if (!plan) return [];
    return getPlanningToolCalls(plan.events);
  };

  const activeStepToolCalls = () => {
    const plan = executedPlan();
    if (!plan) return [];
    return getActiveStepToolCalls(plan.events);
  };

  return (
    <box flexDirection="column" width="100%" paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
      <box>
        <Logo />
        <text>
          <span style={{ fg: COLORS.DIM }}>{` ${POINTER} `}</span>
          <span style={{ fg: COLORS.TEXT }}>{props.instruction}</span>
        </text>
      </box>

      {/* Planning phase — no steps yet */}
      <Show when={totalCount() === 0 && isExecuting()}>
        <box flexDirection="column" marginTop={1}>
          <box>
            <Spinner />
            <text style={{ fg: COLORS.SHIMMER_HIGHLIGHT }}>
              {` Starting${ELLIPSIS} ${elapsedTimeLabel()}`}
            </text>
          </box>
          <For each={planningToolCalls()}>
            {(display) => <ToolCallRow display={display} indent="  " />}
          </For>
        </box>
      </Show>

      {/* Step list */}
      <Show when={totalCount() > 0}>
        <box flexDirection="column" marginTop={1}>
          <For each={executedPlan()?.steps ?? []}>
            {(step, stepIndex) => (
              <StepRow
                step={step}
                stepIndex={stepIndex()}
                elapsedTimeLabel={elapsedTimeLabel()}
                toolCalls={step.status === "active" ? activeStepToolCalls() : []}
              />
            )}
          </For>
        </box>
      </Show>

      {/* Cancel confirmation */}
      <Show when={showCancelConfirmation()}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.YELLOW }}>
            {"Stop run? "}
            <span style={{ fg: COLORS.PRIMARY }}>enter</span>
            {" to stop, "}
            <span style={{ fg: COLORS.PRIMARY }}>esc</span>
            {" to dismiss"}
          </text>
        </box>
      </Show>

      {/* Error display */}
      <Show when={executionError()}>
        <box flexDirection="column" marginTop={1}>
          <text style={{ fg: COLORS.RED }}>
            {`${CROSS} Execution failed`}
          </text>
          <text style={{ fg: COLORS.DIM }}>
            {executionError()}
          </text>
          <text style={{ fg: COLORS.DIM }}>
            {"Press esc to go back"}
          </text>
        </box>
      </Show>
    </box>
  );
};

interface StepRowProps {
  readonly step: AnalysisStep;
  readonly stepIndex: number;
  readonly elapsedTimeLabel: string;
  readonly toolCalls: readonly ToolCallDisplay[];
}

const StepRow = (props: StepRowProps) => {
  const num = () => `${props.stepIndex + 1}.`;
  const label = () => {
    const summary = props.step.summary;
    return Option.isSome(summary) ? summary.value : props.step.title;
  };
  const stepElapsedMs = () => getStepElapsedMs(props.step);
  const stepElapsedLabel = () => {
    const ms = stepElapsedMs();
    return ms !== undefined ? formatElapsedTime(ms) : undefined;
  };

  return (
    <box flexDirection="column">
      <Show when={props.step.status === "active"}>
        <box>
          <text style={{ fg: COLORS.DIM }}>{`  ${num()} `}</text>
          <Spinner />
          <text style={{ fg: COLORS.SHIMMER_HIGHLIGHT }}>
            {` ${props.step.title} ${props.elapsedTimeLabel}`}
          </text>
        </box>
        <For each={props.toolCalls}>
          {(display) => <ToolCallRow display={display} indent="     " />}
        </For>
      </Show>

      <Show when={props.step.status === "passed"}>
        <text>
          <span style={{ fg: COLORS.DIM }}>{`  ${num()}`}</span>
          <span style={{ fg: COLORS.GREEN }}>{` ${TICK} ${truncateLabel(label())}`}</span>
          <Show when={stepElapsedLabel()}>
            <span style={{ fg: COLORS.DIM }}>{` ${stepElapsedLabel()}`}</span>
          </Show>
        </text>
      </Show>

      <Show when={props.step.status === "failed"}>
        <text>
          <span style={{ fg: COLORS.DIM }}>{`  ${num()}`}</span>
          <span style={{ fg: COLORS.RED }}>{` ${CROSS} ${truncateLabel(label())}`}</span>
          <Show when={stepElapsedLabel()}>
            <span style={{ fg: COLORS.DIM }}>{` ${stepElapsedLabel()}`}</span>
          </Show>
        </text>
      </Show>

      <Show when={props.step.status === "skipped"}>
        <text>
          <span style={{ fg: COLORS.DIM }}>{`  ${num()}`}</span>
          <span style={{ fg: COLORS.YELLOW }}>{` ${ARROW_RIGHT} ${truncateLabel(label())}`}</span>
          <Show when={stepElapsedLabel()}>
            <span style={{ fg: COLORS.DIM }}>{` ${stepElapsedLabel()}`}</span>
          </Show>
        </text>
      </Show>

      <Show when={props.step.status === "pending"}>
        <text style={{ fg: COLORS.DIM }}>
          {`  ${num()} ${CIRCLE} ${props.step.title}`}
        </text>
      </Show>
    </box>
  );
};

interface ToolCallRowProps {
  readonly display: ToolCallDisplay;
  readonly indent: string;
}

const ToolCallRow = (props: ToolCallRowProps) => {
  const commandPreview = () => formatCommandPreview(props.display.rawInput);
  const argsPreview = () => {
    const cmd = commandPreview();
    return cmd ? formatArgsPreview(props.display.rawInput, cmd) : props.display.tool.args;
  };
  const hasResult = () => props.display.resultText !== undefined;
  const statusGlyph = () => (props.display.resultIsError ? CROSS : TICK);
  const statusColor = () => (props.display.resultIsError ? COLORS.RED : COLORS.GREEN);

  return (
    <box flexDirection="column">
      <text>
        <span style={{ fg: COLORS.DIM }}>{`${props.indent}${PIPE} `}</span>
        <Show when={props.display.isRunning}>
          <Spinner />
        </Show>
        <Show when={hasResult()}>
          <span style={{ fg: statusColor() }}>{statusGlyph()}</span>
        </Show>
        <Show when={!props.display.isRunning && !hasResult()}>
          <span style={{ fg: COLORS.DIM }}>{CIRCLE}</span>
        </Show>
        <span>{" "}</span>
        <span style={{ fg: COLORS.TEXT }}>{props.display.tool.name}</span>
        <Show when={commandPreview()}>
          <span>{`  `}</span>
          <span style={{ fg: COLORS.PRIMARY }}>{commandPreview()}</span>
        </Show>
        <Show when={argsPreview()}>
          <span>{`  `}</span>
          <span style={{ fg: COLORS.TEXT }}>{argsPreview()}</span>
        </Show>
        <Show when={!hasResult() && props.display.progressBytes !== undefined}>
          <span style={{ fg: COLORS.DIM }}>
            {`  ${POINTER} ${formatStreamingBytes(props.display.progressBytes!)} streaming`}
          </span>
        </Show>
        <Show when={hasResult() && props.display.resultTokens !== undefined}>
          <span style={{ fg: COLORS.DIM }}>
            {` ${ARROW_DOWN} ${formatTokenCount(props.display.resultTokens!)} tokens`}
          </span>
        </Show>
      </text>

      <Show when={hasResult() && props.display.resultText}>
        {(_resultText) => {
          const preview = () => formatResultPreview(props.display.resultText!);
          return (
            <Show when={preview()}>
              <text style={{ fg: COLORS.DIM }}>
                {`${props.indent}${PIPE}   ${ARROW_RIGHT} ${preview()}`}
              </text>
            </Show>
          );
        }}
      </Show>
    </box>
  );
};
