import { Box, Text, useStdout } from "ink";
import { useThemeContext } from "./theme-context.js";
import { STATUSBAR_BRANCH_PADDING, STATUSBAR_TRAILING_PADDING } from "./constants.js";
import { useAppStore } from "./store.js";
import type { Screen } from "./store.js";

const SCREEN_HINTS: Record<Screen, string> = {
  main: "t theme · b branch · ↑↓ nav",
  "switch-branch": "↑↓ nav · tab local/remote · enter select · esc back",
  "select-commit": "↑↓ nav · enter select · / search · esc back",
  "flow-input": "enter submit · esc back",
  planning: "esc cancel",
  "review-plan": "enter approve · esc back",
  testing: "",
  theme: "↑↓ nav · tab light/dark · enter select · esc cancel",
};

export const Modeline = () => {
  const { stdout } = useStdout();
  const { theme } = useThemeContext();
  const gitState = useAppStore((state) => state.gitState);
  const screen = useAppStore((state) => state.screen);

  if (!gitState) return null;

  const hints = SCREEN_HINTS[screen] ?? "";
  const remaining =
    stdout.columns - STATUSBAR_BRANCH_PADDING - gitState.currentBranch.length - STATUSBAR_TRAILING_PADDING;

  return (
    <Box>
      <Text backgroundColor={theme.primary} color="#000000" bold>
        {" "}{gitState.currentBranch}{" "}
      </Text>
      <Text backgroundColor={theme.border} color={theme.text}>
        {(hints ? ` ${hints}` : "").padEnd(remaining)}
      </Text>
    </Box>
  );
};
