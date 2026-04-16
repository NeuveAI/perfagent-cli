import type { CommandDef } from "../context/command";
import type { Screen, ResultsOverlay } from "../context/navigation";

interface RegisterGlobalOptions {
  readonly clearScreen: () => void;
  readonly popDialog: () => void;
  readonly isDialogEmpty: () => boolean;
  readonly showToast: (message: string) => void;
  readonly goBack: () => void;
  readonly currentScreen: () => Screen;
  readonly overlay: () => ResultsOverlay | undefined;
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
    enabled: !options.isDialogEmpty() ||
      (options.currentScreen()._tag !== "Main" && options.overlay() === undefined),
    onSelect: () => {
      if (!options.isDialogEmpty()) {
        options.popDialog();
        return;
      }
      if (options.currentScreen()._tag !== "Main" && options.overlay() === undefined) {
        options.goBack();
      }
    },
  },
];
