import { createContext, useContext, type JSX, type Accessor } from "solid-js";
import { Option } from "effect";
import type { AgentBackend } from "@neuve/agent";
import { agentProviderAtom } from "@neuve/perf-agent-cli/data/runtime";
import { atomToAccessor, atomSet } from "../adapters/effect-atom";
import { useKv, promptHistoryStorage } from "./kv";

/**
 * Agent context — single source of truth for agent provider + model preferences.
 *
 * Fixes pain #23: the Ink TUI mirrors `agentBackend` between
 * `usePreferencesStore.agentBackend` AND `agentProviderAtom` via a useEffect
 * in app.tsx. This context eliminates the double-write by:
 * 1. Reading the canonical value from `agentProviderAtom` (the Effect atom)
 * 2. Writing to BOTH the atom AND the kv store in a single setter
 */

interface ModelPreference {
  readonly configId: string;
  readonly value: string;
}

interface AgentContextValue {
  readonly agentProvider: Accessor<Option.Option<AgentBackend>>;
  readonly setAgentProvider: (backend: AgentBackend) => void;
  readonly agentBackend: Accessor<AgentBackend>;
  readonly modelPreferences: Accessor<Record<AgentBackend, ModelPreference | undefined>>;
  readonly setModelPreference: (agent: AgentBackend, configId: string, modelValue: string) => void;
  readonly notifications: Accessor<boolean | undefined>;
  readonly toggleNotifications: () => void;
  readonly instructionHistory: Accessor<string[]>;
  readonly rememberInstruction: (instruction: string) => void;
}

const FLOW_INPUT_HISTORY_LIMIT = 50;

const AgentContext = createContext<AgentContextValue>();

export const useAgent = (): AgentContextValue => {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error("useAgent must be used inside AgentProvider");
  }
  return context;
};

interface AgentProviderProps {
  readonly children: JSX.Element;
  readonly initialAgent: AgentBackend;
}

export const AgentProvider = (props: AgentProviderProps) => {
  const kv = useKv();

  // The atom is the canonical source — read it reactively
  const agentProvider = atomToAccessor(agentProviderAtom);

  // KV-backed preferences (same on-disk key as Ink TUI's zustand store)
  const [agentBackendKv, setAgentBackendKv] = kv.signal<AgentBackend>(
    "prompt-history",
    promptHistoryStorage,
    "agentBackend",
    props.initialAgent,
  );

  const [modelPreferences, setModelPreferences] = kv.signal<
    Record<AgentBackend, ModelPreference | undefined>
  >(
    "prompt-history",
    promptHistoryStorage,
    "modelPreferences",
    {
      claude: undefined,
      codex: undefined,
      copilot: undefined,
      gemini: undefined,
      cursor: undefined,
      opencode: undefined,
      droid: undefined,
      pi: undefined,
      local: undefined,
    },
  );

  const [notifications, setNotifications] = kv.signal<boolean | undefined>(
    "prompt-history",
    promptHistoryStorage,
    "notifications",
    undefined,
  );

  const [instructionHistory, setInstructionHistory] = kv.signal<string[]>(
    "prompt-history",
    promptHistoryStorage,
    "instructionHistory",
    [],
  );

  // Single setter that writes to BOTH the atom and kv — no drift
  const setAgentProvider = (backend: AgentBackend) => {
    atomSet(agentProviderAtom, Option.some(backend));
    setAgentBackendKv(backend);
  };

  const setModelPreference = (agent: AgentBackend, configId: string, modelValue: string) => {
    setModelPreferences((previous) => ({
      ...previous,
      [agent]: { configId, value: modelValue },
    }));
  };

  const toggleNotifications = () => {
    setNotifications((previous) => (previous === true ? false : true));
  };

  const rememberInstruction = (instruction: string) => {
    if (!instruction) return;
    setInstructionHistory((previous) => [
      instruction,
      ...previous.filter((entry) => entry !== instruction),
    ].slice(0, FLOW_INPUT_HISTORY_LIMIT));
  };

  const value: AgentContextValue = {
    agentProvider,
    setAgentProvider,
    agentBackend: agentBackendKv,
    modelPreferences,
    setModelPreference,
    notifications,
    toggleNotifications,
    instructionHistory,
    rememberInstruction,
  };

  return <AgentContext.Provider value={value}>{props.children}</AgentContext.Provider>;
};
