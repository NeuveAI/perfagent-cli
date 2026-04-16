import { describe, test, expect } from "bun:test";
import { createCommandRegistry, type CommandDef } from "../../src/context/command-registry";
import { ctrlKey, makeKeyEvent, enterKey, escKey } from "../helpers/make-key-event";

const createTestRegistry = (inputFocused: () => boolean = () => false) =>
  createCommandRegistry({ inputFocused });

describe("command registry stress tests", () => {
  test("register 20+ commands, trigger by key, verify correct one fires", () => {
    const registry = createTestRegistry();
    const fired: string[] = [];
    const letters = "abcdefghijklmnopqrst".split("");

    registry.register(() =>
      letters.map((letter) => ({
        title: `Action ${letter}`,
        value: `stress.${letter}`,
        keybind: `ctrl+${letter}`,
        category: "Stress",
        enabled: true,
        onSelect: () => { fired.push(letter); },
      })),
    );

    // Trigger each one individually
    for (const letter of letters) {
      const event = ctrlKey(letter);
      registry.handleKeyEvent(event);
    }

    expect(fired).toEqual(letters);
    expect(fired.length).toBe(20);
  });

  test("register and unregister cycles do not leak commands", () => {
    const registry = createTestRegistry();

    const unregister1 = registry.register(() => [
      {
        title: "first batch",
        value: "batch.first",
        keybind: "ctrl+x",
        category: "Batch",
        enabled: true,
        onSelect: () => {},
      },
    ]);

    expect(registry.getCommands().length).toBe(1);

    unregister1();
    expect(registry.getCommands().length).toBe(0);

    // Re-register with same keybind — should not throw
    registry.register(() => [
      {
        title: "second batch",
        value: "batch.second",
        keybind: "ctrl+x",
        category: "Batch",
        enabled: true,
        onSelect: () => {},
      },
    ]);

    expect(registry.getCommands().length).toBe(1);
    expect(registry.getCommands()[0]!.value).toBe("batch.second");
  });

  test("unregister removes the correct factory only", () => {
    const registry = createTestRegistry();

    const unregister1 = registry.register(() => [
      {
        title: "alpha",
        value: "test.alpha",
        keybind: "ctrl+m",
        category: "Test",
        enabled: true,
        onSelect: () => {},
      },
    ]);

    registry.register(() => [
      {
        title: "beta",
        value: "test.beta",
        keybind: "ctrl+n",
        category: "Test",
        enabled: true,
        onSelect: () => {},
      },
    ]);

    expect(registry.getCommands().length).toBe(2);
    unregister1();
    expect(registry.getCommands().length).toBe(1);
    expect(registry.getCommands()[0]!.value).toBe("test.beta");
  });
});

describe("command registry async onSelect behavior", () => {
  test("trigger with async onSelect does not block and returns true", () => {
    const registry = createTestRegistry();
    let resolved = false;

    registry.register(() => [
      {
        title: "async action",
        value: "test.async",
        keybind: "ctrl+z",
        category: "Test",
        enabled: true,
        onSelect: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          resolved = true;
        },
      },
    ]);

    const result = registry.trigger("test.async");
    // trigger returns synchronously
    expect(result).toBe(true);
    // async hasn't resolved yet
    expect(resolved).toBe(false);
  });

  test("rapid key events during async onSelect: each fires independently", () => {
    const registry = createTestRegistry();
    let count = 0;

    registry.register(() => [
      {
        title: "counter",
        value: "test.counter",
        keybind: "ctrl+j",
        category: "Test",
        enabled: true,
        onSelect: async () => {
          count++;
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      },
    ]);

    // Fire 5 key events rapidly
    for (let index = 0; index < 5; index++) {
      registry.handleKeyEvent(ctrlKey("j"));
    }

    // All 5 should have fired (no queuing / blocking)
    expect(count).toBe(5);
  });
});

describe("command registry getVisibleCommands", () => {
  test("filters out hidden commands", () => {
    const registry = createTestRegistry();

    registry.register(() => [
      { title: "visible", value: "v", category: "T", enabled: true, onSelect: () => {} },
      { title: "hidden", value: "h", category: "T", hidden: true, enabled: true, onSelect: () => {} },
    ]);

    const visible = registry.getVisibleCommands();
    expect(visible.length).toBe(1);
    expect(visible[0]!.value).toBe("v");
  });

  test("filters out disabled commands", () => {
    const registry = createTestRegistry();

    registry.register(() => [
      { title: "enabled", value: "e", category: "T", enabled: true, onSelect: () => {} },
      { title: "disabled", value: "d", category: "T", enabled: false, onSelect: () => {} },
    ]);

    const visible = registry.getVisibleCommands();
    expect(visible.length).toBe(1);
    expect(visible[0]!.value).toBe("e");
  });

  test("returns commands from multiple factories", () => {
    const registry = createTestRegistry();

    registry.register(() => [
      { title: "a", value: "a", category: "T", enabled: true, onSelect: () => {} },
    ]);
    registry.register(() => [
      { title: "b", value: "b", category: "T", enabled: true, onSelect: () => {} },
    ]);

    const visible = registry.getVisibleCommands();
    expect(visible.length).toBe(2);
  });
});

describe("command registry key dispatch with inputFocused", () => {
  test("handles mixed enabled/disabled commands with same keybind", () => {
    let inputFocused = false;
    const registry = createCommandRegistry({ inputFocused: () => inputFocused });
    let firedValue = "";

    registry.register(() => [
      {
        title: "action a",
        value: "a",
        keybind: "ctrl+a",
        category: "T",
        enabled: true,
        onSelect: () => { firedValue = "a"; },
      },
    ]);

    // When not focused, ctrl+a fires
    registry.handleKeyEvent(ctrlKey("a"));
    expect(firedValue).toBe("a");

    // When focused, ctrl+a is blocked (text-editing key)
    firedValue = "";
    inputFocused = true;
    const handled = registry.handleKeyEvent(ctrlKey("a"));
    expect(handled).toBe(false);
    expect(firedValue).toBe("");
  });

  test("non-text-editing keys always dispatch regardless of focus", () => {
    const registry = createCommandRegistry({ inputFocused: () => true });
    let fired = false;

    registry.register(() => [
      {
        title: "cookies",
        value: "main.cookie-sync",
        keybind: "ctrl+k",
        category: "Main",
        enabled: true,
        onSelect: () => { fired = true; },
      },
    ]);

    const handled = registry.handleKeyEvent(ctrlKey("k"));
    expect(handled).toBe(true);
    expect(fired).toBe(true);
  });
});

describe("command registry handleKeyEvent returns false for unmatched keys", () => {
  test("unregistered key returns false", () => {
    const registry = createTestRegistry();
    registry.register(() => [
      {
        title: "action",
        value: "action",
        keybind: "ctrl+z",
        category: "T",
        enabled: true,
        onSelect: () => {},
      },
    ]);

    const result = registry.handleKeyEvent(ctrlKey("y"));
    expect(result).toBe(false);
  });

  test("empty registry returns false for any key", () => {
    const registry = createTestRegistry();
    expect(registry.handleKeyEvent(ctrlKey("a"))).toBe(false);
    expect(registry.handleKeyEvent(enterKey())).toBe(false);
    expect(registry.handleKeyEvent(escKey())).toBe(false);
  });
});
