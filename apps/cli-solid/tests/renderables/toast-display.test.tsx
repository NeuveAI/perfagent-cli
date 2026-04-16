import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { ToastProvider, useToast } from "../../src/context/toast";
import { ToastDisplay } from "../../src/renderables/toast-display";

const createToastTrigger = () => {
  const state: { trigger: ((message: string) => void) | undefined } = { trigger: undefined };

  const ToastDisplayWithTrigger = () => {
    const toast = useToast();
    state.trigger = (message: string) => toast.show(message);
    return <ToastDisplay />;
  };

  return { state, ToastDisplayWithTrigger };
};

describe("ToastDisplay", () => {
  test("renders nothing when no toast is active", async () => {
    const { ToastDisplayWithTrigger } = createToastTrigger();
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => (
        <ToastProvider>
          <ToastDisplayWithTrigger />
        </ToastProvider>
      ),
      { width: 60, height: 5 },
    );

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).not.toContain("toast");
  });

  test("shows toast message when triggered", async () => {
    const { state, ToastDisplayWithTrigger } = createToastTrigger();
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => (
        <ToastProvider>
          <ToastDisplayWithTrigger />
        </ToastProvider>
      ),
      { width: 60, height: 5 },
    );

    await renderOnce();
    state.trigger?.("Operation complete");
    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("Operation complete");
  });

  test("shows latest toast when multiple are fired", async () => {
    const { state, ToastDisplayWithTrigger } = createToastTrigger();
    const { renderer, captureCharFrame, renderOnce } = await testRender(
      () => (
        <ToastProvider>
          <ToastDisplayWithTrigger />
        </ToastProvider>
      ),
      { width: 60, height: 5 },
    );

    await renderOnce();
    state.trigger?.("First message");
    state.trigger?.("Second message");
    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("Second message");
    expect(frame).not.toContain("First message");
  });
});
