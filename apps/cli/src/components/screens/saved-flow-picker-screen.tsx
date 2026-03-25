import { Box, Text, useInput } from "ink";
import { Option } from "effect";
import figures from "figures";
import cliTruncate from "cli-truncate";
import { ChangesFor, TestPlan, TestPlanStep, type SavedFlowFileData } from "@expect/supervisor";
import { PlanId, StepId } from "@expect/shared/models";
import { useNavigationStore, Screen } from "../../stores/use-navigation";
import { usePlanStore, Plan } from "../../stores/use-plan-store";
import { useColors } from "../theme-context";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions";
import { useScrollableList } from "../../hooks/use-scrollable-list";
import { useSavedFlows } from "../../hooks/use-saved-flows";
import { useGitState } from "../../hooks/use-git-state";
import { ScreenHeading } from "../ui/screen-heading";
import { Spinner } from "../ui/spinner";
import { Clickable } from "../ui/clickable";
import { visualPadEnd } from "../../utils/visual-pad-end";

const SAVED_FLOW_VISIBLE_COUNT = 15;

const selectFlow = (flow: SavedFlowFileData, mainBranch: string) => {
  const changesFor = ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch });

  const testPlan = new TestPlan({
    id: PlanId.makeUnsafe(crypto.randomUUID()),
    changesFor,
    currentBranch: "",
    diffPreview: "",
    fileStats: [],
    instruction: flow.flow.userInstruction,
    baseUrl: flow.environment.baseUrl ? Option.some(flow.environment.baseUrl) : Option.none(),
    isHeadless: true,
    requiresCookies: flow.environment.cookies,
    title: flow.flow.title,
    rationale: flow.description,
    steps: flow.flow.steps.map(
      (step) =>
        new TestPlanStep({
          id: StepId.makeUnsafe(step.id),
          title: step.title,
          instruction: step.instruction,
          expectedOutcome: step.expectedOutcome,
          routeHint: Option.none(),
          status: "pending",
          summary: Option.none(),
          startedAt: Option.none(),
          endedAt: Option.none(),
        }),
    ),
  });

  usePlanStore.getState().setPlan(Plan.plan(testPlan));
  useNavigationStore.getState().setScreen(
    Screen.Testing({
      changesFor,
      instruction: flow.flow.userInstruction,
      existingPlan: testPlan,
    }),
  );
};

export const SavedFlowPickerScreen = () => {
  const COLORS = useColors();
  const [columns] = useStdoutDimensions();
  const setScreen = useNavigationStore((state) => state.setScreen);
  const { data: gitState } = useGitState();
  const { data: savedFlows = [], isLoading } = useSavedFlows();

  const { highlightedIndex, setHighlightedIndex, scrollOffset, handleNavigation } =
    useScrollableList({
      itemCount: savedFlows.length,
      visibleCount: SAVED_FLOW_VISIBLE_COUNT,
    });

  const titleColumnWidth = Math.min(40, Math.floor(columns * 0.35));
  const descriptionColumnWidth = Math.max(20, columns - titleColumnWidth - 8);

  const visibleItems = savedFlows.slice(scrollOffset, scrollOffset + SAVED_FLOW_VISIBLE_COUNT);

  useInput((input, key) => {
    if (handleNavigation(input, key)) return;

    if (key.return) {
      const selected = savedFlows[highlightedIndex];
      if (selected) {
        const mainBranch = gitState?.mainBranch ?? "main";
        selectFlow(selected, mainBranch);
      }
    }

    if (key.escape) {
      setScreen(Screen.Main());
    }
  });

  return (
    <Box flexDirection="column" width="100%" paddingY={1}>
      <Box paddingX={1}>
        <ScreenHeading
          title="Saved flows"
          subtitle={`${savedFlows.length} flow${savedFlows.length === 1 ? "" : "s"}`}
        />
      </Box>

      {isLoading && (
        <Box marginTop={1} paddingX={1}>
          <Spinner message="Loading saved flows..." />
        </Box>
      )}

      {!isLoading && savedFlows.length === 0 && (
        <Box marginTop={1} paddingX={1} flexDirection="column">
          <Text color={COLORS.DIM}>
            No saved flows yet. Run a test and press <Text color={COLORS.PRIMARY}>s</Text> on the
            results screen to save a flow.
          </Text>
        </Box>
      )}

      {!isLoading && savedFlows.length > 0 && (
        <Box
          marginTop={1}
          flexDirection="column"
          height={SAVED_FLOW_VISIBLE_COUNT}
          overflow="hidden"
          paddingX={1}
        >
          {visibleItems.map((flow, index) => {
            const actualIndex = index + scrollOffset;
            const isSelected = actualIndex === highlightedIndex;
            const stepCount = flow.flow.steps.length;

            return (
              <Clickable
                key={flow.slug}
                onClick={() => {
                  setHighlightedIndex(actualIndex);
                  const mainBranch = gitState?.mainBranch ?? "main";
                  selectFlow(flow, mainBranch);
                }}
              >
                <Text color={isSelected ? COLORS.PRIMARY : COLORS.DIM}>
                  {isSelected ? `${figures.pointer} ` : "  "}
                </Text>
                <Text color={isSelected ? COLORS.PRIMARY : COLORS.TEXT} bold={isSelected}>
                  {visualPadEnd(cliTruncate(flow.title, titleColumnWidth - 1), titleColumnWidth)}
                </Text>
                <Text color={COLORS.DIM}>
                  {visualPadEnd(`${stepCount} step${stepCount === 1 ? "" : "s"}`, 10)}
                </Text>
                <Text color={COLORS.DIM}>
                  {cliTruncate(flow.description, descriptionColumnWidth)}
                </Text>
              </Clickable>
            );
          })}
        </Box>
      )}
    </Box>
  );
};
