import { describe, test, expect } from "bun:test";
import { createCommandRegistry } from "../../src/context/command-registry";
import { createGlobalCommands } from "../../src/commands/register-global";
import { createMainCommands } from "../../src/commands/register-main";
import { createCookieSyncCommands } from "../../src/commands/register-cookie-sync";
import { createPortPickerCommands } from "../../src/commands/register-port-picker";
import { createTestingCommands } from "../../src/commands/register-testing";
import { createResultsCommands } from "../../src/commands/register-results";
import { Screen } from "../../src/context/navigation";
import { ChangesFor } from "@neuve/shared/models";

const EXPECTED_COMMAND_SETS = [
  {
    name: "global",
    values: [
      "global.clear",
      "global.update",
      "global.back",
      "global.quit",
      "global.force-quit",
    ],
  },
  {
    name: "main",
    values: [
      "main.cookie-sync",
      "main.agent-picker",
      "main.pr-picker",
      "main.saved-flows",
      "main.past-runs",
      "main.watch",
      "main.submit",
    ],
  },
  {
    name: "cookie-sync",
    values: ["cookie-sync.confirm", "cookie-sync.toggle"],
  },
  {
    name: "port-picker",
    values: ["port-picker.confirm", "port-picker.toggle"],
  },
  {
    name: "testing",
    values: ["testing.cancel", "testing.expand", "testing.retry"],
  },
  {
    name: "results",
    values: [
      "results.copy",
      "results.save",
      "results.restart",
      "results.ask",
      "results.insights",
      "results.raw-events",
    ],
  },
];

describe("app wiring — all command sets registered", () => {
  test("all 6 command sets produce expected command values", () => {
    const currentScreen = () => Screen.Main();

    const allCommands = [
      ...createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
      ...createCookieSyncCommands({ currentScreen }),
      ...createPortPickerCommands({ currentScreen }),
      ...createTestingCommands({ currentScreen }),
      ...createResultsCommands({ currentScreen }),
    ];

    const allValues = allCommands.map((cmd) => cmd.value);

    for (const commandSet of EXPECTED_COMMAND_SETS) {
      for (const expectedValue of commandSet.values) {
        expect(allValues).toContain(expectedValue);
      }
    }
  });

  test("total command count matches expected", () => {
    const expectedTotal = EXPECTED_COMMAND_SETS.reduce(
      (sum, commandSet) => sum + commandSet.values.length,
      0,
    );

    const currentScreen = () => Screen.Main();
    const allCommands = [
      ...createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
      ...createCookieSyncCommands({ currentScreen }),
      ...createPortPickerCommands({ currentScreen }),
      ...createTestingCommands({ currentScreen }),
      ...createResultsCommands({ currentScreen }),
    ];

    expect(allCommands.length).toBe(expectedTotal);
  });

  test("no duplicate command values across all sets", () => {
    const currentScreen = () => Screen.Main();
    const allCommands = [
      ...createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
      ...createCookieSyncCommands({ currentScreen }),
      ...createPortPickerCommands({ currentScreen }),
      ...createTestingCommands({ currentScreen }),
      ...createResultsCommands({ currentScreen }),
    ];

    const values = allCommands.map((cmd) => cmd.value);
    const uniqueValues = new Set(values);
    expect(values.length).toBe(uniqueValues.size);
  });

  test("every command with a keybind has that keybind defined as a non-empty string", () => {
    const currentScreen = () => Screen.Main();
    const allCommands = [
      ...createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
      ...createCookieSyncCommands({ currentScreen }),
      ...createPortPickerCommands({ currentScreen }),
      ...createTestingCommands({ currentScreen }),
      ...createResultsCommands({ currentScreen }),
    ];

    for (const command of allCommands) {
      if (command.keybind !== undefined) {
        expect(command.keybind.length).toBeGreaterThan(0);
      }
    }
  });

  test("every command has a non-empty title", () => {
    const currentScreen = () => Screen.Main();
    const allCommands = [
      ...createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
      ...createCookieSyncCommands({ currentScreen }),
      ...createPortPickerCommands({ currentScreen }),
      ...createTestingCommands({ currentScreen }),
      ...createResultsCommands({ currentScreen }),
    ];

    for (const command of allCommands) {
      expect(command.title.length).toBeGreaterThan(0);
    }
  });

  test("every command has a non-empty category", () => {
    const currentScreen = () => Screen.Main();
    const allCommands = [
      ...createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
      ...createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
      ...createCookieSyncCommands({ currentScreen }),
      ...createPortPickerCommands({ currentScreen }),
      ...createTestingCommands({ currentScreen }),
      ...createResultsCommands({ currentScreen }),
    ];

    for (const command of allCommands) {
      expect(command.category.length).toBeGreaterThan(0);
    }
  });
});

describe("app wiring — Screen tagged union covers critical screens", () => {
  test("Screen.Main exists", () => {
    const screen = Screen.Main();
    expect(screen._tag).toBe("Main");
  });

  test("Screen.CookieSyncConfirm exists", () => {
    const screen = Screen.CookieSyncConfirm({});
    expect(screen._tag).toBe("CookieSyncConfirm");
  });

  test("Screen.PortPicker exists", () => {
    const screen = Screen.PortPicker({
      changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
      instruction: "test",
    });
    expect(screen._tag).toBe("PortPicker");
  });

  test("Screen.Testing exists", () => {
    const screen = Screen.Testing({
      changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
      instruction: "test",
    });
    expect(screen._tag).toBe("Testing");
  });

  test("Screen.Results exists", () => {
    const screen = Screen.Results({ report: {} as never });
    expect(screen._tag).toBe("Results");
  });

  test("Screen.Watch exists", () => {
    const screen = Screen.Watch({
      changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
      instruction: "watch",
    });
    expect(screen._tag).toBe("Watch");
  });
});

describe("app wiring — modeline shows correct visible commands per screen", () => {
  test("Main screen shows main category commands (non-hidden, enabled)", () => {
    const currentScreen = () => Screen.Main();
    const registry = createCommandRegistry({ inputFocused: () => false });

    registry.register(() =>
      createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
    );
    registry.register(() =>
      createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
    );
    registry.register(() => createCookieSyncCommands({ currentScreen }));
    registry.register(() => createPortPickerCommands({ currentScreen }));
    registry.register(() => createTestingCommands({ currentScreen }));
    registry.register(() => createResultsCommands({ currentScreen }));

    const visible = registry.getVisibleCommands();
    const visibleValues = visible.map((cmd) => cmd.value);

    expect(visibleValues).toContain("main.cookie-sync");
    expect(visibleValues).toContain("main.agent-picker");
    expect(visibleValues).toContain("main.saved-flows");
    expect(visibleValues).toContain("main.watch");

    expect(visibleValues).not.toContain("global.clear");
    expect(visibleValues).not.toContain("global.back");
    expect(visibleValues).not.toContain("main.submit");

    expect(visibleValues).not.toContain("results.copy");
    expect(visibleValues).not.toContain("results.save");
    expect(visibleValues).not.toContain("results.restart");
    expect(visibleValues).not.toContain("testing.cancel");
  });

  test("Results screen shows results category visible commands", () => {
    const currentScreen = () =>
      Screen.Results({ report: {} as never });
    const registry = createCommandRegistry({ inputFocused: () => false });

    registry.register(() =>
      createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
    );
    registry.register(() =>
      createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
    );
    registry.register(() => createCookieSyncCommands({ currentScreen }));
    registry.register(() => createPortPickerCommands({ currentScreen }));
    registry.register(() => createTestingCommands({ currentScreen }));
    registry.register(() => createResultsCommands({ currentScreen }));

    const visible = registry.getVisibleCommands();
    const visibleValues = visible.map((cmd) => cmd.value);

    expect(visibleValues).toContain("results.copy");
    expect(visibleValues).toContain("results.save");
    expect(visibleValues).toContain("results.restart");

    expect(visibleValues).not.toContain("results.ask");
    expect(visibleValues).not.toContain("results.insights");
    expect(visibleValues).not.toContain("results.raw-events");

    expect(visibleValues).not.toContain("main.cookie-sync");
    expect(visibleValues).not.toContain("main.agent-picker");
  });

  test("Testing screen shows no visible commands (all testing commands are hidden)", () => {
    const currentScreen = () =>
      Screen.Testing({
        changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
        instruction: "test",
      });
    const registry = createCommandRegistry({ inputFocused: () => false });

    registry.register(() =>
      createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
    );
    registry.register(() =>
      createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
    );
    registry.register(() => createCookieSyncCommands({ currentScreen }));
    registry.register(() => createPortPickerCommands({ currentScreen }));
    registry.register(() => createTestingCommands({ currentScreen }));
    registry.register(() => createResultsCommands({ currentScreen }));

    const visible = registry.getVisibleCommands();
    expect(visible.length).toBe(0);
  });

  test("CookieSyncConfirm screen shows no visible commands (all are hidden)", () => {
    const currentScreen = () => Screen.CookieSyncConfirm({});
    const registry = createCommandRegistry({ inputFocused: () => false });

    registry.register(() =>
      createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
    );
    registry.register(() =>
      createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
    );
    registry.register(() => createCookieSyncCommands({ currentScreen }));
    registry.register(() => createPortPickerCommands({ currentScreen }));
    registry.register(() => createTestingCommands({ currentScreen }));
    registry.register(() => createResultsCommands({ currentScreen }));

    const visible = registry.getVisibleCommands();
    expect(visible.length).toBe(0);
  });

  test("PortPicker screen shows no visible commands (all are hidden)", () => {
    const currentScreen = () =>
      Screen.PortPicker({
        changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
        instruction: "test",
      });
    const registry = createCommandRegistry({ inputFocused: () => false });

    registry.register(() =>
      createGlobalCommands({
        clearScreen: () => {},
        showToast: () => {},
        goBack: () => {},
        currentScreen,
        overlay: () => undefined,
      }),
    );
    registry.register(() =>
      createMainCommands({
        showToast: () => {},
        isGitRepo: () => true,
        hasRecentReports: () => true,
        currentScreen,
      }),
    );
    registry.register(() => createCookieSyncCommands({ currentScreen }));
    registry.register(() => createPortPickerCommands({ currentScreen }));
    registry.register(() => createTestingCommands({ currentScreen }));
    registry.register(() => createResultsCommands({ currentScreen }));

    const visible = registry.getVisibleCommands();
    expect(visible.length).toBe(0);
  });
});
