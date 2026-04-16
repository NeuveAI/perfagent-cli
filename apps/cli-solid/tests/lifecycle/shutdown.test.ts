import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  registerCleanupHandler,
  trackChildProcess,
  untrackChildProcess,
  initiateShutdown,
  installSignalHandlers,
  isShuttingDown,
  _resetForTesting,
} from "../../src/lifecycle/shutdown";

beforeEach(() => {
  _resetForTesting();
});

describe("registerCleanupHandler", () => {
  test("adds a handler and the returned function removes it", async () => {
    const calls: string[] = [];
    const unregister = registerCleanupHandler(() => {
      calls.push("handler");
    });

    unregister();

    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    await initiateShutdown();

    expect(calls).toEqual([]);
    exitSpy.mockRestore();
  });

  test("multiple handlers can be registered", async () => {
    const calls: string[] = [];
    registerCleanupHandler(() => {
      calls.push("first");
    });
    registerCleanupHandler(() => {
      calls.push("second");
    });

    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    await initiateShutdown();

    expect(calls).toHaveLength(2);
    exitSpy.mockRestore();
  });
});

describe("initiateShutdown", () => {
  test("calls all registered handlers in reverse order", async () => {
    const calls: string[] = [];
    registerCleanupHandler(() => {
      calls.push("first");
    });
    registerCleanupHandler(() => {
      calls.push("second");
    });
    registerCleanupHandler(() => {
      calls.push("third");
    });

    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    await initiateShutdown();

    expect(calls).toEqual(["third", "second", "first"]);
    exitSpy.mockRestore();
  });

  test("is idempotent — calling twice only runs handlers once", async () => {
    const calls: string[] = [];
    registerCleanupHandler(() => {
      calls.push("handler");
    });

    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);

    const first = initiateShutdown();
    const second = initiateShutdown();

    expect(first).toBe(second);
    await first;

    expect(calls).toEqual(["handler"]);
    exitSpy.mockRestore();
  });

  test("calls process.exit(0) after handlers complete", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    await initiateShutdown();

    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  test("handler errors do not prevent other handlers from running", async () => {
    const calls: string[] = [];
    registerCleanupHandler(() => {
      calls.push("first");
    });
    registerCleanupHandler(() => {
      throw new Error("boom");
    });
    registerCleanupHandler(() => {
      calls.push("third");
    });

    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    await initiateShutdown();

    expect(calls).toEqual(["third", "first"]);
    exitSpy.mockRestore();
  });

  test("kills tracked child processes before running handlers", async () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => true);
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);

    trackChildProcess(12345);
    trackChildProcess(67890);

    const handlerCalled = { value: false };
    registerCleanupHandler(() => {
      handlerCalled.value = true;
    });

    await initiateShutdown();

    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(67890, "SIGTERM");
    expect(handlerCalled.value).toBe(true);

    killSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("trackChildProcess / untrackChildProcess", () => {
  test("tracked PIDs are killed during shutdown", async () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => true);
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);

    trackChildProcess(111);
    trackChildProcess(222);

    await initiateShutdown();

    expect(killSpy).toHaveBeenCalledWith(111, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(222, "SIGTERM");

    killSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("untracked PIDs are not killed during shutdown", async () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => true);
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);

    trackChildProcess(111);
    trackChildProcess(222);
    untrackChildProcess(111);

    await initiateShutdown();

    expect(killSpy).not.toHaveBeenCalledWith(111, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(222, "SIGTERM");

    killSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("isShuttingDown", () => {
  test("returns false initially", () => {
    expect(isShuttingDown()).toBe(false);
  });

  test("returns true after initiateShutdown is called", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    const promise = initiateShutdown();

    expect(isShuttingDown()).toBe(true);
    await promise;
    exitSpy.mockRestore();
  });
});

describe("installSignalHandlers", () => {
  test("is idempotent — safe to call multiple times", () => {
    const initialListenerCount = process.listenerCount("SIGINT");

    installSignalHandlers();
    installSignalHandlers();
    installSignalHandlers();

    expect(process.listenerCount("SIGINT")).toBe(initialListenerCount + 1);
    expect(process.listenerCount("SIGTERM")).toBeGreaterThanOrEqual(1);
  });
});
