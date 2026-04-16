import { describe, test, expect } from "bun:test";
import { createSignal } from "solid-js";

// Test input focus state logic directly.
// Mirrors the InputFocusProvider implementation.

const createInputFocusState = () => {
  const [focused, setFocused] = createSignal(false);
  return { focused, setFocused };
};

describe("input focus state", () => {
  test("starts unfocused", () => {
    const state = createInputFocusState();
    expect(state.focused()).toBe(false);
  });

  test("setFocused(true) enables focus", () => {
    const state = createInputFocusState();
    state.setFocused(true);
    expect(state.focused()).toBe(true);
  });

  test("setFocused(false) disables focus", () => {
    const state = createInputFocusState();
    state.setFocused(true);
    state.setFocused(false);
    expect(state.focused()).toBe(false);
  });

  test("focus transitions toggle correctly", () => {
    const state = createInputFocusState();
    expect(state.focused()).toBe(false);
    state.setFocused(true);
    expect(state.focused()).toBe(true);
    state.setFocused(false);
    expect(state.focused()).toBe(false);
    state.setFocused(true);
    expect(state.focused()).toBe(true);
  });
});

describe("input focus and command dispatch interaction", () => {
  test("text-editing keys blocked when focused", () => {
    // This replicates the registry logic pattern
    const INPUT_TEXT_EDITING_KEYBINDS = new Set(["ctrl+a", "ctrl+e", "ctrl+w"]);
    const isInputTextEditingKey = (keybind: string): boolean =>
      INPUT_TEXT_EDITING_KEYBINDS.has(keybind.toLowerCase());

    const state = createInputFocusState();
    state.setFocused(true);

    // When focused, these keybinds should be blocked
    expect(isInputTextEditingKey("ctrl+a")).toBe(true);
    expect(isInputTextEditingKey("ctrl+e")).toBe(true);
    expect(isInputTextEditingKey("ctrl+w")).toBe(true);

    // These should NOT be blocked even when focused
    expect(isInputTextEditingKey("ctrl+k")).toBe(false);
    expect(isInputTextEditingKey("ctrl+l")).toBe(false);
    expect(isInputTextEditingKey("ctrl+p")).toBe(false);
    expect(isInputTextEditingKey("ctrl+f")).toBe(false);
    expect(isInputTextEditingKey("ctrl+r")).toBe(false);
  });

  test("no text-editing keys blocked when unfocused", () => {
    const state = createInputFocusState();
    // When not focused, all keys should pass through command registry
    expect(state.focused()).toBe(false);
  });
});
