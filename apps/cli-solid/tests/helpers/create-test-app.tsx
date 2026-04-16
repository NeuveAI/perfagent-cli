import { testRender } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import type { TestRendererOptions } from "@opentui/core/testing";
import { DialogProvider } from "../../src/context/dialog";
import { ToastProvider } from "../../src/context/toast";
import { InputFocusProvider } from "../../src/context/input-focus";
import { CommandProvider } from "../../src/context/command";

const DEFAULT_OPTIONS: TestRendererOptions = {
  width: 80,
  height: 24,
};

export const renderInProviders = (
  component: () => JSX.Element,
  options?: TestRendererOptions,
) =>
  testRender(
    () => (
      <ToastProvider>
        <DialogProvider>
          <InputFocusProvider>
            <CommandProvider inputFocused={() => false}>
              {component()}
            </CommandProvider>
          </InputFocusProvider>
        </DialogProvider>
      </ToastProvider>
    ),
    { ...DEFAULT_OPTIONS, ...options },
  );

export const renderBare = (
  component: () => JSX.Element,
  options?: TestRendererOptions,
) => testRender(component, { ...DEFAULT_OPTIONS, ...options });
