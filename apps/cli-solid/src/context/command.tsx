import { createContext, useContext, type JSX } from "solid-js";
import { createCommandRegistry } from "./command-registry";
import type { CommandRegistry } from "./command-registry";

export type { CommandDef, CommandRegistry, CreateCommandRegistryOptions } from "./command-registry";
export { createCommandRegistry } from "./command-registry";

const CommandContext = createContext<CommandRegistry>();

export const useCommandRegistry = (): CommandRegistry => {
  const context = useContext(CommandContext);
  if (!context) {
    throw new Error("useCommandRegistry must be used inside CommandProvider");
  }
  return context;
};

interface CommandProviderProps {
  readonly children: JSX.Element;
  readonly inputFocused: () => boolean;
}

export const CommandProvider = (props: CommandProviderProps) => {
  const registry = createCommandRegistry({ inputFocused: () => props.inputFocused() });

  return <CommandContext.Provider value={registry}>{props.children}</CommandContext.Provider>;
};
