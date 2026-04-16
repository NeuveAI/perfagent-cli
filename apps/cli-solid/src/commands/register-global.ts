import type { CommandDef } from "../context/command";

interface RegisterGlobalOptions {
  readonly clearScreen: () => void;
  readonly popDialog: () => void;
  readonly isDialogEmpty: () => boolean;
  readonly showToast: (message: string) => void;
}

export const createGlobalCommands = (options: RegisterGlobalOptions): readonly CommandDef[] => [
  {
    title: "clear",
    value: "global.clear",
    keybind: "ctrl+l",
    category: "Global",
    hidden: true,
    enabled: true,
    onSelect: () => {
      options.clearScreen();
    },
  },
  {
    title: "update",
    value: "global.update",
    keybind: "ctrl+u",
    category: "Global",
    hidden: true,
    enabled: true,
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "back",
    value: "global.back",
    keybind: "esc",
    category: "Global",
    hidden: true,
    enabled: !options.isDialogEmpty(),
    onSelect: () => {
      if (!options.isDialogEmpty()) {
        options.popDialog();
      }
    },
  },
];
