import { useEffect, useState } from "react";
import { Box, useInput } from "ink";
import { MouseProvider } from "../hooks/mouse-context";
import { PrPickerScreen } from "./screens/pr-picker-screen";
import { PlanReviewScreen } from "./screens/plan-review-screen";
import { CookieSyncConfirmScreen } from "./screens/cookie-sync-confirm-screen";
import { Spinner } from "./ui/spinner";
import { TestingScreen } from "./screens/testing-screen";
import { ResultsScreen } from "./screens/results-screen";
import { SavedFlowPickerScreen } from "./screens/saved-flow-picker-screen";
import { MainMenu } from "./screens/main-menu-screen";
import { Modeline } from "./ui/modeline";
import { useNavigationStore, Screen } from "../stores/use-navigation";
import { usePlanStore } from "../stores/use-plan-store";
import { usePlanExecutionStore } from "../stores/use-plan-execution-store";
import { useGitState } from "../hooks/use-git-state";
import { clearInkDisplay } from "../utils/clear-ink-display";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions";
import { AgentBackend } from "@expect/agent";
import { useAtomSet } from "@effect/atom-react";
import { agentProviderAtom } from "../data/runtime";
import { Option } from "effect";

export const App = ({ agent }: { agent: AgentBackend }) => {
  const screen = useNavigationStore((state) => state.screen);
  const setScreen = useNavigationStore((state) => state.setScreen);
  const navigateTo = useNavigationStore((state) => state.navigateTo);
  const { data: gitState, isLoading: gitStateLoading } = useGitState();

  /** @note(rasmus): this constructs the Layer with the agent provider lazily */
  const setAgentProvider = useAtomSet(agentProviderAtom);
  useEffect(() => {
    setAgentProvider(Option.some(agent));
  }, [agent, setAgentProvider]);

  const goBack = () => {
    if (screen._tag === "ReviewPlan") {
      setScreen(Screen.Main());
      return;
    }
    if (screen._tag === "CookieSyncConfirm") {
      setScreen(Screen.ReviewPlan({ plan: screen.plan }));
      return;
    }
    if (screen._tag === "Results") {
      usePlanStore.getState().setPlan(undefined);
      usePlanExecutionStore.getState().setExecutedPlan(undefined);
      setScreen(Screen.Main());
      return;
    }
    if (screen._tag !== "Testing") {
      setScreen(Screen.Main());
    }
  };

  const [, setRefreshTick] = useState(0);
  const [, rows] = useStdoutDimensions();

  useInput((input, key) => {
    if (key.ctrl && input === "l") {
      clearInkDisplay();
      setRefreshTick((previous) => previous + 1);
      return;
    }
    if (key.escape && screen._tag !== "Main" && screen._tag !== "ReviewPlan") {
      goBack();
    }
    if (key.ctrl && input === "p" && screen._tag === "Main" && gitState?.isGitRepo) {
      navigateTo(Screen.SelectPr());
    }
    if (key.ctrl && input === "f" && screen._tag === "Main") {
      navigateTo(Screen.SavedFlowPicker());
    }
  });

  if (gitStateLoading || !gitState) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Spinner message="Checking git state..." />
      </Box>
    );
  }

  const renderScreen = () => {
    switch (screen._tag) {
      case "Testing":
        return (
          <TestingScreen
            changesFor={screen.changesFor}
            instruction={screen.instruction}
            existingPlan={screen.existingPlan}
          />
        );
      case "Results":
        return <ResultsScreen report={screen.report} />;
      case "SelectPr":
        return <PrPickerScreen />;
      case "ReviewPlan":
        return <PlanReviewScreen plan={screen.plan} />;
      case "CookieSyncConfirm":
        return <CookieSyncConfirmScreen plan={screen.plan} />;
      case "SavedFlowPicker":
        return <SavedFlowPickerScreen />;
      default:
        return <MainMenu gitState={gitState} />;
    }
  };

  return (
    <MouseProvider>
      <Box flexDirection="column" width="100%" height={rows}>
        <Box flexGrow={1}>{renderScreen()}</Box>
        <Modeline />
      </Box>
    </MouseProvider>
  );
};
