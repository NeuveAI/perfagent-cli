import { useEffect, useState } from "react";
import { Text } from "ink";
import { COLORS } from "./constants.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SPINNER_INTERVAL_MS = 80;

interface SpinnerProps {
  message: string;
}

export const Spinner = ({ message }: SpinnerProps) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((previous) => (previous + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text color={COLORS.DIM}>
      <Text color={COLORS.SELECTION}>{SPINNER_FRAMES[frameIndex]}</Text>
      <Text> {message}</Text>
    </Text>
  );
};
