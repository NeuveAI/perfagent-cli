import { create } from "zustand";
import { ExecutedPerfPlan } from "@neuve/supervisor";

interface PlanExecutionStore {
  executedPlan: ExecutedPerfPlan | undefined;
  expanded: boolean;
  setExecutedPlan: (plan: ExecutedPerfPlan | undefined) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
}

export const usePlanExecutionStore = create<PlanExecutionStore>((set) => ({
  executedPlan: undefined,
  expanded: false,
  setExecutedPlan: (executedPlan) => set({ executedPlan }),
  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),
}));
