import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import figures from "figures";
import { SAVED_FLOW_PICKER_VISIBLE_COUNT } from "../../constants.js";
import { useColors } from "../../theme-context.js";
import { useAppStore } from "../../store.js";
import { loadSavedFlow } from "../../utils/load-saved-flow.js";
import { ScreenHeading } from "../ui/screen-heading.js";
import { ErrorMessage } from "../ui/error-message.js";
import { Clickable } from "../ui/clickable.js";

const ACTION_LABELS = {
  "test-unstaged": "Test unstaged changes",
  "test-branch": "Test entire branch",
  "select-commit": "Select a commit to test",
};

export const SavedFlowPickerScreen = () => {
  const COLORS = useColors();
  const testAction = useAppStore((state) => state.testAction);
  const savedFlowSummaries = useAppStore((state) => state.savedFlowSummaries);
  const applySavedFlow = useAppStore((state) => state.applySavedFlow);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const scrollOffset = useMemo(() => {
    if (savedFlowSummaries.length <= SAVED_FLOW_PICKER_VISIBLE_COUNT) return 0;
    const half = Math.floor(SAVED_FLOW_PICKER_VISIBLE_COUNT / 2);
    const maxOffset =
      savedFlowSummaries.length - SAVED_FLOW_PICKER_VISIBLE_COUNT;
    return Math.min(maxOffset, Math.max(0, selectedIndex - half));
  }, [savedFlowSummaries.length, selectedIndex]);

  const visibleSavedFlows = savedFlowSummaries.slice(
    scrollOffset,
    scrollOffset + SAVED_FLOW_PICKER_VISIBLE_COUNT
  );

  const selectFlow = (index: number) => {
    if (loadingFilePath) return;
    const flow = savedFlowSummaries[index];
    if (!flow) return;

    setSelectedIndex(index);
    setLoadingError(null);
    setLoadingFilePath(flow.filePath);

    void loadSavedFlow(flow.filePath)
      .then((loaded) => applySavedFlow(loaded))
      .catch((caughtError) => {
        setLoadingError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load flow."
        );
        setLoadingFilePath(null);
      });
  };

  useInput((input, key) => {
    if (loadingFilePath) return;
    if (savedFlowSummaries.length === 0) return;

    if (key.downArrow || input === "j" || (key.ctrl && input === "n")) {
      setSelectedIndex((previous) =>
        Math.min(savedFlowSummaries.length - 1, previous + 1)
      );
    }

    if (key.upArrow || input === "k" || (key.ctrl && input === "p")) {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
    }

    if (key.return) selectFlow(selectedIndex);
  });

  if (!testAction) return null;

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <ScreenHeading
        title="Reuse saved flow"
        subtitle={ACTION_LABELS[testAction]}
      />

      <Box
        flexDirection="column"
        marginTop={1}
        height={SAVED_FLOW_PICKER_VISIBLE_COUNT}
        overflow="hidden"
      >
        {visibleSavedFlows.map((savedFlow, index) => {
          const actualIndex = index + scrollOffset;
          const isSelected = actualIndex === selectedIndex;
          const isLoading = loadingFilePath === savedFlow.filePath;

          return (
            <Clickable
              key={savedFlow.filePath}
              onClick={() => selectFlow(actualIndex)}
            >
              <Box flexDirection="column" marginBottom={1}>
                <Text>
                  <Text color={isSelected ? COLORS.PRIMARY : COLORS.DIM}>
                    {isSelected ? `${figures.pointer} ` : "  "}
                  </Text>
                  {isSelected ? (
                    <Text color={COLORS.PRIMARY} bold>
                      {savedFlow.title}
                      {isLoading ? " (loading...)" : ""}
                    </Text>
                  ) : (
                    <Text color={COLORS.TEXT}>
                      {savedFlow.title}
                      {isLoading ? " (loading...)" : ""}
                    </Text>
                  )}
                </Text>
                <Text color={COLORS.DIM}>
                  {"  "}
                  {savedFlow.description}
                  {savedFlow.savedTargetDisplayName
                    ? ` · saved for ${savedFlow.savedTargetDisplayName}`
                    : ""}
                </Text>
              </Box>
            </Clickable>
          );
        })}
        {savedFlowSummaries.length === 0 ? (
          <Text color={COLORS.DIM}>
            No compatible saved flows available yet.
          </Text>
        ) : null}
      </Box>

      <ErrorMessage message={loadingError} />
    </Box>
  );
};
