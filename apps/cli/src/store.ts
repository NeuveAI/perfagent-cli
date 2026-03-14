import { create } from "zustand";
import {
  checkoutBranch,
  type BrowserEnvironmentHints,
  type BrowserFlowPlan,
  type CommitSummary,
  type TestTarget,
} from "@browser-tester/supervisor";
import {
  getBrowserEnvironment,
  resolveBrowserTarget,
  type TestAction,
} from "./utils/browser-agent.js";
import { getGitState, type GitState } from "./utils/get-git-state.js";
import { listSavedFlows, type SavedFlowSummary } from "./utils/list-saved-flows.js";
import type { LoadedSavedFlow } from "./utils/load-saved-flow.js";

export type Screen =
  | "main"
  | "switch-branch"
  | "select-commit"
  | "saved-flow-picker"
  | "flow-input"
  | "planning"
  | "review-plan"
  | "testing"
  | "theme";

interface AppStore {
  screen: Screen;
  previousScreen: Screen;
  gitState: GitState | null;
  testAction: TestAction | null;
  selectedCommit: CommitSummary | null;
  flowInstruction: string;
  autoRunAfterPlanning: boolean;
  generatedPlan: BrowserFlowPlan | null;
  resolvedTarget: TestTarget | null;
  browserEnvironment: BrowserEnvironmentHints | null;
  planningError: string | null;
  planOrigin: "generated" | "saved" | null;
  savedFlowSummaries: SavedFlowSummary[];
  pendingSavedFlow: LoadedSavedFlow | null;

  loadGitState: () => void;
  loadSavedFlows: () => Promise<void>;
  goBack: () => void;
  navigateTo: (screen: Screen) => void;
  selectAction: (action: TestAction) => void;
  selectCommit: (commit: CommitSummary) => void;
  beginSavedFlowReuse: (action: TestAction) => void;
  applySavedFlow: (savedFlow: LoadedSavedFlow) => void;
  submitFlowInstruction: (instruction: string) => void;
  toggleAutoRun: () => void;
  completePlanning: (result: {
    target: TestTarget;
    plan: BrowserFlowPlan;
    environment: BrowserEnvironmentHints;
  }) => void;
  failPlanning: (error: string) => void;
  updatePlan: (plan: BrowserFlowPlan) => void;
  updateEnvironment: (environment: BrowserEnvironmentHints | null) => void;
  approvePlan: (plan: BrowserFlowPlan) => void;
  exitTesting: () => void;
  switchBranch: (branch: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  screen: "main",
  previousScreen: "main",
  gitState: null,
  testAction: null,
  selectedCommit: null,
  flowInstruction: "",
  autoRunAfterPlanning: false,
  generatedPlan: null,
  resolvedTarget: null,
  browserEnvironment: null,
  planningError: null,
  planOrigin: null,
  savedFlowSummaries: [],
  pendingSavedFlow: null,

  loadGitState: () => set({ gitState: getGitState() }),

  loadSavedFlows: async () => {
    const savedFlowSummaries = await listSavedFlows();
    set({ savedFlowSummaries });
  },

  goBack: () =>
    set((state) => {
      if (state.screen === "review-plan") {
        return { screen: state.planOrigin === "saved" ? "saved-flow-picker" : "flow-input" };
      }
      if (state.screen === "planning") {
        return { screen: "flow-input" };
      }
      if (state.screen === "saved-flow-picker") {
        return {
          screen: "main",
          testAction: null,
          selectedCommit: null,
          generatedPlan: null,
          resolvedTarget: null,
          browserEnvironment: null,
          pendingSavedFlow: null,
          planOrigin: null,
        };
      }
      if (state.screen === "select-commit" && state.pendingSavedFlow) {
        return {
          screen: "saved-flow-picker",
          selectedCommit: null,
        };
      }
      if (state.screen !== "testing") {
        return { screen: "main" };
      }
      return {};
    }),

  navigateTo: (screen) => set((state) => ({ screen, previousScreen: state.screen })),

  selectAction: (action) =>
    set({
      testAction: action,
      selectedCommit: null,
      generatedPlan: null,
      resolvedTarget: null,
      browserEnvironment: null,
      pendingSavedFlow: null,
      planOrigin: null,
      screen: "flow-input",
    }),

  selectCommit: (commit) =>
    set((state) => {
      if (state.pendingSavedFlow) {
        return {
          testAction: "select-commit",
          selectedCommit: commit,
          generatedPlan: state.pendingSavedFlow.plan,
          resolvedTarget: resolveBrowserTarget({ action: "select-commit", commit }),
          browserEnvironment: {
            ...getBrowserEnvironment(),
            ...state.pendingSavedFlow.environment,
          },
          pendingSavedFlow: null,
          screen: "review-plan",
        };
      }

      return {
        testAction: "select-commit",
        selectedCommit: commit,
        generatedPlan: null,
        resolvedTarget: null,
        browserEnvironment: null,
        pendingSavedFlow: null,
        planOrigin: null,
        screen: "flow-input",
      };
    }),

  beginSavedFlowReuse: (action) =>
    set({
      testAction: action,
      selectedCommit: null,
      generatedPlan: null,
      resolvedTarget: null,
      browserEnvironment: null,
      planningError: null,
      pendingSavedFlow: null,
      planOrigin: "saved",
      screen: "saved-flow-picker",
    }),

  applySavedFlow: (savedFlow) =>
    set((state) => {
      if (!state.testAction) {
        return {};
      }

      if (state.testAction === "select-commit") {
        return {
          pendingSavedFlow: savedFlow,
          selectedCommit: null,
          generatedPlan: null,
          resolvedTarget: null,
          browserEnvironment: null,
          screen: "select-commit",
        };
      }

      return {
        generatedPlan: savedFlow.plan,
        resolvedTarget: resolveBrowserTarget({ action: state.testAction }),
        browserEnvironment: {
          ...getBrowserEnvironment(),
          ...savedFlow.environment,
        },
        pendingSavedFlow: null,
        selectedCommit: null,
        screen: "review-plan",
      };
    }),

  submitFlowInstruction: (instruction) =>
    set({
      flowInstruction: instruction,
      planningError: null,
      generatedPlan: null,
      resolvedTarget: null,
      browserEnvironment: null,
      pendingSavedFlow: null,
      planOrigin: "generated",
      screen: "planning",
    }),

  toggleAutoRun: () => set((state) => ({ autoRunAfterPlanning: !state.autoRunAfterPlanning })),

  completePlanning: (result) =>
    set((state) => ({
      resolvedTarget: result.target,
      generatedPlan: result.plan,
      browserEnvironment: result.environment,
      screen:
        state.autoRunAfterPlanning && !result.plan.cookieSync.required ? "testing" : "review-plan",
    })),

  failPlanning: (error) => set({ planningError: error }),

  updatePlan: (plan) => set({ generatedPlan: plan }),

  updateEnvironment: (environment) => set({ browserEnvironment: environment }),

  approvePlan: (plan) => set({ generatedPlan: plan, screen: "testing" }),

  exitTesting: () =>
    set({
      testAction: null,
      selectedCommit: null,
      flowInstruction: "",
      generatedPlan: null,
      resolvedTarget: null,
      browserEnvironment: null,
      planningError: null,
      planOrigin: null,
      pendingSavedFlow: null,
      screen: "main",
    }),

  switchBranch: (branch) => {
    const success = checkoutBranch(process.cwd(), branch);
    if (success) {
      set({ gitState: getGitState(), screen: "main" });
    } else {
      set({ screen: "main" });
    }
  },
}));
