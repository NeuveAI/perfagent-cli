import type { KeyEvent } from "@opentui/core";
import * as keybind from "./keybind";

export interface CommandDef {
  readonly title: string;
  readonly value: string;
  readonly keybind?: string;
  readonly category: string;
  readonly slash?: { readonly name: string; readonly aliases?: readonly string[] };
  readonly suggested?: boolean;
  readonly hidden?: boolean;
  readonly enabled?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void | Promise<void>;
}

export interface CommandRegistry {
  readonly register: (factory: () => readonly CommandDef[]) => () => void;
  readonly trigger: (value: string) => boolean;
  readonly handleKeyEvent: (event: KeyEvent) => boolean;
  readonly getCommands: () => readonly CommandDef[];
  readonly getVisibleCommands: () => readonly CommandDef[];
}

class DuplicateKeybindError extends Error {
  constructor(keybindName: string, existingCommand: string, newCommand: string) {
    super(
      `Duplicate keybind "${keybindName}": already bound to "${existingCommand}", cannot bind to "${newCommand}"`,
    );
    this.name = "DuplicateKeybindError";
  }
}

const INPUT_TEXT_EDITING_KEYBINDS = new Set(["ctrl+a", "ctrl+e", "ctrl+w"]);

const isInputTextEditingKey = (commandKeybind: string): boolean =>
  INPUT_TEXT_EDITING_KEYBINDS.has(commandKeybind.toLowerCase());

export interface CreateCommandRegistryOptions {
  readonly inputFocused: () => boolean;
}

export const createCommandRegistry = (options: CreateCommandRegistryOptions): CommandRegistry => {
  // HACK: factories is a plain JS array, not a Solid signal. Reactivity works because
  // factories are re-invoked on every getCommands() call, and each factory closure reads
  // Solid signals (e.g. isGitRepo(), isDialogEmpty()). This means Solid tracks signal
  // reads transitively when getCommands() is called inside a reactive scope (like JSX).
  // Do NOT cache or memoize the return value of getCommands() — it would break reactivity.
  // Factories MUST be pure functions that read Solid signals on each call.
  const factories: Array<() => readonly CommandDef[]> = [];

  const getCommands = (): readonly CommandDef[] => {
    const allCommands: CommandDef[] = [];
    for (const factory of factories) {
      const commands = factory();
      allCommands.push(...commands);
    }
    return allCommands;
  };

  const validateKeybinds = (commands: readonly CommandDef[]) => {
    const keybindMap = new Map<string, string>();
    for (const command of commands) {
      if (command.keybind && command.enabled !== false) {
        const normalized = command.keybind.toLowerCase();
        const existing = keybindMap.get(normalized);
        if (existing) {
          throw new DuplicateKeybindError(command.keybind, existing, command.value);
        }
        keybindMap.set(normalized, command.value);
      }
    }
  };

  const getVisibleCommands = (): readonly CommandDef[] => {
    const commands = getCommands();
    return commands.filter((command) => command.hidden !== true && command.enabled !== false);
  };

  const register = (factory: () => readonly CommandDef[]): (() => void) => {
    factories.push(factory);
    const commands = getCommands();
    validateKeybinds(commands);
    return () => {
      const index = factories.indexOf(factory);
      if (index >= 0) {
        factories.splice(index, 1);
      }
    };
  };

  const trigger = (value: string): boolean => {
    const commands = getCommands();
    const command = commands.find((cmd) => cmd.value === value);
    if (!command) return false;
    if (command.enabled === false) return false;
    void command.onSelect();
    return true;
  };

  const handleKeyEvent = (event: KeyEvent): boolean => {
    const inputHasFocus = options.inputFocused();
    const commands = getCommands();
    for (const command of commands) {
      if (!command.keybind) continue;
      if (command.enabled === false) continue;
      if (inputHasFocus && isInputTextEditingKey(command.keybind)) continue;
      if (!keybind.match(command.keybind, event)) continue;
      void command.onSelect();
      return true;
    }
    return false;
  };

  return { register, trigger, handleKeyEvent, getCommands, getVisibleCommands };
};
