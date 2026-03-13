import { Text } from "ink";
import { COLORS, SELECTED_INDICATOR } from "./constants.js";
import type { DiffStats } from "./utils/get-git-state.js";

interface MenuItemProps {
  label: string;
  detail: string;
  isSelected: boolean;
  recommended?: boolean;
  diffStats?: DiffStats;
}

export const MenuItem = ({ label, detail, isSelected, recommended, diffStats }: MenuItemProps) => {
  return (
    <Text color={COLORS.TEXT}>
      <Text color={isSelected ? COLORS.SELECTION : COLORS.TEXT}>
        {isSelected ? `${SELECTED_INDICATOR} ` : "  "}
      </Text>
      <Text color={isSelected ? COLORS.SELECTION : COLORS.TEXT}>{label}</Text>
      {diffStats && (
        <>
          <Text color={COLORS.TEXT}> [ </Text>
          <Text color={COLORS.GREEN}>+{diffStats.additions}</Text>
          <Text color={COLORS.TEXT}> </Text>
          <Text color={COLORS.RED}>-{diffStats.deletions}</Text>
          <Text color={COLORS.TEXT}> · {diffStats.filesChanged} files ]</Text>
        </>
      )}
      {!diffStats && isSelected && detail ? <Text color={COLORS.DIM}> {detail}</Text> : null}
      {recommended && <Text color={COLORS.YELLOW}> recommended</Text>}
    </Text>
  );
};
