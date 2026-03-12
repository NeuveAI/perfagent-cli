import { useCallback, useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  BRANCH_COUNT,
  COLORS,
  FETCH_DELAY_MS,
  MENU_OPTIONS,
  REMOTE_BRANCH_INDEX,
  REMOTE_NAME,
  SEARCH_PLACEHOLDER,
} from "./constants";
import { generateRemoteBranches, type RemoteBranch } from "./utils/generate-remote-branches";
import { Spinner } from "./spinner";
import { PrFilterBar, PR_FILTERS, type PrFilter } from "./pr-filter";

interface RemoteBranchScreenProps {
  onSelect: (branch: string) => void;
}

const PrBadge = ({ branch }: { branch: RemoteBranch }) => {
  if (!branch.prNumber || !branch.prStatus) return null;

  const colorMap = {
    open: COLORS.GREEN,
    draft: COLORS.DIM,
    merged: COLORS.PURPLE,
  } as const;

  return (
    <span fg={colorMap[branch.prStatus]}>
      {` PR #${branch.prNumber} (${branch.prStatus})`}
    </span>
  );
};

const matchesFilter = (branch: RemoteBranch, filter: PrFilter): boolean => {
  if (filter === "all") return true;
  if (filter === "no-pr") return branch.prStatus === null;
  return branch.prStatus === filter;
};

export const RemoteBranchScreen = ({ onSelect }: RemoteBranchScreenProps) => {
  const option = MENU_OPTIONS[REMOTE_BRANCH_INDEX];
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [branches, setBranches] = useState<RemoteBranch[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState<PrFilter>("all");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setBranches(generateRemoteBranches(BRANCH_COUNT));
      setIsLoading(false);
    }, FETCH_DELAY_MS);
    return () => clearTimeout(timeout);
  }, []);

  const filteredBranches = useMemo(() => {
    let result = branches.filter((branch) => matchesFilter(branch, activeFilter));
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((branch) => branch.name.toLowerCase().includes(lower));
    }
    return result;
  }, [branches, searchQuery, activeFilter]);

  const maxBranchWidth = useMemo(
    () => Math.max(...filteredBranches.map((branch) => branch.name.length), 0),
    [filteredBranches],
  );

  const maxAuthorWidth = useMemo(
    () => Math.max(...filteredBranches.map((branch) => branch.author.length), 0),
    [filteredBranches],
  );

  const handleInput = useCallback((value: string) => {
    setSearchQuery(value);
    setHighlightedIndex(0);
  }, []);

  const cycleFilter = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = PR_FILTERS.indexOf(activeFilter);
      const nextIndex = (currentIndex + direction + PR_FILTERS.length) % PR_FILTERS.length;
      setActiveFilter(PR_FILTERS[nextIndex]);
      setHighlightedIndex(0);
    },
    [activeFilter],
  );

  useKeyboard((key) => {
    if (isLoading) return;
    if (key.name === "down") {
      setHighlightedIndex((previous) => Math.min(filteredBranches.length - 1, previous + 1));
    }
    if (key.name === "up") {
      setHighlightedIndex((previous) => Math.max(0, previous - 1));
    }
    if (key.name === "tab" || key.name === "right") {
      cycleFilter(1);
    }
    if (key.shift && key.name === "tab") {
      cycleFilter(-1);
    }
    if (key.name === "left") {
      cycleFilter(-1);
    }
    if (key.name === "return" && filteredBranches.length > 0) {
      onSelect(filteredBranches[highlightedIndex].name);
    }
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={COLORS.BACKGROUND}
      paddingX={2}
      paddingY={1}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text fg={COLORS.TEXT}>
          <b>{`${REMOTE_BRANCH_INDEX + 1}. ${option.label}`}</b>
        </text>
        <text fg={COLORS.DIM}>{REMOTE_NAME}</text>
      </box>

      <box
        marginTop={1}
        height={1}
        width="100%"
        border={["top"]}
        borderColor={COLORS.DIVIDER}
        borderStyle="single"
      />

      {isLoading ? (
        <box marginTop={1}>
          <Spinner message={`fetching remote branches from ${REMOTE_NAME}`} />
        </box>
      ) : (
        <box flexDirection="column" marginTop={1}>
          <PrFilterBar activeFilter={activeFilter} />

          <box flexDirection="column" marginTop={1} gap={0}>
            {filteredBranches.map((branch, index) => (
              <text key={index} fg={index === highlightedIndex ? COLORS.SELECTION : COLORS.TEXT}>
                {index === highlightedIndex ? "➤ " : "  "}
                {branch.name.padEnd(maxBranchWidth + 2)}
                <span fg={COLORS.YELLOW}>{branch.author.padEnd(maxAuthorWidth + 2)}</span>
                <PrBadge branch={branch} />
              </text>
            ))}
            {filteredBranches.length === 0 && <text fg={COLORS.DIM}>No matching branches</text>}
          </box>
        </box>
      )}

      {!isLoading && (
        <box
          marginTop={2}
          width="80%"
          border
          borderStyle="rounded"
          borderColor={COLORS.BORDER}
          paddingX={2}
        >
          <input
            focused
            width="100%"
            textColor={COLORS.TEXT}
            placeholder={SEARCH_PLACEHOLDER}
            value={searchQuery}
            onInput={handleInput}
          />
        </box>
      )}

      <text fg={COLORS.DIM} marginTop={1}>
        {isLoading ? "Esc to go back" : "↑/↓ navigate · ←/→ filter · Enter select · Esc back"}
      </text>
    </box>
  );
};
