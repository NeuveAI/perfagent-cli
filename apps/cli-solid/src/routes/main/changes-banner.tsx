import { Show } from "solid-js";
import { COLORS } from "../../constants";

interface ChangesBannerProps {
  readonly hasChanges: boolean;
  readonly fileCount: number;
  readonly totalAdded: number;
  readonly totalRemoved: number;
}

export const ChangesBanner = (props: ChangesBannerProps) => {
  return (
    <Show when={props.hasChanges}>
      <box
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        marginBottom={1}
        backgroundColor={COLORS.BANNER_BG}
        width="100%"
        flexDirection="column"
      >
        <box>
          <text>
            <span style={{ fg: COLORS.YELLOW, bold: true }}>
              {"\u26A0 Changes detected"}
            </span>
          </text>
          <Show when={props.fileCount > 0}>
            <text>
              <span style={{ fg: COLORS.DIM }}>
                {" "}
                {props.fileCount} file{props.fileCount === 1 ? "" : "s"}{" "}
              </span>
            </text>
            <Show when={props.totalAdded > 0}>
              <text style={{ fg: COLORS.GREEN }}>+{props.totalAdded}</text>
            </Show>
            <Show when={props.totalAdded > 0 && props.totalRemoved > 0}>
              <text style={{ fg: COLORS.DIM }}> </text>
            </Show>
            <Show when={props.totalRemoved > 0}>
              <text style={{ fg: COLORS.RED }}>-{props.totalRemoved}</text>
            </Show>
          </Show>
        </box>
        <text style={{ fg: COLORS.DIM }}>
          Describe what to analyze and hit enter to check performance.
        </text>
      </box>
    </Show>
  );
};
