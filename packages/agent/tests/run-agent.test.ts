import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import type { AgentConfig, AgentLogEntry } from "../src/types.js";
import { runAgent } from "../src/run-agent.js";

const collect = async (generator: AsyncGenerator<ModelMessage>): Promise<ModelMessage[]> => {
  const messages: ModelMessage[] = [];
  for await (const message of generator) messages.push(message);
  return messages;
};

const textMessage = (text: string): ModelMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
});

const createMockAgent = (generator: AgentConfig["run"]): AgentConfig => ({
  name: "claude",
  envKeys: [],
  run: generator,
});

describe("runAgent", () => {
  describe("message streaming", () => {
    it("yields messages from the underlying agent", async () => {
      const agent = createMockAgent(async function* () {
        yield textMessage("Hello");
        yield textMessage("World");
      });

      const messages = await collect(runAgent(agent, "test"));

      expect(messages).toHaveLength(2);
      expect(messages.map((message) => (message.content as Array<{ text: string }>)[0].text)).toEqual([
        "Hello",
        "World",
      ]);
    });

    it("yields messages in order", async () => {
      const agent = createMockAgent(async function* () {
        yield textMessage("first");
        yield textMessage("second");
        yield textMessage("third");
      });

      const messages = await collect(runAgent(agent, "test"));

      expect(messages.map((message) => (message.content as Array<{ text: string }>)[0].text)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });

    it("handles agent that yields no messages", async () => {
      const agent = createMockAgent(async function* () {
        yield textMessage("only-to-satisfy-lint");
        return;
      });

      const messages = await collect(runAgent(agent, "test"));
      expect(messages).toHaveLength(1);
    });

    it("yields different message roles", async () => {
      const agent = createMockAgent(async function* () {
        yield { role: "assistant" as const, content: [{ type: "text" as const, text: "I'll check" }] };
        yield {
          role: "assistant" as const,
          content: [{ type: "tool-call" as const, toolCallId: "t1", toolName: "Read", input: {} }],
        };
        yield {
          role: "tool" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId: "t1",
              toolName: "Read",
              output: { type: "text" as const, value: "file contents" },
            },
          ],
        };
      });

      const messages = await collect(runAgent(agent, "test"));
      expect(messages.map((message) => message.role)).toEqual(["assistant", "assistant", "tool"]);
    });
  });

  describe("option passthrough", () => {
    it("passes prompt to agent.run", async () => {
      let capturedPrompt = "";

      const agent = createMockAgent(async function* (options) {
        capturedPrompt = options.prompt;
        yield textMessage("ack");
      });

      await collect(runAgent(agent, "fix the bug in auth.ts"));

      expect(capturedPrompt).toBe("fix the bug in auth.ts");
    });

    it("passes cwd and sessionId", async () => {
      let capturedCwd = "";
      let capturedSessionId: string | undefined;

      const agent = createMockAgent(async function* (options) {
        capturedCwd = options.cwd;
        capturedSessionId = options.sessionId;
        yield textMessage("ack");
      });

      await collect(runAgent(agent, "test", { cwd: "/my/project", sessionId: "sess-123" }));

      expect(capturedCwd).toBe("/my/project");
      expect(capturedSessionId).toBe("sess-123");
    });

    it("defaults cwd to process.cwd() when not provided", async () => {
      let capturedCwd = "";

      const agent = createMockAgent(async function* (options) {
        capturedCwd = options.cwd;
        yield textMessage("ack");
      });

      await collect(runAgent(agent, "test"));

      expect(capturedCwd).toBe(process.cwd());
    });

    it("passes env to agent.run", async () => {
      let capturedEnv: Record<string, string> | undefined;

      const agent = createMockAgent(async function* (options) {
        capturedEnv = options.env;
        yield textMessage("ack");
      });

      const env = { CUSTOM_VAR: "value", API_KEY: "secret" };
      await collect(runAgent(agent, "test", { env }));

      expect(capturedEnv).toEqual(env);
    });

    it("forwards onLog callback", async () => {
      const logs: AgentLogEntry[] = [];

      const agent = createMockAgent(async function* (options) {
        options.onLog?.({ stream: "stdout", data: "hello", timestamp: 1000 });
        yield textMessage("ack");
      });

      await collect(runAgent(agent, "test", { onLog: (entry) => logs.push(entry) }));

      expect(logs).toEqual([{ stream: "stdout", data: "hello", timestamp: 1000 }]);
    });
  });

  describe("abort signal", () => {
    it("provides non-aborted signal to agent", async () => {
      let receivedSignal: AbortSignal | undefined;

      const agent = createMockAgent(async function* (options) {
        receivedSignal = options.signal;
        yield textMessage("ack");
      });

      await collect(runAgent(agent, "test"));

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal?.aborted).toBe(false);
    });

    it("clears timeout after successful completion", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      const agent = createMockAgent(async function* () {
        yield textMessage("done");
      });

      await collect(runAgent(agent, "test"));

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it("clears timeout even when agent throws", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      const agent = createMockAgent(async function* () {
        yield textMessage("before");
        throw new Error("boom");
      });

      try {
        await collect(runAgent(agent, "test"));
      } catch {
        // expected
      }

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("propagates errors from the agent", async () => {
      const agent = createMockAgent(async function* () {
        yield textMessage("before error");
        throw new Error("agent crashed");
      });

      const messages: ModelMessage[] = [];
      await expect(async () => {
        for await (const message of runAgent(agent, "test")) {
          messages.push(message);
        }
      }).rejects.toThrow("agent crashed");

      expect(messages).toHaveLength(1);
    });

    it("preserves error type", async () => {
      const agent = createMockAgent(async function* () {
        yield textMessage("ack");
        throw new TypeError("invalid argument");
      });

      await expect(collect(runAgent(agent, "test"))).rejects.toBeInstanceOf(TypeError);
    });

    it("propagates errors thrown before any yield", async () => {
      const agent = createMockAgent(async function* () {
        throw new Error("immediate failure");
        yield textMessage("never reached");
      });

      await expect(collect(runAgent(agent, "test"))).rejects.toThrow("immediate failure");
    });
  });
});
