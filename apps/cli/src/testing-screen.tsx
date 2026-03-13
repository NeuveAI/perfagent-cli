import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type {
  BrowserEnvironmentHints,
  BrowserFlowPlan,
  BrowserRunEvent,
  TestTarget,
} from "@browser-tester/orchestrator";
import { TESTING_TOOL_TEXT_CHAR_LIMIT, TESTING_VISIBLE_LOG_COUNT } from "./constants.js";
import { useColors, type Colors } from "./theme-context.js";
import { Spinner } from "./spinner.js";
import { executeApprovedPlan } from "./utils/browser-agent.js";

interface TestingScreenProps {
  target: TestTarget;
  plan: BrowserFlowPlan;
  environment: BrowserEnvironmentHints;
  onExit: () => void;
}

interface TestingLine {
  text: string;
  color: string;
}

const BROWSER_TOOL_PREFIX = "mcp__browser__";

const truncateText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;

const parseToolInput = (input: string): Record<string, unknown> | null => {
  try {
    const parsedValue = JSON.parse(input);
    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) return null;
    return parsedValue;
  } catch {
    return null;
  }
};

const readString = (input: Record<string, unknown> | null, key: string): string | null => {
  const value = input?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const readNumber = (input: Record<string, unknown> | null, key: string): number | null => {
  const value = input?.[key];
  return typeof value === "number" ? value : null;
};

const readPathOrUrl = (input: Record<string, unknown> | null, key: string): string | null => {
  const value = readString(input, key);
  if (!value) return null;

  try {
    const parsedUrl = new URL(value);
    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}` || parsedUrl.origin;
  } catch {
    return value;
  }
};

const formatBrowserToolCall = (toolName: string, input: string): string | null => {
  if (!toolName.startsWith(BROWSER_TOOL_PREFIX)) return null;

  const action = toolName.slice(BROWSER_TOOL_PREFIX.length);
  const parsedInput = parseToolInput(input);

  switch (action) {
    case "open":
      return `Open ${readPathOrUrl(parsedInput, "url") ?? "page"}`;
    case "attach":
      return "Attach live Chrome tab";
    case "list_pages":
      return "List open tabs";
    case "select_page":
      return `Select tab ${readNumber(parsedInput, "pageId") ?? ""}`.trim();
    case "new_page":
      return `Open ${readPathOrUrl(parsedInput, "url") ?? "new tab"}`;
    case "navigate_page":
      return `Navigate ${readPathOrUrl(parsedInput, "url") ?? readString(parsedInput, "type") ?? "page"}`;
    case "snapshot":
      return "Capture page snapshot";
    case "take_snapshot":
      return "Capture page snapshot";
    case "click":
      return `Click ${readString(parsedInput, "ref") ?? "element"}`;
    case "fill":
      return `Fill ${readString(parsedInput, "ref") ?? "input"}`;
    case "type":
      return `Type into ${readString(parsedInput, "ref") ?? "input"}`;
    case "type_text":
      return "Type text";
    case "select":
      return `Select ${truncateText(readString(parsedInput, "value") ?? "option", 24)}`;
    case "hover":
      return `Hover ${readString(parsedInput, "ref") ?? "element"}`;
    case "wait": {
      const selector = readString(parsedInput, "selector");
      const url = readPathOrUrl(parsedInput, "url");
      const timeout = readNumber(parsedInput, "timeout");
      const loadState = readString(parsedInput, "loadState");
      if (selector) return `Wait for ${selector}`;
      if (url) return `Wait for ${url}`;
      if (loadState) return `Wait for ${loadState}`;
      if (timeout !== null) return `Wait ${timeout}ms`;
      return "Wait";
    }
    case "read_console_messages":
    case "list_console_messages":
      return "Inspect console";
    case "read_network_requests":
    case "list_network_requests":
      return "Inspect network";
    case "get_page_text":
      return "Read page text";
    case "javascript":
    case "evaluate_script":
      return "Run browser script";
    case "navigate":
      return `Navigate ${readString(parsedInput, "action") ?? ""}`.trim();
    case "scroll":
      return `Scroll ${readString(parsedInput, "direction") ?? "page"}`;
    case "press_key":
      return `Press ${readString(parsedInput, "key") ?? "key"}`;
    case "screenshot":
    case "take_screenshot":
      return "Take screenshot";
    case "annotated_screenshot":
      return "Take annotated screenshot";
    case "save_video":
      return "Save browser video";
    case "close":
      return "Close browser";
    case "close_page":
      return `Close tab ${readNumber(parsedInput, "pageId") ?? ""}`.trim();
    default:
      return truncateText(action.replaceAll("_", " "), TESTING_TOOL_TEXT_CHAR_LIMIT);
  }
};

const shouldShowToolResult = (event: Extract<BrowserRunEvent, { type: "tool-result" }>): boolean =>
  event.isError ||
  event.toolName === `${BROWSER_TOOL_PREFIX}save_video` ||
  event.toolName === `${BROWSER_TOOL_PREFIX}close`;

const formatRunEvent = (event: BrowserRunEvent, colors: Colors): TestingLine | null => {
  switch (event.type) {
    case "run-started":
      return {
        text: `Starting ${event.planTitle}`,
        color: colors.PURPLE,
      };
    case "step-started":
      return {
        text: `→ ${event.stepId} ${event.title}`,
        color: colors.SELECTION,
      };
    case "step-completed":
      return {
        text: `✓ ${event.stepId} ${truncateText(event.summary, TESTING_TOOL_TEXT_CHAR_LIMIT)}`,
        color: colors.GREEN,
      };
    case "assertion-failed":
      return {
        text: `✗ ${event.stepId} ${truncateText(event.message, TESTING_TOOL_TEXT_CHAR_LIMIT)}`,
        color: colors.RED,
      };
    case "tool-call": {
      const toolCallText = formatBrowserToolCall(event.toolName, event.input);
      if (!toolCallText) return null;
      return {
        text: `• ${toolCallText}`,
        color: colors.DIM,
      };
    }
    case "tool-result":
      if (!shouldShowToolResult(event)) return null;
      return {
        text: truncateText(event.result, TESTING_TOOL_TEXT_CHAR_LIMIT),
        color: event.isError ? colors.RED : colors.DIM,
      };
    case "browser-log":
    case "text":
    case "thinking":
      return null;
    case "error":
      return {
        text: `Error: ${truncateText(event.message, TESTING_TOOL_TEXT_CHAR_LIMIT)}`,
        color: colors.RED,
      };
    case "run-completed":
      return {
        text: `Run ${event.status}: ${truncateText(event.summary, TESTING_TOOL_TEXT_CHAR_LIMIT)}`,
        color: event.status === "passed" ? colors.GREEN : colors.RED,
      };
    default:
      return null;
  }
};

export const TestingScreen = ({ target, plan, environment, onExit }: TestingScreenProps) => {
  const COLORS = useColors();
  const colorsRef = useRef(COLORS);
  colorsRef.current = COLORS;
  const [lines, setLines] = useState<TestingLine[]>([]);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const visibleLines = useMemo(() => lines.slice(-TESTING_VISIBLE_LOG_COUNT), [lines]);

  useEffect(() => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const run = async () => {
      try {
        for await (const event of executeApprovedPlan({
          target,
          plan,
          environment,
          signal: abortController.signal,
        })) {
          if (event.type === "run-completed") {
            setVideoPath(event.videoPath ?? null);
            setCurrentStep(null);
          }
          if (event.type === "step-started") {
            setCurrentStep(`${event.stepId} ${event.title}`);
          }
          const line = formatRunEvent(event, colorsRef.current);
          if (line) {
            setLines((previous) => [...previous, line]);
          }
          if (abortController.signal.aborted) {
            break;
          }
        }
      } catch (caughtError) {
        if (caughtError instanceof DOMException && caughtError.name === "AbortError") {
          setLines((previous) => [
            ...previous,
            { text: "Cancelled.", color: colorsRef.current.YELLOW },
          ]);
        } else {
          const errorMessage = caughtError instanceof Error ? caughtError.message : "Unknown error";
          setError(errorMessage);
        }
      } finally {
        setRunning(false);
      }
    };

    run();

    return () => {
      abortController.abort();
    };
  }, [environment, plan, target]);

  useInput((_input, key) => {
    if (key.escape) {
      abortControllerRef.current?.abort();
      onExit();
    }
  });

  return (
    <Box flexDirection="column" width="100%" paddingX={2} paddingY={1}>
      <Text bold color={COLORS.TEXT}>
        Executing browser plan
      </Text>
      <Text color={COLORS.DIM}>{plan.title}</Text>
      <Text color={COLORS.DIM}>{target.displayName}</Text>

      <Box
        marginTop={1}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={COLORS.DIVIDER}
      />

      <Box flexDirection="column" marginTop={1}>
        <Text color={currentStep ? COLORS.SELECTION : COLORS.DIM}>
          {currentStep ? `Current step: ${currentStep}` : "Waiting for first step..."}
        </Text>
        <Text color={COLORS.DIM}>Browser actions are summarized below to reduce agent noise.</Text>
      </Box>

      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={COLORS.BORDER}
        paddingX={1}
      >
        {visibleLines.map((line, index) => (
          <Text key={`${index}-${line.text}`} color={line.color}>
            {line.text}
          </Text>
        ))}
        {visibleLines.length === 0 ? <Text color={COLORS.DIM}>No activity yet.</Text> : null}
      </Box>

      {running && (
        <Box marginTop={1}>
          <Spinner message="Agent is working..." />
        </Box>
      )}

      {!running && !error && (
        <Box marginTop={1}>
          <Box flexDirection="column">
            <Text color={COLORS.GREEN} bold>
              Done
            </Text>
            {videoPath ? <Text color={COLORS.DIM}>Video saved to {videoPath}</Text> : null}
          </Box>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={COLORS.RED}>Error: {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>Esc to {running ? "cancel" : "go back"}</Text>
      </Box>
    </Box>
  );
};
