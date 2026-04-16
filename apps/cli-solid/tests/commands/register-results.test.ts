import { describe, test, expect } from "bun:test";
import { createResultsCommands } from "../../src/commands/register-results";
import { createGlobalCommands } from "../../src/commands/register-global";
import { createMainCommands } from "../../src/commands/register-main";
import { createTestingCommands } from "../../src/commands/register-testing";
import { createCommandRegistry } from "../../src/context/command-registry";
import { Screen } from "../../src/context/navigation";
import { ChangesFor } from "@neuve/shared/models";

const resultsScreen = () =>
  Screen.Results({
    report: {} as never,
    videoUrl: "https://example.com/video",
  });

const testingScreen = () =>
  Screen.Testing({
    changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
    instruction: "test something",
  });

describe("register-results commands", () => {
  test("creates expected command set", () => {
    const commands = createResultsCommands({
      currentScreen: resultsScreen,
    });
    const values = commands.map((cmd) => cmd.value);

    expect(values).toContain("results.copy");
    expect(values).toContain("results.save");
    expect(values).toContain("results.restart");
    expect(values).toContain("results.ask");
    expect(values).toContain("results.insights");
    expect(values).toContain("results.raw-events");
  });

  test("copy, save, restart are visible; ask, insights, raw-events are hidden", () => {
    const commands = createResultsCommands({
      currentScreen: resultsScreen,
    });

    const copy = commands.find((cmd) => cmd.value === "results.copy");
    const save = commands.find((cmd) => cmd.value === "results.save");
    const restart = commands.find((cmd) => cmd.value === "results.restart");
    const ask = commands.find((cmd) => cmd.value === "results.ask");
    const insights = commands.find((cmd) => cmd.value === "results.insights");
    const rawEvents = commands.find((cmd) => cmd.value === "results.raw-events");

    expect(copy?.hidden).toBeUndefined();
    expect(save?.hidden).toBeUndefined();
    expect(restart?.hidden).toBeUndefined();
    expect(ask?.hidden).toBe(true);
    expect(insights?.hidden).toBe(true);
    expect(rawEvents?.hidden).toBe(true);
  });

  test("commands are enabled on Results screen", () => {
    const commands = createResultsCommands({
      currentScreen: resultsScreen,
    });

    for (const cmd of commands) {
      expect(cmd.enabled).toBe(true);
    }
  });

  test("commands are disabled on Main screen", () => {
    const commands = createResultsCommands({
      currentScreen: () => Screen.Main(),
    });

    for (const cmd of commands) {
      expect(cmd.enabled).toBe(false);
    }
  });

  test("commands are disabled on Testing screen", () => {
    const commands = createResultsCommands({
      currentScreen: testingScreen,
    });

    for (const cmd of commands) {
      expect(cmd.enabled).toBe(false);
    }
  });

  test("commands are disabled on PortPicker screen", () => {
    const commands = createResultsCommands({
      currentScreen: () =>
        Screen.PortPicker({
          changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
          instruction: "test",
        }),
    });

    for (const cmd of commands) {
      expect(cmd.enabled).toBe(false);
    }
  });

  test("keybinds are correct", () => {
    const commands = createResultsCommands({
      currentScreen: resultsScreen,
    });

    const copy = commands.find((cmd) => cmd.value === "results.copy");
    const save = commands.find((cmd) => cmd.value === "results.save");
    const restart = commands.find((cmd) => cmd.value === "results.restart");
    const ask = commands.find((cmd) => cmd.value === "results.ask");
    const insights = commands.find((cmd) => cmd.value === "results.insights");
    const rawEvents = commands.find((cmd) => cmd.value === "results.raw-events");

    expect(copy?.keybind).toBe("y");
    expect(save?.keybind).toBe("s");
    expect(restart?.keybind).toBe("r");
    expect(ask?.keybind).toBe("a");
    expect(insights?.keybind).toBe("i");
    expect(rawEvents?.keybind).toBe("ctrl+o");
  });

  test("no keybind collisions with global commands", () => {
    const registry = createCommandRegistry({ inputFocused: () => false });

    expect(() => {
      registry.register(() =>
        createGlobalCommands({
          clearScreen: () => {},
          showToast: () => {},
          goBack: () => {},
          currentScreen: resultsScreen,
          overlay: () => undefined,
        }),
      );

      registry.register(() =>
        createResultsCommands({
          currentScreen: resultsScreen,
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
        createResultsCommands({
          currentScreen: resultsScreen,
        }),
      );
    }).not.toThrow();
  });

  test("no keybind collisions with testing commands (same currentScreen signal)", () => {
    const registry = createCommandRegistry({ inputFocused: () => false });

    expect(() => {
      registry.register(() =>
        createTestingCommands({
          currentScreen: resultsScreen,
        }),
      );

      registry.register(() =>
        createResultsCommands({
          currentScreen: resultsScreen,
        }),
      );
    }).not.toThrow();
  });

  test("all commands belong to Results category", () => {
    const commands = createResultsCommands({
      currentScreen: resultsScreen,
    });

    for (const cmd of commands) {
      expect(cmd.category).toBe("Results");
    }
  });
});
