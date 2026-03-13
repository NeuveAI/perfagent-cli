import type { ModelMessage } from "ai";
import { AGENT_COMMAND_TIMEOUT_MS } from "./constants.js";
import type { AgentConfig, AgentLogEntry } from "./types.js";

export const runAgent = async function* (
  agent: AgentConfig,
  prompt: string,
  options?: {
    cwd?: string;
    sessionId?: string;
    onLog?: (entry: AgentLogEntry) => void;
    env?: Record<string, string>;
  },
): AsyncGenerator<ModelMessage> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort("agent timed out"), AGENT_COMMAND_TIMEOUT_MS);

  try {
    yield* agent.run({
      prompt,
      cwd: options?.cwd ?? process.cwd(),
      sessionId: options?.sessionId,
      signal: abortController.signal,
      onLog: options?.onLog,
      env: options?.env,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};
