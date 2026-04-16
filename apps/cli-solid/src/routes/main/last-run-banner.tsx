import { Show } from "solid-js";
import { COLORS } from "../../constants";

interface LastRunBannerProps {
  readonly visible: boolean;
  readonly host: string;
  readonly relativeTime: string;
  readonly passed: boolean;
}

const TICK = "\u2714";
const CROSS = "\u2718";

export const LastRunBanner = (props: LastRunBannerProps) => {
  const statusColor = () => (props.passed ? COLORS.GREEN : COLORS.RED);
  const statusIcon = () => (props.passed ? TICK : CROSS);

  return (
    <Show when={props.visible}>
      <box paddingLeft={1} paddingRight={1} marginBottom={1}>
        <text>
          <span style={{ fg: COLORS.DIM }}>Last run: </span>
          <span style={{ fg: COLORS.TEXT }}>{props.host}</span>
          <span style={{ fg: COLORS.DIM }}>   {props.relativeTime}   </span>
          <span style={{ fg: statusColor() }}>{statusIcon()}</span>
        </text>
      </box>
    </Show>
  );
};
