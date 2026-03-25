import { Box, Text } from "ink";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions";
import stringWidth from "string-width";
import { useColors, theme } from "../theme-context";
import { HintBar, HINT_SEPARATOR, type HintSegment } from "./hint-bar";
import { Option } from "effect";
import { useNavigationStore, Screen } from "../../stores/use-navigation";
import { usePlanExecutionStore } from "../../stores/use-plan-execution-store";
import { useGitState } from "../../hooks/use-git-state";
import { Clickable } from "./clickable";
import { TextShimmer } from "./text-shimmer";

const useHintSegments = (screen: Screen): HintSegment[] => {
  const COLORS = useColors();
  const setScreen = useNavigationStore((state) => state.setScreen);

  switch (screen._tag) {
    case "Main": {
      return [
        {
          key: "ctrl+r",
          label: "saved flows",
          cta: true,
          onClick: () => setScreen(Screen.SavedFlowPicker()),
        },
        {
          key: "ctrl+p",
          label: "pick pr",
          cta: true,
          onClick: () => setScreen(Screen.SelectPr()),
        },
      ];
    }
    case "SelectPr":
      return [
        { key: "↑↓", label: "nav" },
        { key: "←→", label: "filter" },
        { key: "/", label: "search" },
        { key: "esc", label: "back", cta: true, onClick: () => setScreen(Screen.Main()) },
        { key: "enter", label: "select", color: COLORS.PRIMARY, cta: true },
      ];
    case "SavedFlowPicker":
      return [
        { key: "↑↓", label: "nav" },
        { key: "esc", label: "back", cta: true, onClick: () => setScreen(Screen.Main()) },
        { key: "enter", label: "select", color: COLORS.PRIMARY, cta: true },
      ];
    case "CookieSyncConfirm":
      return [
        { key: "↑↓", label: "nav" },
        {
          key: "esc",
          label: "back",
          onClick: () => setScreen(Screen.Main()),
        },
        {
          key: "c",
          label: "enable sync",
          cta: true,
          onClick: () => {
            setScreen(
              Screen.Testing({
                changesFor: screen.changesFor,
                instruction: screen.instruction,
                savedFlow: screen.savedFlow,
              }),
            );
          },
        },
        {
          key: "a",
          label: "run anyway",
          color: COLORS.PRIMARY,
          cta: true,
          onClick: () => {
            setScreen(
              Screen.Testing({
                changesFor: screen.changesFor,
                instruction: screen.instruction,
                savedFlow: screen.savedFlow,
              }),
            );
          },
        },
      ];
    case "Testing": {
      return [{ key: "esc", label: "cancel" }];
    }
    case "Results": {
      const hints: HintSegment[] = [{ key: "y", label: "copy", color: COLORS.PRIMARY, cta: true }];
      if (Option.isSome(screen.report.pullRequest)) {
        hints.push({ key: "p", label: "post to PR", cta: true });
      }
      hints.push({ key: "s", label: "save flow", cta: true });
      hints.push({
        key: "r",
        label: "restart",
        color: COLORS.PRIMARY,
        cta: true,
        onClick: () => {
          usePlanExecutionStore.getState().setExecutedPlan(undefined);
          setScreen(
            Screen.Testing({
              changesFor: screen.report.changesFor,
              instruction: screen.report.instruction,
            }),
          );
        },
      });
      hints.push({
        key: "esc",
        label: "main menu",
        cta: true,
        onClick: () => {
          usePlanExecutionStore.getState().setExecutedPlan(undefined);
          setScreen(Screen.Main());
        },
      });
      return hints;
    }
    default:
      return [];
  }
};

const getHintText = (segments: HintSegment[]): string =>
  segments.length > 0
    ? ` ${segments.map((segment) => `${segment.label} [${segment.key}]`).join(HINT_SEPARATOR)}`
    : "";

export const Modeline = () => {
  const [columns] = useStdoutDimensions();
  const { data: gitState } = useGitState();
  const screen = useNavigationStore((state) => state.screen);
  const segments = useHintSegments(screen);

  if (!gitState) return null;

  const keybinds = segments.filter((segment) => !segment.cta);
  const actions = segments.filter((segment) => segment.cta);

  const keybindText = getHintText(keybinds);
  const actionPills = actions
    .map((action) =>
      action.color ? ` ${action.label} [${action.key}] ` : `${action.label} [${action.key}]`,
    )
    .join("   ");
  const actionWidth = actions.length > 0 ? stringWidth(actionPills) : 0;
  const rightWidth = stringWidth(keybindText);
  const gap = Math.max(0, columns - actionWidth - rightWidth - 2);

  return (
    <Box flexDirection="column">
      {screen._tag === "Testing" ? (
        <TextShimmer
          text={"─".repeat(columns)}
          baseColor={theme.border}
          highlightColor={theme.primary}
          speed={3}
        />
      ) : (
        <Text color={theme.border}>{"─".repeat(columns)}</Text>
      )}
      <Box paddingX={1}>
        {actions.map((action, index) => {
          const pill = (
            <Text key={action.key + action.label}>
              {index > 0 ? "   " : ""}
              {action.color ? (
                <Text backgroundColor={action.color} color="black">
                  {" "}
                  <Text bold>{action.label}</Text> <Text>[{action.key}]</Text>{" "}
                </Text>
              ) : (
                <Text>
                  <Text color={theme.textMuted}>{action.label} </Text>
                  <Text color={theme.textMuted}>[{action.key}]</Text>
                </Text>
              )}
            </Text>
          );

          return action.onClick ? (
            <Clickable key={action.key + action.label} onClick={action.onClick} fullWidth={false}>
              {pill}
            </Clickable>
          ) : (
            pill
          );
        })}
        <Text>{" ".repeat(gap)}</Text>
        {keybinds.length > 0 ? (
          <HintBar segments={keybinds} color={theme.primary} mutedColor={theme.textMuted} />
        ) : null}
      </Box>
    </Box>
  );
};
