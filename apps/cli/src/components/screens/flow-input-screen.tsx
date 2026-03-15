import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Input } from "../ui/input.js";
import { useColors } from "../theme-context.js";
import { stripMouseSequences } from "../../hooks/mouse-context.js";
import type { TestAction } from "../../utils/browser-agent.js";
import { useAppStore } from "../../store.js";
import { ScreenHeading } from "../ui/screen-heading.js";
import { ErrorMessage } from "../ui/error-message.js";
import { Clickable } from "../ui/clickable.js";
import { FLOW_PRESETS } from "../../constants.js";

const ACTION_LABELS: Record<TestAction, string> = {
  "test-unstaged": "Test current changes",
  "test-branch": "Test entire branch",
  "select-commit": "Test commit",
};

export const FlowInputScreen = () => {
  const COLORS = useColors();
  const testAction = useAppStore((state) => state.testAction);
  const selectedCommit = useAppStore((state) => state.selectedCommit);
  const checkedOutBranch = useAppStore((state) => state.checkedOutBranch);
  const checkedOutPrNumber = useAppStore((state) => state.checkedOutPrNumber);
  const flowInstruction = useAppStore((state) => state.flowInstruction);
  const flowInstructionHistory = useAppStore((state) => state.flowInstructionHistory);
  const submitFlowInstruction = useAppStore((state) => state.submitFlowInstruction);

  const [inputMode, setInputMode] = useState<"presets" | "custom">("presets");
  const [presetIndex, setPresetIndex] = useState(0);
  const [value, setValue] = useState(flowInstruction);
  const [inputInstanceKey, setInputInstanceKey] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraftValue, setHistoryDraftValue] = useState(flowInstruction);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateValue = (nextValue: string) => {
    setValue(nextValue);
    setInputInstanceKey((previous) => previous + 1);
    if (errorMessage) setErrorMessage(null);
  };

  const recallPreviousInstruction = () => {
    if (flowInstructionHistory.length === 0) return;

    if (historyIndex === null) {
      setHistoryDraftValue(value);
      setHistoryIndex(0);
      updateValue(flowInstructionHistory[0] ?? "");
      return;
    }

    const nextIndex = Math.min(flowInstructionHistory.length - 1, historyIndex + 1);
    if (nextIndex === historyIndex) return;

    setHistoryIndex(nextIndex);
    updateValue(flowInstructionHistory[nextIndex] ?? "");
  };

  const recallNextInstruction = () => {
    if (historyIndex === null) return;

    if (historyIndex === 0) {
      setHistoryIndex(null);
      updateValue(historyDraftValue);
      return;
    }

    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    updateValue(flowInstructionHistory[nextIndex] ?? historyDraftValue);
  };

  const submitValue = (nextValue: string) => {
    const trimmedValue = nextValue.trim();

    if (!trimmedValue) {
      setErrorMessage("Describe the user flow you want the browser agent to test.");
      return;
    }

    submitFlowInstruction(trimmedValue);
  };

  useInput(
    (input, key) => {
      if (key.tab) {
        setInputMode(inputMode === "presets" ? "custom" : "presets");
        if (errorMessage) setErrorMessage(null);
        return;
      }

      if (inputMode !== "presets") return;

      if (key.downArrow || input === "j") {
        setPresetIndex((previous) => Math.min(FLOW_PRESETS.length - 1, previous + 1));
      }
      if (key.upArrow || input === "k") {
        setPresetIndex((previous) => Math.max(0, previous - 1));
      }
      if (key.return) {
        const selected = FLOW_PRESETS[presetIndex];
        if (selected) submitFlowInstruction(selected);
      }
    },
    { isActive: true },
  );

  if (!testAction) return null;

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <ScreenHeading title={ACTION_LABELS[testAction]} />

      {checkedOutBranch ? (
        <Box marginTop={1}>
          <Text color={COLORS.GREEN}>{"✓ "}</Text>
          <Text color={COLORS.DIM}>{"checked out "}</Text>
          <Text color={COLORS.TEXT} bold>
            {checkedOutBranch}
          </Text>
          {checkedOutPrNumber ? (
            <Text color={COLORS.DIM}>
              {" · PR #"}
              {checkedOutPrNumber}
            </Text>
          ) : null}
        </Box>
      ) : selectedCommit ? (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>{"commit "}</Text>
          <Text color={COLORS.PURPLE}>{selectedCommit.shortHash}</Text>
          <Text color={COLORS.DIM}>{" · "}</Text>
          <Text color={COLORS.TEXT}>{selectedCommit.subject}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        <Text color={COLORS.DIM}>
          {"  "}Quick picks {inputMode === "presets" ? <Text color={COLORS.PRIMARY}>●</Text> : null}
        </Text>
        <Box flexDirection="column" marginTop={0}>
          {FLOW_PRESETS.map((preset, index) => {
            const isSelected = inputMode === "presets" && index === presetIndex;
            return (
              <Clickable key={preset} onClick={() => submitFlowInstruction(preset)}>
                {isSelected ? (
                  <Text>
                    <Text color={COLORS.PRIMARY}>{"  ▸ "}</Text>
                    <Text color={COLORS.PRIMARY} bold>
                      {preset}
                    </Text>
                  </Text>
                ) : (
                  <Text color={COLORS.DIM}>
                    {"    "}
                    {preset}
                  </Text>
                )}
              </Clickable>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={COLORS.DIM}>
          {"  "}Or write your own{" "}
          {inputMode === "custom" ? <Text color={COLORS.PRIMARY}>●</Text> : null}
        </Text>
        <Box
          marginTop={0}
          borderStyle="round"
          borderColor={inputMode === "custom" ? COLORS.PRIMARY : COLORS.BORDER}
          paddingX={2}
        >
          <Text color={COLORS.PRIMARY}>{"❯ "}</Text>
          <Input
            key={`flow-input-${inputInstanceKey}`}
            focus={inputMode === "custom"}
            multiline
            placeholder="Describe what to test..."
            value={value}
            onSubmit={submitValue}
            onUpArrowAtTop={recallPreviousInstruction}
            onDownArrowAtBottom={recallNextInstruction}
            onChange={(nextValue) => {
              const sanitizedValue = stripMouseSequences(nextValue);
              setHistoryIndex(null);
              setHistoryDraftValue(sanitizedValue);
              setValue(sanitizedValue);
              if (errorMessage) setErrorMessage(null);
            }}
          />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          {inputMode === "presets"
            ? "Press ↑/↓ to browse, Enter to select."
            : historyIndex === null
              ? "Use ↑/↓ on the first or last line to recall previous inputs."
              : `Browsing previous inputs ${historyIndex + 1}/${flowInstructionHistory.length}.`}{" "}
          Press <Text color={COLORS.PRIMARY}>Tab</Text> to{" "}
          {inputMode === "presets" ? "write your own" : "see quick picks"}.
        </Text>
      </Box>

      <ErrorMessage message={errorMessage} />
    </Box>
  );
};
