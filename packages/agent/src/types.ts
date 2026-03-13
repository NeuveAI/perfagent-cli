import type { ModelMessage } from "ai";

export type { ModelMessage } from "ai";

export type AgentFormat = "claude" | "codex";

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  sessionId?: string;
  signal?: AbortSignal;
  onLog?: (entry: AgentLogEntry) => void;
  env?: Record<string, string>;
}

export interface AgentConfig {
  name: AgentFormat;
  envKeys: string[];
  run: (options: AgentRunOptions) => AsyncGenerator<ModelMessage>;
}

export interface AgentLogEntry {
  stream: "stdout" | "stderr";
  data: string;
  timestamp: number;
}
