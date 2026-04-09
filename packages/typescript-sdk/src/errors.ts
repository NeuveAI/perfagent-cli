import { Schema } from "effect";

export class PerfAgentTimeoutError extends Schema.ErrorClass<PerfAgentTimeoutError>("PerfAgentTimeoutError")(
  {
    _tag: Schema.tag("PerfAgentTimeoutError"),
    timeoutMs: Schema.Number,
  },
) {
  message = `perf-agent execution timed out after ${this.timeoutMs}ms`;
}

export class PerfAgentConfigError extends Error {
  constructor(message: string, fix: string) {
    super(`${message}\n\nFix: ${fix}`);
    this.name = "PerfAgentConfigError";
  }
}
