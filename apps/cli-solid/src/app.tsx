import { useKeyboard, useRenderer } from "@opentui/solid";
import { CommandProvider, useCommandRegistry } from "./context/command";
import { DialogProvider, useDialogStack } from "./context/dialog";
import { ToastProvider, useToast } from "./context/toast";
import { InputFocusProvider, useInputFocus } from "./context/input-focus";
import { Modeline } from "./renderables/modeline";
import { ToastDisplay } from "./renderables/toast-display";
import { MainScreen } from "./routes/main/main-screen";
import { createGlobalCommands } from "./commands/register-global";
import { createMainCommands } from "./commands/register-main";

const AppInner = () => {
  const registry = useCommandRegistry();
  const dialog = useDialogStack();
  const toast = useToast();
  const renderer = useRenderer();

  const isGitRepo = () => true;
  const hasRecentReports = () => true;

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

const App = () => {
  return (
    <ToastProvider>
      <DialogProvider>
        <InputFocusProvider>
          <AppInnerWithFocus />
        </InputFocusProvider>
      </DialogProvider>
    </ToastProvider>
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
