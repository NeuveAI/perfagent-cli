import type { AgentBackend } from "@neuve/agent";

const OLLAMA_TIMEOUT_MS = 3000;
const MCP_RESOLVE_TIMEOUT_MS = 5000;

export interface HealthCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message?: string;
}

export const checkOllamaRunning = async (): Promise<HealthCheckResult> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    try {
      await fetch("http://localhost:11434/api/tags", {
        signal: controller.signal,
      });
      return { name: "Ollama", passed: true };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return {
      name: "Ollama",
      passed: false,
      message: "Ollama is not running. Start it with: ollama serve",
    };
  }
};

export const checkDevToolsMcpResolvable = async (): Promise<HealthCheckResult> => {
  try {
    const proc = Bun.spawn(
      ["npx", "chrome-devtools-mcp@0.21.0", "--version"],
      { stdout: "ignore", stderr: "ignore" },
    );

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error("timeout"));
      }, MCP_RESOLVE_TIMEOUT_MS);
    });

    try {
      const exitCode = await Promise.race([proc.exited, timeout]);

      if (exitCode === 0) {
        return { name: "Chrome DevTools MCP", passed: true };
      }
      return {
        name: "Chrome DevTools MCP",
        passed: false,
        message:
          "chrome-devtools-mcp is not installed. Run: npm install -g chrome-devtools-mcp@0.21.0",
      };
    } finally {
      clearTimeout(timer!);
    }
  } catch {
    return {
      name: "Chrome DevTools MCP",
      passed: false,
      message:
        "chrome-devtools-mcp is not installed. Run: npm install -g chrome-devtools-mcp@0.21.0",
    };
  }
};

export const killStaleMcpProcesses = async (): Promise<{ killed: number }> => {
  try {
    const proc = Bun.spawn(["pgrep", "-f", "chrome-devtools-mcp"], {
      stdout: "pipe",
      stderr: "ignore",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const pids = output
      .trim()
      .split("\n")
      .map((line) => parseInt(line, 10))
      .filter((pid) => !isNaN(pid) && pid !== process.pid);

    let killed = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        killed++;
      } catch {
      }
    }

    return { killed };
  } catch {
    return { killed: 0 };
  }
};

export const runHealthChecks = async (
  agent: AgentBackend,
): Promise<readonly HealthCheckResult[]> => {
  await killStaleMcpProcesses();

  const checks = [checkDevToolsMcpResolvable()];

  if (agent === "local") {
    checks.push(checkOllamaRunning());
  }

  return Promise.all(checks);
};
