import { createSignal, createEffect, onCleanup, untrack, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Exit, Option } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import type {
  ChangesFor,
  SavedFlow,
  ExecutedPerfPlan,
  AnalysisStep,
} from "@neuve/shared/models";
import type { DevServerHint } from "@neuve/shared/prompts";
import { executeFn } from "@neuve/perf-agent-cli/data/execution-atom";
import { agentConfigOptionsAtom } from "@neuve/perf-agent-cli/data/config-options";
import { saveSession, updateSession } from "../../data/session-history";
import { useNavigation, Screen } from "../../context/navigation";
import { useAgent } from "../../context/agent";
import { atomFnToPromise, atomSet, atomGet } from "../../adapters/effect-atom";
import { Logo } from "../../renderables/logo";
import { Spinner, SpinnerSpan } from "../../renderables/spinner";
import { formatElapsedTime } from "../../utils/format-elapsed-time";
import { parseExecutionError, type ParsedError } from "../../utils/parse-execution-error";
import { ErrorDisplay } from "../../renderables/error-display";
import { COLORS, TESTING_TIMER_UPDATE_INTERVAL_MS } from "../../constants";
import {
  type ToolCallDisplay,
  formatTokenCount,
  formatStreamingBytes,
  formatCommandPreview,
  formatArgsPreview,
  formatResultPreview,
  truncateLabel,
  getActiveStepToolCalls,
  getPlanningToolCalls,
  getStepElapsedMs,
} from "./testing-helpers";

const TICK = "\u2714";
const CROSS = "\u2718";
const CIRCLE = "\u25CB";
const ARROW_RIGHT = "\u2192";
const POINTER = "\u25B8";
const PIPE = "\u2502";
const ARROW_DOWN = "\u2193";
const ELLIPSIS = "\u2026";

interface TestingScreenProps {
  readonly changesFor: ChangesFor;
  readonly instruction: string;
  readonly savedFlow?: SavedFlow;
  readonly cookieBrowserKeys?: readonly string[];
  readonly baseUrls?: readonly string[];
  readonly devServerHints?: readonly DevServerHint[];
}

export const TestingScreen = (props: TestingScreenProps) => {
  const navigation = useNavigation();
  const agent = useAgent();

  const [executedPlan, setExecutedPlan] = createSignal<ExecutedPerfPlan | undefined>(undefined);
  const [runStartedAt, setRunStartedAt] = createSignal<number | undefined>(undefined);
  const [elapsedTimeMs, setElapsedTimeMs] = createSignal(0);
  const [showCancelConfirmation, setShowCancelConfirmation] = createSignal(false);
  const [isExecuting, setIsExecuting] = createSignal(true);
  const [executionError, setExecutionError] = createSignal<ParsedError | undefined>(undefined);
  const [sessionId, setSessionId] = createSignal<string | undefined>(undefined);

  const elapsedTimeLabel = () => formatElapsedTime(elapsedTimeMs());
  const totalCount = () => executedPlan()?.steps?.length ?? 0;

  createEffect(() => {
    untrack(() => {
      const startTime = Date.now();
      setRunStartedAt(startTime);

      const agentBackend = agent.agentBackend();
      const modelPrefs = agent.modelPreferences();
      const modelPref = modelPrefs[agentBackend];

      try {
        const session = saveSession({
          instruction: props.instruction,
          status: "running",
          agentBackend,
        });
        setSessionId(session.id);
      } catch {}

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
          const result = exit.value;
          const sid = sessionId();
          if (sid) {
            try { updateSession(sid, { status: "completed", reportPath: result.reportPath }); } catch {}
          }
          navigation.setScreen(Screen.Results({ report: result.report, videoUrl: result.videoUrl }));
        } else {
          const parsed = parseExecutionError(exit.cause);
          const sid = sessionId();
          if (sid) {
            try { updateSession(sid, { status: "failed", error: parsed.title + ": " + parsed.message }); } catch {}
          }
          setExecutionError(parsed);
        }
      });
    });

    onCleanup(() => {
      if (isExecuting()) {
        const sid = sessionId();
        if (sid) {
          try { updateSession(sid, { status: "cancelled" }); } catch {}
        }
      }
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

    if (event.name === "r" && executionError()) {
      setExecutionError(undefined);
      setExecutedPlan(undefined);
      setIsExecuting(true);
      setRunStartedAt(undefined);
      setElapsedTimeMs(0);
      navigation.setScreen(Screen.Testing({
        changesFor: props.changesFor,
        instruction: props.instruction,
        savedFlow: props.savedFlow,
        cookieBrowserKeys: props.cookieBrowserKeys ? [...props.cookieBrowserKeys] : undefined,
        baseUrls: props.baseUrls ? [...props.baseUrls] : undefined,
        devServerHints: props.devServerHints ? [...props.devServerHints] : undefined,
      }));
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
      <box flexShrink={0}>
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
        {(error) => (
          <box flexDirection="column" marginTop={1}>
            <ErrorDisplay error={error()} />
            <box marginTop={1}>
              <text style={{ fg: COLORS.DIM }}>
                {"  Press "}
                <span style={{ fg: COLORS.PRIMARY }}>r</span>
                {" to retry, "}
                <span style={{ fg: COLORS.PRIMARY }}>esc</span>
                {" to go back"}
              </text>
            </box>
          </box>
        )}
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
          <SpinnerSpan />
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

      <Show when={props.display.tool.multilineArgs}>
        <For each={props.display.tool.multilineArgs!.split("\n")}>
          {(line) => (
            <text style={{ fg: COLORS.DIM }}>
              {`${props.indent}${PIPE}     `}
              <span style={{ fg: COLORS.TEXT }}>{line}</span>
            </text>
          )}
        </For>
      </Show>

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
