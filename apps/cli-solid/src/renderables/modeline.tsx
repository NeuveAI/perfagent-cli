import { For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useCommandRegistry } from "../context/command";
import * as keybindPrinter from "../context/keybind";
import { COLORS } from "../constants";

export const Modeline = () => {
  const dimensions = useTerminalDimensions();
  const registry = useCommandRegistry();

  const visibleCommands = () => registry.getVisibleCommands();

  const columns = () => dimensions().width;

  const dividerLine = () => "\u2500".repeat(columns());

  return (
    <box flexDirection="column">
      <text style={{ fg: COLORS.BORDER }}>{dividerLine()}</text>
      <box paddingLeft={1} paddingRight={1}>
        <For each={visibleCommands()}>
          {(command, index) => (
            <text>
              <Show when={index() > 0}>
                <span style={{ fg: COLORS.DIM }}>{"   "}</span>
              </Show>
              <span style={{ fg: COLORS.DIM }}>{command.title} </span>
              <Show when={command.keybind}>
                <span style={{ fg: COLORS.DIM }}>
                  {"["}
                  {keybindPrinter.print(command.keybind!)}
                  {"]"}
                </span>
              </Show>
            </text>
          )}
        </For>
      </box>
    </box>
  );
};
