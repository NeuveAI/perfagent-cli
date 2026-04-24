import { createContext, useContext, type JSX, onCleanup } from "solid-js";
import { Option } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { AgentBackend } from "@neuve/agent";
import { agentProviderAtom, verboseAtom } from "@neuve/perf-agent-cli/data/runtime";
import { setAtomRegistry, atomMount } from "../adapters/effect-atom";
import { recentReportsAtom } from "@neuve/perf-agent-cli/data/recent-reports-atom";
import { registerCleanupHandler, isShuttingDown } from "../lifecycle/shutdown";

/**
 * RuntimeProvider initializes the shared AtomRegistry and seeds it with
 * the initial values for agentProviderAtom and verboseAtom.
 *
 * This is the SINGLE atom runtime for the entire Solid TUI.
 * It mirrors what `RegistryProvider` does in the Ink TUI's program.tsx.
 */

interface RuntimeContextValue {
  readonly registry: AtomRegistry.AtomRegistry;
}

const RuntimeContext = createContext<RuntimeContextValue>();

export const useRuntime = (): RuntimeContextValue => {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error("useRuntime must be used inside RuntimeProvider");
  }
  return context;
};

interface RuntimeProviderProps {
  readonly children: JSX.Element;
  readonly agent: AgentBackend;
  readonly verbose?: boolean;
}

export const RuntimeProvider = (props: RuntimeProviderProps) => {
  const registry = AtomRegistry.make({
    initialValues: [
      [agentProviderAtom, Option.some(props.agent)],
      [verboseAtom, props.verbose ?? false],
    ],
  });

  setAtomRegistry(registry);

  // Mount key atoms so they stay alive
  const unmountReports = atomMount(recentReportsAtom);

  const unregisterShutdown = registerCleanupHandler(() => {
    unmountReports();
    registry.dispose();
  });

  onCleanup(() => {
    unregisterShutdown();
    if (isShuttingDown()) return;
    unmountReports();
    registry.dispose();
  });

  return (
    <RuntimeContext.Provider value={{ registry }}>
      {props.children}
    </RuntimeContext.Provider>
  );
};
