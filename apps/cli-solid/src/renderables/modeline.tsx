import { For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useCommandRegistry } from "../context/command";
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
      <Show when={visibleCommands().length > 0}>
        <box paddingLeft={1} paddingRight={1}>
          <text>
            <For each={visibleCommands()}>
              {(command, index) => (
                <>
                  <Show when={index() > 0}>
                    <span style={{ fg: COLORS.DIM }}>{"  "}</span>
                  </Show>
                  <span style={{ fg: COLORS.PRIMARY }}>/{command.title.replace(/\s+/g, "-")}</span>
                </>
              )}
            </For>
          </text>
        </box>
      </Show>
    </box>
  );
};
