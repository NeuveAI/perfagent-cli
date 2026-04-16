import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { ScreenHeading } from "../../src/renderables/screen-heading";

describe("ScreenHeading", () => {
  test("renders title in uppercase", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <ScreenHeading title="results" />,
      { width: 60, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("RESULTS");
  });

  test("renders subtitle when provided", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <ScreenHeading title="results" subtitle="3 steps" />,
      { width: 60, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("RESULTS");
    expect(frame).toContain("3 steps");
  });

  test("renders divider line by default", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <ScreenHeading title="test" />,
      { width: 60, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    // Divider uses \u2500 characters
    expect(frame).toContain("\u2500");
  });

  test("hides divider when showDivider is false", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <ScreenHeading title="test" showDivider={false} />,
      { width: 60, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    // Title should still render
    expect(frame).toContain("TEST");
    // No divider line
    expect(frame).not.toContain("\u2500");
  });
});
