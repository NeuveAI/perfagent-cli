export const ASCII_ART = `   __            __  _
  / /____  _____/ /_(_)__
 / __/ _ \\/ ___/ __/ / _ \\
/ /_/  __(__  ) /_/ /  __/
\\__/\\___/____/\\__/_/\\___/`;

export const SELECTED_INDICATOR = "➤";

export const NUMBER_OPTION_GAP = "  ";

export const CURRENT_BRANCH_INDEX = 1;

export const MENU_OPTIONS = [
  {
    label: "Unstaged changes",
    detail: "[ +44 -23 · 2 files ]",
  },
  {
    label: "Current branch",
    detail: "(current/branch)",
  },
  {
    label: "Local branch",
    detail: "(14)",
  },
  {
    label: "Remote branch",
    detail: "(millionco/ami)",
  },
  {
    label: "Something else (describe your own test) ...",
    detail: "",
    separated: true,
  },
] as const;

export const PROMPT_TEXT = "What would you like to test?";

export const LOCAL_BRANCH_INDEX = 2;
export const REMOTE_BRANCH_INDEX = 3;
export const SOMETHING_ELSE_INDEX = 4;

export const BRANCH_COUNT = 14;

export const REMOTE_NAME = "millionco/ami";

export const FETCH_DELAY_MS = 2000;


export const SEARCH_PLACEHOLDER = "Search branches ...";

export const COLORS = {
  BACKGROUND: "#1e1e1e",
  TEXT: "#cccccc",
  DIM: "#666666",
  GREEN: "#6abf69",
  SELECTION: "#7dc4e8",
  RED: "#f44747",
  WHITE: "#ffffff",
  BORDER: "#555555",
  DIVIDER: "#444444",
  YELLOW: "#e5c07b",
  PURPLE: "#c678dd",
  ORANGE: "#ff8833",
} as const;
