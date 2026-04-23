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

  test("shift+letter preserves uppercase character", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("");

    await renderOnce();
    mockInput.pressKey("a", { shift: true });
    mockInput.pressKey("b", { shift: true });
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("AB");
  });

  test("shift+digit inserts shifted symbol", async () => {
    const { renderer, mockInput, renderOnce, getValue } = await renderInput("");

    await renderOnce();
    mockInput.pressKey("!");
    mockInput.pressKey("@");
    await renderOnce();
    renderer.destroy();

    expect(getValue()).toBe("!@");
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

  test("option+enter inserts newline in multiline mode (non-kitty fallback)", async () => {
    let currentValue = "line1";
    const [value, setValue] = createSignal("line1");
    const wrappedOnChange = (newValue: string) => { currentValue = newValue; setValue(newValue); };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input value={value()} onChange={wrappedOnChange} multiline />
        </InputFocusProvider>
      ),
      { width: 40, height: 5 },
    );

    await result.renderOnce();
    result.mockInput.pressKey("RETURN", { meta: true });
    await result.renderOnce();
    result.renderer.destroy();

    expect(currentValue).toContain("\n");
  });

  test("ctrl+j (linefeed) inserts newline in multiline mode", async () => {
    let currentValue = "line1";
    const [value, setValue] = createSignal("line1");
    const wrappedOnChange = (newValue: string) => { currentValue = newValue; setValue(newValue); };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input value={value()} onChange={wrappedOnChange} multiline />
        </InputFocusProvider>
      ),
      { width: 40, height: 5 },
    );

    await result.renderOnce();
    // Ctrl+J sends raw \n which parses as name="linefeed"
    result.mockInput.pressKey("\n");
    await result.renderOnce();
    result.renderer.destroy();

    expect(currentValue).toContain("\n");
  });

  test("down arrow on middle line moves cursor, does not trigger history", async () => {
    let bottomHit = false;
    const [value, setValue] = createSignal("line1\nline2\nline3");
    const wrappedOnChange = (newValue: string) => { setValue(newValue); };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input
            value={value()}
            onChange={wrappedOnChange}
            multiline
            onDownArrowAtBottom={() => { bottomHit = true; }}
          />
        </InputFocusProvider>
      ),
      { width: 40, height: 5 },
    );

    await result.renderOnce();
    // Move to very start (buffer-home via Home key), then down — lands on line 2, not history
    result.mockInput.pressKey("HOME");
    result.mockInput.pressArrow("down");
    await result.renderOnce();
    result.renderer.destroy();

    expect(bottomHit).toBe(false);
  });

  test("up arrow on line 2 of multiline moves cursor, does not trigger history", async () => {
    let topHit = false;
    const [value, setValue] = createSignal("line1\nline2");
    const wrappedOnChange = (newValue: string) => { setValue(newValue); };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input
            value={value()}
            onChange={wrappedOnChange}
            multiline
            onUpArrowAtTop={() => { topHit = true; }}
          />
        </InputFocusProvider>
      ),
      { width: 40, height: 5 },
    );

    await result.renderOnce();
    // Cursor initializes at end (line 1). Press up once → should move to line 0, not fire history.
    result.mockInput.pressArrow("up");
    await result.renderOnce();
    result.renderer.destroy();

    expect(topHit).toBe(false);
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

  test("up on row 0 mid-column snaps to offset 0 without firing history", async () => {
    let topHit = 0;
    const { renderer, mockInput, renderOnce } = await renderInput("single line", {
      multiline: true,
      onUpArrowAtTop: () => { topHit++; },
    });

    await renderOnce();
    // Cursor starts at end. Arrow left a few times → still row 0, but offset > 0.
    mockInput.pressArrow("left");
    mockInput.pressArrow("left");
    mockInput.pressArrow("up");
    await renderOnce();
    // First up: snap to offset 0, history NOT fired.
    expect(topHit).toBe(0);
    // Second up: now at offset 0, history fires.
    mockInput.pressArrow("up");
    await renderOnce();
    renderer.destroy();

    expect(topHit).toBe(1);
  });

  test("history-up places cursor at offset 0 so next up fires history immediately", async () => {
    const historyEntries = ["older entry", "newest entry"];
    let historyIndex = historyEntries.length;
    let topHit = 0;
    const [value, setValue] = createSignal("");
    const wrappedOnChange = (newValue: string) => { setValue(newValue); };

    const navigateBack = () => {
      topHit++;
      historyIndex = Math.max(0, historyIndex - 1);
      setValue(historyEntries[historyIndex]!);
    };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input
            value={value()}
            onChange={wrappedOnChange}
            multiline
            onUpArrowAtTop={navigateBack}
          />
        </InputFocusProvider>
      ),
      { width: 40, height: 5 },
    );

    await result.renderOnce();
    // Empty value, cursor at offset 0. First up → loads "newest entry".
    result.mockInput.pressArrow("up");
    await result.renderOnce();
    expect(value()).toBe("newest entry");
    expect(topHit).toBe(1);
    // Cursor should be at offset 0 of the newly-loaded value.
    // So next up immediately triggers history again (momentum).
    result.mockInput.pressArrow("up");
    await result.renderOnce();
    result.renderer.destroy();

    expect(value()).toBe("older entry");
    expect(topHit).toBe(2);
  });

  test("history-down places cursor at end so next down fires history immediately", async () => {
    const historyEntries = ["first", "second"];
    let historyIndex = -1;
    let bottomHit = 0;
    const [value, setValue] = createSignal(historyEntries[0]!);
    const wrappedOnChange = (newValue: string) => { setValue(newValue); };

    const navigateForward = () => {
      bottomHit++;
      historyIndex = Math.min(historyEntries.length - 1, historyIndex + 1);
      setValue(historyEntries[historyIndex]!);
    };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input
            value={value()}
            onChange={wrappedOnChange}
            multiline
            onDownArrowAtBottom={navigateForward}
          />
        </InputFocusProvider>
      ),
      { width: 40, height: 5 },
    );

    await result.renderOnce();
    // Cursor initializes at end of "first". First down → loads "first" (index 0).
    result.mockInput.pressArrow("down");
    await result.renderOnce();
    expect(value()).toBe("first");
    expect(bottomHit).toBe(1);
    // Cursor should be at end of "first"; next down fires again (momentum).
    result.mockInput.pressArrow("down");
    await result.renderOnce();
    result.renderer.destroy();

    expect(value()).toBe("second");
    expect(bottomHit).toBe(2);
  });

  test("up arrow on wrapped visual row 1 of a single logical line moves to visual row 0, does not trigger history", async () => {
    let topHit = 0;
    // One logical line long enough to wrap at width=20 into multiple visual rows.
    const longLine = "word1 word2 word3 word4 word5 word6 word7 word8";
    const [value, setValue] = createSignal(longLine);
    const wrappedOnChange = (newValue: string) => { setValue(newValue); };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input
            value={value()}
            onChange={wrappedOnChange}
            multiline
            onUpArrowAtTop={() => { topHit++; }}
          />
        </InputFocusProvider>
      ),
      { width: 20, height: 8 },
    );

    await result.renderOnce();
    // Cursor starts at end (last visual row). Press up once → should move to
    // previous visual row, not fire history.
    result.mockInput.pressArrow("up");
    await result.renderOnce();
    result.renderer.destroy();

    expect(topHit).toBe(0);
  });

  test("down arrow on wrapped visual row 0 of a single logical line moves to next visual row, does not trigger history", async () => {
    let bottomHit = 0;
    const longLine = "word1 word2 word3 word4 word5 word6 word7 word8";
    const [value, setValue] = createSignal(longLine);
    const wrappedOnChange = (newValue: string) => { setValue(newValue); };

    const result = await testRender(
      () => (
        <InputFocusProvider>
          <Input
            value={value()}
            onChange={wrappedOnChange}
            multiline
            onDownArrowAtBottom={() => { bottomHit++; }}
          />
        </InputFocusProvider>
      ),
      { width: 20, height: 8 },
    );

    await result.renderOnce();
    // Move cursor to very start (offset 0 = visual row 0).
    result.mockInput.pressKey("HOME");
    await result.renderOnce();
    // Press down once → should move to next visual row, not fire history.
    result.mockInput.pressArrow("down");
    await result.renderOnce();
    result.renderer.destroy();

    expect(bottomHit).toBe(0);
  });

  test("down on last row mid-column snaps to end without firing history", async () => {
    let bottomHit = 0;
    const { renderer, mockInput, renderOnce } = await renderInput("line1\nline2", {
      multiline: true,
      onDownArrowAtBottom: () => { bottomHit++; },
    });

    await renderOnce();
    // Cursor starts at end (offset 11). Move to middle of last line.
    mockInput.pressArrow("left");
    mockInput.pressArrow("left");
    mockInput.pressArrow("down");
    await renderOnce();
    // First down on last row mid-column: snap to end, no history.
    expect(bottomHit).toBe(0);
    // Second down: now at end, history fires.
    mockInput.pressArrow("down");
    await renderOnce();
    renderer.destroy();

    expect(bottomHit).toBe(1);
  });
});
