import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { Spinner } from "../../src/renderables/spinner";
import { SPINNER_FRAMES } from "../../src/constants";

describe("Spinner", () => {
  test("renders without crashing", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Spinner />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame.length).toBeGreaterThan(0);
  });

  test("renders one of the spinner frame characters", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Spinner />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    const containsSpinnerFrame = SPINNER_FRAMES.some((spinnerChar) =>
      frame.includes(spinnerChar),
    );
    expect(containsSpinnerFrame).toBe(true);
  });

  test("renders with message when provided", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Spinner message="Loading data..." />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("Loading data...");
  });

  test("renders without message text when message is omitted", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => <Spinner />,
      { width: 40, height: 3 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    // Should only contain the spinner character, no extra text
    expect(frame).not.toContain("Loading");
  });
});
