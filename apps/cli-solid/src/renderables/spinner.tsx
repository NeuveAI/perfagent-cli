import { createSignal, onCleanup, Show } from "solid-js";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS, COLORS } from "../constants";

interface SpinnerProps {
  readonly message?: string;
}

const useSpinnerFrame = () => {
  const [frameIndex, setFrameIndex] = createSignal(0);
  const interval = setInterval(() => {
    setFrameIndex((previous) => (previous + 1) % SPINNER_FRAMES.length);
  }, SPINNER_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));
  return () => SPINNER_FRAMES[frameIndex()];
};

export const Spinner = (props: SpinnerProps) => {
  const frame = useSpinnerFrame();
  return (
    <text style={{ fg: COLORS.DIM }}>
      <span style={{ fg: COLORS.SELECTION }}>{frame()}</span>
      <Show when={props.message}>
        <span>{` ${props.message}`}</span>
      </Show>
    </text>
  );
};

export const SpinnerSpan = () => {
  const frame = useSpinnerFrame();
  return <span style={{ fg: COLORS.SELECTION }}>{frame()}</span>;
};
