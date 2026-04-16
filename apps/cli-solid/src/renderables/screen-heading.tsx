import { Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { COLORS } from "../constants";

interface ScreenHeadingProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly showDivider?: boolean;
}

export const ScreenHeading = (props: ScreenHeadingProps) => {
  const dimensions = useTerminalDimensions();
  const showDivider = () => props.showDivider ?? true;
  const upperTitle = () => props.title.toUpperCase();
  const subtitleContent = () => (props.subtitle ? ` \u2502 ${props.subtitle}` : "");
  const textWidth = () => upperTitle().length + subtitleContent().length;
  const lineWidth = () => {
    if (!showDivider()) return 0;
    return Math.max(0, dimensions().width - textWidth() - 3);
  };

  return (
    <text>
      <span style={{ fg: COLORS.TEXT, bold: true }}>{upperTitle()}</span>
      <Show when={props.subtitle}>
        <span style={{ fg: COLORS.DIM }}>{subtitleContent()}</span>
      </Show>
      <Show when={showDivider()}>
        <span style={{ fg: COLORS.BORDER }}>{" "}{"\u2500".repeat(lineWidth())}</span>
      </Show>
    </text>
  );
};
