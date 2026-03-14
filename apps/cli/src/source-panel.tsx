import { Box, Text } from "ink";
import type { ElementInfo, ElementSourceInfo } from "element-source";
import { useColors } from "./components/theme-context.js";

const formatLocation = (source: ElementSourceInfo): string => {
  const parts = [source.filePath];
  if (source.lineNumber !== null) parts.push(String(source.lineNumber));
  if (source.columnNumber !== null) parts.push(String(source.columnNumber));
  return parts.join(":");
};

interface SourcePanelProps {
  info: ElementInfo;
  copied: boolean;
}

export const SourcePanel = ({ info, copied }: SourcePanelProps) => {
  const COLORS = useColors();

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{info.componentName ?? info.tagName}</Text>
        {info.source ? <Text color={COLORS.DIM}> {formatLocation(info.source)}</Text> : null}
      </Text>
      {info.stack.map((frame, index) => (
        <Text key={index} color={COLORS.DIM}>
          {"  "}in {frame.componentName ?? formatLocation(frame)} ({formatLocation(frame)})
        </Text>
      ))}
      <Text color={COLORS.DIM}>
        {copied ? <Text color={COLORS.GREEN}>Copied!</Text> : "c copy"}
        {" · esc exit"}
      </Text>
    </Box>
  );
};
