import { Codex } from "@openai/codex-sdk";
import type { AgentConfig } from "./types.js";

export const codexAgent: AgentConfig = {
  name: "codex",
  envKeys: ["OPENAI_API_KEY"],
  run: async function* (options) {
    const codex = new Codex();

    const thread = options.sessionId
      ? codex.resumeThread(options.sessionId)
      : await codex.startThread();

    const result = await thread.run(options.prompt);

    const resultText = typeof result === "string" ? result : JSON.stringify(result);

    options.onLog?.({ stream: "stdout", data: resultText, timestamp: Date.now() });

    yield { role: "assistant" as const, content: [{ type: "text" as const, text: resultText }] };
  },
};
