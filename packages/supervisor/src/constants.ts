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

export const REPORT_DIRECTORY_NAME = "reports";
export const REPORT_LATEST_JSON_NAME = "latest.json";
export const REPORT_LATEST_MARKDOWN_NAME = "latest.md";
export const REPORT_SLUG_MAX_LENGTH = 60;
export const REPORT_DEFAULT_SLUG = "perf-report";
export const REPORT_JSON_INDENT = 2;
export const REPORT_MAX_CONSOLE_ENTRIES_IN_MARKDOWN = 10;
export const REPORT_MAX_NETWORK_ENTRIES_IN_MARKDOWN = 10;
export const REPORT_ANALYSIS_PREVIEW_CHARS = 4000;

export const ALL_STEPS_TERMINAL_GRACE_MS = 2 * 60 * 1000;

export const REACT_PLAN_UPDATE_CAP = 5;
export const REACT_REFLECT_THRESHOLD = 2;
export const REACT_PREMATURE_RUN_WINDOW = 3;

// Wave R4 prompt-budget thresholds. Gemma 4 E4B advertises a 128K context
// (`ollama show gemma4:e4b` confirms `num_ctx=131072`); we keep a safety
// margin so a runaway trajectory doesn't silently truncate at the model
// boundary. Numbers are PRD §R4 verbatim (warn at ≈75% of 128K, abort at
// ≈93.75%) and not subject to ad-hoc tuning without re-validating against
// `docs/handover/q9-tool-call-gap/diary/rebaseline-2026-04-25.md` Probe D.
export const REACT_BUDGET_WARN_TOKENS = 96_000;
export const REACT_BUDGET_ABORT_TOKENS = 120_000;

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
