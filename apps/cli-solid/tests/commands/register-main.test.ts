import { describe, test, expect } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createMainCommands } from "../../src/commands/register-main";
import { createGlobalCommands } from "../../src/commands/register-global";
import { Screen } from "../../src/context/navigation";
import { match, print } from "../../src/context/keybind";
import { createCommandRegistry, type CommandDef } from "../../src/context/command-registry";

const makeKeyEvent = (overrides: Partial<KeyEvent>): KeyEvent => {
  const base = {
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "",
    number: false,
    raw: "",
    eventType: "press" as const,
    source: "raw" as const,
  };
  return { ...base, ...overrides } as unknown as KeyEvent;
};

const createTestRegistry = (inputFocused: () => boolean = () => false) =>
  createCommandRegistry({ inputFocused });

describe("command registry", () => {
  test("validates no duplicate keybinds on register", () => {
    const registry = createTestRegistry();

    registry.register(() => [
      {
        title: "first",
        value: "test.first",
        keybind: "ctrl+k",
        category: "Test",
        enabled: true,
        onSelect: () => {},
      },
    ]);

    expect(() => {
      registry.register(() => [
        {
          title: "second",
          value: "test.second",
          keybind: "ctrl+k",
          category: "Test",
          enabled: true,
          onSelect: () => {},
        },
      ]);
    }).toThrow("Duplicate keybind");
  });

  test("allows duplicate keybinds when one is disabled", () => {
    const registry = createTestRegistry();

    registry.register(() => [
      {
        title: "first",
        value: "test.first",
        keybind: "ctrl+k",
        category: "Test",
        enabled: false,
        onSelect: () => {},
      },
    ]);

    expect(() => {
      registry.register(() => [
        {
          title: "second",
          value: "test.second",
          keybind: "ctrl+k",
          category: "Test",
          enabled: true,
          onSelect: () => {},
        },
      ]);
    }).not.toThrow();
  });

  test("trigger fires the correct onSelect", () => {
    const registry = createTestRegistry();
    let fired = "";

    registry.register(() => [
      {
        title: "alpha",
        value: "test.alpha",
        category: "Test",
        enabled: true,
        onSelect: () => {
          fired = "alpha";
        },
      },
      {
        title: "beta",
        value: "test.beta",
        category: "Test",
        enabled: true,
        onSelect: () => {
          fired = "beta";
        },
      },
    ]);

    registry.trigger("test.beta");
    expect(fired).toBe("beta");
  });

  test("disabled commands are not triggered", () => {
    const registry = createTestRegistry();
    let fired = false;

    registry.register(() => [
      {
        title: "disabled",
        value: "test.disabled",
        category: "Test",
        enabled: false,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const result = registry.trigger("test.disabled");
    expect(result).toBe(false);
    expect(fired).toBe(false);
  });

  test("trigger returns false for unknown commands", () => {
    const registry = createTestRegistry();
    registry.register(() => []);
    const result = registry.trigger("nonexistent");
    expect(result).toBe(false);
  });
});

describe("register-main commands", () => {
  test("all main commands have unique keybinds", () => {
    const commands = createMainCommands({
      showToast: () => {},
      isGitRepo: () => true,
      hasRecentReports: () => true,
      currentScreen: () => Screen.Main(),
    });

    const keybinds = commands
      .filter((cmd) => cmd.keybind && cmd.enabled !== false)
      .map((cmd) => cmd.keybind);
    const uniqueKeybinds = new Set(keybinds);
    expect(keybinds.length).toBe(uniqueKeybinds.size);
  });

  test("main + global commands have no keybind collisions", () => {
    const registry = createTestRegistry();

    expect(() => {
      registry.register(() =>
        createGlobalCommands({
          clearScreen: () => {},
          showToast: () => {},
          goBack: () => {},
          currentScreen: () => Screen.Main(),
          overlay: () => undefined,
        }),
      );

      registry.register(() =>
        createMainCommands({
          showToast: () => {},
          isGitRepo: () => true,
          hasRecentReports: () => true,
          currentScreen: () => Screen.Main(),
        }),
      );
    }).not.toThrow();
  });

  test("pr-picker is disabled when not a git repo", () => {
    const commands = createMainCommands({
      showToast: () => {},
      isGitRepo: () => false,
      hasRecentReports: () => true,
      currentScreen: () => Screen.Main(),
    });

    const prPicker = commands.find((cmd) => cmd.value === "main.pr-picker");
    expect(prPicker?.enabled).toBe(false);
  });

  test("past-runs is disabled when no recent reports", () => {
    const commands = createMainCommands({
      showToast: () => {},
      isGitRepo: () => true,
      hasRecentReports: () => false,
      currentScreen: () => Screen.Main(),
    });

    const pastRuns = commands.find((cmd) => cmd.value === "main.past-runs");
    expect(pastRuns?.enabled).toBe(false);
  });

  test("watch is disabled when not a git repo", () => {
    const commands = createMainCommands({
      showToast: () => {},
      isGitRepo: () => false,
      hasRecentReports: () => true,
      currentScreen: () => Screen.Main(),
    });

    const watchCmd = commands.find((cmd) => cmd.value === "main.watch");
    expect(watchCmd?.enabled).toBe(false);
  });

  test("each main command fires toast on select", () => {
    const toasts: string[] = [];
    const commands = createMainCommands({
      showToast: (message) => toasts.push(message),
      isGitRepo: () => true,
      hasRecentReports: () => true,
      currentScreen: () => Screen.Main(),
    });

    for (const command of commands) {
      if (command.enabled !== false) {
        command.onSelect();
      }
    }

    expect(toasts.length).toBeGreaterThan(0);
    for (const toastMessage of toasts) {
      expect(toastMessage).toBe("not yet wired");
    }
  });
});

describe("keybind matching", () => {
  test("ctrl+l matches ctrl+l event", () => {
    const event = makeKeyEvent({ name: "l", ctrl: true });
    expect(match("ctrl+l", event)).toBe(true);
  });

  test("ctrl+l does not match bare l", () => {
    const event = makeKeyEvent({ name: "l", ctrl: false });
    expect(match("ctrl+l", event)).toBe(false);
  });

  test("esc matches escape event", () => {
    const event = makeKeyEvent({ name: "escape" });
    expect(match("esc", event)).toBe(true);
  });

  test("enter matches return event", () => {
    const event = makeKeyEvent({ name: "return" });
    expect(match("enter", event)).toBe(true);
  });

  test("ctrl+k does not match ctrl+l", () => {
    const event = makeKeyEvent({ name: "l", ctrl: true });
    expect(match("ctrl+k", event)).toBe(false);
  });
});

describe("keybind printing", () => {
  test("ctrl+f prints as ^F", () => {
    expect(print("ctrl+f")).toBe("^F");
  });

  test("ctrl+l prints as ^L", () => {
    expect(print("ctrl+l")).toBe("^L");
  });

  test("esc prints as Esc", () => {
    expect(print("esc")).toBe("Esc");
  });

  test("enter prints as Enter", () => {
    expect(print("enter")).toBe("Enter");
  });
});

describe("hidden commands and key dispatch", () => {
  test("hidden commands DO trigger via handleKeyEvent", () => {
    const registry = createTestRegistry();
    let fired = false;

    registry.register(() => [
      {
        title: "hidden action",
        value: "test.hidden",
        keybind: "ctrl+u",
        category: "Test",
        hidden: true,
        enabled: true,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "u", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(true);
    expect(fired).toBe(true);
  });

  test("hidden commands do NOT appear in getVisibleCommands", () => {
    const registry = createTestRegistry();

    registry.register(() => [
      {
        title: "hidden action",
        value: "test.hidden",
        keybind: "ctrl+u",
        category: "Test",
        hidden: true,
        enabled: true,
        onSelect: () => {},
      },
    ]);

    const visible = registry.getVisibleCommands();
    expect(visible.find((cmd) => cmd.value === "test.hidden")).toBeUndefined();
  });

  test("ctrl+l is hidden but still triggers via keybind", () => {
    const registry = createTestRegistry();
    let cleared = false;

    registry.register(() =>
      createGlobalCommands({
        clearScreen: () => {
          cleared = true;
        },
        showToast: () => {},
        goBack: () => {},
        currentScreen: () => Screen.Main(),
        overlay: () => undefined,
      }),
    );

    const clearCommand = registry.getCommands().find((cmd) => cmd.value === "global.clear");
    expect(clearCommand?.hidden).toBe(true);

    const visible = registry.getVisibleCommands();
    expect(visible.find((cmd) => cmd.value === "global.clear")).toBeUndefined();

    const event = makeKeyEvent({ name: "l", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(true);
    expect(cleared).toBe(true);
  });

  test("enter (main.submit) is hidden but triggers via keybind", () => {
    const registry = createTestRegistry();
    let submitted = false;

    registry.register(() => [
      {
        title: "submit",
        value: "main.submit",
        keybind: "enter",
        category: "Main",
        hidden: true,
        enabled: true,
        onSelect: () => {
          submitted = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "return" });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(true);
    expect(submitted).toBe(true);
  });
});

describe("input focus prevents command dispatch for text-editing keys", () => {
  test("ctrl+a is NOT dispatched when input is focused", () => {
    let inputFocused = true;
    const registry = createTestRegistry(() => inputFocused);
    let fired = false;

    registry.register(() => [
      {
        title: "agent",
        value: "main.agent-picker",
        keybind: "ctrl+a",
        category: "Main",
        enabled: true,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "a", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(false);
    expect(fired).toBe(false);
  });

  test("ctrl+a IS dispatched when input is NOT focused", () => {
    let inputFocused = false;
    const registry = createTestRegistry(() => inputFocused);
    let fired = false;

    registry.register(() => [
      {
        title: "agent",
        value: "main.agent-picker",
        keybind: "ctrl+a",
        category: "Main",
        enabled: true,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "a", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(true);
    expect(fired).toBe(true);
  });

  test("ctrl+w is NOT dispatched when input is focused", () => {
    const registry = createTestRegistry(() => true);
    let fired = false;

    registry.register(() => [
      {
        title: "watch",
        value: "main.watch",
        keybind: "ctrl+w",
        category: "Main",
        enabled: true,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "w", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(false);
    expect(fired).toBe(false);
  });

  test("ctrl+e is NOT dispatched when input is focused", () => {
    const registry = createTestRegistry(() => true);
    let fired = false;

    registry.register(() => [
      {
        title: "some action",
        value: "test.ctrl-e",
        keybind: "ctrl+e",
        category: "Test",
        enabled: true,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "e", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(false);
    expect(fired).toBe(false);
  });

  test("ctrl+k IS dispatched even when input is focused (not a text-editing key)", () => {
    const registry = createTestRegistry(() => true);
    let fired = false;

    registry.register(() => [
      {
        title: "cookies",
        value: "main.cookie-sync",
        keybind: "ctrl+k",
        category: "Main",
        enabled: true,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "k", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(true);
    expect(fired).toBe(true);
  });

  test("ctrl+l IS dispatched even when input is focused (not a text-editing key)", () => {
    const registry = createTestRegistry(() => true);
    let fired = false;

    registry.register(() => [
      {
        title: "clear",
        value: "global.clear",
        keybind: "ctrl+l",
        category: "Global",
        hidden: true,
        enabled: true,
        onSelect: () => {
          fired = true;
        },
      },
    ]);

    const event = makeKeyEvent({ name: "l", ctrl: true });
    const handled = registry.handleKeyEvent(event);
    expect(handled).toBe(true);
    expect(fired).toBe(true);
  });
});
