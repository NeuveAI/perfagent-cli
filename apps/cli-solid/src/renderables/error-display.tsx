import { Show } from "solid-js";
import type { ParsedError } from "../utils/parse-execution-error";
import { COLORS } from "../constants";

const CROSS = "\u2718";

interface ErrorDisplayProps {
  readonly error: ParsedError;
}

export const ErrorDisplay = (props: ErrorDisplayProps) => (
  <box flexDirection="column">
    <text style={{ fg: COLORS.RED }}>{`${CROSS} ${props.error.title}`}</text>
    <text style={{ fg: COLORS.DIM }}>{`  ${props.error.message}`}</text>
    <Show when={props.error.hint}>
      {(hint) => <text style={{ fg: COLORS.YELLOW }}>{`  Hint: ${hint()}`}</text>}
    </Show>
  </box>
);
