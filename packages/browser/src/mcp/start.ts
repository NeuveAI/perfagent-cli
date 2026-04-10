import { McpRuntime } from "./runtime";
import { startBrowserMcpServer } from "./server";

let cleanupRegistered = false;

const registerProcessCleanup = () => {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const handleShutdown = () => {
    process.exit(0);
  };

  process.once("SIGINT", handleShutdown);
  process.once("SIGTERM", handleShutdown);
};

registerProcessCleanup();
void startBrowserMcpServer(McpRuntime);
