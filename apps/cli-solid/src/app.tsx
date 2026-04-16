import { useKeyboard, useRenderer } from "@opentui/solid";
import { CommandProvider, useCommandRegistry } from "./context/command";
import { DialogProvider, useDialogStack } from "./context/dialog";
import { ToastProvider, useToast } from "./context/toast";
import { InputFocusProvider, useInputFocus } from "./context/input-focus";
import { KvProvider } from "./context/kv";
import { RuntimeProvider } from "./context/runtime";
import { ProjectProvider, useProject } from "./context/project";
import { AgentProvider } from "./context/agent";
import { SyncProvider } from "./context/sync";
import { atomToAccessor } from "./adapters/effect-atom";
import { recentReportsAtom } from "@neuve/perf-agent-cli/data/recent-reports-atom";
import { AGENT_PROVIDER_DISPLAY_NAMES } from "@neuve/shared/models";
import type { AgentBackend } from "@neuve/agent";
import { Modeline } from "./renderables/modeline";
import { ToastDisplay } from "./renderables/toast-display";
import { MainScreen } from "./routes/main/main-screen";
import { createGlobalCommands } from "./commands/register-global";
import { createMainCommands } from "./commands/register-main";

const VALID_AGENTS = new Set(Object.keys(AGENT_PROVIDER_DISPLAY_NAMES));

const validateAgent = (input: string | undefined): AgentBackend => {
  if (input && VALID_AGENTS.has(input)) return input as AgentBackend;
  return "claude";
};

const AppInner = () => {
  const registry = useCommandRegistry();
  const dialog = useDialogStack();
  const toast = useToast();
  const renderer = useRenderer();
  const project = useProject();

  const recentReportsResult = atomToAccessor(recentReportsAtom);

  const isGitRepo = () => {
    const state = project.gitState();
    return state ? state.isGitRepo : false;
  };

  const hasRecentReports = () => {
    const result = recentReportsResult();
    return result._tag === "Success" && result.value.length > 0;
  };

  registry.register(() =>
    createGlobalCommands({
      clearScreen: () => {
        renderer.requestRender();
      },
      popDialog: () => dialog.pop(),
      isDialogEmpty: () => dialog.isEmpty(),
      showToast: (message: string) => toast.show(message),
    }),
  );

  registry.register(() =>
    createMainCommands({
      showToast: (message: string) => toast.show(message),
      isGitRepo,
      hasRecentReports,
    }),
  );

  useKeyboard((event) => {
    if (event.name === "escape" && !dialog.isEmpty()) {
      dialog.pop();
      event.preventDefault();
      return;
    }
    registry.handleKeyEvent(event);
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexGrow={1}>
        <MainScreen />
      </box>
      <ToastDisplay />
      <Modeline />
    </box>
  );
};

interface AppProps {
  readonly agent?: string;
}

const App = (props: AppProps) => {
  const agent = validateAgent(props.agent);

  return (
    <RuntimeProvider agent={agent}>
      <KvProvider>
        <AgentProvider initialAgent={agent}>
          <ProjectProvider>
            <SyncProvider>
              <ToastProvider>
                <DialogProvider>
                  <InputFocusProvider>
                    <AppInnerWithFocus />
                  </InputFocusProvider>
                </DialogProvider>
              </ToastProvider>
            </SyncProvider>
          </ProjectProvider>
        </AgentProvider>
      </KvProvider>
    </RuntimeProvider>
  );
};

const AppInnerWithFocus = () => {
  const inputFocus = useInputFocus();
  return (
    <CommandProvider inputFocused={inputFocus.focused}>
      <AppInner />
    </CommandProvider>
  );
};

export default App;
