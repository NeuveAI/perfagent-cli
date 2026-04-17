import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { COLORS } from "../constants";

interface OverlayContainerProps {
  readonly title: string;
  readonly children: JSX.Element;
  readonly footerHint?: string;
}

const OVERLAY_WIDTH_RATIO = 0.8;
const OVERLAY_HEIGHT_RATIO = 0.7;
const OVERLAY_MIN_WIDTH = 40;
const OVERLAY_MIN_HEIGHT = 10;

export const OverlayContainer = (props: OverlayContainerProps) => {
  const dimensions = useTerminalDimensions();
  const panelWidth = () =>
    Math.max(OVERLAY_MIN_WIDTH, Math.floor(dimensions().width * OVERLAY_WIDTH_RATIO));
  const panelHeight = () =>
    Math.max(OVERLAY_MIN_HEIGHT, Math.floor(dimensions().height * OVERLAY_HEIGHT_RATIO));

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor={COLORS.BANNER_BG}
    >
      <box
        width={panelWidth()}
        height={panelHeight()}
        flexDirection="column"
        border
        borderStyle="single"
        borderColor={COLORS.BORDER}
        backgroundColor={COLORS.BANNER_BG}
        paddingLeft={1}
        paddingRight={1}
      >
        <box>
          <text>
            <span style={{ fg: COLORS.SELECTION, bold: true }}>{props.title}</span>
          </text>
        </box>
        <box flexGrow={1} flexDirection="column" marginTop={1}>
          {props.children}
        </box>
        <Show when={props.footerHint}>
          {(hint) => (
            <box marginTop={1}>
              <text style={{ fg: COLORS.DIM }}>{hint()}</text>
            </box>
          )}
        </Show>
      </box>
    </box>
  );
};
