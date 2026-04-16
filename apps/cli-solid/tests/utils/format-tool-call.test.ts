import { describe, test, expect } from "bun:test";
import { formatToolCall } from "../../src/utils/format-tool-call";

describe("formatToolCall", () => {
  describe("name normalization", () => {
    test("strips mcp prefix from tool name", () => {
      const result = formatToolCall("mcp__devtools__screenshot", {});
      expect(result.name).toBe("screenshot");
    });

    test("keeps plain tool name unchanged", () => {
      const result = formatToolCall("playwright", {});
      expect(result.name).toBe("playwright");
    });

    test("keeps name with single underscore unchanged", () => {
      const result = formatToolCall("console_logs", {});
      expect(result.name).toBe("console_logs");
    });
  });

  describe("open tool", () => {
    test("formats url as quoted string", () => {
      const result = formatToolCall("open", { url: "https://example.com" });
      expect(result.args).toBe('"https://example.com"');
    });

    test("returns empty args when no url", () => {
      const result = formatToolCall("open", {});
      expect(result.args).toBe("");
    });
  });

  describe("screenshot tool", () => {
    test("returns empty args for default screenshot mode", () => {
      const result = formatToolCall("screenshot", { mode: "screenshot" });
      expect(result.args).toBe("");
    });

    test("returns mode when not screenshot", () => {
      const result = formatToolCall("screenshot", { mode: "fullPage" });
      expect(result.args).toBe("fullPage");
    });

    test("returns empty when no mode", () => {
      const result = formatToolCall("screenshot", {});
      expect(result.args).toBe("");
    });
  });

  describe("playwright tool", () => {
    test("collapses whitespace in code", () => {
      const result = formatToolCall("playwright", { code: "await  page\n  .click('button')" });
      expect(result.args).toBe("await page .click('button')");
    });

    test("truncates long code", () => {
      const longCode = "a".repeat(200);
      const result = formatToolCall("playwright", { code: longCode });
      expect(result.args.length).toBeLessThanOrEqual(100);
      expect(result.args).toContain("\u2026");
    });

    test("sets multilineArgs when code has newlines", () => {
      const code = "line1\nline2\nline3";
      const result = formatToolCall("playwright", { code });
      expect(result.multilineArgs).toBe(code);
    });

    test("no multilineArgs for single-line code", () => {
      const result = formatToolCall("playwright", { code: "await page.click('button')" });
      expect(result.multilineArgs).toBeUndefined();
    });
  });

  describe("console_logs tool", () => {
    test("formats type", () => {
      const result = formatToolCall("console_logs", { type: "error" });
      expect(result.args).toBe('type: "error"');
    });

    test("returns empty when no type", () => {
      const result = formatToolCall("console_logs", {});
      expect(result.args).toBe("");
    });
  });

  describe("network_requests tool", () => {
    test("formats method and url", () => {
      const result = formatToolCall("network_requests", {
        method: "GET",
        url: "https://api.example.com",
      });
      expect(result.args).toBe('GET, "https://api.example.com"');
    });

    test("formats method only", () => {
      const result = formatToolCall("network_requests", { method: "POST" });
      expect(result.args).toBe("POST");
    });
  });

  describe("performance_metrics and close tools", () => {
    test("performance_metrics returns empty", () => {
      const result = formatToolCall("performance_metrics", { foo: "bar" });
      expect(result.args).toBe("");
    });

    test("close returns empty", () => {
      const result = formatToolCall("close", { session: "123" });
      expect(result.args).toBe("");
    });
  });

  describe("fallback summarizeInput", () => {
    test("summarizes string values from unknown tool", () => {
      const result = formatToolCall("some_tool", { query: "hello world", limit: "10" });
      expect(result.args).toContain("hello world");
    });

    test("returns empty for empty input", () => {
      const result = formatToolCall("some_tool", {});
      expect(result.args).toBe("");
    });
  });

  describe("string input parsing", () => {
    test("parses JSON string input", () => {
      const result = formatToolCall("open", JSON.stringify({ url: "https://test.com" }));
      expect(result.args).toBe('"https://test.com"');
    });

    test("handles invalid JSON string gracefully", () => {
      const result = formatToolCall("some_tool", "not-json");
      expect(result.name).toBe("some_tool");
    });
  });
});
