import { McpRuntime } from "./runtime";
import { startBrowserMcpServer } from "./server";
import { SHUTDOWN_GRACE_PERIOD_MS } from "./constants";

const STDIN_END_EXIT_CODE = 0;
const SIGINT_EXIT_CODE = 130;
const SIGTERM_EXIT_CODE = 143;
const SIGHUP_EXIT_CODE = 129;

let cleanupRegistered = false;
let shuttingDown = false;

const triggerShutdown = (exitCode: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExitTimer = setTimeout(() => {
    process.stderr.write(
      `perf-agent browser-mcp: dispose timed out after ${SHUTDOWN_GRACE_PERIOD_MS}ms, forcing exit\n`,
    );
    process.exit(exitCode);
  }, SHUTDOWN_GRACE_PERIOD_MS);
  forceExitTimer.unref();
  McpRuntime.dispose()
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`perf-agent browser-mcp: dispose error: ${reason}\n`);
    })
    .finally(() => {
      clearTimeout(forceExitTimer);
      process.exit(exitCode);
    });
};

const registerProcessCleanup = () => {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  process.once("SIGINT", () => triggerShutdown(SIGINT_EXIT_CODE));
  process.once("SIGTERM", () => triggerShutdown(SIGTERM_EXIT_CODE));
  process.once("SIGHUP", () => triggerShutdown(SIGHUP_EXIT_CODE));
  // HACK: when the parent coding agent exits without closing stdio cleanly,
  // stdin receives EOF — treat that as a shutdown signal so we don't leak
  // the chrome-devtools-mcp child + its Chrome.
  process.stdin.once("close", () => triggerShutdown(STDIN_END_EXIT_CODE));
};

registerProcessCleanup();
void startBrowserMcpServer(McpRuntime);
