import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

const mockRun = vi.fn();
const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();

vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    startThread = mockStartThread.mockResolvedValue({ run: mockRun });
    resumeThread = mockResumeThread.mockReturnValue({ run: mockRun });
  },
}));

import { codexAgent } from "../src/codex.js";

const collect = async (generator: AsyncGenerator<ModelMessage>): Promise<ModelMessage[]> => {
  const messages: ModelMessage[] = [];
  for await (const message of generator) messages.push(message);
  return messages;
};

describe("codexAgent", () => {
  describe("result handling", () => {
    it("yields assistant message from string result", async () => {
      mockRun.mockResolvedValue("Here are the files in this directory.");

      const messages = await collect(codexAgent.run({ prompt: "list files", cwd: "/tmp" }));

      expect(messages).toEqual([
        { role: "assistant", content: [{ type: "text", text: "Here are the files in this directory." }] },
      ]);
    });

    it("serializes object result to JSON string", async () => {
      const objectResult = { files: ["index.ts", "package.json"], count: 2 };
      mockRun.mockResolvedValue(objectResult);

      const messages = await collect(codexAgent.run({ prompt: "list files", cwd: "/tmp" }));

      const content = messages[0].content as Array<{ text: string }>;
      expect(JSON.parse(content[0].text)).toEqual(objectResult);
    });

    it("handles number result", async () => {
      mockRun.mockResolvedValue(42);

      const messages = await collect(codexAgent.run({ prompt: "count files", cwd: "/tmp" }));

      const content = messages[0].content as Array<{ text: string }>;
      expect(content[0].text).toBe("42");
    });

    it("handles null result", async () => {
      mockRun.mockResolvedValue(null);

      const messages = await collect(codexAgent.run({ prompt: "test", cwd: "/tmp" }));

      const content = messages[0].content as Array<{ text: string }>;
      expect(content[0].text).toBe("null");
    });

    it("handles empty string result", async () => {
      mockRun.mockResolvedValue("");

      const messages = await collect(codexAgent.run({ prompt: "test", cwd: "/tmp" }));

      const content = messages[0].content as Array<{ text: string }>;
      expect(content[0].text).toBe("");
    });
  });

  describe("prompt passthrough", () => {
    it("passes prompt directly to thread.run", async () => {
      mockRun.mockResolvedValue("done");

      await collect(codexAgent.run({ prompt: "fix the bug in auth.ts", cwd: "/tmp" }));

      expect(mockRun).toHaveBeenCalledWith("fix the bug in auth.ts");
    });

    it("preserves special characters in prompt", async () => {
      mockRun.mockResolvedValue("done");

      await collect(codexAgent.run({ prompt: "find files matching *.ts && count them", cwd: "/tmp" }));

      expect(mockRun).toHaveBeenCalledWith("find files matching *.ts && count them");
    });
  });

  describe("session handling", () => {
    it("starts new thread when no sessionId", async () => {
      mockRun.mockResolvedValue("done");

      await collect(codexAgent.run({ prompt: "test", cwd: "/tmp" }));

      expect(mockStartThread).toHaveBeenCalled();
      expect(mockResumeThread).not.toHaveBeenCalled();
    });

    it("resumes thread when sessionId provided", async () => {
      mockRun.mockResolvedValue("done");

      await collect(codexAgent.run({ prompt: "continue", cwd: "/tmp", sessionId: "thread-abc-123" }));

      expect(mockResumeThread).toHaveBeenCalledWith("thread-abc-123");
    });
  });

  describe("error handling", () => {
    it("propagates errors from thread.run", async () => {
      mockRun.mockRejectedValue(new Error("API rate limit exceeded"));

      await expect(
        collect(codexAgent.run({ prompt: "test", cwd: "/tmp" })),
      ).rejects.toThrow("API rate limit exceeded");
    });
  });

  describe("onLog callback", () => {
    it("emits result text", async () => {
      mockRun.mockResolvedValue("result text");
      const logs: string[] = [];

      await collect(
        codexAgent.run({ prompt: "test", cwd: "/tmp", onLog: (entry) => logs.push(entry.data) }),
      );

      expect(logs).toEqual(["result text"]);
    });

    it("log entries have stream:stdout and timestamp", async () => {
      mockRun.mockResolvedValue("result");
      const entries: Array<{ stream: string; timestamp: number }> = [];

      await collect(
        codexAgent.run({ prompt: "test", cwd: "/tmp", onLog: (entry) => entries.push(entry) }),
      );

      expect(entries[0].stream).toBe("stdout");
      expect(entries[0].timestamp).toBeGreaterThan(0);
    });

    it("does not throw when onLog is not provided", async () => {
      mockRun.mockResolvedValue("result");

      await expect(collect(codexAgent.run({ prompt: "test", cwd: "/tmp" }))).resolves.toHaveLength(1);
    });
  });
});
