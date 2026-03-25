export const VIDEO_WIDTH_PX = 1920;
export const VIDEO_HEIGHT_PX = 1080;
export const VIDEO_FPS = 30;

export const BACKGROUND_COLOR = "#0a0a0a";
export const TEXT_COLOR = "#d4d4d8";
export const MUTED_COLOR = "#737373";
export const RED_COLOR = "#f87171";
export const GREEN_COLOR = "#4ade80";
export const YELLOW_COLOR = "#eab308";
export const CYAN_COLOR = "#22d3ee";
export const OVERLAY_GRADIENT_RGB = "10, 10, 10";
export const OVERLAY_GRADIENT_HEIGHT_PX = 420;
export const OVERLAY_GRADIENT_HORIZONTAL_PADDING_PX = 120;
export const OVERLAY_GRADIENT_BOTTOM_PADDING_PX = 80;
export const OVERLAY_GRADIENT_BOTTOM_ALPHA = 0.96;
export const OVERLAY_GRADIENT_MIDDLE_ALPHA = 0.55;
export const OVERLAY_GRADIENT_MIDDLE_STOP_PERCENT = 50;

export const COMMAND = "npx expect-cli init";
export const CONTENT_WIDTH_PX = 1400;

export const TYPING_FONT_SIZE_PX = 100;
export const TYPING_CHAR_WIDTH_PX = 60;
export const CHAR_FRAMES = 2;
export const CURSOR_BLINK_FRAMES = 16;
export const TYPING_INITIAL_DELAY_FRAMES = 15;
export const TYPING_POST_PAUSE_FRAMES = 12;
export const TYPING_PAN_THRESHOLD_PX = CONTENT_WIDTH_PX * 0.6;

export const ERROR_LOG_FONT_SIZE_PX = 75;
export const ERROR_LOG_ICON_SIZE_PX = 200;
export const ERROR_LOG_ICON_LEFT_PX = 120;
export const ERROR_LOG_TEXT_LEFT_PX = 300;
export const ERROR_LOG_TOP_START_PX = 110;
export const ERROR_LOG_ITEM_SPACING_PX = 176;
export const ERROR_LOG_INITIAL_DELAY_FRAMES = 5;
export const ERROR_LOG_APPEAR_FRAMES = 8;
export const ERROR_LOG_APPEAR_STAGGER_FRAMES = 4;
export const ERROR_LOG_FAIL_START_FRAMES = 25;
export const ERROR_LOG_FAIL_INTERVAL_FRAMES = 8;
export const ERROR_LOG_FAIL_TRANSITION_FRAMES = 4;
export const ERROR_ICON_COLOR = "#FC272F";
export const CHECK_ICON_COLOR = "#27C840";
export const ERROR_LOG_COVERAGE_FONT_SIZE_PX = 150;
export const ERROR_LOG_COVERAGE_COLOR = "#FC282F";
export const ERROR_LOG_COVERAGE_DELAY_FRAMES = 15;
export const ERROR_LOG_PASS_START_DELAY_FRAMES = 25;
export const ERROR_LOG_PASS_INTERVAL_FRAMES = 12;
export const ERROR_LOG_PASS_TRANSITION_FRAMES = 6;
export const PASS_LOG_COVERAGE_COLOR = "#27C840";

export const ERROR_LOG_ITEMS = [
  { message: "POST /api/checkout \u2192 500 Internal Server Error", failIndex: 0 },
  { message: "Database connection pool exhausted (max: 20)", failIndex: 1 },
  { message: "OAuth token refresh failed: 401 Unauthorized", failIndex: 2 },
  { message: "Memory limit exceeded: container killed (OOMKilled)", failIndex: 3 },
  { message: "Stripe webhook timeout after 30s \u2014 retrying...", failIndex: 4 },
];

export const TEST_PLAN_STEPS = [
  "Navigate to the login page and verify it loads correctly",
  "Enter valid credentials and submit the login form",
  "Verify the dashboard renders with the correct user data",
  "Navigate to the profile page and verify user details display",
  "Update the profile name and verify the change persists",
  "Navigate to the user card and verify the new styling",
  "Test the logout flow and verify redirect to login page",
];

export const TEST_PLAN_FONT_SIZE_PX = 38;
export const FRAMES_PER_STEP = 6;
export const TEST_PLAN_INITIAL_DELAY_FRAMES = 15;

export const EXECUTION_STEP_FONT_SIZE_PX = 38;
export const EXECUTION_STEP_INTERVAL_FRAMES = 12;
export const EXECUTION_STEP_START_FRAME = 20;

export const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_SPEED_FRAMES = 3;

export const RESULTS_STEP_COUNT = 7;
export const RESULTS_ELAPSED_TIME = "12.4s";
export const RESULTS_ANIMATION_FRAMES = 20;

export const SCENE_TYPING_DURATION_FRAMES = 70;
export const SCENE_COVERAGE_BAR_DURATION_FRAMES = 95;
export const SCENE_DIFF_SCAN_DURATION_FRAMES = 90;
export const SCENE_ERROR_LOG_RESOLVED_DURATION_FRAMES = 140;
export const SCENE_TEST_PLAN_DURATION_FRAMES = 135;
export const SCENE_BROWSER_EXECUTION_DURATION_FRAMES = 140;
export const SCENE_RESULTS_DURATION_FRAMES = 110;
export const TRANSITION_DURATION_FRAMES = 15;

export const TOTAL_DURATION =
  SCENE_TYPING_DURATION_FRAMES +
  SCENE_COVERAGE_BAR_DURATION_FRAMES +
  345 -
  TRANSITION_DURATION_FRAMES * 2;
