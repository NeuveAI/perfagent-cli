import { Box, Text } from "ink";
import { useColors } from "../theme-context";
import { testContextId, type GitState, type TestContext } from "@neuve/shared/models";
import { getContextLabel, getContextDescription } from "../../utils/context-options";
import { CONTEXT_PICKER_VISIBLE_COUNT } from "../../constants";
import figures from "figures";

interface ContextPickerProps {
  readonly options: TestContext[];
  readonly selectedIndex: number;
  readonly isLoading: boolean;
  readonly gitState: GitState | null;
}

const StatusDot = ({ status }: { readonly status?: string | null }) => {
  const COLORS = useColors();
  if (status === "open") return <Text color={COLORS.GREEN}>{figures.bullet} </Text>;
  if (status === "merged") return <Text color={COLORS.PURPLE}>{figures.bullet} </Text>;
  if (status === "draft") return <Text color={COLORS.DIM}>{figures.bullet} </Text>;
  return null;
};

export const ContextPicker = ({
  options,
  selectedIndex,
  isLoading,
  gitState,
}: ContextPickerProps) => {
  const COLORS = useColors();

  const scrollOffset = (() => {
    if (options.length <= CONTEXT_PICKER_VISIBLE_COUNT) return 0;
    const half = Math.floor(CONTEXT_PICKER_VISIBLE_COUNT / 2);
    const maxOffset = options.length - CONTEXT_PICKER_VISIBLE_COUNT;
    return Math.min(maxOffset, Math.max(0, selectedIndex - half));
  })();

  const visibleOptions = options.slice(scrollOffset, scrollOffset + CONTEXT_PICKER_VISIBLE_COUNT);

  if (options.length === 0 && !isLoading) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.DIM}>No matching results</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visibleOptions.map((option, index) => {
        const actualIndex = index + scrollOffset;
        const isSelected = actualIndex === selectedIndex;
        const label = getContextLabel(option, gitState);
        const description = getContextDescription(option, gitState);
        const prNumber =
          option._tag === "PullRequest" || option._tag === "Branch" ? option.branch.prNumber : null;
        const prStatus =
          option._tag === "PullRequest" || option._tag === "Branch" ? option.branch.prStatus : null;

        return (
          <Text key={testContextId(option)} wrap="truncate">
            <Text color={isSelected ? COLORS.PRIMARY : COLORS.DIM}>
              {isSelected ? `${figures.pointer} ` : "  "}
            </Text>
            {option._tag === "WorkingTree" && <Text color={COLORS.GREEN}>{figures.bullet} </Text>}
            {prStatus && <StatusDot status={prStatus} />}
            <Text color={isSelected ? COLORS.PRIMARY : COLORS.TEXT} bold={isSelected}>
              {label}
            </Text>
            {prNumber && (
              <Text>
                {" "}
                <Text
                  color={
                    prStatus === "open"
                      ? COLORS.GREEN
                      : prStatus === "merged"
                        ? COLORS.PURPLE
                        : COLORS.DIM
                  }
                >
                  #{prNumber}
                </Text>
                {prStatus && <Text color={COLORS.DIM}> {prStatus}</Text>}
              </Text>
            )}
            {description && !prNumber && <Text color={COLORS.DIM}> {description}</Text>}
          </Text>
        );
      })}
      {isLoading && (
        <Box>
          <Text color={COLORS.DIM}> Loading PRs and branches{figures.ellipsis}</Text>
        </Box>
      )}
      {options.length > CONTEXT_PICKER_VISIBLE_COUNT && (
        <Box>
          <Text color={COLORS.DIM}>
            {"  "}
            {options.length - CONTEXT_PICKER_VISIBLE_COUNT} more {figures.arrowUp}/
            {figures.arrowDown}
          </Text>
        </Box>
      )}
    </Box>
  );
};
