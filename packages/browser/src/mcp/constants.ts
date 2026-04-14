export const PERF_AGENT_COOKIE_BROWSERS_ENV_NAME = "PERF_AGENT_COOKIE_BROWSERS";
export const PERF_AGENT_CDP_URL_ENV_NAME = "PERF_AGENT_CDP_URL";
export const PERF_AGENT_BASE_URL_ENV_NAME = "PERF_AGENT_BASE_URL";
export const PERF_AGENT_HEADED_ENV_NAME = "PERF_AGENT_HEADED";
export const PERF_AGENT_PROFILE_ENV_NAME = "PERF_AGENT_PROFILE";
export const TMP_ARTIFACT_OUTPUT_DIRECTORY = "/tmp/perf-agent-artifacts";
export const CLI_SESSION_FILE = "/tmp/perf-agent-cli-session.json";
export const MAX_DAEMON_REQUEST_BODY_BYTES = 1024 * 1024;
export const MAX_STRINGIFY_LENGTH = 10_000;
// HACK: MCP SDK StdioClientTransport.close() does stdin.end → wait 2s → SIGTERM → wait 2s → SIGKILL.
// Worst case is ~4s. 5s lets the SDK's own teardown finish before our force-exit watchdog fires,
// otherwise Chrome gets orphaned (the exact zombie this is meant to prevent).
export const SHUTDOWN_GRACE_PERIOD_MS = 5_000;
