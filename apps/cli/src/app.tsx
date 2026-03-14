import { useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MouseProvider } from "./hooks/mouse-context.js";
import { useColors } from "./theme-context.js";
import { BranchSwitcherScreen } from "./components/screens/branch-switcher-screen.js";
import { CommitPickerScreen } from "./components/screens/commit-picker-screen.js";
import { FlowInputScreen } from "./components/screens/flow-input-screen.js";
import { PlanningScreen } from "./components/screens/planning-screen.js";
import { PlanReviewScreen } from "./components/screens/plan-review-screen.js";
import { SavedFlowPickerScreen } from "./components/screens/saved-flow-picker-screen.js";
import { Spinner } from "./components/ui/spinner.js";
import { TestingScreen } from "./components/screens/testing-screen.js";
import { ThemePickerScreen } from "./components/screens/theme-picker-screen.js";
import { MainMenu } from "./components/screens/main-menu-screen.js";
import { Modeline } from "./components/ui/modeline.js";
import { InkGrab } from "../ink-grab/index.js";
import { generateBrowserPlan } from "./utils/browser-agent.js";
import { useAppStore } from "./store.js";

const usePlanningEffect = () => {
  const screen = useAppStore((state) => state.screen);
  const gitState = useAppStore((state) => state.gitState);
  const testAction = useAppStore((state) => state.testAction);
  const flowInstruction = useAppStore((state) => state.flowInstruction);
  const selectedCommit = useAppStore((state) => state.selectedCommit);
  const environmentOverrides = useAppStore((state) => state.environmentOverrides);
  const completePlanning = useAppStore((state) => state.completePlanning);
  const failPlanning = useAppStore((state) => state.failPlanning);

  useEffect(() => {
    if (screen !== "planning" || !gitState || !testAction || !flowInstruction.trim()) return;

    let isCancelled = false;

    void generateBrowserPlan({
      action: testAction,
      commit: selectedCommit ?? undefined,
      userInstruction: flowInstruction,
      environmentOverrides,
    })
      .then((result) => {
        if (!isCancelled) completePlanning(result);
      })
      .catch((caughtError) => {
        if (!isCancelled) {
          failPlanning(caughtError instanceof Error ? caughtError.message : "Unknown error");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    completePlanning,
    environmentOverrides,
    failPlanning,
    flowInstruction,
    gitState,
    screen,
    selectedCommit,
    testAction,
  ]);
};

export const App = () => {
  const screen = useAppStore((state) => state.screen);
  const gitState = useAppStore((state) => state.gitState);
  const loadGitState = useAppStore((state) => state.loadGitState);
  const loadSavedFlows = useAppStore((state) => state.loadSavedFlows);
  const goBack = useAppStore((state) => state.goBack);
  const planningError = useAppStore((state) => state.planningError);
  const COLORS = useColors();

  useEffect(() => {
    loadGitState();
  }, [loadGitState]);

  useEffect(() => {
    void loadSavedFlows();
  }, [loadSavedFlows]);

  usePlanningEffect();

  const navigateTo = useAppStore((state) => state.navigateTo);

  useInput((input, key) => {
    if (key.escape && screen !== "main") {
      goBack();
    }
    if (input === "t" && screen !== "theme" && screen !== "flow-input") {
      navigateTo("theme");
    }
  });

  if (!gitState) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Spinner message="Checking git state..." />
      </Box>
    );
  }

  const renderScreen = () => {
    switch (screen) {
      case "testing":
        return <TestingScreen />;
      case "select-commit":
        return <CommitPickerScreen />;
      case "theme":
        return <ThemePickerScreen />;
      case "switch-branch":
        return <BranchSwitcherScreen />;
      case "flow-input":
        return <FlowInputScreen />;
      case "saved-flow-picker":
        return <SavedFlowPickerScreen />;
      case "planning":
        return (
          <Box flexDirection="column" width="100%">
            <PlanningScreen />
            {planningError ? (
              <Box paddingX={2}>
                <Text color={COLORS.RED}>Planning failed: {planningError}</Text>
              </Box>
            ) : null}
          </Box>
        );
      case "review-plan":
        return <PlanReviewScreen />;
      default:
        return <MainMenu />;
    }
  };

  return (
    <InkGrab>
      <MouseProvider>
        <Box flexDirection="column" width="100%">
          <Box flexGrow={1}>{renderScreen()}</Box>
          <Modeline />
        </Box>
      </MouseProvider>
    </InkGrab>
  );
};
