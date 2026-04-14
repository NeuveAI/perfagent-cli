import * as fs from "node:fs";
import * as path from "node:path";

const resolveLogPath = (): string => {
  const override = process.env["PERF_AGENT_LOCAL_LOG"];
  if (override) return override;
  const cwd = process.cwd();
  const dir = path.join(cwd, ".perf-agent");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return path.join(dir, "local-agent.log");
};

const LOG_PATH = resolveLogPath();

export const log = (message: string, context?: Record<string, unknown>): void => {
  const timestamp = new Date().toISOString();
  const payload = context ? ` ${JSON.stringify(context)}` : "";
  const line = `[${timestamp}] ${message}${payload}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
  process.stderr.write(line);
};
