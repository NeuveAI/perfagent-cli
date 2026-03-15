import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Spinner } from "../ui/spinner.js";
import { ScreenHeading } from "../ui/screen-heading.js";
import { useColors } from "../theme-context.js";
import { useAppStore } from "../../store.js";
import { formatElapsedTime } from "../../utils/format-elapsed-time.js";
import { TESTING_TIMER_UPDATE_INTERVAL_MS } from "../../constants.js";
import type { TestAction } from "../../utils/browser-agent.js";

const ACTION_LABELS: Record<TestAction, string> = {
  "test-unstaged": "Test current changes",
  "test-branch": "Test entire branch",
  "select-commit": "Test commit",
};

export const PlanningScreen = () => {
  const COLORS = useColors();
  const flowInstruction = useAppStore((state) => state.flowInstruction);
  const testAction = useAppStore((state) => state.testAction);
  const target = useAppStore((state) => state.resolvedTarget);
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, TESTING_TIMER_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [startTime]);

  const fileCount = target?.changedFiles.length ?? 0;
  const commitCount = target?.recentCommits.length ?? 0;
  const diffInfo = target?.diffStats
    ? `+${target.diffStats.additions} -${target.diffStats.deletions}`
    : null;

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <ScreenHeading title={testAction ? ACTION_LABELS[testAction] : "Generating browser plan"} />

      <Box marginTop={1} borderStyle="round" borderColor={COLORS.BORDER} paddingX={2}>
        <Text color={COLORS.DIM}>{flowInstruction}</Text>
      </Box>

      {target ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.DIM}>
            {"  scope     "}
            <Text color={COLORS.TEXT}>{target.displayName}</Text>
          </Text>
          <Text color={COLORS.DIM}>
            {"  files     "}
            <Text color={COLORS.TEXT}>{fileCount} changed</Text>
            {diffInfo ? (
              <Text color={COLORS.DIM}>
                {" ("}
                {diffInfo}
                {")"}
              </Text>
            ) : null}
          </Text>
          {commitCount > 0 ? (
            <Text color={COLORS.DIM}>
              {"  commits   "}
              <Text color={COLORS.TEXT}>{commitCount}</Text>
            </Text>
          ) : null}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Spinner message="Waiting for Claude to generate plan..." />
        <Text color={COLORS.DIM}> {formatElapsedTime(elapsed)}</Text>
      </Box>
    </Box>
  );
};
