export const COLORS = {
  RED: "#ff5555",
  GREEN: "#50fa7b",
  YELLOW: "#f1fa8c",
  PRIMARY: "#8be9fd",
  DIM: "#6272a4",
  TEXT: "#f8f8f2",
  BORDER: "#bd93f9",
  SELECTION: "#44475a",
  BANNER_BG: "#282a36",
  INPUT_BG: "#282a36",
  WARNING: "#ffb86c",
  SHIMMER_BASE: "#44475a",
  SHIMMER_HIGHLIGHT: "#bd93f9",
} as const;

export const SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
export const SPINNER_INTERVAL_MS = 80;
export const TOAST_DURATION_MS = 3000;
export const MIN_COLUMNS_FOR_CYCLE_HINT = 80;

export const PORT_PICKER_VISIBLE_COUNT = 10;
export const MIN_USER_PORT = 1024;
export const MAX_PORT = 65535;
export const EPHEMERAL_PORT_START = 32768;
export const LISTENING_PORTS_REFETCH_INTERVAL_MS = 5000;
export const TLS_PROBE_TIMEOUT_MS = 300;
export const PROJECT_SCAN_MAX_DEPTH = 3;

export const TESTING_TOOL_TEXT_CHAR_LIMIT = 100;
export const TESTING_RESULT_PREVIEW_MAX_CHARS = 120;
export const TESTING_ARG_PREVIEW_MAX_CHARS = 80;
export const TESTING_TIMER_UPDATE_INTERVAL_MS = 1000;
export const MAX_VISIBLE_TOOL_CALLS = 5;
