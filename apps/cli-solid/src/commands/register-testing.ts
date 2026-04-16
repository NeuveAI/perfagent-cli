import type { CommandDef } from "../context/command";
import type { Screen } from "../context/navigation";

interface RegisterTestingOptions {
  readonly currentScreen: () => Screen;
}

const isTestingScreen = (currentScreen: () => Screen): boolean =>
  currentScreen()._tag === "Testing";

export const createTestingCommands = (options: RegisterTestingOptions): readonly CommandDef[] => [
  {
    title: "cancel",
    value: "testing.cancel",
    category: "Testing",
    hidden: true,
    enabled: isTestingScreen(options.currentScreen),
    onSelect: () => {
      // HACK: actual cancel handled in-screen via useKeyboard — no keybind
      // registered here because esc is already bound to global.back and the
      // Testing screen handles esc directly via useKeyboard
    },
  },
  {
    title: "retry",
    value: "testing.retry",
    keybind: "r",
    category: "Testing",
    hidden: true,
    enabled: isTestingScreen(options.currentScreen),
    onSelect: () => {
      // HACK: actual retry handled in-screen via useKeyboard
    },
  },
  {
    title: "expand",
    value: "testing.expand",
    keybind: "ctrl+o",
    category: "Testing",
    hidden: true,
    enabled: isTestingScreen(options.currentScreen),
    onSelect: () => {
      // HACK: stub for MVP — expanded view is future work
    },
  },
];
