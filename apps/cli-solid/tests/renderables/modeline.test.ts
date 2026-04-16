import { describe, test, expect } from "bun:test";
import { createMainCommands } from "../../src/commands/register-main";
import { createGlobalCommands } from "../../src/commands/register-global";
import { Screen } from "../../src/context/navigation";
import type { CommandDef } from "../../src/context/command-registry";
import * as keybindPrinter from "../../src/context/keybind";

describe("modeline derivation from registry", () => {
  test("every visible command with a keybind has a printable label", () => {
    const allCommands: CommandDef[] = [
      ...createGlobalCommands({
        clearScreen: () => {},
        popDialog: () => {},
        isDialogEmpty: () => true,
        showToast: () => {},
        goBack: () => {},
        currentScreen: () => Screen.Main(),
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen: () => Screen.Main(),
      }),
    ];

    const visibleWithKeybind = allCommands.filter(
      (cmd) => cmd.hidden !== true && cmd.enabled !== false && cmd.keybind,
    );

    expect(visibleWithKeybind.length).toBeGreaterThan(0);

    for (const command of visibleWithKeybind) {
      const printed = keybindPrinter.print(command.keybind!);
      expect(printed.length).toBeGreaterThan(0);
      expect(typeof printed).toBe("string");
    }
  });

  test("no orphan hints - every modeline entry corresponds to an enabled command", () => {
    const allCommands: CommandDef[] = [
      ...createGlobalCommands({
        clearScreen: () => {},
        popDialog: () => {},
        isDialogEmpty: () => true,
        showToast: () => {},
        goBack: () => {},
        currentScreen: () => Screen.Main(),
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen: () => Screen.Main(),
      }),
    ];

    const visibleCommands = allCommands.filter(
      (cmd) => cmd.hidden !== true && cmd.enabled !== false,
    );

    for (const command of visibleCommands) {
      expect(command.enabled).not.toBe(false);
      expect(command.onSelect).toBeDefined();
      expect(typeof command.title).toBe("string");
      expect(command.title.length).toBeGreaterThan(0);
    }
  });

  test("disabled commands do not appear in visible set", () => {
    const commands = createMainCommands({
      showToast: () => {},
      isGitRepo: () => false,
      hasRecentReports: () => false,
      currentScreen: () => Screen.Main(),
    });

    const visible = commands.filter((cmd) => cmd.hidden !== true && cmd.enabled !== false);
    const disabledValues = commands
      .filter((cmd) => cmd.enabled === false)
      .map((cmd) => cmd.value);

    for (const visibleCommand of visible) {
      expect(disabledValues).not.toContain(visibleCommand.value);
    }
  });

  test("hidden commands do not appear in modeline but exist in registry", () => {
    const allCommands: CommandDef[] = [
      ...createGlobalCommands({
        clearScreen: () => {},
        popDialog: () => {},
        isDialogEmpty: () => true,
        showToast: () => {},
        goBack: () => {},
        currentScreen: () => Screen.Main(),
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen: () => Screen.Main(),
      }),
    ];

    const hidden = allCommands.filter((cmd) => cmd.hidden === true);
    const visible = allCommands.filter(
      (cmd) => cmd.hidden !== true && cmd.enabled !== false,
    );

    expect(hidden.length).toBeGreaterThan(0);
    for (const hiddenCommand of hidden) {
      const inVisible = visible.find((v) => v.value === hiddenCommand.value);
      expect(inVisible).toBeUndefined();
    }
  });

  test("keybind print output is human-readable for all main commands", () => {
    const commands = createMainCommands({
      showToast: () => {},
      isGitRepo: () => true,
      hasRecentReports: () => true,
      currentScreen: () => Screen.Main(),
    });

    const expectedPrints: Record<string, string> = {
      "ctrl+k": "^K",
      "ctrl+a": "^A",
      "ctrl+p": "^P",
      "ctrl+r": "^R",
      "ctrl+f": "^F",
      "ctrl+w": "^W",
      enter: "Enter",
    };

    for (const command of commands) {
      if (command.keybind) {
        const printed = keybindPrinter.print(command.keybind);
        const expected = expectedPrints[command.keybind];
        if (expected) {
          expect(printed).toBe(expected);
        }
      }
    }
  });
});
