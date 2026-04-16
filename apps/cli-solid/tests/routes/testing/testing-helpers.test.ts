import { describe, test, expect } from "bun:test";
import {
  ToolCall,
  ToolResult,
  ToolProgress,
  StepStarted,
  StepCompleted,
  AgentThinking,
  StepId,
} from "@neuve/shared/models";
import type { ExecutionEvent } from "@neuve/shared/models";
import {
  formatTokenCount,
  formatStreamingBytes,
  truncateSingleLine,
  parseRawInput,
  getActionObject,
  formatCommandPreview,
  formatArgsPreview,
  formatResultPreview,
  truncateLabel,
  collectToolCalls,
  markLastCallRunning,
  getActiveStepToolCalls,
  getPlanningToolCalls,
} from "../../../src/routes/testing/testing-helpers";

describe("formatTokenCount", () => {
  test("small number returns as-is", () => {
    expect(formatTokenCount(42)).toBe("42");
  });

  test("999 returns as-is", () => {
    expect(formatTokenCount(999)).toBe("999");
  });

  test("1000 returns 1.0k", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
  });

  test("1500 returns 1.5k", () => {
    expect(formatTokenCount(1500)).toBe("1.5k");
  });

  test("10000 returns 10.0k", () => {
    expect(formatTokenCount(10000)).toBe("10.0k");
  });
});

describe("formatStreamingBytes", () => {
  test("small bytes", () => {
    expect(formatStreamingBytes(100)).toBe("100 B");
  });

  test("kilobytes", () => {
    expect(formatStreamingBytes(2048)).toBe("2.0 KB");
  });

  test("megabytes", () => {
    expect(formatStreamingBytes(1048576)).toBe("1.0 MB");
  });

  test("just under 1KB", () => {
    expect(formatStreamingBytes(1023)).toBe("1023 B");
  });

  test("exactly 1KB", () => {
    expect(formatStreamingBytes(1024)).toBe("1.0 KB");
  });
});

describe("truncateSingleLine", () => {
  test("short text unchanged", () => {
    expect(truncateSingleLine("hello", 10)).toBe("hello");
  });

  test("collapses whitespace", () => {
    expect(truncateSingleLine("hello   world\n  foo", 50)).toBe("hello world foo");
  });

  test("truncates long text with ellipsis", () => {
    const result = truncateSingleLine("a".repeat(20), 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toContain("\u2026");
  });

  test("exact length text unchanged", () => {
    expect(truncateSingleLine("12345", 5)).toBe("12345");
  });
});

describe("parseRawInput", () => {
  test("parses object directly", () => {
    const result = parseRawInput({ command: "click" });
    expect(result).toEqual({ command: "click" });
  });

  test("parses JSON string", () => {
    const result = parseRawInput('{"command":"navigate"}');
    expect(result).toEqual({ command: "navigate" });
  });

  test("returns empty for invalid JSON string", () => {
    const result = parseRawInput("not-json");
    expect(result).toEqual({});
  });

  test("returns empty for null", () => {
    const result = parseRawInput(null);
    expect(result).toEqual({});
  });

  test("returns empty for number", () => {
    const result = parseRawInput(42);
    expect(result).toEqual({});
  });

  test("returns empty for array JSON string", () => {
    const result = parseRawInput("[1,2,3]");
    expect(result).toEqual({});
  });
});

describe("getActionObject", () => {
  test("returns action when it is an object", () => {
    const result = getActionObject({ action: { command: "click" } });
    expect(result).toEqual({ command: "click" });
  });

  test("returns undefined when action is not an object", () => {
    const result = getActionObject({ action: "string" });
    expect(result).toBeUndefined();
  });

  test("returns undefined when no action key", () => {
    const result = getActionObject({ command: "click" });
    expect(result).toBeUndefined();
  });
});

describe("formatCommandPreview", () => {
  test("extracts command from top-level", () => {
    expect(formatCommandPreview({ command: "navigate" })).toBe("navigate");
  });

  test("extracts command from nested action", () => {
    expect(formatCommandPreview({ action: { command: "click" } })).toBe("click");
  });

  test("prefers action.command over top-level command", () => {
    expect(formatCommandPreview({ command: "top", action: { command: "nested" } })).toBe("nested");
  });

  test("returns empty for no command", () => {
    expect(formatCommandPreview({ foo: "bar" })).toBe("");
  });

  test("parses JSON string input", () => {
    expect(formatCommandPreview('{"command":"navigate"}')).toBe("navigate");
  });
});

describe("formatArgsPreview", () => {
  test("shows primary key for navigate", () => {
    const result = formatArgsPreview({ action: { command: "navigate", url: "https://test.com" } }, "navigate");
    expect(result).toContain("https://test.com");
  });

  test("shows uid for click (single primary key, no key= prefix)", () => {
    const result = formatArgsPreview({ action: { command: "click", uid: "btn-1" } }, "click");
    expect(result).toBe("btn-1");
  });

  test("shows key=value for fill (multiple primary keys)", () => {
    const result = formatArgsPreview(
      { action: { command: "fill", uid: "input-1", value: "hello" } },
      "fill",
    );
    expect(result).toContain("uid=input-1");
    expect(result).toContain("value=hello");
  });

  test("falls back to generic key=value for unknown command", () => {
    const result = formatArgsPreview({ foo: "bar", baz: "qux" }, "unknown_cmd");
    expect(result).toContain("foo=bar");
  });

  test("skips command and includeSnapshot keys in fallback", () => {
    const result = formatArgsPreview(
      { command: "navigate", includeSnapshot: true, url: "https://test.com" },
      "unknown_cmd",
    );
    expect(result).not.toContain("command=");
    expect(result).not.toContain("includeSnapshot=");
    expect(result).toContain("url=https://test.com");
  });

  test("formats array values as length", () => {
    const result = formatArgsPreview(
      { action: { command: "network", resourceTypes: ["script", "xhr"] } },
      "network",
    );
    expect(result).toContain("[2]");
  });

  test("truncates long args", () => {
    const result = formatArgsPreview(
      { action: { command: "click", uid: "a".repeat(200) } },
      "click",
    );
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toContain("\u2026");
  });
});

describe("formatResultPreview", () => {
  test("short result unchanged", () => {
    expect(formatResultPreview("success")).toBe("success");
  });

  test("long result truncated", () => {
    const result = formatResultPreview("x".repeat(200));
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result).toContain("\u2026");
  });
});

describe("truncateLabel", () => {
  test("short label unchanged", () => {
    expect(truncateLabel("Navigate to page")).toBe("Navigate to page");
  });

  test("long label truncated at 100 chars", () => {
    const result = truncateLabel("x".repeat(200));
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain("\u2026");
  });

  test("exact 100 char label unchanged", () => {
    const label = "x".repeat(100);
    expect(truncateLabel(label)).toBe(label);
  });
});

const makeStepId = (id: string) => StepId.makeUnsafe(id);

describe("collectToolCalls", () => {
  test("empty events returns empty", () => {
    expect(collectToolCalls([], 0)).toEqual([]);
  });

  test("collects a single tool call", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "screenshot", input: {} }),
    ];
    const calls = collectToolCalls(events, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool.name).toBe("screenshot");
    expect(calls[0].isRunning).toBe(false);
    expect(calls[0].resultTokens).toBeUndefined();
  });

  test("pairs tool call with result", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "screenshot", input: {} }),
      new ToolResult({ toolName: "screenshot", result: "done", isError: false }),
    ];
    const calls = collectToolCalls(events, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0].resultText).toBe("done");
    expect(calls[0].resultIsError).toBe(false);
    expect(calls[0].resultTokens).toBeDefined();
  });

  test("pairs tool call with progress", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "playwright", input: {} }),
      new ToolProgress({ toolName: "playwright", outputSize: 4000 }),
    ];
    const calls = collectToolCalls(events, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0].progressBytes).toBe(4000);
    expect(calls[0].resultTokens).toBe(1000);
  });

  test("collects multiple tool calls", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "open", input: { url: "https://a.com" } }),
      new ToolResult({ toolName: "open", result: "opened", isError: false }),
      new ToolCall({ toolName: "screenshot", input: {} }),
      new ToolResult({ toolName: "screenshot", result: "captured", isError: false }),
    ];
    const calls = collectToolCalls(events, 0);
    expect(calls).toHaveLength(2);
    expect(calls[0].tool.name).toBe("open");
    expect(calls[1].tool.name).toBe("screenshot");
  });

  test("respects fromIndex and toIndex", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "open", input: {} }),
      new ToolResult({ toolName: "open", result: "ok", isError: false }),
      new StepStarted({ stepId: makeStepId("s1"), title: "Step 1" }),
      new ToolCall({ toolName: "screenshot", input: {} }),
      new ToolResult({ toolName: "screenshot", result: "ok", isError: false }),
    ];
    const calls = collectToolCalls(events, 3, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool.name).toBe("screenshot");
  });

  test("marks error result", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "playwright", input: {} }),
      new ToolResult({ toolName: "playwright", result: "Error: timeout", isError: true }),
    ];
    const calls = collectToolCalls(events, 0);
    expect(calls[0].resultIsError).toBe(true);
  });
});

describe("markLastCallRunning", () => {
  test("empty calls returns empty", () => {
    expect(markLastCallRunning([], [])).toEqual([]);
  });

  test("marks last call as running when last event is not ToolResult", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "screenshot", input: {} }),
    ];
    const calls = collectToolCalls(events, 0);
    const marked = markLastCallRunning(calls, events);
    expect(marked[0].isRunning).toBe(true);
  });

  test("does not mark running when last event is ToolResult", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "screenshot", input: {} }),
      new ToolResult({ toolName: "screenshot", result: "ok", isError: false }),
    ];
    const calls = collectToolCalls(events, 0);
    const marked = markLastCallRunning(calls, events);
    expect(marked[0].isRunning).toBe(false);
  });
});

describe("getActiveStepToolCalls", () => {
  test("returns empty when no StepStarted events", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "screenshot", input: {} }),
    ];
    expect(getActiveStepToolCalls(events)).toEqual([]);
  });

  test("returns tool calls after last StepStarted", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "open", input: {} }),
      new ToolResult({ toolName: "open", result: "ok", isError: false }),
      new StepStarted({ stepId: makeStepId("s1"), title: "Step 1" }),
      new ToolCall({ toolName: "screenshot", input: {} }),
    ];
    const calls = getActiveStepToolCalls(events);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool.name).toBe("screenshot");
    expect(calls[0].isRunning).toBe(true);
  });

  test("limits to MAX_VISIBLE_TOOL_CALLS (5)", () => {
    const events: ExecutionEvent[] = [
      new StepStarted({ stepId: makeStepId("s1"), title: "Step 1" }),
    ];
    for (let index = 0; index < 8; index++) {
      events.push(new ToolCall({ toolName: `tool${index}`, input: {} }));
      events.push(new ToolResult({ toolName: `tool${index}`, result: "ok", isError: false }));
    }
    const calls = getActiveStepToolCalls(events);
    expect(calls).toHaveLength(5);
    expect(calls[0].tool.name).toBe("tool3");
    expect(calls[4].tool.name).toBe("tool7");
  });
});

describe("getPlanningToolCalls", () => {
  test("returns empty for empty events", () => {
    expect(getPlanningToolCalls([])).toEqual([]);
  });

  test("returns tool calls from all events", () => {
    const events: ExecutionEvent[] = [
      new ToolCall({ toolName: "open", input: {} }),
      new ToolResult({ toolName: "open", result: "ok", isError: false }),
      new AgentThinking({ text: "thinking..." }),
      new ToolCall({ toolName: "screenshot", input: {} }),
    ];
    const calls = getPlanningToolCalls(events);
    expect(calls).toHaveLength(2);
    expect(calls[1].isRunning).toBe(true);
  });

  test("limits to MAX_VISIBLE_TOOL_CALLS (5)", () => {
    const events: ExecutionEvent[] = [];
    for (let index = 0; index < 10; index++) {
      events.push(new ToolCall({ toolName: `tool${index}`, input: {} }));
      events.push(new ToolResult({ toolName: `tool${index}`, result: "ok", isError: false }));
    }
    const calls = getPlanningToolCalls(events);
    expect(calls).toHaveLength(5);
    expect(calls[0].tool.name).toBe("tool5");
  });
});
