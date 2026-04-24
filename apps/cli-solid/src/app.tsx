import { Switch, Match, onCleanup } from "solid-js";
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
import { NavigationProvider, useNavigation, Screen } from "./context/navigation";
import { registerCleanupHandler, isShuttingDown } from "./lifecycle/shutdown";
import { atomToAccessor } from "./adapters/effect-atom";
import { recentReportsAtom } from "@neuve/perf-agent-cli/data/recent-reports-atom";
import { AGENT_PROVIDER_DISPLAY_NAMES } from "@neuve/shared/models";
import type { AgentBackend } from "@neuve/agent";
import { Modeline } from "./renderables/modeline";
import { ToastDisplay } from "./renderables/toast-display";
import { StartupScreen } from "./routes/startup/startup-screen";
import { MainScreen } from "./routes/main/main-screen";
import { CookieSyncConfirmScreen } from "./routes/cookie-sync-confirm/cookie-sync-confirm-screen";
import { PortPickerScreen } from "./routes/port-picker/port-picker-screen";
import { TestingScreen } from "./routes/testing/testing-screen";
import { ResultsScreen, clearResultsActions } from "./routes/results/results-screen";
import { SessionPickerScreen } from "./routes/session-picker/session-picker-screen";
import { createGlobalCommands } from "./commands/register-global";
import { createMainCommands } from "./commands/register-main";
import { createCookieSyncCommands } from "./commands/register-cookie-sync";
import { createPortPickerCommands } from "./commands/register-port-picker";
import { createTestingCommands } from "./commands/register-testing";
import { createResultsCommands } from "./commands/register-results";
import { createSessionPickerCommands } from "./commands/register-session-picker";

const screenOfTag = <T extends Screen["_tag"]>(
  accessor: () => Screen,
  tag: T,
): Extract<Screen, { _tag: T }> | undefined => {
  const screen = accessor();
  if (screen._tag === tag) return screen as Extract<Screen, { _tag: T }>;
  return undefined;
};

const VALID_AGENTS = new Set(Object.keys(AGENT_PROVIDER_DISPLAY_NAMES));

const validateAgent = (input: string | undefined): AgentBackend => {
  if (input && VALID_AGENTS.has(input)) return input as AgentBackend;
  return "claude";
};

const goBack = (screen: Screen, setScreen: (screen: Screen) => void) => {
  if (screen._tag === "Startup" || screen._tag === "Testing" || screen._tag === "Watch") return;
  if (screen._tag === "Results") {
    clearResultsActions();
  }
  setScreen(Screen.Main());
};

const AppInner = () => {
  const registry = useCommandRegistry();
  const dialog = useDialogStack();
  const toast = useToast();
  const renderer = useRenderer();
  const project = useProject();
  const navigation = useNavigation();

  const unregisterRendererCleanup = registerCleanupHandler(() => {
    renderer.destroy();
  });

  onCleanup(() => {
    unregisterRendererCleanup();
    if (isShuttingDown()) return;
    renderer.destroy();
  });

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
      showToast: (message: string) => toast.show(message),
      goBack: () => goBack(navigation.currentScreen(), navigation.setScreen),
      currentScreen: navigation.currentScreen,
      overlay: navigation.overlay,
    }),
  );

  registry.register(() =>
    createMainCommands({
      showToast: (message: string) => toast.show(message),
      isGitRepo,
      hasRecentReports,
      currentScreen: navigation.currentScreen,
      navigateToSessionPicker: () => navigation.setScreen(Screen.SessionPicker()),
    }),
  );

  registry.register(() =>
    createCookieSyncCommands({
      currentScreen: navigation.currentScreen,
    }),
  );

  registry.register(() =>
    createPortPickerCommands({
      currentScreen: navigation.currentScreen,
    }),
  );

  registry.register(() =>
    createTestingCommands({
      currentScreen: navigation.currentScreen,
    }),
  );

  registry.register(() =>
    createResultsCommands({
      currentScreen: navigation.currentScreen,
      overlay: navigation.overlay,
      isDialogEmpty: dialog.isEmpty,
      setOverlay: navigation.setOverlay,
    }),
  );

  registry.register(() =>
    createSessionPickerCommands({
      currentScreen: navigation.currentScreen,
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
        <Switch fallback={<text>Screen: {navigation.currentScreen()._tag}</text>}>
          <Match when={navigation.currentScreen()._tag === "Startup"}>
            <StartupScreen />
          </Match>
          <Match when={navigation.currentScreen()._tag === "Main"}>
            <MainScreen />
          </Match>
          <Match when={screenOfTag(navigation.currentScreen, "CookieSyncConfirm")}>
            {(screen) => <CookieSyncConfirmScreen {...screen()} />}
          </Match>
          <Match when={screenOfTag(navigation.currentScreen, "PortPicker")}>
            {(screen) => <PortPickerScreen {...screen()} />}
          </Match>
          <Match when={screenOfTag(navigation.currentScreen, "Testing")}>
            {(screen) => <TestingScreen {...screen()} />}
          </Match>
          <Match when={screenOfTag(navigation.currentScreen, "Results")}>
            {(screen) => <ResultsScreen {...screen()} />}
          </Match>
          <Match when={navigation.currentScreen()._tag === "SessionPicker"}>
            <SessionPickerScreen />
          </Match>
        </Switch>
      </box>
      <ToastDisplay />
      <Modeline />
    </box>
  );
};

interface AppProps {
  readonly agent?: string;
  readonly urls?: readonly string[];
}

const App = (props: AppProps) => {
  const agent = validateAgent(props.agent);

  return (
    <RuntimeProvider agent={agent}>
      <KvProvider>
        <AgentProvider initialAgent={agent}>
          <ProjectProvider cliBaseUrls={props.urls}>
            <SyncProvider>
              <NavigationProvider>
                <ToastProvider>
                  <DialogProvider>
                    <InputFocusProvider>
                      <AppInnerWithFocus />
                    </InputFocusProvider>
                  </DialogProvider>
                </ToastProvider>
              </NavigationProvider>
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
