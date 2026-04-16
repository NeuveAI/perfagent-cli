import type { CommandDef } from "../context/command";
import type { Screen } from "../context/navigation";

interface RegisterPortPickerOptions {
  readonly currentScreen: () => Screen;
}

const isPortPickerScreen = (currentScreen: () => Screen): boolean =>
  currentScreen()._tag === "PortPicker";

export const createPortPickerCommands = (
  options: RegisterPortPickerOptions,
): readonly CommandDef[] => [
  {
    title: "confirm",
    value: "port-picker.confirm",
    keybind: "enter",
    category: "PortPicker",
    hidden: true,
    enabled: isPortPickerScreen(options.currentScreen),
    onSelect: () => {
      // HACK: handled by useKeyboard in port-picker-screen.tsx
    },
  },
  {
    title: "toggle",
    value: "port-picker.toggle",
    category: "PortPicker",
    hidden: true,
    enabled: isPortPickerScreen(options.currentScreen),
    onSelect: () => {
      // HACK: handled by useKeyboard in port-picker-screen.tsx
    },
  },
];
