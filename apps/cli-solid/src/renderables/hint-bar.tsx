import { For } from "solid-js";
import { useCommandRegistry } from "../context/command";
import * as keybindPrinter from "../context/keybind";
import { COLORS } from "../constants";

export const HintBar = () => {
  const registry = useCommandRegistry();

  const hints = () => {
    const commands = registry.getVisibleCommands();
    return commands.filter((command) => command.keybind);
  };

  return (
    <box>
      <For each={hints()}>
        {(command, index) => (
          <text>
            {index() > 0 && <span style={{ fg: COLORS.DIM }}>{"   "}</span>}
            <span style={{ fg: COLORS.DIM }}>{command.title} </span>
            <span style={{ fg: COLORS.DIM }}>
              {"["}
              {keybindPrinter.print(command.keybind!)}
              {"]"}
            </span>
          </text>
        )}
      </For>
    </box>
  );
};
