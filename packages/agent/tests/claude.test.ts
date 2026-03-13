import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

let pendingEvents: Record<string, unknown>[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () =>
    (async function* () {
      for (const event of pendingEvents) yield event;
    })(),
}));

import { claudeAgent } from "../src/claude.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

const loadFixture = (name: string): Record<string, unknown>[] =>
  readFileSync(join(FIXTURES_DIR, name), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const collect = async (generator: AsyncGenerator<ModelMessage>): Promise<ModelMessage[]> => {
  const messages: ModelMessage[] = [];
  for await (const message of generator) messages.push(message);
  return messages;
};

const runWithEvents = (events: Record<string, unknown>[]) => {
  pendingEvents = events;
  return claudeAgent.run({ prompt: "test", cwd: "/tmp" });
};

const sdkAssistant = (content: Record<string, unknown>[]) => ({
  type: "assistant",
  uuid: "a1b2c3d4-0000-0000-0000-000000000000",
  session_id: "sess-test",
  message: {
    id: "msg_test",
    role: "assistant",
    content,
    model: "claude-opus-4-6",
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 20 },
  },
  parent_tool_use_id: null,
});

const sdkUser = (content: Record<string, unknown>[]) => ({
  type: "user",
  uuid: "b2c3d4e5-0000-0000-0000-000000000000",
  session_id: "sess-test",
  message: { role: "user", content },
  parent_tool_use_id: null,
});

const sdkSystem = {
  type: "system",
  subtype: "init",
  uuid: "c3d4e5f6-0000-0000-0000-000000000000",
  session_id: "sess-test",
  tools: ["Bash", "Read"],
  model: "claude-opus-4-6",
  cwd: "/tmp",
  permissionMode: "bypassPermissions",
};

const sdkResult = (isError = false) => ({
  type: "result",
  subtype: isError ? "error_during_execution" : "success",
  uuid: "d4e5f6a7-0000-0000-0000-000000000000",
  session_id: "sess-test",
  is_error: isError,
  duration_ms: 5000,
  num_turns: 2,
  total_cost_usd: 0.01,
  usage: { input_tokens: 500, output_tokens: 100 },
});

describe("claudeAgent", () => {
  describe("text content", () => {
    it("converts a simple text block", async () => {
      const messages = await collect(
        runWithEvents([sdkAssistant([{ type: "text", text: "Hello world" }])]),
      );
      expect(messages).toEqual([
        { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      ]);
    });

    it("preserves multiline, code fences, and special characters", async () => {
      const complexText = "Line 1\nLine 2\n```typescript\nconst x = 1;\n```\n\ttabbed";
      const messages = await collect(
        runWithEvents([sdkAssistant([{ type: "text", text: complexText }])]),
      );
      expect((messages[0].content as Array<{ text: string }>)[0].text).toBe(complexText);
    });

    it("preserves unicode and emoji", async () => {
      const messages = await collect(
        runWithEvents([sdkAssistant([{ type: "text", text: "café ☕ résumé 日本語" }])]),
      );
      expect((messages[0].content as Array<{ text: string }>)[0].text).toBe("café ☕ résumé 日本語");
    });
  });

  describe("thinking/reasoning content", () => {
    it("converts thinking to reasoning type", async () => {
      const messages = await collect(
        runWithEvents([sdkAssistant([{ type: "thinking", thinking: "Let me analyze..." }])]),
      );
      expect(messages).toEqual([
        { role: "assistant", content: [{ type: "reasoning", text: "Let me analyze..." }] },
      ]);
    });
  });

  describe("tool_use content", () => {
    it("preserves all fields", async () => {
      const messages = await collect(
        runWithEvents([
          sdkAssistant([
            { type: "tool_use", id: "toolu_01Abc", name: "Bash", input: { command: "git diff HEAD~1" } },
          ]),
        ]),
      );
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content[0]).toEqual({
        type: "tool-call",
        toolCallId: "toolu_01Abc",
        toolName: "Bash",
        input: { command: "git diff HEAD~1" },
      });
    });

    it("defaults missing id and name to 'unknown'", async () => {
      const messages = await collect(
        runWithEvents([sdkAssistant([{ type: "tool_use", input: { key: "value" } }])]),
      );
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content[0].toolCallId).toBe("unknown");
      expect(content[0].toolName).toBe("unknown");
    });

    it("defaults missing input to empty object", async () => {
      const messages = await collect(
        runWithEvents([sdkAssistant([{ type: "tool_use", id: "t1", name: "Read" }])]),
      );
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content[0].input).toEqual({});
    });
  });

  describe("tool_result content", () => {
    it("converts successful result with json output", async () => {
      const messages = await collect(
        runWithEvents([
          sdkUser([
            { type: "tool_result", tool_use_id: "toolu_abc", name: "Read", content: "file body", is_error: false },
          ]),
        ]),
      );
      expect(messages[0].role).toBe("tool");
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content[0].toolCallId).toBe("toolu_abc");
      expect((content[0].output as Record<string, unknown>).type).toBe("json");
    });

    it("converts error result with error-text output", async () => {
      const messages = await collect(
        runWithEvents([
          sdkUser([
            { type: "tool_result", tool_use_id: "t1", name: "Bash", content: "exit 1", is_error: true },
          ]),
        ]),
      );
      const content = messages[0].content as Array<{ output: { type: string } }>;
      expect(content[0].output.type).toBe("error-text");
    });

    it("handles missing content on tool_result", async () => {
      const messages = await collect(
        runWithEvents([sdkUser([{ type: "tool_result", tool_use_id: "t1", name: "Bash" }])]),
      );
      const content = messages[0].content as Array<{ output: { type: string } }>;
      expect(content[0].output.type).toBe("json");
    });

    it("defaults missing tool_use_id and name", async () => {
      const messages = await collect(
        runWithEvents([sdkUser([{ type: "tool_result", content: "r", is_error: false }])]),
      );
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content[0].toolCallId).toBe("unknown");
      expect(content[0].toolName).toBe("unknown");
    });
  });

  describe("tool_error content", () => {
    it("converts to error-text", async () => {
      const messages = await collect(
        runWithEvents([
          sdkUser([{ type: "tool_error", tool_use_id: "t1", name: "Bash", error: "Permission denied" }]),
        ]),
      );
      const content = messages[0].content as Array<{ output: { type: string; value: string } }>;
      expect(content[0].output).toEqual({ type: "error-text", value: "Permission denied" });
    });

    it("handles missing error field", async () => {
      const messages = await collect(
        runWithEvents([sdkUser([{ type: "tool_error", tool_use_id: "t1", name: "Bash" }])]),
      );
      const content = messages[0].content as Array<{ output: { value: string } }>;
      expect(content[0].output.value).toBe("");
    });
  });

  describe("mixed content blocks", () => {
    it("text + tool_use → single message with both parts", async () => {
      const messages = await collect(
        runWithEvents([
          sdkAssistant([
            { type: "text", text: "I'll read the file." },
            { type: "tool_use", id: "t1", name: "Read", input: { file_path: "foo.ts" } },
          ]),
        ]),
      );
      expect(messages).toHaveLength(1);
      const types = (messages[0].content as Array<{ type: string }>).map((block) => block.type);
      expect(types).toEqual(["text", "tool-call"]);
    });

    it("thinking + text + tool_use → all three parts", async () => {
      const messages = await collect(
        runWithEvents([
          sdkAssistant([
            { type: "thinking", thinking: "I should check the file" },
            { type: "text", text: "Let me look." },
            { type: "tool_use", id: "t1", name: "Read", input: {} },
          ]),
        ]),
      );
      const types = (messages[0].content as Array<{ type: string }>).map((block) => block.type);
      expect(types).toEqual(["reasoning", "text", "tool-call"]);
    });

    it("multiple tool results in one user event", async () => {
      const messages = await collect(
        runWithEvents([
          sdkUser([
            { type: "tool_result", tool_use_id: "t1", name: "Read", content: "a", is_error: false },
            { type: "tool_result", tool_use_id: "t2", name: "Glob", content: "b", is_error: false },
          ]),
        ]),
      );
      expect(messages).toHaveLength(1);
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(2);
      expect(content[0].toolCallId).toBe("t1");
      expect(content[1].toolCallId).toBe("t2");
    });
  });

  describe("event filtering", () => {
    it("skips system events", async () => {
      expect(await collect(runWithEvents([sdkSystem]))).toEqual([]);
    });

    it("skips result events", async () => {
      expect(await collect(runWithEvents([sdkResult()]))).toEqual([]);
    });

    it("skips empty assistant content", async () => {
      expect(await collect(runWithEvents([sdkAssistant([])]))).toEqual([]);
    });

    it("skips null and primitive content blocks", async () => {
      const messages = await collect(
        runWithEvents([sdkAssistant([null, 42, "str", undefined] as unknown as Record<string, unknown>[])]),
      );
      expect(messages).toEqual([]);
    });

    it("skips unrecognized content block types", async () => {
      expect(
        await collect(runWithEvents([sdkAssistant([{ type: "image", url: "http://x.com/img.png" }])])),
      ).toEqual([]);
    });

    it("skips user events with non-array content", async () => {
      expect(
        await collect(runWithEvents([{ type: "user", session_id: "s", message: { content: "string" } }])),
      ).toEqual([]);
    });

    it("skips user events with no tool_result or tool_error blocks", async () => {
      expect(
        await collect(runWithEvents([sdkUser([{ type: "text", text: "not a tool result" }])])),
      ).toEqual([]);
    });

    it("skips stream_event, progress, file-history-snapshot", async () => {
      const messages = await collect(
        runWithEvents([
          { type: "stream_event", event: { type: "content_block_delta" } },
          { type: "progress", data: {} },
          { type: "file-history-snapshot", messageId: "abc" },
        ]),
      );
      expect(messages).toEqual([]);
    });
  });

  describe("full conversation sequences", () => {
    it("multi-turn with thinking, text, tool calls", async () => {
      const messages = await collect(
        runWithEvents([
          sdkSystem,
          sdkAssistant([{ type: "thinking", thinking: "analyzing..." }]),
          sdkAssistant([{ type: "text", text: "Let me check." }]),
          sdkAssistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
          sdkUser([{ type: "tool_result", tool_use_id: "t1", name: "Bash", content: "file.ts", is_error: false }]),
          sdkAssistant([{ type: "text", text: "Done!" }]),
          sdkResult(),
        ]),
      );
      expect(messages.map((message) => message.role)).toEqual(["assistant", "assistant", "assistant", "tool", "assistant"]);
      expect(messages.map((message) => (message.content as Array<{ type: string }>)[0].type)).toEqual([
        "reasoning",
        "text",
        "tool-call",
        "tool-result",
        "text",
      ]);
    });

    it("sequential tool uses", async () => {
      const messages = await collect(
        runWithEvents([
          sdkAssistant([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }]),
          sdkUser([{ type: "tool_result", tool_use_id: "t1", name: "Read", content: "code A", is_error: false }]),
          sdkAssistant([{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "b.ts" } }]),
          sdkUser([{ type: "tool_result", tool_use_id: "t2", name: "Read", content: "code B", is_error: false }]),
          sdkAssistant([{ type: "text", text: "Both files read." }]),
        ]),
      );
      expect(messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant", "tool", "assistant"]);
    });

    it("tool error then retry", async () => {
      const messages = await collect(
        runWithEvents([
          sdkAssistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "jq ." } }]),
          sdkUser([{ type: "tool_error", tool_use_id: "t1", name: "Bash", error: "jq not found" }]),
          sdkAssistant([{ type: "text", text: "Let me try another way." }]),
          sdkAssistant([{ type: "tool_use", id: "t2", name: "Bash", input: { command: "cat data.json" } }]),
          sdkUser([{ type: "tool_result", tool_use_id: "t2", name: "Bash", content: "{}", is_error: false }]),
        ]),
      );
      expect(messages).toHaveLength(5);
      const errorContent = messages[1].content as Array<{ output: { type: string } }>;
      expect(errorContent[0].output.type).toBe("error-text");
    });
  });

  describe("real NDJSON trace: claude-simple.jsonl", () => {
    it("converts a real error session (API error response)", async () => {
      const events = loadFixture("claude-simple.jsonl");
      const messages = await collect(runWithEvents(events));

      expect(messages.length).toBeGreaterThan(0);
      const firstAssistant = messages.find((message) => message.role === "assistant");
      expect(firstAssistant).toBeDefined();
      const content = firstAssistant!.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe("text");
      expect(content[0].text).toContain("API Error");
    });
  });

  describe("real NDJSON trace: claude-with-tools.jsonl", () => {
    it("converts a real multi-tool conversation", async () => {
      const events = loadFixture("claude-with-tools.jsonl");
      const messages = await collect(runWithEvents(events));

      expect(messages.length).toBeGreaterThan(5);
      const roles = new Set(messages.map((message) => message.role));
      expect(roles.has("assistant")).toBe(true);
      expect(roles.has("tool")).toBe(true);
    });

    it("contains thinking/reasoning from real trace", async () => {
      const events = loadFixture("claude-with-tools.jsonl");
      const messages = await collect(runWithEvents(events));

      const hasReasoning = messages.some((message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => {
          const typed = part as Record<string, unknown>;
          return typed.type === "reasoning";
        }),
      );
      expect(hasReasoning).toBe(true);
    });

    it("produces tool-call with real tool IDs from trace", async () => {
      const events = loadFixture("claude-with-tools.jsonl");
      const messages = await collect(runWithEvents(events));

      const toolCalls = messages.flatMap((message) =>
        Array.isArray(message.content)
          ? message.content.filter((part) => (part as Record<string, unknown>).type === "tool-call")
          : [],
      );
      expect(toolCalls.length).toBeGreaterThan(0);
      for (const toolCall of toolCalls) {
        const typed = toolCall as Record<string, unknown>;
        expect(typeof typed.toolCallId).toBe("string");
        expect((typed.toolCallId as string).startsWith("toolu_")).toBe(true);
        expect(typeof typed.toolName).toBe("string");
        expect(typed.input).toBeDefined();
      }
    });

    it("produces tool-result matching tool-call IDs from trace", async () => {
      const events = loadFixture("claude-with-tools.jsonl");
      const messages = await collect(runWithEvents(events));

      const toolCallIds = new Set(
        messages.flatMap((message) =>
          Array.isArray(message.content)
            ? message.content
                .filter((part) => (part as Record<string, unknown>).type === "tool-call")
                .map((part) => (part as Record<string, unknown>).toolCallId as string)
            : [],
        ),
      );

      const toolResultIds = new Set(
        messages.flatMap((message) =>
          Array.isArray(message.content)
            ? message.content
                .filter((part) => (part as Record<string, unknown>).type === "tool-result")
                .map((part) => (part as Record<string, unknown>).toolCallId as string)
            : [],
        ),
      );

      for (const resultId of toolResultIds) {
        expect(toolCallIds.has(resultId)).toBe(true);
      }
    });

    it("all content parts have valid ModelMessage types", async () => {
      const events = loadFixture("claude-with-tools.jsonl");
      const messages = await collect(runWithEvents(events));
      const validTypes = new Set(["text", "reasoning", "tool-call", "tool-result"]);

      for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content) {
          const typed = part as Record<string, unknown>;
          expect(validTypes.has(typed.type as string)).toBe(true);
        }
      }
    });

    it("tool results always appear after at least one preceding assistant message", async () => {
      const events = loadFixture("claude-with-tools.jsonl");
      const messages = await collect(runWithEvents(events));
      const roles = messages.map((message) => message.role);

      const firstToolIndex = roles.indexOf("tool");
      if (firstToolIndex !== -1) {
        const precedingAssistant = roles.slice(0, firstToolIndex).includes("assistant");
        expect(precedingAssistant).toBe(true);
      }
    });
  });

  describe("onLog callback", () => {
    it("emits raw JSON for every SDK event", async () => {
      pendingEvents = [sdkSystem, sdkAssistant([{ type: "text", text: "Hi" }]), sdkResult()];
      const logs: string[] = [];

      await collect(
        claudeAgent.run({ prompt: "test", cwd: "/tmp", onLog: (entry) => logs.push(entry.data) }),
      );

      expect(logs).toHaveLength(3);
      expect(logs.map((log) => JSON.parse(log).type)).toEqual(["system", "assistant", "result"]);
    });

    it("log entries have stream:stdout and timestamp", async () => {
      pendingEvents = [sdkAssistant([{ type: "text", text: "Hi" }])];
      const entries: Array<{ stream: string; timestamp: number }> = [];

      await collect(
        claudeAgent.run({ prompt: "test", cwd: "/tmp", onLog: (entry) => entries.push(entry) }),
      );

      expect(entries[0].stream).toBe("stdout");
      expect(entries[0].timestamp).toBeGreaterThan(0);
    });

    it("emits all events from real trace", async () => {
      pendingEvents = loadFixture("claude-with-tools.jsonl");
      const logCount = { value: 0 };

      await collect(
        claudeAgent.run({ prompt: "test", cwd: "/tmp", onLog: () => { logCount.value++; } }),
      );

      expect(logCount.value).toBe(pendingEvents.length);
    });
  });
});
