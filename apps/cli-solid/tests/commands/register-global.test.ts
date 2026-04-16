import { describe, test, expect } from "bun:test";
import { createGlobalCommands } from "../../src/commands/register-global";
import { createCommandRegistry } from "../../src/context/command-registry";
import { Screen } from "../../src/context/navigation";
import { ctrlKey, escKey } from "../helpers/make-key-event";

const makeGlobalOptions = (overrides?: {
  clearScreen?: () => void;
  showToast?: (message: string) => void;
  goBack?: () => void;
  currentScreen?: () => Screen;
  overlay?: () => undefined;
}) => ({
  clearScreen: overrides?.clearScreen ?? (() => {}),
  showToast: overrides?.showToast ?? (() => {}),
  goBack: overrides?.goBack ?? (() => {}),
  currentScreen: overrides?.currentScreen ?? (() => Screen.Main()),
  overlay: overrides?.overlay ?? (() => undefined),
});

describe("register-global commands", () => {
  test("creates expected command set", () => {
    const commands = createGlobalCommands(makeGlobalOptions());
    const values = commands.map((cmd) => cmd.value);

    expect(values).toContain("global.clear");
    expect(values).toContain("global.update");
    expect(values).toContain("global.back");
  });

  test("all global commands except quit are hidden", () => {
    const commands = createGlobalCommands(makeGlobalOptions());
    for (const cmd of commands) {
      if (cmd.value === "global.quit") {
        expect(cmd.hidden).not.toBe(true);
        continue;
      }
      expect(cmd.hidden).toBe(true);
    }
  });

  test("ctrl+l triggers clearScreen", () => {
    let cleared = false;
    const registry = createCommandRegistry({ inputFocused: () => false });
    registry.register(() =>
      createGlobalCommands(makeGlobalOptions({
        clearScreen: () => { cleared = true; },
      })),
    );

    registry.handleKeyEvent(ctrlKey("l"));
    expect(cleared).toBe(true);
  });

  test("ctrl+u triggers showToast for update", () => {
    const toasts: string[] = [];
    const registry = createCommandRegistry({ inputFocused: () => false });
    registry.register(() =>
      createGlobalCommands(makeGlobalOptions({
        showToast: (msg) => toasts.push(msg),
      })),
    );

    registry.handleKeyEvent(ctrlKey("u"));
    expect(toasts).toEqual(["not yet wired"]);
  });

  test("esc is enabled and calls goBack on non-Main screen", () => {
    let wentBack = false;
    const commands = createGlobalCommands(makeGlobalOptions({
      currentScreen: () => Screen.SelectPr(),
      goBack: () => { wentBack = true; },
    }));

    const backCmd = commands.find((cmd) => cmd.value === "global.back");
    expect(backCmd?.enabled).toBe(true);
    backCmd?.onSelect();
    expect(wentBack).toBe(true);
  });

  test("esc is disabled on Main screen", () => {
    const commands = createGlobalCommands(makeGlobalOptions({
      currentScreen: () => Screen.Main(),
    }));

    const backCmd = commands.find((cmd) => cmd.value === "global.back");
    expect(backCmd?.enabled).toBe(false);
  });

  test("no keybind collisions among global commands", () => {
    const commands = createGlobalCommands(makeGlobalOptions());
    const enabledKeybinds = commands
      .filter((cmd) => cmd.enabled !== false && cmd.keybind)
      .map((cmd) => cmd.keybind);
    const unique = new Set(enabledKeybinds);
    expect(enabledKeybinds.length).toBe(unique.size);
  });
});
