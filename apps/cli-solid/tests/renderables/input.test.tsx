import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { Input } from "../../src/renderables/input";
import { InputFocusProvider } from "../../src/context/input-focus";

const renderInput = (
  initialValue: string,
  options?: {
    placeholder?: string;
    multiline?: boolean;
    onSubmit?: (value: string) => void;
    onAtTrigger?: () => void;
    onUpArrowAtTop?: () => void;
    onDownArrowAtBottom?: () => void;
  },
) => {
  let currentValue = initialValue;
  const [value, setValue] = createSignal(initialValue);

  const wrappedOnChange = (newValue: string) => {
    currentValue = newValue;
    setValue(newValue);
  };

  return testRender(
    () => (
      <InputFocusProvider>
        <Input
          value={value()}
          onChange={wrappedOnChange}
          placeholder={options?.placeholder}
          multiline={options?.multiline}
          onSubmit={options?.onSubmit}
          onAtTrigger={options?.onAtTrigger}
          onUpArrowAtTop={options?.onUpArrowAtTop}
          onDownArrowAtBottom={options?.onDownArrowAtBottom}
        />
      </InputFocusProvider>
    ),
    { width: 40, height: 5 },
  ).then((result) => ({
    ...result,
    getValue: () => currentValue,
  }));
};

describe("Input", () => {
  test("renders placeholder when value is empty", async () => {
    const { renderer, captureCharFrame, renderOnce } = await renderInput("", {
      placeholder: "Type here...",
    });

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("Type here...");
  });

  test("renders value when non-empty", async () => {
    const { renderer, captureCharFrame, renderOnce } = await renderInput("Hello world");

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("Hello world");
  });

  test("typing a character appends to value", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("Hi");

    await renderOnce();
    mockInput.pressKey("!");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("Hi!");
  });

  test("backspace removes last character", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("abc");

    await renderOnce();
    mockInput.pressKey("BACKSPACE");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("ab");
  });

  test("enter triggers onSubmit", async () => {
    let submitted = "";
    const { renderer, mockInput, renderOnce } = await renderInput("test value", {
      onSubmit: (val) => { submitted = val; },
    });

    await renderOnce();
    mockInput.pressEnter();
    await renderOnce();
    renderer.destroy();

    expect(submitted).toBe("test value");
  });

  test("@ on empty input triggers onAtTrigger", async () => {
    let triggered = false;
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("", {
      onAtTrigger: () => { triggered = true; },
    });

    await renderOnce();
    mockInput.pressKey("@");
    await renderOnce();
    renderer.destroy();

    expect(triggered).toBe(true);
    // Value should remain empty since @ was intercepted
    expect(getValue()).toBe("");
  });

  test("@ on non-empty input inserts the character", async () => {
    let triggered = false;
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("prefix", {
      onAtTrigger: () => { triggered = true; },
    });

    await renderOnce();
    mockInput.pressKey("@");
    await renderOnce();
    renderer.destroy();

    expect(triggered).toBe(false);
    expect(getValue()).toContain("@");
  });

  test("ctrl+a moves cursor to beginning (start of line)", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("hello");

    await renderOnce();
    // ctrl+a moves to start; then typing inserts at position 0
    mockInput.pressKey("a", { ctrl: true });
    mockInput.pressKey("z");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("zhello");
  });

  test("ctrl+e moves cursor to end", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("hello");

    await renderOnce();
    // First move to start, then back to end, then type
    mockInput.pressKey("a", { ctrl: true });
    mockInput.pressKey("e", { ctrl: true });
    mockInput.pressKey("!");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("hello!");
  });

  test("ctrl+w deletes previous word", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("hello world");

    await renderOnce();
    mockInput.pressKey("w", { ctrl: true });
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("hello ");
  });

  test("left arrow moves cursor left", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("abc");

    await renderOnce();
    mockInput.pressArrow("left");
    mockInput.pressKey("z");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("abzc");
  });

  test("right arrow does not move past end", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("abc");

    await renderOnce();
    mockInput.pressArrow("right");
    mockInput.pressArrow("right");
    mockInput.pressKey("!");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("abc!");
  });

  test("delete key removes character at cursor", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("abcd");

    await renderOnce();
    // Move to start, then delete forward
    mockInput.pressKey("a", { ctrl: true });
    mockInput.pressKey("DELETE");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("bcd");
  });
});

describe("Input multiline", () => {
  // HACK: shift+enter requires kitty keyboard protocol to transmit the shift
  // modifier over stdin. Standard terminal escape sequences cannot distinguish
  // shift+enter from plain enter, so we use kittyKeyboard: true for this test.
  test("shift+enter inserts newline in multiline mode (kitty keyboard)", async () => {
    let currentValue = "line1";
    const [value, setValue] = createSignal("line1");
    const wrappedOnChange = (newValue: string) => { currentValue = newValue; setValue(newValue); };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input
            value={value()}
            onChange={wrappedOnChange}
            multiline
          />
        </InputFocusProvider>
      ),
      { width: 40, height: 5, kittyKeyboard: true },
    );

    await result.renderOnce();
    result.mockInput.pressKey("RETURN", { shift: true });
    await result.renderOnce();
    result.renderer.destroy();

    expect(currentValue).toContain("\n");
  });

  test("up arrow at first line triggers onUpArrowAtTop", async () => {
    let topHit = false;
    const { renderer, mockInput, renderOnce } = await renderInput("single line", {
      multiline: true,
      onUpArrowAtTop: () => { topHit = true; },
    });

    await renderOnce();
    // Move cursor to start first
    mockInput.pressKey("a", { ctrl: true });
    mockInput.pressArrow("up");
    await renderOnce();
    renderer.destroy();

    expect(topHit).toBe(true);
  });

  test("down arrow at last line triggers onDownArrowAtBottom", async () => {
    let bottomHit = false;
    const { renderer, mockInput, renderOnce } = await renderInput("single line", {
      multiline: true,
      onDownArrowAtBottom: () => { bottomHit = true; },
    });

    await renderOnce();
    mockInput.pressArrow("down");
    await renderOnce();
    renderer.destroy();

    expect(bottomHit).toBe(true);
  });
});
