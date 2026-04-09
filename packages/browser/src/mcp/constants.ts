import * as path from "node:path";

export const PERF_AGENT_COOKIE_BROWSERS_ENV_NAME = "PERF_AGENT_COOKIE_BROWSERS";
export const PERF_AGENT_CDP_URL_ENV_NAME = "PERF_AGENT_CDP_URL";
export const PERF_AGENT_BASE_URL_ENV_NAME = "PERF_AGENT_BASE_URL";
export const PERF_AGENT_HEADED_ENV_NAME = "PERF_AGENT_HEADED";
export const PERF_AGENT_PROFILE_ENV_NAME = "PERF_AGENT_PROFILE";
export const DUPLICATE_REQUEST_WINDOW_MS = 500;
export const TMP_ARTIFACT_OUTPUT_DIRECTORY = "/tmp/perf-agent-artifacts";
export const CLI_SESSION_FILE = "/tmp/perf-agent-cli-session.json";
export const MAX_DAEMON_REQUEST_BODY_BYTES = 1024 * 1024;
export const MAX_STRINGIFY_LENGTH = 10_000;
export const PLAYWRIGHT_RESULTS_DIR = path.join(
  TMP_ARTIFACT_OUTPUT_DIRECTORY,
  "playwright-results",
);
