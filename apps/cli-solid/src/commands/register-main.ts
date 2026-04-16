import type { CommandDef } from "../context/command";

interface RegisterMainOptions {
  readonly showToast: (message: string) => void;
  readonly isGitRepo: () => boolean;
  readonly hasRecentReports: () => boolean;
}

export const createMainCommands = (options: RegisterMainOptions): readonly CommandDef[] => [
  {
    title: "cookies",
    value: "main.cookie-sync",
    keybind: "ctrl+k",
    category: "Main",
    enabled: true,
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "agent",
    value: "main.agent-picker",
    keybind: "ctrl+a",
    category: "Main",
    enabled: true,
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "pick pr",
    value: "main.pr-picker",
    keybind: "ctrl+p",
    category: "Main",
    enabled: options.isGitRepo(),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "saved flows",
    value: "main.saved-flows",
    keybind: "ctrl+r",
    category: "Main",
    enabled: true,
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "past runs",
    value: "main.past-runs",
    keybind: "ctrl+f",
    category: "Main",
    enabled: options.hasRecentReports(),
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
  {
    title: "watch",
    value: "main.watch",
    keybind: "ctrl+w",
    category: "Main",
    enabled: options.isGitRepo(),
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
    enabled: true,
    onSelect: () => {
      options.showToast("not yet wired");
    },
  },
];
