import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  checkOllamaRunning,
  checkDevToolsMcpResolvable,
  cleanupStaleLockfile,
  killStaleMcpProcesses,
  runHealthChecks,
} from "../../src/lifecycle/health-checks";
import { writeLockfile } from "../../src/lifecycle/shutdown";

const LOCKFILE_PATH = path.join(process.cwd(), ".perf-agent", "tui.lock");

const removeLockfile = () => {
  try {
    fs.unlinkSync(LOCKFILE_PATH);
  } catch {}
};

describe("killStaleMcpProcesses", () => {
  test("returns { killed: number } shape", async () => {
    const result = await killStaleMcpProcesses();
    expect(result).toHaveProperty("killed");
    expect(typeof result.killed).toBe("number");
    expect(result.killed).toBeGreaterThanOrEqual(0);
  });
});

describe("checkOllamaRunning", () => {
  test("returns a HealthCheckResult with name Ollama", async () => {
    const result = await checkOllamaRunning();
    expect(result.name).toBe("Ollama");
    expect(typeof result.passed).toBe("boolean");

    if (!result.passed) {
      expect(result.message).toBe(
        "Ollama is not running. Start it with: ollama serve",
      );
    }
  });
});

describe("checkDevToolsMcpResolvable", () => {
  test("returns a HealthCheckResult with correct name", async () => {
    const result = await checkDevToolsMcpResolvable();
    expect(result.name).toBe("Chrome DevTools MCP");
    expect(typeof result.passed).toBe("boolean");

    if (!result.passed) {
      expect(result.message).toBe(
        "chrome-devtools-mcp is not installed. Run: npm install -g chrome-devtools-mcp@0.21.0",
      );
    }
  });
});

describe("cleanupStaleLockfile", () => {
  afterEach(() => {
    removeLockfile();
  });

  test("returns { cleaned: false } when no lockfile exists", async () => {
    removeLockfile();

    const result = await cleanupStaleLockfile();

    expect(result).toEqual({ cleaned: false });
  });

  test("returns { cleaned: false } when lockfile contains current process.pid", async () => {
    writeLockfile();

    const result = await cleanupStaleLockfile();

    expect(result).toEqual({ cleaned: false });
    expect(fs.existsSync(LOCKFILE_PATH)).toBe(true);
  });

  test("returns { cleaned: true } and removes lockfile when PID is dead", async () => {
    fs.mkdirSync(path.dirname(LOCKFILE_PATH), { recursive: true });
    fs.writeFileSync(LOCKFILE_PATH, "999999999");

    const result = await cleanupStaleLockfile();

    expect(result.cleaned).toBe(true);
    expect(result.killedPid).toBeUndefined();
    expect(fs.existsSync(LOCKFILE_PATH)).toBe(false);
  });

  test("returns { cleaned: true } when lockfile contains invalid content", async () => {
    fs.mkdirSync(path.dirname(LOCKFILE_PATH), { recursive: true });
    fs.writeFileSync(LOCKFILE_PATH, "not-a-number");

    const result = await cleanupStaleLockfile();

    expect(result).toEqual({ cleaned: false });
  });
});

describe("runHealthChecks", () => {
  test("returns array of HealthCheckResults", async () => {
    const results = await runHealthChecks("claude");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);

    for (const result of results) {
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("passed");
      expect(typeof result.name).toBe("string");
      expect(typeof result.passed).toBe("boolean");
    }
  });

  test("includes Ollama check when agent is local", async () => {
    const results = await runHealthChecks("local");
    const ollamaCheck = results.find((r) => r.name === "Ollama");
    expect(ollamaCheck).toBeDefined();
  });

  test("excludes Ollama check for non-local agents", async () => {
    const results = await runHealthChecks("claude");
    const ollamaCheck = results.find((r) => r.name === "Ollama");
    expect(ollamaCheck).toBeUndefined();
  });

  test("always includes Chrome DevTools MCP check", async () => {
    const results = await runHealthChecks("claude");
    const mcpCheck = results.find((r) => r.name === "Chrome DevTools MCP");
    expect(mcpCheck).toBeDefined();
  });
});
