import type { CommandDef } from "../context/command";
import type { Screen } from "../context/navigation";

interface RegisterMainOptions {
  readonly showToast: (message: string) => void;
  readonly isGitRepo: () => boolean;
  readonly hasRecentReports: () => boolean;
  readonly currentScreen: () => Screen;
}

const isMainScreen = (currentScreen: () => Screen): boolean =>
  currentScreen()._tag === "Main";

export const createMainCommands = (options: RegisterMainOptions): readonly CommandDef[] => [
  {
    title: "cookies",
    value: "main.cookie-sync",
    keybind: "ctrl+k",
    category: "Main",
    enabled: isMainScreen(options.currentScreen),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "agent",
    value: "main.agent-picker",
    keybind: "ctrl+a",
    category: "Main",
    enabled: isMainScreen(options.currentScreen),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "pick pr",
    value: "main.pr-picker",
    keybind: "ctrl+p",
    category: "Main",
    enabled: isMainScreen(options.currentScreen) && options.isGitRepo(),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "saved flows",
    value: "main.saved-flows",
    keybind: "ctrl+r",
    category: "Main",
    enabled: isMainScreen(options.currentScreen),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "past runs",
    value: "main.past-runs",
    keybind: "ctrl+f",
    category: "Main",
    enabled: isMainScreen(options.currentScreen) && options.hasRecentReports(),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "watch",
    value: "main.watch",
    keybind: "ctrl+w",
    category: "Main",
    enabled: isMainScreen(options.currentScreen) && options.isGitRepo(),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "submit",
    value: "main.submit",
    keybind: "enter",
    category: "Main",
    hidden: true,
    enabled: isMainScreen(options.currentScreen),
    onSelect: () => {
      // HACK: actual submit is handled by Input.onSubmit in main-screen.tsx
    },
  },
];
