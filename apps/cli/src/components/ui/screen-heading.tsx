import { Box, Text } from "ink";
import { useThemeContext } from "../theme-context.js";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions.js";
import stringWidth from "string-width";

interface ScreenHeadingProps {
  title: string;
  subtitle?: string;
}

export const ScreenHeading = ({ title, subtitle }: ScreenHeadingProps) => {
  const [columns] = useStdoutDimensions();
  const { theme } = useThemeContext();

  const leftContent = ` ${title} `;
  const rightContent = subtitle ? `${subtitle} ` : "";
  const leftWidth = stringWidth(leftContent);
  const rightWidth = stringWidth(rightContent);
  const gapWidth = Math.max(0, columns - leftWidth - rightWidth);

  return (
    <Box>
      <Text backgroundColor={theme.border} color={theme.text} bold>
        {leftContent}
      </Text>
      <Text backgroundColor={theme.border}>{" ".repeat(gapWidth)}</Text>
      <Text backgroundColor={theme.border} color={theme.text}>
        {rightContent}
      </Text>
    </Box>
  );
};
