import { describe, test, expect } from "bun:test";
import {
  checkOllamaRunning,
  checkDevToolsMcpResolvable,
  killStaleMcpProcesses,
  runHealthChecks,
} from "../../src/lifecycle/health-checks";

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
