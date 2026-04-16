import { createSignal, Show } from "solid-js";
import { Logo } from "../../renderables/logo";
import { Input } from "../../renderables/input";
import { ChangesBanner } from "./changes-banner";
import { LastRunBanner } from "./last-run-banner";
import { ContextPicker } from "./context-picker";
import { useToast } from "../../context/toast";
import { COLORS } from "../../constants";

const POINTER = "\u25B8";
const BULLET = "\u2022";

export const MainScreen = () => {
  const toast = useToast();
  const [value, setValue] = createSignal("");
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [selectedContext, setSelectedContext] = createSignal<string | undefined>(undefined);

  const hasChanges = () => true;
  const fileCount = () => 3;
  const totalAdded = () => 42;
  const totalRemoved = () => 7;

  const hasLastRun = () => true;
  const lastRunHost = () => "localhost:3000";
  const lastRunTime = () => "2 minutes ago";
  const lastRunPassed = () => true;

  const handleSubmit = (submittedValue: string) => {
    const trimmed = submittedValue.trim();
    if (!trimmed) {
      toast.show("Describe what you want the browser agent to test.");
      return;
    }
    toast.show("not yet wired");
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

      <LastRunBanner
        visible={hasLastRun()}
        host={lastRunHost()}
        relativeTime={lastRunTime()}
        passed={lastRunPassed()}
      />

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
              onChange={setValue}
              onSubmit={handleSubmit}
              focus={!pickerOpen()}
              multiline
              placeholder="Describe what to test..."
              onAtTrigger={handleAtTrigger}
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
