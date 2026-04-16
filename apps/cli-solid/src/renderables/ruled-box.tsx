import type { JSX } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { COLORS } from "../constants";

interface RuledBoxProps {
  readonly color?: string;
  readonly children: JSX.Element;
  readonly paddingX?: number;
}

export const RuledBox = (props: RuledBoxProps) => {
  const dimensions = useTerminalDimensions();
  const ruleColor = () => props.color ?? COLORS.BORDER;
  const columns = () => dimensions().width;
  const rule = () => "\u2500".repeat(columns());

  return (
    <box flexDirection="column" width="100%">
      <text style={{ fg: ruleColor() }}>{rule()}</text>
      <box flexDirection="column" paddingLeft={props.paddingX ?? 1} paddingRight={props.paddingX ?? 1}>
        {props.children}
      </box>
      <text style={{ fg: ruleColor() }}>{rule()}</text>
    </box>
  );
};
