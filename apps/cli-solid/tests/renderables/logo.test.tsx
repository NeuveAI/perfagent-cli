import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { Logo } from "../../src/renderables/logo";

describe("Logo", () => {
  test("renders without crashing", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Logo />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame.length).toBeGreaterThan(0);
  });

  test("contains Perf Agent text", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Logo />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("Perf Agent");
  });

  test("contains version indicator", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Logo />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("dev");
  });

  test("contains tick and cross symbols", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Logo />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    // Cross: \u2718, Tick: \u2714
    expect(frame).toContain("\u2718");
    expect(frame).toContain("\u2714");
  });
});
