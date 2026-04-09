export const COMMENT_DIRECTORY_PREFIX = "perf-agent-comment-";
export const FLOW_DIRECTORY_NAME = "flows";
export const FLOW_DESCRIPTION_CHAR_LIMIT = 120;
export const SAVED_FLOW_FORMAT_VERSION = 3;
export const GIT_TIMEOUT_MS = 5000;
export const GITHUB_TIMEOUT_MS = 15000;
export const PR_LIMIT = 100;
export const EXECUTION_CONTEXT_FILE_LIMIT = 12;
export const EXECUTION_RECENT_COMMIT_LIMIT = 5;
export const PERF_AGENT_STATE_DIR = ".perf-agent";
export const TESTED_FINGERPRINT_FILE = "last-tested";

export const ALL_STEPS_TERMINAL_GRACE_MS = 2 * 60 * 1000;

export const FRAMEWORK_DEFAULT_PORTS: Record<string, number> = {
  next: 3000,
  vite: 5173,
  angular: 4200,
  remix: 5173,
  astro: 4321,
  nuxt: 3000,
  sveltekit: 5173,
  gatsby: 8000,
  "create-react-app": 3000,
  unknown: 3000,
};
