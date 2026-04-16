import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { RuledBox } from "../../src/renderables/ruled-box";

describe("RuledBox", () => {
  test("renders children content", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => (
        <RuledBox>
          <text>Inside the box</text>
        </RuledBox>
      ),
      { width: 40, height: 5 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("Inside the box");
  });

  test("renders horizontal rule lines", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => (
        <RuledBox>
          <text>Content</text>
        </RuledBox>
      ),
      { width: 40, height: 5 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    // RuledBox uses \u2500 (box drawing horizontal) for rules
    expect(frame).toContain("\u2500");
  });

  test("renders without crashing with empty children", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => (
        <RuledBox>
          <text>{""}</text>
        </RuledBox>
      ),
      { width: 40, height: 5 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame.length).toBeGreaterThan(0);
  });
});
