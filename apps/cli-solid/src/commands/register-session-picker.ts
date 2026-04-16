import type { CommandDef } from "../context/command";
import type { Screen } from "../context/navigation";

interface RegisterSessionPickerOptions {
  readonly currentScreen: () => Screen;
}

const isSessionPickerScreen = (currentScreen: () => Screen): boolean =>
  currentScreen()._tag === "SessionPicker";

export const createSessionPickerCommands = (
  options: RegisterSessionPickerOptions,
): readonly CommandDef[] => [
  {
    title: "resume",
    value: "session-picker.resume",
    keybind: "enter",
    category: "SessionPicker",
    hidden: true,
    enabled: isSessionPickerScreen(options.currentScreen),
    onSelect: () => {
      // HACK: actual resume handled in-screen via useKeyboard
    },
  },
];
