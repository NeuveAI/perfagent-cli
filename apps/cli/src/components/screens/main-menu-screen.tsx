import { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import figures from "figures";
import stringWidth from "string-width";
import { useColors } from "../../theme-context.js";
import { Clickable } from "../ui/clickable.js";
import { MenuItem } from "../ui/menu-item.js";
import type { DiffStats } from "@browser-tester/supervisor";
import {
  getRecommendedScope,
  type GitState,
  type TestScope,
} from "../../utils/get-git-state.js";
import {
  BROWSER_FRAME_BODY_HEIGHT,
  FRAME_CONTENT_PADDING,
  FRAME_DOTS_TRAILING_GAP,
} from "../../constants.js";
import { useAppStore } from "../../store.js";

type MenuAction = "test-unstaged" | "test-branch" | "select-commit";

interface ScopeMenuOption {
  label: string;
  detail: string;
  action: MenuAction;
  diffStats?: DiffStats | null;
}

const buildMenuOptions = (
  scope: TestScope,
  gitState: GitState
): ScopeMenuOption[] => {
  const options: ScopeMenuOption[] = [];

  if (scope === "unstaged-changes") {
    options.push({
      label: "Test unstaged changes",
      detail: "",
      action: "test-unstaged",
      diffStats: gitState.diffStats,
    });
  }

  if (
    scope === "entire-branch" ||
    (scope === "unstaged-changes" &&
      !gitState.isOnMain &&
      gitState.hasBranchCommits)
  ) {
    options.push({
      label: "Test entire branch",
      detail: `(${gitState.currentBranch})`,
      action: "test-branch",
    });
  }

  options.push({
    label: "Select a commit to test",
    detail: "",
    action: "select-commit",
  });

  return options;
};

export const MainMenu = () => {
  const COLORS = useColors();
  const gitState = useAppStore((state) => state.gitState);
  const autoRunAfterPlanning = useAppStore(
    (state) => state.autoRunAfterPlanning
  );
  const savedFlowSummaries = useAppStore((state) => state.savedFlowSummaries);
  const selectAction = useAppStore((state) => state.selectAction);
  const beginSavedFlowReuse = useAppStore((state) => state.beginSavedFlowReuse);
  const navigateTo = useAppStore((state) => state.navigateTo);
  const toggleAutoRun = useAppStore((state) => state.toggleAutoRun);
  const setMainMenuOnAction = useAppStore((state) => state.setMainMenuOnAction);
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!gitState) return null;

  const recommendedScope = getRecommendedScope(gitState);
  const menuOptions = buildMenuOptions(recommendedScope, gitState);
  const selectedOption = menuOptions[selectedIndex] ?? null;
  const canReuseSavedFlow =
    savedFlowSummaries.length > 0 && Boolean(selectedOption);

  const activateOption = useCallback(
    (option: ScopeMenuOption) => {
      if (option.action === "select-commit") {
        navigateTo("select-commit");
      } else {
        selectAction(option.action);
      }
    },
    [navigateTo, selectAction]
  );

  const totalItems = menuOptions.length + 1;
  const autoRunIndex = menuOptions.length;

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

    if (key.tab) {
      toggleAutoRun();
    }

    if (input === "b") {
      navigateTo("switch-branch");
    }

    if (input === "r" && canReuseSavedFlow && selectedOption) {
      if (
        selectedOption.action === "test-unstaged" ||
        selectedOption.action === "test-branch"
      ) {
        beginSavedFlowReuse(selectedOption.action);
      }

      if (selectedOption.action === "select-commit") {
        beginSavedFlowReuse("select-commit");
      }
    }

    if (key.return) {
      if (selectedIndex === autoRunIndex) {
        toggleAutoRun();
      } else if (menuOptions.length > 0) {
        activateOption(menuOptions[selectedIndex]);
      }
    }
  });

  const dots = `${figures.circleFilled} ${figures.circleFilled} ${figures.circleFilled}`;
  const titleLabel = "browser-tester";

  const inner =
    Math.max(
      titleLabel.length + 4,
      stringWidth(dots) + FRAME_DOTS_TRAILING_GAP
    ) + FRAME_CONTENT_PADDING;

  const emptyRow = " ".repeat(inner);
  const topRows = Math.floor((BROWSER_FRAME_BODY_HEIGHT - 1) / 2);
  const bottomRows = BROWSER_FRAME_BODY_HEIGHT - 1 - topRows;
  const labelPadLeft = Math.floor((inner - stringWidth(titleLabel)) / 2);
  const labelPadRight = inner - stringWidth(titleLabel) - labelPadLeft;

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <Text color={COLORS.BORDER}>
        {"╭"}
        {"─".repeat(inner)}
        {"╮"}
      </Text>
      <Text color={COLORS.BORDER}>
        {"│ "}
        <Text color="#ff5f57">{`${figures.circleFilled} `}</Text>
        <Text color="#febc2e">{`${figures.circleFilled} `}</Text>
        <Text color="#28c840">{figures.circleFilled}</Text>
        {" ".repeat(inner - stringWidth(dots) - FRAME_DOTS_TRAILING_GAP)}
        {"│"}
      </Text>
      {Array.from({ length: topRows }).map((_, index) => (
        <Text key={`top-${index}`} color={COLORS.BORDER}>
          {"│"}
          {emptyRow}
          {"│"}
        </Text>
      ))}
      <Text color={COLORS.BORDER}>
        {"│"}
        {" ".repeat(labelPadLeft)}
        <Text bold color={COLORS.TEXT}>
          {titleLabel}
        </Text>
        <Text color={COLORS.BORDER}>
          {" ".repeat(labelPadRight)}
          {"│"}
        </Text>
      </Text>
      {Array.from({ length: bottomRows }).map((_, index) => (
        <Text key={`bot-${index}`} color={COLORS.BORDER}>
          {"│"}
          {emptyRow}
          {"│"}
        </Text>
      ))}
      <Text color={COLORS.BORDER}>
        {"╰"}
        {"─".repeat(inner)}
        {"╯"}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold color={COLORS.TEXT}>
          {" "}
          Actions
        </Text>
        {menuOptions.map((option, index) => {
          return (
            <Clickable
              key={option.label}
              onClick={() => activateOption(option)}
            >
              <MenuItem
                label={option.label}
                detail={option.detail}
                isSelected={index === selectedIndex}
                recommended={index === 0 && menuOptions.length > 1}
                hint={
                  menuOptions.length === 1 && index === selectedIndex
                    ? "press return"
                    : undefined
                }
                diffStats={option.diffStats}
              />
            </Clickable>
          );
        })}
      </Box>

      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text bold color={COLORS.TEXT}>
          {" "}
          Options
        </Text>
        <Clickable onClick={toggleAutoRun}>
          {selectedIndex === autoRunIndex ? (
            <Text>
              <Text color={COLORS.PRIMARY}>{figures.pointer} </Text>
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
      </Box>
    </Box>
  );
};
