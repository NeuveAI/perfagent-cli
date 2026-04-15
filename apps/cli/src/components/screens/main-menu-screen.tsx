import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import figures from "figures";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useAtomValue } from "@effect/atom-react";
import { recentReportsAtom } from "../../data/recent-reports-atom";
import { formatRelativeTime } from "../../utils/format-relative-time";
import { formatHostPath } from "../../utils/format-host-path";
import { ChangesFor, checkoutBranch } from "@neuve/supervisor";
import type { GitState, AnalysisContext } from "@neuve/shared/models";
import { usePreferencesStore } from "../../stores/use-preferences";
import { useProjectPreferencesStore } from "../../stores/use-project-preferences";
import {
  useNavigationStore,
  Screen,
  screenForTestingOrPortPicker,
} from "../../stores/use-navigation";
import { useColors, COLORS } from "../theme-context";
import { Input } from "../ui/input";
import { InlineError } from "../ui/error-message";
import { RuledBox } from "../ui/ruled-box";
import { Spinner } from "../ui/spinner";
import { Logo } from "../ui/logo";
import { ContextPicker } from "../ui/context-picker";
import { useContextPicker } from "../../hooks/use-context-picker";
import { trackEvent } from "../../utils/session-analytics";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions";
import { getFlowSuggestions } from "../../utils/get-flow-suggestions";
import { getContextDisplayLabel, getContextDescription } from "../../utils/context-options";
import { queryClient } from "../../query-client";
import { containsUrl } from "../../utils/detect-url";

interface MainMenuProps {
  gitState: GitState | undefined;
}

const MIN_COLUMNS_FOR_CYCLE_HINT = 80;

export const MainMenu = ({ gitState }: MainMenuProps) => {
  const COLORS = useColors();
  const [columns] = useStdoutDimensions();
  const recentReportsResult = useAtomValue(recentReportsAtom);
  const latestManifest =
    AsyncResult.isSuccess(recentReportsResult) && recentReportsResult.value.length > 0
      ? recentReportsResult.value[0]
      : undefined;
  const instructionHistory = usePreferencesStore((state) => state.instructionHistory);
  const setScreen = useNavigationStore((state) => state.setScreen);
  const [selectedContext, setSelectedContext] = useState<AnalysisContext | undefined>(undefined);
  const [value, setValue] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [hasCycled, setHasCycled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedCurrentInput, setSavedCurrentInput] = useState("");
  const cookieBrowserKeys = useProjectPreferencesStore((state) => state.cookieBrowserKeys);
  const clearCookieBrowserKeys = useProjectPreferencesStore(
    (state) => state.clearCookieBrowserKeys,
  );
  const cliBaseUrlsRef = useRef(usePreferencesStore.getState().cliBaseUrls);
  useEffect(() => {
    usePreferencesStore.setState({ cliBaseUrls: undefined });
  }, []);
  const cliBaseUrls = cliBaseUrlsRef.current;

  const navigateHistoryBack = () => {
    if (instructionHistory.length === 0) return;
    const nextIndex = historyIndex + 1;
    if (nextIndex >= instructionHistory.length) return;
    if (historyIndex === -1) {
      setSavedCurrentInput(value);
    }
    setHistoryIndex(nextIndex);
    setValue(instructionHistory[nextIndex]!);
    setInputKey((previous) => previous + 1);
  };

  const navigateHistoryForward = () => {
    if (historyIndex <= -1) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    if (nextIndex === -1) {
      setValue(savedCurrentInput);
    } else {
      setValue(instructionHistory[nextIndex]!);
    }
    setInputKey((previous) => previous + 1);
  };

  const picker = useContextPicker({
    gitState: gitState ?? null,
    onSelect: (context) => {
      setSelectedContext(context);
      const contextTypeMap = {
        WorkingTree: "working_tree",
        Branch: "branch",
        PullRequest: "pull_request",
        Commit: "commit",
      } as const;
      trackEvent("context:selected", {
        context_type: contextTypeMap[context._tag],
      });
    },
  });

  const defaultContext =
    picker.localOptions.find((option) => option._tag === "WorkingTree") ?? undefined;

  const activeContext = selectedContext ?? defaultContext ?? null;
  const suggestions = getFlowSuggestions(activeContext, gitState ?? null);

  useEffect(() => {
    setSuggestionIndex(0);
  }, [activeContext, gitState]);

  const submit = (submittedValue?: string) => {
    const trimmed = (submittedValue ?? value).trim();
    if (!trimmed) {
      setErrorMessage("Describe what you want the browser agent to test.");
      return;
    }
    if (!gitState) return;

    const mainBranch = gitState.mainBranch ?? "main";
    let changesFor: ChangesFor;

    if (activeContext?._tag === "Commit") {
      changesFor = ChangesFor.makeUnsafe({ _tag: "Commit", hash: activeContext.hash });
    } else if (activeContext?._tag === "Branch" || activeContext?._tag === "PullRequest") {
      if (activeContext.branch.name) {
        checkoutBranch(process.cwd(), activeContext.branch.name);
        void queryClient.invalidateQueries({ queryKey: ["git-state"] });
      }
      changesFor = ChangesFor.makeUnsafe({ _tag: "Branch", mainBranch });
    } else {
      changesFor = ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch });
    }

    usePreferencesStore.getState().rememberInstruction(trimmed);

    if (cookieBrowserKeys.length > 0 || containsUrl(trimmed) || cliBaseUrls) {
      setScreen(
        screenForTestingOrPortPicker({
          changesFor,
          instruction: trimmed,
          cookieBrowserKeys,
          baseUrls: cliBaseUrls ? [...cliBaseUrls] : undefined,
        }),
      );
    } else {
      setScreen(Screen.CookieSyncConfirm({ changesFor, instruction: trimmed }));
    }
  };

  const valueRef = useRef(value);
  valueRef.current = value;

  const handleInputChange = picker.createInputChangeHandler(valueRef, (stripped) => {
    setValue(stripped);
    if (errorMessage) setErrorMessage(undefined);
  });

  const isSingleLine = !value.includes("\n");
  const showSuggestion = value === "" && !picker.pickerOpen && suggestions.length > 0;
  const showCycleHint = showSuggestion && !hasCycled && columns >= MIN_COLUMNS_FOR_CYCLE_HINT;
  const currentSuggestion = suggestions[suggestionIndex % suggestions.length];

  useInput(
    (input, key) => {
      if (picker.pickerOpen) {
        if (key.escape) {
          picker.closePicker();
          return;
        }
        if (key.downArrow || (key.ctrl && input === "n")) {
          picker.setPickerIndex(
            Math.min(picker.filteredOptions.length - 1, picker.pickerIndex + 1),
          );
          return;
        }
        if (key.upArrow || (key.ctrl && input === "p")) {
          picker.setPickerIndex(Math.max(0, picker.pickerIndex - 1));
          return;
        }
        if (key.return || key.tab) {
          const selected = picker.filteredOptions[picker.pickerIndex];
          if (selected) picker.handleContextSelect(selected);
          return;
        }
        if (key.backspace || key.delete) {
          if (picker.pickerQuery.length === 0) {
            picker.closePicker();
          } else {
            picker.setPickerQuery(picker.pickerQuery.slice(0, -1));
          }
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          picker.setPickerQuery(picker.pickerQuery + input);
        }
        return;
      }

      if (isSingleLine && key.upArrow) {
        navigateHistoryBack();
        return;
      }
      if (isSingleLine && key.downArrow) {
        navigateHistoryForward();
        return;
      }

      if (key.ctrl && input === "k") {
        if (cookieBrowserKeys.length > 0) {
          clearCookieBrowserKeys();
          trackEvent("cookies:cleared");
          trackEvent("cookies:toggled", { enabled: false });
        } else {
          setScreen(Screen.CookieSyncConfirm({}));
        }
        return;
      }

      if (key.tab && !key.shift && showSuggestion && currentSuggestion) {
        setValue(currentSuggestion);
        setInputKey((previous) => previous + 1);
        trackEvent("suggestion:accepted");
        return;
      }
      if (key.tab && key.shift) {
        return;
      }
      if (!showSuggestion) return;
      if (key.rightArrow) {
        setSuggestionIndex((previous) => (previous + 1) % suggestions.length);
        setHasCycled(true);
        return;
      }
      if (key.leftArrow) {
        setSuggestionIndex((previous) => (previous - 1 + suggestions.length) % suggestions.length);
        setHasCycled(true);
        return;
      }
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" width="100%" paddingY={1}>
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Logo />
      </Box>

      {latestManifest && <LastRunBanner manifest={latestManifest} />}

      {gitState?.hasUntestedChanges && (
          <Box
            paddingX={1}
            paddingY={1}
            marginBottom={1}
            backgroundColor={COLORS.BANNER_BG}
            width="100%"
            flexDirection="column"
            gap={0}
          >
            {(() => {
              if (!gitState) return null;
              const stats = gitState.workingTreeFileStats;
              const totalAdded = stats.reduce((sum, stat) => sum + stat.added, 0);
              const totalRemoved = stats.reduce((sum, stat) => sum + stat.removed, 0);
              return (
                <Box>
                  <Text color={COLORS.YELLOW} bold>
                    {figures.warning} Changes detected
                  </Text>
                  {stats.length > 0 && (
                    <>
                      <Text color={COLORS.DIM}>
                        {" "}
                        {stats.length} file{stats.length === 1 ? "" : "s"}{" "}
                      </Text>
                      {totalAdded > 0 && <Text color={COLORS.GREEN}>+{totalAdded}</Text>}
                      {totalAdded > 0 && totalRemoved > 0 && <Text color={COLORS.DIM}> </Text>}
                      {totalRemoved > 0 && <Text color={COLORS.RED}>-{totalRemoved}</Text>}
                    </>
                  )}
                </Box>
              );
            })()}
            <Text color={COLORS.DIM}>
              Describe what to analyze and hit enter to check performance.
            </Text>
          </Box>
        )}

      <Box flexDirection="column" width="100%">
        <Box paddingX={1}>
          {!gitState && <Spinner message="loading context" />}
          {gitState && gitState.isGitRepo && activeContext && (
            <Text color={COLORS.DIM}>
              {figures.bullet}{" "}
              <Text color={COLORS.PRIMARY}>@{getContextDisplayLabel(activeContext, gitState)}</Text>
              {getContextDescription(activeContext, gitState) &&
                ` (${getContextDescription(activeContext, gitState)})`}
            </Text>
          )}
        </Box>
        <Box
          flexDirection="column"
          marginTop={1}
          backgroundColor={COLORS.INPUT_BG}
          width="100%"
          paddingX={1}
          paddingY={1}
        >
          <Box>
            <Text color={COLORS.PRIMARY}>{`${figures.pointer} `}</Text>
            <Box flexGrow={1}>
              <Input
                key={inputKey}
                focus={!picker.pickerOpen}
                multiline
                placeholder={currentSuggestion ? `${currentSuggestion}  [tab]` : ""}
                value={value}
                onSubmit={submit}
                onUpArrowAtTop={isSingleLine ? undefined : navigateHistoryBack}
                onDownArrowAtBottom={isSingleLine ? undefined : navigateHistoryForward}
                onChange={handleInputChange}
              />
            </Box>
            {showCycleHint ? <Text color={COLORS.DIM}>{"  ←→ cycle test suggestions"}</Text> : null}
          </Box>
        </Box>
        {gitState?.isGitRepo && picker.pickerOpen && (
          <RuledBox color={COLORS.BORDER}>
            <Box marginBottom={0}>
              <Text color={COLORS.DIM}>@ </Text>
              <Text color={COLORS.PRIMARY}>{picker.pickerQuery}</Text>
              <Text color={COLORS.DIM}>{picker.pickerQuery ? "" : "type to filter"}</Text>
            </Box>
            <ContextPicker
              options={picker.filteredOptions}
              selectedIndex={picker.pickerIndex}
              isLoading={picker.remoteLoading}
              gitState={gitState}
            />
          </RuledBox>
        )}
        {gitState?.isGitRepo && !picker.pickerOpen && (
          <Box marginTop={1} paddingX={1}>
            <Text color={COLORS.DIM}>
              <Text color={COLORS.PRIMARY}>@</Text> add context
            </Text>
          </Box>
        )}
      </Box>

      <InlineError message={errorMessage} />
    </Box>
  );
};

interface LastRunBannerProps {
  readonly manifest: {
    readonly url: string | undefined;
    readonly collectedAt: Date;
    readonly status: string;
  };
}

const LastRunBanner = ({ manifest }: LastRunBannerProps) => {
  const COLORS = useColors();
  const host = formatHostPath(manifest.url) ?? "(no url)";
  const passed = manifest.status === "passed";
  const statusColor = passed ? COLORS.GREEN : COLORS.RED;
  const statusIcon = passed ? figures.tick : figures.cross;

  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color={COLORS.DIM}>Last run: </Text>
      <Text color={COLORS.TEXT}>{host}</Text>
      <Text color={COLORS.DIM}>   {formatRelativeTime(manifest.collectedAt)}   </Text>
      <Text color={statusColor}>{statusIcon}</Text>
    </Box>
  );
};
