import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { promptHistoryStorage } from "@expect/supervisor";
import type { AgentBackend } from "@expect/agent";
import { FLOW_INPUT_HISTORY_LIMIT } from "../constants";

interface PreferencesStore {
  agentBackend: AgentBackend;
  autoSaveFlows: boolean;
  instructionHistory: string[];
  setAgentBackend: (backend: AgentBackend) => void;
  toggleAutoSave: () => void;
  rememberInstruction: (instruction: string) => void;
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      agentBackend: "claude",
      autoSaveFlows: true,
      instructionHistory: [],
      setAgentBackend: (backend: AgentBackend) => set({ agentBackend: backend }),
      toggleAutoSave: () => set((state) => ({ autoSaveFlows: !state.autoSaveFlows })),
      rememberInstruction: (instruction) => {
        if (!instruction) return;
        set((state) => ({
          instructionHistory: [
            instruction,
            ...state.instructionHistory.filter((entry) => entry !== instruction),
          ].slice(0, FLOW_INPUT_HISTORY_LIMIT),
        }));
      },
    }),
    {
      name: "prompt-history",
      storage: createJSONStorage(() => promptHistoryStorage),
      partialize: (state) => ({ instructionHistory: state.instructionHistory }),
    },
  ),
);
