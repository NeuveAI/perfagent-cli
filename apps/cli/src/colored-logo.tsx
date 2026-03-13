import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const LOGO_LINES = [
  "   __            __  _    ",
  "  / /____  _____/ /_(_)__ ",
  " / __/ _ \\/ ___/ __/ / _ \\",
  "/ /_/  __(__  ) /_/ /  __/",
  "\\__/\\___/____/\\__/_/\\___/ ",
];

const SHADES = [
  "#cc5500",
  "#dd6611",
  "#ee7722",
  "#ff8833",
  "#ff9944",
  "#ff8833",
  "#ee7722",
  "#dd6611",
];

const ANIMATION_INTERVAL_MS = 400;

export const ColoredLogo = () => {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset((previous) => (previous + 1) % SHADES.length);
    }, ANIMATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column">
      {LOGO_LINES.map((line, lineIndex) => {
        const shadeIndex = (lineIndex + offset) % SHADES.length;
        return (
          <Text key={lineIndex} color={SHADES[shadeIndex]}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
};
