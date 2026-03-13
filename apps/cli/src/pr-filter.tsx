import { Text } from "ink";
import { COLORS } from "./constants.js";

export type PrFilter = "all" | "open" | "draft" | "merged" | "no-pr";

export const PR_FILTERS: PrFilter[] = ["all", "open", "draft", "merged", "no-pr"];

const FILTER_COLORS: Record<PrFilter, string> = {
  all: COLORS.TEXT,
  open: COLORS.GREEN,
  draft: COLORS.DIM,
  merged: COLORS.PURPLE,
  "no-pr": COLORS.YELLOW,
};

interface PrFilterBarProps {
  activeFilter: PrFilter;
}

export const PrFilterBar = ({ activeFilter }: PrFilterBarProps) => (
  <Text color={COLORS.DIM}>
    {PR_FILTERS.map((filter, index) => {
      const isActive = filter === activeFilter;
      const separator = index < PR_FILTERS.length - 1 ? "  " : "";
      return (
        <Text key={filter}>
          <Text color={isActive ? FILTER_COLORS[filter] : COLORS.DIM}>
            {isActive ? `[${filter}]` : ` ${filter} `}
          </Text>
          {separator}
        </Text>
      );
    })}
  </Text>
);
