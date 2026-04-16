import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  registerCleanupHandler,
  trackChildProcess,
  untrackChildProcess,
  initiateShutdown,
  installSignalHandlers,
  isShuttingDown,
  writeLockfile,
  readLockfile,
  deleteLockfile,
  _resetForTesting,
} from "../../src/lifecycle/shutdown";

const LOCKFILE_PATH = path.join(process.cwd(), ".perf-agent", "tui.lock");

beforeEach(() => {
  _resetForTesting();
});

afterEach(() => {
  try {
    fs.unlinkSync(LOCKFILE_PATH);
  } catch {}
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

  test("writes the lockfile after installing handlers", () => {
    installSignalHandlers();

    expect(fs.existsSync(LOCKFILE_PATH)).toBe(true);
    const content = fs.readFileSync(LOCKFILE_PATH, "utf-8").trim();
    expect(parseInt(content, 10)).toBe(process.pid);
  });
});

describe("writeLockfile", () => {
  test("creates a file with the current process PID", () => {
    writeLockfile();

    expect(fs.existsSync(LOCKFILE_PATH)).toBe(true);
    const content = fs.readFileSync(LOCKFILE_PATH, "utf-8").trim();
    expect(parseInt(content, 10)).toBe(process.pid);
  });
});

describe("readLockfile", () => {
  test("returns the PID stored in the lockfile", () => {
    writeLockfile();

    expect(readLockfile()).toBe(process.pid);
  });

  test("returns undefined when the lockfile does not exist", () => {
    try {
      fs.unlinkSync(LOCKFILE_PATH);
    } catch {}

    expect(readLockfile()).toBeUndefined();
  });

  test("returns undefined when the lockfile contains invalid content", () => {
    fs.mkdirSync(path.dirname(LOCKFILE_PATH), { recursive: true });
    fs.writeFileSync(LOCKFILE_PATH, "not-a-number");

    expect(readLockfile()).toBeUndefined();
  });
});

describe("deleteLockfile", () => {
  test("removes the lockfile if it exists", () => {
    writeLockfile();
    expect(fs.existsSync(LOCKFILE_PATH)).toBe(true);

    deleteLockfile();

    expect(fs.existsSync(LOCKFILE_PATH)).toBe(false);
  });

  test("does not throw when the lockfile is missing", () => {
    try {
      fs.unlinkSync(LOCKFILE_PATH);
    } catch {}

    expect(() => deleteLockfile()).not.toThrow();
  });
});

describe("initiateShutdown with lockfile", () => {
  test("deletes the lockfile during shutdown", async () => {
    writeLockfile();
    expect(fs.existsSync(LOCKFILE_PATH)).toBe(true);

    const exitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
    await initiateShutdown();

    expect(fs.existsSync(LOCKFILE_PATH)).toBe(false);
    exitSpy.mockRestore();
  });
});
