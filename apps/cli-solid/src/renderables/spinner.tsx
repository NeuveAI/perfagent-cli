import { createSignal, onCleanup, Show } from "solid-js";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS, COLORS } from "../constants";

interface SpinnerProps {
  readonly message?: string;
}

export const Spinner = (props: SpinnerProps) => {
  const [frameIndex, setFrameIndex] = createSignal(0);

  const interval = setInterval(() => {
    setFrameIndex((previous) => (previous + 1) % SPINNER_FRAMES.length);
  }, SPINNER_INTERVAL_MS);

  onCleanup(() => clearInterval(interval));

  const frame = () => SPINNER_FRAMES[frameIndex()];

  return (
    <text style={{ fg: COLORS.DIM }}>
      <span style={{ fg: COLORS.SELECTION }}>{frame()}</span>
      <Show when={props.message}>
        <span>{` ${props.message}`}</span>
      </Show>
    </text>
  );
};
