import { describe, test, expect } from "bun:test";
import { Cause } from "effect";
import { parseExecutionError } from "../../src/utils/parse-execution-error";

describe("parseExecutionError", () => {
  test("AcpSessionCreateError with 'Connection closed' produces stale session hint", () => {
    const cause = Cause.fail({
      _tag: "AcpSessionCreateError",
      message: "Creating session failed: Connection closed",
      cause: { message: "Connection closed" },
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Session failed");
    expect(result.message).toBe("A previous browser session may be stale");
    expect(result.hint).toBe("Try killing any leftover chrome-devtools-mcp processes");
  });

  test("AcpSessionCreateError with other cause produces generic session message", () => {
    const cause = Cause.fail({
      _tag: "AcpSessionCreateError",
      message: "Creating session failed: timeout",
      cause: { message: "timeout" },
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Session failed");
    expect(result.message).toBe("Creating session failed: timeout");
    expect(result.hint).toBeUndefined();
  });

  test("DevToolsConnectionError produces browser connection message with hint", () => {
    const cause = Cause.fail({
      _tag: "DevToolsConnectionError",
      message: "Failed to connect to chrome-devtools-mcp: ECONNREFUSED",
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Browser connection failed");
    expect(result.message).toBe("Failed to connect to chrome-devtools-mcp: ECONNREFUSED");
    expect(result.hint).toBe("Is chrome-devtools-mcp installed? Run: npx chrome-devtools-mcp@0.21.0 --help");
  });

  test("DevToolsToolError produces browser tool error message", () => {
    const cause = Cause.fail({
      _tag: "DevToolsToolError",
      message: 'DevTools tool "click" failed: element not found',
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Browser tool error");
    expect(result.message).toBe('DevTools tool "click" failed: element not found');
    expect(result.hint).toBeUndefined();
  });

  test("ExecutionError unwraps and uses inner error mapping", () => {
    const cause = Cause.fail({
      _tag: "ExecutionError",
      message: "Streaming failed: network error",
      reason: { _tag: "AcpStreamError", message: "Stream broke" },
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Agent stream error");
    expect(result.message).toBe("Stream broke");
    expect(result.hint).toBe("Check your network connection and try again");
  });

  test("ExecutionError with AcpSessionCreateError with Connection closed unwraps correctly", () => {
    const cause = Cause.fail({
      _tag: "ExecutionError",
      message: "Creating session failed: Connection closed",
      reason: {
        _tag: "AcpSessionCreateError",
        message: "Creating session failed: Connection closed",
        cause: "Connection closed",
      },
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Session failed");
    expect(result.message).toBe("A previous browser session may be stale");
    expect(result.hint).toBe("Try killing any leftover chrome-devtools-mcp processes");
  });

  test("AcpProviderNotInstalledError produces provider not installed message", () => {
    const cause = Cause.fail({
      _tag: "AcpProviderNotInstalledError",
      message: "Claude Code is not installed. Install it from https://code.claude.com",
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Provider not installed");
    expect(result.message).toBe("Claude Code is not installed. Install it from https://code.claude.com");
    expect(result.hint).toBeUndefined();
  });

  test("AcpProviderUnauthenticatedError produces not authenticated message", () => {
    const cause = Cause.fail({
      _tag: "AcpProviderUnauthenticatedError",
      message: "Please log in using `claude login`, and then re-run perf-agent.",
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Not authenticated");
    expect(result.message).toBe("Please log in using `claude login`, and then re-run perf-agent.");
    expect(result.hint).toBeUndefined();
  });

  test("AcpProviderUsageLimitError produces usage limit message", () => {
    const cause = Cause.fail({
      _tag: "AcpProviderUsageLimitError",
      message: "Usage limits exceeded for claude. Please check your plan and billing.",
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Usage limit reached");
    expect(result.message).toBe("Usage limits exceeded for claude. Please check your plan and billing.");
    expect(result.hint).toBeUndefined();
  });

  test("AcpStreamError produces agent stream error with hint", () => {
    const cause = Cause.fail({
      _tag: "AcpStreamError",
      message: "Streaming failed: network timeout",
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Agent stream error");
    expect(result.message).toBe("Streaming failed: network timeout");
    expect(result.hint).toBe("Check your network connection and try again");
  });

  test("unknown error tag hits fallback", () => {
    const cause = Cause.fail({
      _tag: "SomeRandomError",
      message: "Something weird happened",
    });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Unexpected error");
    expect(result.message).toBe("Something weird happened");
    expect(result.hint).toBeUndefined();
  });

  test("non-tagged error in Cause hits fallback", () => {
    const cause = Cause.fail("raw string error");
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Unexpected error");
    expect(result.message).toContain("raw string error");
  });

  test("long fallback message is truncated at 500 chars", () => {
    const longMessage = "x".repeat(600);
    const cause = Cause.fail({ _tag: "UnknownTag", message: longMessage });
    const result = parseExecutionError(cause);
    expect(result.title).toBe("Unexpected error");
    expect(result.message.length).toBe(501);
    expect(result.message.endsWith("…")).toBe(true);
    expect(result.message.startsWith("x".repeat(500))).toBe(true);
  });
});
