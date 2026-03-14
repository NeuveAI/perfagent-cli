import { Text } from "ink";
import figures from "figures";
import { useColors } from "../../theme-context.js";
import type { DiffStats } from "@browser-tester/supervisor";

interface MenuItemProps {
  label: string;
  detail: string;
  isSelected: boolean;
  recommended?: boolean;
  hint?: string;
  diffStats?: DiffStats | null;
}

export const MenuItem = ({
  label,
  detail,
  isSelected,
  recommended,
  hint,
  diffStats,
}: MenuItemProps) => {
  const COLORS = useColors();

  if (isSelected) {
    return (
      <Text>
        <Text color={COLORS.PRIMARY}>{figures.pointer} </Text>
        <Text color={COLORS.PRIMARY} bold>
          {label}
          {diffStats ? (
            <Text color={COLORS.PRIMARY}>
              {" "}
              +{diffStats.additions} -{diffStats.deletions}
            </Text>
          ) : null}
          {recommended ? " (recommended)" : ""}
          {hint ? ` (${hint})` : ""}
        </Text>
      </Text>
    );
  }

  return (
    <Text>
      <Text color={COLORS.DIM}>{"  "}</Text>
      <Text color={COLORS.DIM}>{label}</Text>
      {detail ? <Text color={COLORS.DIM}> {detail}</Text> : null}
    </Text>
  );
};
