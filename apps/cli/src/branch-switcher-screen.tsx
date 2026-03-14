import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import {
  BRANCH_NAME_COLUMN_WIDTH,
  BRANCH_AUTHOR_COLUMN_WIDTH,
  BRANCH_VISIBLE_COUNT,
  COMMIT_SELECTOR_WIDTH,
} from "./constants.js";
import { useColors } from "./theme-context.js";
import { fetchLocalBranches } from "./utils/fetch-local-branches.js";
import { fetchRemoteBranches, type RemoteBranch } from "./utils/fetch-remote-branches.js";
import { Spinner } from "./spinner.js";
import { truncateText } from "./utils/truncate-text.js";
import { PR_FILTERS, type PrFilter } from "./pr-filter.js";
import { useAppStore } from "./store.js";

type Tab = "local" | "remote";

const PR_STATUS_LABELS: Record<string, string> = {
  open: "open",
  draft: "draft",
  merged: "merged",
};

export const BranchSwitcherScreen = () => {
  const { stdout } = useStdout();
  const storeSwitchBranch = useAppStore((state) => state.switchBranch);
  const COLORS = useColors();
  const [activeTab, setActiveTab] = useState<Tab>("local");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState<PrFilter>("all");
  const [isSearching, setIsSearching] = useState(false);

  const [localBranches] = useState(() => fetchLocalBranches());
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranch[]>([]);
  const [isLoadingRemote, setIsLoadingRemote] = useState(true);
  const [hasFetchedRemote, setHasFetchedRemote] = useState(false);

  useEffect(() => {
    if (activeTab !== "remote" || hasFetchedRemote) return;
    setHasFetchedRemote(true);
    fetchRemoteBranches().then((branches) => {
      setRemoteBranches(branches);
      setIsLoadingRemote(false);
    });
  }, [activeTab, hasFetchedRemote]);

  const filteredLocalBranches = useMemo(() => {
    if (!searchQuery) return localBranches;
    const lower = searchQuery.toLowerCase();
    return localBranches.filter((branch) => branch.toLowerCase().includes(lower));
  }, [localBranches, searchQuery]);

  const filteredRemoteBranches = useMemo(() => {
    let result = remoteBranches.filter((branch) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "no-pr") return branch.prStatus === null;
      return branch.prStatus === activeFilter;
    });
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((branch) => branch.name.toLowerCase().includes(lower));
    }
    return result;
  }, [remoteBranches, searchQuery, activeFilter]);

  const currentList = activeTab === "local" ? filteredLocalBranches : filteredRemoteBranches;
  const currentCount = currentList.length;

  const prColumnWidth =
    stdout.columns -
    COMMIT_SELECTOR_WIDTH -
    BRANCH_NAME_COLUMN_WIDTH -
    BRANCH_AUTHOR_COLUMN_WIDTH -
    2;

  const scrollOffset = useMemo(() => {
    if (currentCount <= BRANCH_VISIBLE_COUNT) return 0;
    const half = Math.floor(BRANCH_VISIBLE_COUNT / 2);
    const maxOffset = currentCount - BRANCH_VISIBLE_COUNT;
    return Math.min(maxOffset, Math.max(0, highlightedIndex - half));
  }, [currentCount, highlightedIndex]);

  const visibleItems = currentList.slice(scrollOffset, scrollOffset + BRANCH_VISIBLE_COUNT);

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

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
      }
      return;
    }

    if (key.tab) {
      setActiveTab((previous) => (previous === "local" ? "remote" : "local"));
      setHighlightedIndex(0);
      setSearchQuery("");
      return;
    }

    if (key.downArrow || input === "j" || (key.ctrl && input === "n")) {
      setHighlightedIndex((previous) => Math.min(currentCount - 1, previous + 1));
    }
    if (key.upArrow || input === "k" || (key.ctrl && input === "p")) {
      setHighlightedIndex((previous) => Math.max(0, previous - 1));
    }

    if (activeTab === "remote") {
      if (key.rightArrow) cycleFilter(1);
      if (key.leftArrow) cycleFilter(-1);
    }

    if (key.return) {
      if (activeTab === "local" && filteredLocalBranches.length > 0) {
        storeSwitchBranch(filteredLocalBranches[highlightedIndex]);
      }
      if (activeTab === "remote" && filteredRemoteBranches.length > 0) {
        storeSwitchBranch(filteredRemoteBranches[highlightedIndex].name);
      }
    }

    if (input === "/") {
      setIsSearching(true);
    }
  });

  const isCurrentTabLoading = activeTab === "remote" && isLoadingRemote;

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <Text bold color={COLORS.TEXT}>
        Switch branch
      </Text>
      <Text color={COLORS.DIM}>
        <Text color={activeTab === "local" ? COLORS.TEXT : COLORS.DIM} bold={activeTab === "local"}>
          local
        </Text>
        <Text color={COLORS.DIM}> · </Text>
        <Text
          color={activeTab === "remote" ? COLORS.TEXT : COLORS.DIM}
          bold={activeTab === "remote"}
        >
          remote
        </Text>
        <Text color={COLORS.DIM}>
          {"  "}({currentCount}){searchQuery ? ` matching "${searchQuery}"` : ""}
        </Text>
      </Text>

      {activeTab === "remote" && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>
            {PR_FILTERS.map((filter, index) => {
              const isActive = filter === activeFilter;
              const separator = index < PR_FILTERS.length - 1 ? " · " : "";
              const filterColors: Record<PrFilter, string> = {
                all: COLORS.TEXT,
                open: COLORS.GREEN,
                draft: COLORS.DIM,
                merged: COLORS.PURPLE,
                "no-pr": COLORS.YELLOW,
              };
              return (
                <Text key={filter}>
                  <Text color={isActive ? filterColors[filter] : COLORS.DIM}>
                    {isActive ? `[${filter}]` : filter}
                  </Text>
                  <Text color={COLORS.DIM}>{separator}</Text>
                </Text>
              );
            })}
          </Text>
        </Box>
      )}

      {isCurrentTabLoading ? (
        <Box marginTop={1}>
          <Spinner message="Fetching remote branches..." />
        </Box>
      ) : (
        <>
          <Box marginTop={1} flexDirection="column" height={BRANCH_VISIBLE_COUNT} overflow="hidden">
            {visibleItems.map((item, index) => {
              const actualIndex = index + scrollOffset;
              const isSelected = actualIndex === highlightedIndex;
              const branchName = typeof item === "string" ? item : item.name;
              const remoteBranch = typeof item === "string" ? null : item;

              return (
                <Text key={branchName}>
                  <Text color={isSelected ? COLORS.ORANGE : COLORS.DIM}>
                    {isSelected ? "❯ " : "  "}
                  </Text>
                  <Text color={isSelected ? COLORS.TEXT : COLORS.DIM} bold={isSelected}>
                    {truncateText(branchName, BRANCH_NAME_COLUMN_WIDTH - 1).padEnd(
                      BRANCH_NAME_COLUMN_WIDTH,
                    )}
                  </Text>
                  {remoteBranch && (
                    <>
                      <Text color={COLORS.CYAN}>
                        {truncateText(
                          remoteBranch.author || "—",
                          BRANCH_AUTHOR_COLUMN_WIDTH - 1,
                        ).padEnd(BRANCH_AUTHOR_COLUMN_WIDTH)}
                      </Text>
                      {remoteBranch.prNumber && remoteBranch.prStatus ? (
                        <Text
                          color={
                            remoteBranch.prStatus === "open"
                              ? COLORS.GREEN
                              : remoteBranch.prStatus === "merged"
                                ? COLORS.PURPLE
                                : COLORS.DIM
                          }
                        >
                          {truncateText(
                            `#${remoteBranch.prNumber} ${PR_STATUS_LABELS[remoteBranch.prStatus] ?? ""}`,
                            prColumnWidth,
                          )}
                        </Text>
                      ) : (
                        <Text color={COLORS.DIM}>—</Text>
                      )}
                    </>
                  )}
                </Text>
              );
            })}
            {currentCount === 0 && <Text color={COLORS.DIM}>No matching branches</Text>}
          </Box>
        </>
      )}

      {isSearching ? (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>/</Text>
          <TextInput focus value={searchQuery} onChange={handleInput} />
        </Box>
      ) : searchQuery ? (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>/{searchQuery}</Text>
        </Box>
      ) : null}

    </Box>
  );
};
