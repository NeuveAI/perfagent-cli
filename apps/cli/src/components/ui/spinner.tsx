import { Text } from "ink";
import InkSpinner from "ink-spinner";
import { useColors } from "../../theme-context.js";

interface SpinnerProps {
  message: string;
}

export const Spinner = ({ message }: SpinnerProps) => {
  const COLORS = useColors();

  return (
    <Text color={COLORS.DIM}>
      <Text color={COLORS.SELECTION}>
        <InkSpinner type="dots" />
      </Text>
      <Text> {message}</Text>
    </Text>
  );
};
