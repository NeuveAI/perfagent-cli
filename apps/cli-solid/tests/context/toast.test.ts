import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createSignal } from "solid-js";

// Test toast queue logic directly without JSX rendering.
// Mirrors the ToastProvider implementation.

interface ToastEntry {
  readonly message: string;
  readonly id: number;
}

let nextTestToastId = 0;

const createToastQueue = () => {
  const [current, setCurrent] = createSignal<ToastEntry | undefined>(undefined);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  const dismiss = () => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
    }
    setCurrent(undefined);
  };

  const show = (message: string, durationMs: number = 3000) => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
    }
    const id = nextTestToastId++;
    setCurrent({ message, id });
    dismissTimer = setTimeout(() => {
      setCurrent((prev) => {
        if (prev?.id === id) return undefined;
        return prev;
      });
      dismissTimer = undefined;
    }, durationMs);
  };

  return { show, current, dismiss };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("toast queue", () => {
  test("starts with no current toast", () => {
    const toast = createToastQueue();
    expect(toast.current()).toBeUndefined();
  });

  test("show sets the current toast", () => {
    const toast = createToastQueue();
    toast.show("Hello");
    expect(toast.current()?.message).toBe("Hello");
  });

  test("dismiss clears the current toast", () => {
    const toast = createToastQueue();
    toast.show("Hello");
    toast.dismiss();
    expect(toast.current()).toBeUndefined();
  });

  test("showing a new toast replaces the current one", () => {
    const toast = createToastQueue();
    toast.show("First");
    toast.show("Second");
    expect(toast.current()?.message).toBe("Second");
  });

  test("auto-dismiss after specified duration", async () => {
    const toast = createToastQueue();
    toast.show("Auto-dismiss", 50);
    expect(toast.current()?.message).toBe("Auto-dismiss");
    await sleep(100);
    expect(toast.current()).toBeUndefined();
  });

  test("replacing toast before auto-dismiss cancels old timer", async () => {
    const toast = createToastQueue();
    toast.show("First", 50);
    toast.show("Second", 200);
    await sleep(100);
    // First timer would have fired, but Second should still be visible
    expect(toast.current()?.message).toBe("Second");
  });

  test("dismiss before auto-dismiss cancels the timer", async () => {
    const toast = createToastQueue();
    toast.show("Will dismiss", 200);
    toast.dismiss();
    expect(toast.current()).toBeUndefined();
    await sleep(250);
    // Timer should not have re-set anything
    expect(toast.current()).toBeUndefined();
  });

  test("each toast gets a unique id", () => {
    const toast = createToastQueue();
    toast.show("First");
    const firstId = toast.current()?.id;
    toast.show("Second");
    const secondId = toast.current()?.id;
    expect(firstId).not.toBe(secondId);
  });

  test("rapid show calls only keep the last message visible", () => {
    const toast = createToastQueue();
    for (let index = 0; index < 10; index++) {
      toast.show(`Toast ${index}`);
    }
    expect(toast.current()?.message).toBe("Toast 9");
  });
});
