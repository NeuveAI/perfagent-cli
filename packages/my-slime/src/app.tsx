import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  COLORS,
  CURRENT_BRANCH_INDEX,
  LOCAL_BRANCH_INDEX,
  MENU_OPTIONS,
  NUMBER_OPTION_GAP,
  PROMPT_TEXT,
  REMOTE_BRANCH_INDEX,
  SOMETHING_ELSE_INDEX,
} from "./constants";
import { MenuItem } from "./menu-item";
import { LocalBranchScreen } from "./local-branch-screen";
import { RemoteBranchScreen } from "./remote-branch-screen";
import { ColoredLogo } from "./colored-logo";

type Screen = "main" | "local-branch" | "remote-branch";

export const App = () => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [screen, setScreen] = useState<Screen>("main");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string | null>(null);
  const [somethingElseValue, setSomethingElseValue] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(false);

  useKeyboard((key) => {
    if (screen !== "main") {
      if (key.name === "escape") {
        setScreen("main");
      }
      return;
    }

    if (key.name === "up") {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
    }
    if (key.name === "down") {
      setSelectedIndex((previous) => Math.min(MENU_OPTIONS.length - 1, previous + 1));
    }

    if (selectedIndex === SOMETHING_ELSE_INDEX) return;

    if (key.name === "k") {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
    }
    if (key.name === "j") {
      setSelectedIndex((previous) => Math.min(MENU_OPTIONS.length - 1, previous + 1));
    }
    const numberPressed = Number(key.name);
    if (numberPressed >= 1 && numberPressed <= MENU_OPTIONS.length) {
      setSelectedIndex(numberPressed - 1);
    }
    if (selectedIndex === CURRENT_BRANCH_INDEX && key.name === "space") {
      setIncludeUnstaged((previous) => !previous);
    }
    if (key.name === "return") {
      if (selectedIndex === LOCAL_BRANCH_INDEX) {
        setScreen("local-branch");
      }
      if (selectedIndex === REMOTE_BRANCH_INDEX) {
        setScreen("remote-branch");
      }
    }
  });

  const handleLocalBranchSelect = (branch: string) => {
    setSelectedBranch(branch);
    setScreen("main");
  };

  const handleRemoteBranchSelect = (branch: string) => {
    setSelectedRemoteBranch(branch);
    setScreen("main");
  };

  if (screen === "local-branch") {
    return <LocalBranchScreen onSelect={handleLocalBranchSelect} />;
  }

  if (screen === "remote-branch") {
    return <RemoteBranchScreen onSelect={handleRemoteBranchSelect} />;
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={COLORS.BACKGROUND}
      paddingX={2}
      paddingY={1}
    >
      <ColoredLogo />

      <box flexDirection="row" marginTop={2} alignItems="flex-end">
        <text fg={COLORS.ORANGE}>{"(•‿•)"}</text>
        <box flexDirection="column" marginLeft={1}>
          <box
            border
            borderStyle="rounded"
            borderColor={COLORS.ORANGE}
            paddingX={1}
          >
            <text fg={COLORS.TEXT}>{PROMPT_TEXT}</text>
          </box>
          <text fg={COLORS.ORANGE}>{"──╯"}</text>
        </box>
      </box>

      <box flexDirection="column" marginTop={2} gap={1}>
        {MENU_OPTIONS.map((option, index) => {
          let detail: string = option.detail;
          if (index === LOCAL_BRANCH_INDEX && selectedBranch) {
            detail = `(${selectedBranch})`;
          }
          if (index === REMOTE_BRANCH_INDEX && selectedRemoteBranch) {
            detail = `(${selectedRemoteBranch})`;
          }
          return (
            <box key={index} flexDirection="column" gap={"separated" in option ? 0 : 1}>
              {"separated" in option && option.separated && (
                <box
                  height={1}
                  width="100%"
                  border={["top"]}
                  borderColor={COLORS.DIVIDER}
                  borderStyle="single"
                />
              )}
              {index === SOMETHING_ELSE_INDEX ? (
                <box flexDirection="row">
                  <text fg={index === selectedIndex ? COLORS.SELECTION : COLORS.TEXT}>
                    {index === selectedIndex ? `➤ ${index + 1}${NUMBER_OPTION_GAP}` : `  ${index + 1}${NUMBER_OPTION_GAP}`}
                  </text>
                  <input
                    focused={index === selectedIndex}
                    textColor={COLORS.TEXT}
                    placeholder={option.label}
                    placeholderColor={index === selectedIndex ? COLORS.SELECTION : COLORS.DIM}
                    value={somethingElseValue}
                    onInput={setSomethingElseValue}
                    flexGrow={1}
                  />
                </box>
              ) : (
                <box flexDirection="column">
                  <MenuItem
                    index={index}
                    label={option.label}
                    detail={detail}
                    isSelected={index === selectedIndex}
                  />
                  {index === CURRENT_BRANCH_INDEX && index === selectedIndex && (
                    <text fg={COLORS.DIM} marginLeft={5}>
                      <span fg={includeUnstaged ? COLORS.GREEN : COLORS.DIM}>
                        {includeUnstaged ? "[" : "[ ]"}
                      </span>
                      {includeUnstaged && <span fg={COLORS.WHITE}>{"x"}</span>}
                      {includeUnstaged && <span fg={COLORS.GREEN}>{"]"}</span>}
                      <span> include unstaged changes </span>
                      <span fg={COLORS.DIM}>(space to toggle)</span>
                    </text>
                  )}
                </box>
              )}
            </box>
          );
        })}
      </box>

      <box
        marginTop={2}
        height={1}
        width="100%"
        border={["top"]}
        borderColor={COLORS.DIVIDER}
        borderStyle="single"
      />

      <text fg={COLORS.DIM} marginTop={1}>
        ↑/↓ to navigate · Enter to select
      </text>
    </box>
  );
};
