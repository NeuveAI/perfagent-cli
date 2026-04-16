import { createSignal, Show } from "solid-js";
import { Logo } from "../../renderables/logo";
import { Input } from "../../renderables/input";
import { ChangesBanner } from "./changes-banner";
import { ContextPicker } from "./context-picker";
import { useToast } from "../../context/toast";
import { useProject } from "../../context/project";
import { useAgent } from "../../context/agent";
import { useNavigation, Screen, screenForTestingOrPortPicker } from "../../context/navigation";
import { ChangesFor } from "@neuve/shared/models";
import { containsUrl } from "../../utils/detect-url";
import { COLORS } from "../../constants";

const POINTER = "\u25B8";
const BULLET = "\u2022";

export const MainScreen = () => {
  const toast = useToast();
  const project = useProject();
  const agent = useAgent();
  const navigation = useNavigation();

  const [value, setValue] = createSignal("");
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [selectedContext, setSelectedContext] = createSignal<string | undefined>(undefined);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  const [savedCurrentInput, setSavedCurrentInput] = createSignal("");

  const gitState = () => project.gitState();

  const hasChanges = () => {
    const state = gitState();
    if (!state) return false;
    return state.workingTreeFileStats.length > 0 || state.fileStats.length > 0;
  };

  const fileCount = () => {
    const state = gitState();
    if (!state) return 0;
    const stats = state.workingTreeFileStats.length > 0 ? state.workingTreeFileStats : state.fileStats;
    return stats.length;
  };

  const totalAdded = () => {
    const state = gitState();
    if (!state) return 0;
    const stats = state.workingTreeFileStats.length > 0 ? state.workingTreeFileStats : state.fileStats;
    return stats.reduce((sum, fileStat) => sum + fileStat.added, 0);
  };

  const totalRemoved = () => {
    const state = gitState();
    if (!state) return 0;
    const stats = state.workingTreeFileStats.length > 0 ? state.workingTreeFileStats : state.fileStats;
    return stats.reduce((sum, fileStat) => sum + fileStat.removed, 0);
  };

  const navigateHistoryBack = () => {
    const history = agent.instructionHistory();
    if (history.length === 0) return;
    const nextIndex = historyIndex() + 1;
    if (nextIndex >= history.length) return;
    if (historyIndex() === -1) {
      setSavedCurrentInput(value());
    }
    setHistoryIndex(nextIndex);
    setValue(history[nextIndex]!);
  };

  const navigateHistoryForward = () => {
    if (historyIndex() <= -1) return;
    const nextIndex = historyIndex() - 1;
    setHistoryIndex(nextIndex);
    if (nextIndex === -1) {
      setValue(savedCurrentInput());
    } else {
      setValue(agent.instructionHistory()[nextIndex]!);
    }
  };

  const handleChange = (newValue: string) => {
    setValue(newValue);
    if (historyIndex() !== -1) {
      setHistoryIndex(-1);
      setSavedCurrentInput("");
    }
  };

  const handleSubmit = (submittedValue: string) => {
    const trimmed = submittedValue.trim();
    if (!trimmed) {
      toast.show("Describe what you want the browser agent to test.");
      return;
    }

    const state = gitState();
    const mainBranch = state?.mainBranch ?? "main";

    const ctx = selectedContext();
    let changesFor: ChangesFor;

    if (ctx?.startsWith("commit:")) {
      changesFor = ChangesFor.makeUnsafe({ _tag: "Commit", hash: ctx.slice(7) });
    } else if (ctx?.startsWith("branch:") || ctx?.startsWith("pr:")) {
      changesFor = ChangesFor.makeUnsafe({ _tag: "Branch", mainBranch });
    } else {
      changesFor = ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch });
    }

    agent.rememberInstruction(trimmed);
    setHistoryIndex(-1);
    setSavedCurrentInput("");

    const cookieKeys = project.cookieBrowserKeys();
    const cliUrls = project.cliBaseUrls();
    if (cliUrls) project.clearCliBaseUrls();

    if (cookieKeys.length > 0 || containsUrl(trimmed) || cliUrls) {
      navigation.navigateTo(
        screenForTestingOrPortPicker({
          changesFor,
          instruction: trimmed,
          cookieBrowserKeys: cookieKeys,
          baseUrls: cliUrls ? [...cliUrls] : undefined,
        }),
      );
    } else {
      navigation.navigateTo(Screen.CookieSyncConfirm({ changesFor, instruction: trimmed }));
    }
  };

  const handleAtTrigger = () => {
    setPickerOpen(true);
  };

  const handlePickerClose = () => {
    setPickerOpen(false);
  };

  const handlePickerSelect = (contextValue: string) => {
    setSelectedContext(contextValue);
    setPickerOpen(false);
  };

  const contextLabel = () => {
    const ctx = selectedContext();
    if (!ctx) return "Working tree";
    if (ctx.startsWith("branch:")) return ctx.slice(7);
    return ctx;
  };

  return (
    <box flexDirection="column" width="100%" paddingTop={1} paddingBottom={1}>
      <box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
        <Logo />
      </box>

      <ChangesBanner
        hasChanges={hasChanges()}
        fileCount={fileCount()}
        totalAdded={totalAdded()}
        totalRemoved={totalRemoved()}
      />

      <box flexDirection="column" width="100%">
        <box paddingLeft={1} paddingRight={1}>
          <text>
            <span style={{ fg: COLORS.DIM }}>
              {BULLET}{" "}
            </span>
            <span style={{ fg: COLORS.PRIMARY }}>@{contextLabel()}</span>
          </text>
        </box>

        <box
          flexDirection="column"
          marginTop={1}
          backgroundColor={COLORS.INPUT_BG}
          width="100%"
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <box>
            <text style={{ fg: COLORS.PRIMARY }}>{`${POINTER} `}</text>
            <Input
              value={value()}
              onChange={handleChange}
              onSubmit={handleSubmit}
              focus={!pickerOpen()}
              multiline
              placeholder="Describe what to analyze and hit enter to check performance."
              onAtTrigger={handleAtTrigger}
              onUpArrowAtTop={navigateHistoryBack}
              onDownArrowAtBottom={navigateHistoryForward}
            />
          </box>
        </box>

        <ContextPicker
          open={pickerOpen()}
          onClose={handlePickerClose}
          onSelect={handlePickerSelect}
        />

        <Show when={!pickerOpen()}>
          <box marginTop={1} paddingLeft={1} paddingRight={1}>
            <text>
              <span style={{ fg: COLORS.PRIMARY }}>@</span>
              <span style={{ fg: COLORS.DIM }}> add context</span>
            </text>
          </box>
        </Show>
      </box>
    </box>
  );
};
