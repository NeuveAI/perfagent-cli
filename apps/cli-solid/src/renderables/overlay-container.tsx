import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import { COLORS } from "../constants";

interface OverlayContainerProps {
  readonly title: string;
  readonly children: JSX.Element;
  readonly footerHint?: string;
}

const OVERLAY_WIDTH_RATIO = 0.8;
const OVERLAY_MIN_WIDTH = 40;
const OVERLAY_BACKDROP_ALPHA = 150;
const OVERLAY_Z_INDEX = 3000;

export const OverlayContainer = (props: OverlayContainerProps) => {
  const dimensions = useTerminalDimensions();
  const panelWidth = () =>
    Math.max(OVERLAY_MIN_WIDTH, Math.floor(dimensions().width * OVERLAY_WIDTH_RATIO));

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      position="absolute"
      left={0}
      top={0}
      zIndex={OVERLAY_Z_INDEX}
      alignItems="center"
      paddingTop={dimensions().height / 4}
      backgroundColor={RGBA.fromInts(0, 0, 0, OVERLAY_BACKDROP_ALPHA)}
    >
      <box
        width={panelWidth()}
        maxWidth={dimensions().width - 2}
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
        <box flexDirection="column" marginTop={1}>
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
