import { describe, test, expect } from "bun:test";
import { createCommandRegistry } from "../../src/context/command-registry";
import { createGlobalCommands } from "../../src/commands/register-global";
import { createMainCommands } from "../../src/commands/register-main";
import { createCookieSyncCommands } from "../../src/commands/register-cookie-sync";
import { createPortPickerCommands } from "../../src/commands/register-port-picker";
import { createTestingCommands } from "../../src/commands/register-testing";
import { createResultsCommands } from "../../src/commands/register-results";
import { Screen } from "../../src/context/navigation";
import { charKey, ctrlKey, enterKey, escKey } from "../helpers/make-key-event";
import { ChangesFor } from "@neuve/shared/models";

const testingScreen = () =>
  Screen.Testing({
    changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
    instruction: "test something",
  });

const resultsScreen = () =>
  Screen.Results({ report: {} as never, videoUrl: undefined });

const portPickerScreen = () =>
  Screen.PortPicker({
    changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
    instruction: "test",
  });

const cookieSyncScreen = () => Screen.CookieSyncConfirm({});

interface ScreenFactory {
  readonly name: string;
  readonly make: () => Screen;
}

const ALL_SCREENS: readonly ScreenFactory[] = [
  { name: "Main", make: () => Screen.Main() },
  { name: "CookieSyncConfirm", make: cookieSyncScreen },
  { name: "PortPicker", make: portPickerScreen },
  { name: "Testing", make: testingScreen },
  { name: "Results", make: resultsScreen },
];

const buildFullRegistry = (currentScreen: () => Screen) => {
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

  registry.register(() =>
    createCookieSyncCommands({ currentScreen }),
  );

  registry.register(() =>
    createPortPickerCommands({ currentScreen }),
  );

  registry.register(() =>
    createTestingCommands({ currentScreen }),
  );

  registry.register(() =>
    createResultsCommands({ currentScreen }),
  );

  return registry;
};

describe("screen command isolation", () => {
  describe("no keybind collisions across all screens", () => {
    for (const screenFactory of ALL_SCREENS) {
      test(`no duplicate keybinds on ${screenFactory.name} screen`, () => {
        expect(() =>
          buildFullRegistry(() => screenFactory.make()),
        ).not.toThrow();
      });
    }
  });

  describe("main commands disabled on non-Main screens", () => {
    const mainOnlyCommands = [
      "main.cookie-sync",
      "main.agent-picker",
      "main.pr-picker",
      "main.saved-flows",
      "main.past-runs",
      "main.watch",
      "main.submit",
    ];

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "Main")) {
      test(`main commands disabled on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const commands = registry.getCommands();

        for (const commandValue of mainOnlyCommands) {
          const command = commands.find((cmd) => cmd.value === commandValue);
          expect(command?.enabled).toBe(false);
        }
      });
    }
  });

  describe("results commands disabled on non-Results screens", () => {
    const resultsOnlyCommands = [
      "results.copy",
      "results.save",
      "results.restart",
      "results.ask",
      "results.insights",
      "results.raw-events",
    ];

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "Results")) {
      test(`results commands disabled on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const commands = registry.getCommands();

        for (const commandValue of resultsOnlyCommands) {
          const command = commands.find((cmd) => cmd.value === commandValue);
          expect(command?.enabled).toBe(false);
        }
      });
    }
  });

  describe("testing commands disabled on non-Testing screens", () => {
    const testingOnlyCommands = ["testing.cancel", "testing.expand"];

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "Testing")) {
      test(`testing commands disabled on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const commands = registry.getCommands();

        for (const commandValue of testingOnlyCommands) {
          const command = commands.find((cmd) => cmd.value === commandValue);
          expect(command?.enabled).toBe(false);
        }
      });
    }
  });

  describe("cookie-sync commands disabled on non-CookieSyncConfirm screens", () => {
    const cookieSyncCommands = ["cookie-sync.confirm", "cookie-sync.toggle"];

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "CookieSyncConfirm")) {
      test(`cookie-sync commands disabled on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const commands = registry.getCommands();

        for (const commandValue of cookieSyncCommands) {
          const command = commands.find((cmd) => cmd.value === commandValue);
          expect(command?.enabled).toBe(false);
        }
      });
    }
  });

  describe("port-picker commands disabled on non-PortPicker screens", () => {
    const portPickerCommands = ["port-picker.confirm", "port-picker.toggle"];

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "PortPicker")) {
      test(`port-picker commands disabled on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const commands = registry.getCommands();

        for (const commandValue of portPickerCommands) {
          const command = commands.find((cmd) => cmd.value === commandValue);
          expect(command?.enabled).toBe(false);
        }
      });
    }
  });

  describe("enter keybind only fires for the active screen", () => {
    test("enter dispatches on Main (main.submit) but not cookie-sync/port-picker enter", () => {
      const registry = buildFullRegistry(() => Screen.Main());
      const commands = registry.getCommands();

      const mainSubmit = commands.find((cmd) => cmd.value === "main.submit");
      const cookieConfirm = commands.find((cmd) => cmd.value === "cookie-sync.confirm");
      const portConfirm = commands.find((cmd) => cmd.value === "port-picker.confirm");

      expect(mainSubmit?.enabled).toBe(true);
      expect(mainSubmit?.keybind).toBe("enter");
      expect(cookieConfirm?.enabled).toBe(false);
      expect(portConfirm?.enabled).toBe(false);
    });

    test("enter dispatches on CookieSyncConfirm (cookie-sync.confirm) but not main/port-picker", () => {
      const registry = buildFullRegistry(cookieSyncScreen);
      const commands = registry.getCommands();

      const mainSubmit = commands.find((cmd) => cmd.value === "main.submit");
      const cookieConfirm = commands.find((cmd) => cmd.value === "cookie-sync.confirm");
      const portConfirm = commands.find((cmd) => cmd.value === "port-picker.confirm");

      expect(cookieConfirm?.enabled).toBe(true);
      expect(cookieConfirm?.keybind).toBe("enter");
      expect(mainSubmit?.enabled).toBe(false);
      expect(portConfirm?.enabled).toBe(false);
    });

    test("enter dispatches on PortPicker (port-picker.confirm) but not main/cookie-sync", () => {
      const registry = buildFullRegistry(portPickerScreen);
      const commands = registry.getCommands();

      const mainSubmit = commands.find((cmd) => cmd.value === "main.submit");
      const cookieConfirm = commands.find((cmd) => cmd.value === "cookie-sync.confirm");
      const portConfirm = commands.find((cmd) => cmd.value === "port-picker.confirm");

      expect(portConfirm?.enabled).toBe(true);
      expect(portConfirm?.keybind).toBe("enter");
      expect(mainSubmit?.enabled).toBe(false);
      expect(cookieConfirm?.enabled).toBe(false);
    });
  });

  describe("y/s/r keys only fire on Results screen", () => {
    test("y dispatches results.copy on Results", () => {
      const registry = buildFullRegistry(resultsScreen);
      const commands = registry.getCommands();

      const copy = commands.find((cmd) => cmd.value === "results.copy");
      expect(copy?.enabled).toBe(true);
      expect(copy?.keybind).toBe("y");
    });

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "Results")) {
      test(`y does not dispatch on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const handled = registry.handleKeyEvent(charKey("y"));
        expect(handled).toBe(false);
      });
    }

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "Results")) {
      test(`s does not dispatch on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const handled = registry.handleKeyEvent(charKey("s"));
        expect(handled).toBe(false);
      });
    }

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "Results")) {
      test(`r does not dispatch on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const handled = registry.handleKeyEvent(charKey("r"));
        expect(handled).toBe(false);
      });
    }
  });

  describe("ctrl+a (agent picker) only fires on Main screen", () => {
    test("ctrl+a dispatches on Main", () => {
      const registry = buildFullRegistry(() => Screen.Main());
      let fired = false;
      const commands = registry.getCommands();
      const agentPicker = commands.find((cmd) => cmd.value === "main.agent-picker");
      expect(agentPicker?.enabled).toBe(true);
      expect(agentPicker?.keybind).toBe("ctrl+a");
    });

    for (const screenFactory of ALL_SCREENS.filter((s) => s.name !== "Main")) {
      test(`ctrl+a does not dispatch on ${screenFactory.name}`, () => {
        const registry = buildFullRegistry(() => screenFactory.make());
        const handled = registry.handleKeyEvent(ctrlKey("a"));
        expect(handled).toBe(false);
      });
    }
  });

  describe("esc behavior per screen", () => {
    test("esc is disabled on Main screen (no go-back from home)", () => {
      const registry = buildFullRegistry(() => Screen.Main());
      const commands = registry.getCommands();
      const back = commands.find((cmd) => cmd.value === "global.back");
      expect(back?.enabled).toBe(false);
    });

    test("esc on Testing screen is a no-op via goBack (cancel handled in-screen)", () => {
      const registry = buildFullRegistry(testingScreen);
      const commands = registry.getCommands();
      const back = commands.find((cmd) => cmd.value === "global.back");
      // global.back is enabled but goBack() is a no-op for Testing/Watch —
      // the TestingScreen handles esc via its own useKeyboard for cancel confirmation
      expect(back?.enabled).toBe(true);
    });

    test("esc on Watch screen is a no-op via goBack", () => {
      const watchScreen = () =>
        Screen.Watch({
          changesFor: ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" }),
          instruction: "watch",
        });
      const registry = buildFullRegistry(watchScreen);
      const commands = registry.getCommands();
      const back = commands.find((cmd) => cmd.value === "global.back");
      // same as Testing — goBack() returns early without navigating
      expect(back?.enabled).toBe(true);
    });

    test("esc is enabled on CookieSyncConfirm screen", () => {
      const registry = buildFullRegistry(cookieSyncScreen);
      const commands = registry.getCommands();
      const back = commands.find((cmd) => cmd.value === "global.back");
      expect(back?.enabled).toBe(true);
    });

    test("esc is enabled on PortPicker screen", () => {
      const registry = buildFullRegistry(portPickerScreen);
      const commands = registry.getCommands();
      const back = commands.find((cmd) => cmd.value === "global.back");
      expect(back?.enabled).toBe(true);
    });

    test("esc is enabled on Results screen", () => {
      const registry = buildFullRegistry(resultsScreen);
      const commands = registry.getCommands();
      const back = commands.find((cmd) => cmd.value === "global.back");
      expect(back?.enabled).toBe(true);
    });
  });
});
