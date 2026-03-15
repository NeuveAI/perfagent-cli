import { useCallback, useEffect, useState } from "react";
import type { DiffStats } from "@browser-tester/supervisor";
import { Box, Text, useInput } from "ink";
import { useAppStore } from "../../store.js";
import type { TestAction } from "../../utils/browser-agent.js";
import { getRecommendedScope, type GitState, type TestScope } from "../../utils/get-git-state.js";
import { useColors } from "../theme-context.js";
import { Clickable } from "../ui/clickable.js";
import { ChangesWarningPanel } from "../ui/changes-warning-panel.js";
import { MenuItem } from "../ui/menu-item.js";

interface ScopeMenuOption {
  label: string;
  detail: string;
  action: TestAction | "select-pr" | "custom-test";
  diffStats?: DiffStats | null;
}

const getDefaultActionForScope = (scope: TestScope): TestAction | null => {
  if (scope === "unstaged-changes") return "test-unstaged";
  if (scope === "entire-branch") return "test-branch";
  return null;
};

const getCustomTestAction = (defaultAction: TestAction | null): TestAction =>
  defaultAction ?? "test-unstaged";

const getSavedFlowAction = (
  action: ScopeMenuOption["action"],
  defaultAction: TestAction | null,
): TestAction | null => {
  if (action === "select-pr") return null;
  if (action === "custom-test") return getCustomTestAction(defaultAction);
  return action;
};

const buildMenuOptions = (scope: TestScope, gitState: GitState): ScopeMenuOption[] => {
  const options: ScopeMenuOption[] = [];

  if (scope === "unstaged-changes") {
    options.push({
      label: "Test current changes",
      detail: "",
      action: "test-unstaged",
      diffStats: gitState.diffStats,
    });
  }

  if (
    scope === "entire-branch" ||
    (scope === "unstaged-changes" && !gitState.isOnMain && gitState.hasBranchCommits)
  ) {
    options.push({
      label: "Test entire branch",
      detail: `(${gitState.currentBranch})`,
      action: "test-branch",
      diffStats: gitState.branchDiffStats,
    });
  }

  options.push({
    label: "Select a PR or branch to test",
    detail: "",
    action: "select-pr",
  });

  options.push({
    label: "Describe a custom test",
    detail: "",
    action: "custom-test",
  });

  return options;
};

export const MainMenu = () => {
  const COLORS = useColors();
  const gitState = useAppStore((state) => state.gitState);
  const autoRunAfterPlanning = useAppStore((state) => state.autoRunAfterPlanning);
  const savedFlowSummaries = useAppStore((state) => state.savedFlowSummaries);
  const selectAction = useAppStore((state) => state.selectAction);
  const beginSavedFlowReuse = useAppStore((state) => state.beginSavedFlowReuse);
  const navigateTo = useAppStore((state) => state.navigateTo);
  const autoSaveFlows = useAppStore((state) => state.autoSaveFlows);
  const toggleAutoRun = useAppStore((state) => state.toggleAutoRun);
  const toggleAutoSave = useAppStore((state) => state.toggleAutoSave);
  const setMainMenuOnAction = useAppStore((state) => state.setMainMenuOnAction);
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!gitState) return null;

  const recommendedScope = getRecommendedScope(gitState);
  const recommendedAction = getDefaultActionForScope(recommendedScope);
  const warningDiffStats =
    recommendedScope === "unstaged-changes" ? gitState.diffStats : gitState.branchDiffStats;
  const menuOptions = buildMenuOptions(recommendedScope, gitState);
  const selectedOption = menuOptions[selectedIndex] ?? null;
  const canReuseSavedFlow =
    savedFlowSummaries.length > 0 &&
    Boolean(selectedOption) &&
    Boolean(selectedOption ? getSavedFlowAction(selectedOption.action, recommendedAction) : null);

  const activateOption = useCallback(
    (option: ScopeMenuOption) => {
      if (option.action === "select-pr") {
        navigateTo("select-pr");
        return;
      }

      if (option.action === "custom-test") {
        selectAction(getCustomTestAction(recommendedAction));
        return;
      }

      selectAction(option.action);
    },
    [navigateTo, recommendedAction, selectAction],
  );

  const autoRunIndex = menuOptions.length;
  const autoSaveIndex = menuOptions.length + 1;
  const totalItems = menuOptions.length + 2;

  useEffect(() => {
    setMainMenuOnAction(selectedIndex < autoRunIndex);
  }, [selectedIndex, autoRunIndex, setMainMenuOnAction]);

  useInput((input, key) => {
    if (key.downArrow || input === "j" || (key.ctrl && input === "n")) {
      setSelectedIndex((previous) => Math.min(totalItems - 1, previous + 1));
    }
    if (key.upArrow || input === "k" || (key.ctrl && input === "p")) {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
    }

    if (input === "r" && canReuseSavedFlow && selectedOption) {
      const savedFlowAction = getSavedFlowAction(selectedOption.action, recommendedAction);
      if (savedFlowAction) beginSavedFlowReuse(savedFlowAction);
    }

    if (key.return) {
      if (selectedIndex === autoRunIndex) {
        toggleAutoRun();
      } else if (selectedIndex === autoSaveIndex) {
        toggleAutoSave();
      } else if (menuOptions.length > 0) {
        activateOption(menuOptions[selectedIndex]);
      }
    }
  });

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.DIM}>{"═".repeat(40)}</Text>
        <Text bold color={COLORS.PRIMARY}>
          {"  BROWSER-TESTER v0.1"}
        </Text>
        <Text color={COLORS.DIM}>{"═".repeat(40)}</Text>
        <Text color={COLORS.DIM}>
          {"  BRANCH "}
          <Text color={COLORS.TEXT}>{gitState.currentBranch}</Text>
        </Text>
      </Box>

      {warningDiffStats ? (
        <ChangesWarningPanel
          title="Code changes detected - not yet tested"
          detail="Run a browser check before you push or ask for review."
          diffStats={warningDiffStats}
          tone="danger"
        />
      ) : null}

      <Box flexDirection="column">
        {menuOptions.map((option, index) => {
          return (
            <Clickable key={option.label} onClick={() => activateOption(option)}>
              <MenuItem
                label={option.label}
                detail={option.detail}
                isSelected={index === selectedIndex}
                recommended={index === 0 && menuOptions.length > 1}
                hint={
                  menuOptions.length === 1 && index === selectedIndex ? "press return" : undefined
                }
                diffStats={option.diffStats}
              />
            </Clickable>
          );
        })}
      </Box>

      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Clickable onClick={toggleAutoRun}>
          {selectedIndex === autoRunIndex ? (
            <Text>
              <Text color={COLORS.PRIMARY}>{"▸ "}</Text>
              <Text color={COLORS.PRIMARY} bold>
                auto-run after planning: {autoRunAfterPlanning ? "yes" : "no"}
              </Text>
            </Text>
          ) : (
            <Text color={autoRunAfterPlanning ? COLORS.TEXT : COLORS.DIM}>
              {"  "}auto-run after planning:{" "}
              <Text
                color={autoRunAfterPlanning ? COLORS.GREEN : COLORS.DIM}
                bold={autoRunAfterPlanning}
              >
                {autoRunAfterPlanning ? "yes" : "no"}
              </Text>
            </Text>
          )}
        </Clickable>
        <Clickable onClick={toggleAutoSave}>
          {selectedIndex === autoSaveIndex ? (
            <Text>
              <Text color={COLORS.PRIMARY}>{"▸ "}</Text>
              <Text color={COLORS.PRIMARY} bold>
                auto-save flows: {autoSaveFlows ? "yes" : "no"}
              </Text>
            </Text>
          ) : (
            <Text color={autoSaveFlows ? COLORS.TEXT : COLORS.DIM}>
              {"  "}auto-save flows:{" "}
              <Text color={autoSaveFlows ? COLORS.GREEN : COLORS.DIM} bold={autoSaveFlows}>
                {autoSaveFlows ? "yes" : "no"}
              </Text>
            </Text>
          )}
        </Clickable>
      </Box>
    </Box>
  );
};
