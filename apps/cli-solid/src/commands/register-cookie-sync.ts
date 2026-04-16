import type { CommandDef } from "../context/command";
import type { Screen } from "../context/navigation";

interface RegisterCookieSyncOptions {
  readonly currentScreen: () => Screen;
}

const isCookieSyncScreen = (currentScreen: () => Screen): boolean =>
  currentScreen()._tag === "CookieSyncConfirm";

export const createCookieSyncCommands = (
  options: RegisterCookieSyncOptions,
): readonly CommandDef[] => [
  {
    title: "confirm",
    value: "cookie-sync.confirm",
    keybind: "enter",
    category: "CookieSync",
    hidden: true,
    enabled: isCookieSyncScreen(options.currentScreen),
    onSelect: () => {
      // HACK: handled by useKeyboard in cookie-sync-confirm-screen.tsx
    },
  },
  {
    title: "toggle",
    value: "cookie-sync.toggle",
    category: "CookieSync",
    hidden: true,
    enabled: isCookieSyncScreen(options.currentScreen),
    onSelect: () => {
      // HACK: handled by useKeyboard in cookie-sync-confirm-screen.tsx
    },
  },
];
