import { describe, test, expect } from "bun:test";
import { createTestingCommands } from "../../src/commands/register-testing";
import { createGlobalCommands } from "../../src/commands/register-global";
import { createMainCommands } from "../../src/commands/register-main";
import { createCommandRegistry } from "../../src/context/command-registry";
import { Screen } from "../../src/context/navigation";
import { ChangesFor } from "@neuve/shared/models";

const testingScreen = () =>
  Screen.Testing({
    changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
    instruction: "test something",
  });

describe("register-testing commands", () => {
  test("creates expected command set", () => {
    const commands = createTestingCommands({
      currentScreen: testingScreen,
    });
    const values = commands.map((cmd) => cmd.value);

    expect(values).toContain("testing.cancel");
    expect(values).toContain("testing.expand");
  });

  test("all testing commands are hidden", () => {
    const commands = createTestingCommands({
      currentScreen: testingScreen,
    });
    for (const cmd of commands) {
      expect(cmd.hidden).toBe(true);
    }
  });

  test("commands are enabled on Testing screen", () => {
    const commands = createTestingCommands({
      currentScreen: testingScreen,
    });

    const cancel = commands.find((cmd) => cmd.value === "testing.cancel");
    const expand = commands.find((cmd) => cmd.value === "testing.expand");
    expect(cancel?.enabled).toBe(true);
    expect(expand?.enabled).toBe(true);
  });

  test("commands are disabled on Main screen", () => {
    const commands = createTestingCommands({
      currentScreen: () => Screen.Main(),
    });

    const cancel = commands.find((cmd) => cmd.value === "testing.cancel");
    const expand = commands.find((cmd) => cmd.value === "testing.expand");
    expect(cancel?.enabled).toBe(false);
    expect(expand?.enabled).toBe(false);
  });

  test("commands are disabled on PortPicker screen", () => {
    const commands = createTestingCommands({
      currentScreen: () =>
        Screen.PortPicker({
          changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
          instruction: "test",
        }),
    });

    const cancel = commands.find((cmd) => cmd.value === "testing.cancel");
    expect(cancel?.enabled).toBe(false);
  });

  test("commands are disabled on CookieSyncConfirm screen", () => {
    const commands = createTestingCommands({
      currentScreen: () => Screen.CookieSyncConfirm({}),
    });

    const cancel = commands.find((cmd) => cmd.value === "testing.cancel");
    expect(cancel?.enabled).toBe(false);
  });

  test("no keybind collisions with global commands", () => {
    const registry = createCommandRegistry({ inputFocused: () => false });

    expect(() => {
      registry.register(() =>
        createGlobalCommands({
          clearScreen: () => {},
          showToast: () => {},
          goBack: () => {},
          currentScreen: testingScreen,
          overlay: () => undefined,
        }),
      );

      registry.register(() =>
        createTestingCommands({
          currentScreen: testingScreen,
        }),
      );
    }).not.toThrow();
  });

  test("no keybind collisions with main commands (different screens)", () => {
    const registry = createCommandRegistry({ inputFocused: () => false });

    expect(() => {
      registry.register(() =>
        createMainCommands({
          showToast: () => {},
          isGitRepo: () => true,
          hasRecentReports: () => true,
          currentScreen: () => Screen.Main(),
        }),
      );

      registry.register(() =>
        createTestingCommands({
          currentScreen: testingScreen,
        }),
      );
    }).not.toThrow();
  });

  test("cancel has no keybind (handled in-screen via useKeyboard)", () => {
    const commands = createTestingCommands({
      currentScreen: testingScreen,
    });

    const cancel = commands.find((cmd) => cmd.value === "testing.cancel");
    expect(cancel?.keybind).toBeUndefined();
  });

  test("expand keybind is ctrl+o", () => {
    const commands = createTestingCommands({
      currentScreen: testingScreen,
    });

    const expand = commands.find((cmd) => cmd.value === "testing.expand");
    expect(expand?.keybind).toBe("ctrl+o");
  });
});
