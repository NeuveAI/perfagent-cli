export const DEFAULT_TIMEOUT_MS = 5000;
export const MS_PER_SECOND = 1000;

export const BROWSER_MEMORY_OVERHEAD_MB = 150;
export const MEMORY_SAFETY_RATIO = 0.75;
export const BYTES_PER_MB = 1024 * 1024;
export const FALLBACK_CPU_CORES = 1;

// Wave R4 trajectory rolling — JetBrains 10-turn sliding window per
// `architecture-prd.md` §4 Decision #6. The most recent 10 assistant/observation
// pairs are kept verbatim; older pairs collapse into a single
// `<trajectory_summary>` block via the rule-based summarizer.
export const REACT_TRAJECTORY_VERBATIM_WINDOW = 10;

// Per-turn observation truncation cap (characters) used by the rolling
// summarizer. Long tool outputs (e.g. trace insight dumps) get sliced to this
// length in the `<event>...</event>` summary line so the rolled prefix stays
// bounded even on >100-turn runs.
export const REACT_TRAJECTORY_OBSERVATION_SUMMARY_CHAR_LIMIT = 120;
