import { Box, Text } from "ink";
import figures from "figures";
import { useColors } from "../theme-context";

interface ErrorMessageProps {
  error: {
    readonly _tag: string;
    readonly displayName?: string;
    readonly message: string;
  };
  type: "error" | "defect";
}

export const ErrorMessage = ({ error, type }: ErrorMessageProps) => {
  if (!error.message) return null;

  const COLORS = useColors();
  const isDefect = type === "defect";

  return (
    <Box
      paddingX={1}
      paddingY={1}
      marginBottom={1}
      backgroundColor={COLORS.ERROR_BG}
      width="100%"
      flexDirection="column"
      gap={0}
    >
      <Box paddingBottom={1}>
        <Text color={COLORS.RED} bold>
          {figures.warning} {error.displayName ?? error._tag}
        </Text>
      </Box>
      <Box paddingBottom={1}>
        <Text color={COLORS.DIM}>{error.message}</Text>
      </Box>

      {isDefect && (
        <Text color={COLORS.DIM}>
          This is a bug. Report it at{" "}
          <Text color={COLORS.YELLOW}>https://github.com/neuve/perf-agent-cli/issues</Text>
        </Text>
      )}
      <Text color={COLORS.DIM}>
        Press <Text color={COLORS.RED}>esc</Text> to return
      </Text>
    </Box>
  );
};

interface InlineErrorProps {
  message: string | undefined;
}

export const InlineError = ({ message }: InlineErrorProps) => {
  const COLORS = useColors();

  if (!message) return null;

  return (
    <Box marginTop={1}>
      <Text color={COLORS.RED}>{message}</Text>
    </Box>
  );
};
