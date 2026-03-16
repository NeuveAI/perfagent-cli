import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useInput } from "ink";
import figures from "figures";
import { executeBrowserFlow, type BrowserRunEvent } from "@browser-tester/supervisor";
import {
  LIVE_VIEW_READY_POLL_INTERVAL_MS,
  PROGRESS_BAR_WIDTH,
  TESTING_TIMER_UPDATE_INTERVAL_MS,
  TESTING_TOOL_TEXT_CHAR_LIMIT,
} from "../../constants.js";
import { useColors } from "../theme-context.js";
import { RuledBox } from "../ui/ruled-box.js";
import { Spinner } from "../ui/spinner.js";
import { TextShimmer } from "../ui/text-shimmer.js";
import { useAppStore } from "../../store.js";
import { ScreenHeading } from "../ui/screen-heading.js";
import cliTruncate from "cli-truncate";
import { formatElapsedTime } from "../../utils/format-elapsed-time.js";
import { extractScreenshotPath } from "../../utils/extract-screenshot-path.js";
import { Image } from "../ui/image.js";
import { FileLink } from "../ui/file-link.js";
import { ErrorMessage } from "../ui/error-message.js";
import { deriveTestingState } from "../../utils/derive-testing-state.js";
import { openUrl } from "../../utils/open-url.js";
import { saveTestedFingerprint } from "../../utils/tested-state.js";

const TOOL_CALL_DISPLAY_MODE_COMPACT = "compact";
const TOOL_CALL_DISPLAY_MODE_DETAILED = "detailed";
const TOOL_CALL_DISPLAY_MODE_HIDDEN = "hidden";
const TRACE_DISPLAY_SHORTCUT_KEY = "v";
const LIVE_VIEW_SHORTCUT_KEY = "o";

const getNextToolCallDisplayMode = (toolCallDisplayMode: string): string => {
  switch (toolCallDisplayMode) {
    case TOOL_CALL_DISPLAY_MODE_COMPACT:
      return TOOL_CALL_DISPLAY_MODE_DETAILED;
    case TOOL_CALL_DISPLAY_MODE_DETAILED:
      return TOOL_CALL_DISPLAY_MODE_HIDDEN;
    default:
      return TOOL_CALL_DISPLAY_MODE_COMPACT;
  }
};

export const TestingScreen = () => {
  const target = useAppStore((state) => state.resolvedTarget);
  const plan = useAppStore((state) => state.generatedPlan);
  const environment = useAppStore((state) => state.browserEnvironment);
  const completeTestingRun = useAppStore((state) => state.completeTestingRun);
  const exitTesting = useAppStore((state) => state.exitTesting);
  const liveViewUrl = useAppStore((state) => state.liveViewUrl);
  const setLiveViewUrl = useAppStore((state) => state.setLiveViewUrl);
  const COLORS = useColors();
  const [events, setEvents] = useState<BrowserRunEvent[]>([]);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [screenshotPaths, setScreenshotPaths] = useState<string[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const [toolCallDisplayMode, setToolCallDisplayMode] = useState(TOOL_CALL_DISPLAY_MODE_COMPACT);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [exitRequested, setExitRequested] = useState(false);
  const [pendingLiveViewUrl, setPendingLiveViewUrl] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const derivedState = useMemo(
    () => (plan ? deriveTestingState(plan, events, toolCallDisplayMode, running) : null),
    [plan, events, toolCallDisplayMode, running],
  );

  const elapsedTimeLabel = useMemo(() => formatElapsedTime(elapsedTimeMs), [elapsedTimeMs]);

  useEffect(() => {
    if (!exitRequested || running) return;
    exitTesting();
  }, [exitRequested, exitTesting, running]);

  useEffect(() => {
    if (!running || runStartedAt === null) return;

    setElapsedTimeMs(Date.now() - runStartedAt);

    const interval = setInterval(() => {
      setElapsedTimeMs(Date.now() - runStartedAt);
    }, TESTING_TIMER_UPDATE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [runStartedAt, running]);

  useEffect(() => {
    if (!pendingLiveViewUrl) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(pendingLiveViewUrl);
        if (response.ok && !cancelled) {
          setLiveViewUrl(pendingLiveViewUrl);
          clearInterval(interval);
        }
      } catch {
        // HACK: server not ready yet, keep polling
      }
    }, LIVE_VIEW_READY_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pendingLiveViewUrl, setLiveViewUrl]);

  useEffect(() => {
    if (!target || !plan || !environment) return;

    const abortController = new AbortController();
    const startedAt = Date.now();
    abortControllerRef.current = abortController;
    setEvents([]);
    setRunning(true);
    setError(null);
    setVideoPath(null);
    setScreenshotPaths([]);
    setRunStartedAt(startedAt);
    setElapsedTimeMs(0);
    setShowCancelConfirmation(false);
    setExitRequested(false);

    const run = async () => {
      try {
        for await (const event of executeBrowserFlow({
          target,
          plan,
          environment,
          signal: abortController.signal,
        })) {
          if (event.type === "run-started" && event.liveViewUrl) {
            setPendingLiveViewUrl(event.liveViewUrl);
          }
          if (event.type === "run-completed") {
            setVideoPath(event.report?.artifacts.rawVideoPath ?? event.videoPath ?? null);
            if (event.report) {
              if (event.report.status === "passed") {
                saveTestedFingerprint();
              }
              completeTestingRun(event.report);
            }
          }
          if (event.type === "tool-result") {
            const screenshotPath = extractScreenshotPath(event);
            if (screenshotPath) {
              setScreenshotPaths((previous) => [...previous, screenshotPath]);
            }
          }
          setEvents((previous) => [...previous, event]);
          if (abortController.signal.aborted) {
            break;
          }
        }
      } catch (caughtError) {
        if (!(caughtError instanceof DOMException && caughtError.name === "AbortError")) {
          const errorMessage = caughtError instanceof Error ? caughtError.message : "Unknown error";
          setError(errorMessage);
        }
      } finally {
        setShowCancelConfirmation(false);
        setRunning(false);
      }
    };

    run();

    return () => {
      abortController.abort();
    };
  }, [completeTestingRun, environment, plan, setLiveViewUrl, target]);

  useInput((input, key) => {
    const normalizedInput = input.toLowerCase();

    if (exitRequested) {
      return;
    }

    if (showCancelConfirmation) {
      if (key.return || normalizedInput === "y") {
        setShowCancelConfirmation(false);
        setExitRequested(true);
        abortControllerRef.current?.abort();
        return;
      }

      if (key.escape || normalizedInput === "n") {
        setShowCancelConfirmation(false);
      }

      return;
    }

    if (normalizedInput === LIVE_VIEW_SHORTCUT_KEY && liveViewUrl) {
      openUrl(liveViewUrl);
      return;
    }

    if (input === TRACE_DISPLAY_SHORTCUT_KEY) {
      setToolCallDisplayMode((previous) => getNextToolCallDisplayMode(previous));
      return;
    }

    if (key.escape) {
      if (running) {
        setShowCancelConfirmation(true);
        return;
      }

      exitTesting();
    }
  });

  if (!target || !plan || !environment || !derivedState) return null;

  const { steps, currentToolCallText, activeStepStartedAt, completedCount, totalCount } =
    derivedState;
  const stepElapsedLabel =
    activeStepStartedAt !== null ? formatElapsedTime(Date.now() - activeStepStartedAt) : null;
  const filledWidth =
    totalCount > 0 ? Math.round((completedCount / totalCount) * PROGRESS_BAR_WIDTH) : 0;
  const emptyWidth = PROGRESS_BAR_WIDTH - filledWidth;

  return (
    <>
      <Static items={screenshotPaths}>
        {(screenshotPath) => (
          <Box key={screenshotPath} paddingX={1}>
            <Image src={screenshotPath} alt={screenshotPath} />
          </Box>
        )}
      </Static>
      <Box flexDirection="column" width="100%" paddingY={1}>
        <Box paddingX={1}>
          <ScreenHeading
            title="Executing browser plan"
            subtitle={`${plan.title} │ ${target.displayName}`}
          />
        </Box>

        <Box marginTop={1} paddingX={1}>
          <Text>
            <Text color={COLORS.PRIMARY}>{"━".repeat(filledWidth)}</Text>
            <Text color={COLORS.BORDER}>{"─".repeat(emptyWidth)}</Text>
          </Text>
          <Text color={COLORS.DIM}>
            {`  ${completedCount}/${totalCount}`}
            {running ? ` ${figures.pointerSmall} ${elapsedTimeLabel}` : ""}
          </Text>
        </Box>

        <Box flexDirection="column" marginTop={1} paddingX={1}>
          {steps.map((step, stepIndex) => {
            const stepPrefix = `Step ${stepIndex + 1}`;
            return (
              <Box key={step.stepId} flexDirection="column">
                {step.status === "passed" ? (
                  <Text color={COLORS.GREEN}>
                    {`  ${figures.tick} ${stepPrefix} ${cliTruncate(step.label, TESTING_TOOL_TEXT_CHAR_LIMIT)}`}
                  </Text>
                ) : step.status === "failed" ? (
                  <Text color={COLORS.RED}>
                    {`  ${figures.cross} ${stepPrefix} ${cliTruncate(step.label, TESTING_TOOL_TEXT_CHAR_LIMIT)}`}
                  </Text>
                ) : step.status === "active" ? (
                  <>
                    <Box>
                      <Text>{"  "}</Text>
                      <Spinner />
                      <Text> </Text>
                      <TextShimmer
                        text={`${stepPrefix} ${step.label}${stepElapsedLabel ? ` ${stepElapsedLabel}` : ""}`}
                        baseColor={COLORS.SELECTION}
                        highlightColor={COLORS.PRIMARY}
                      />
                    </Box>
                    {currentToolCallText ? (
                      <Text color={COLORS.DIM}>
                        {`    ${figures.pointerSmall} ${currentToolCallText}`}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text color={COLORS.DIM}>{`  ○ ${stepPrefix} ${step.label}`}</Text>
                )}
              </Box>
            );
          })}
        </Box>

        {showCancelConfirmation ? (
          <RuledBox color={COLORS.YELLOW} marginTop={1}>
            <Text color={COLORS.YELLOW} bold>
              Stop this browser run?
            </Text>
            <Text color={COLORS.DIM}>This will terminate the agent and close the browser.</Text>
            <Text color={COLORS.DIM}>
              Press <Text color={COLORS.PRIMARY}>Enter</Text> or{" "}
              <Text color={COLORS.PRIMARY}>y</Text> to stop, or{" "}
              <Text color={COLORS.PRIMARY}>Esc</Text> or <Text color={COLORS.PRIMARY}>n</Text> to
              keep it running.
            </Text>
          </RuledBox>
        ) : null}

        {running && !showCancelConfirmation ? (
          <Box marginTop={1} paddingX={1}>
            <TextShimmer
              text={`${exitRequested ? "Stopping" : "Testing"}${figures.ellipsis} ${elapsedTimeLabel}`}
              baseColor={COLORS.DIM}
              highlightColor={COLORS.PRIMARY}
            />
          </Box>
        ) : null}

        {!running && !error ? (
          <Box marginTop={1} flexDirection="column" paddingX={1}>
            <Text color={COLORS.GREEN} bold>
              Done
            </Text>
            {videoPath ? (
              <Text color={COLORS.DIM}>
                Video saved to <FileLink path={videoPath} />
              </Text>
            ) : null}
          </Box>
        ) : null}

        <Box paddingX={1}>
          <ErrorMessage message={error ? `Error: ${error}` : null} />
        </Box>
      </Box>
    </>
  );
};
