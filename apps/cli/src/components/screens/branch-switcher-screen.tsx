import { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions.js";
import figures from "figures";
import {
  BRANCH_NAME_COLUMN_WIDTH,
  BRANCH_AUTHOR_COLUMN_WIDTH,
  BRANCH_VISIBLE_COUNT,
  COMMIT_SELECTOR_WIDTH,
  TABLE_COLUMN_GAP,
} from "../../constants.js";
import { useColors } from "../../theme-context.js";
import { stripMouseSequences } from "../../hooks/mouse-context.js";
import { Clickable } from "../ui/clickable.js";
import { SearchBar } from "../ui/search-bar.js";
import { getLocalBranches } from "@browser-tester/supervisor";
import {
  fetchRemoteBranches,
  type RemoteBranch,
} from "../../utils/fetch-remote-branches.js";
import { Spinner } from "../ui/spinner.js";
import { truncateText } from "../../utils/truncate-text.js";
import { visualPadEnd } from "../../utils/visual-pad-end.js";
import { useScrollableList } from "../../hooks/use-scrollable-list.js";
import { useAppStore } from "../../store.js";
import { ScreenHeading } from "../ui/screen-heading.js";

type PrFilter = "all" | "open" | "draft" | "merged" | "no-pr";

const PR_FILTERS: PrFilter[] = ["all", "open", "draft", "merged", "no-pr"];

type Tab = "local" | "remote";

export const BranchSwitcherScreen = () => {
  const [columns] = useStdoutDimensions();
  const storeSwitchBranch = useAppStore((state) => state.switchBranch);
  const COLORS = useColors();
  const [activeTab, setActiveTab] = useState<Tab>("local");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<PrFilter>("all");
  const [isSearching, setIsSearching] = useState(false);

  const [localBranches] = useState(() => getLocalBranches(process.cwd()));
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

  const filteredLocalBranches = (() => {
    if (!searchQuery) return localBranches;
    const lowercaseQuery = searchQuery.toLowerCase();
    return localBranches.filter((branch) =>
      branch.toLowerCase().includes(lowercaseQuery)
    );
  })();

  const filteredRemoteBranches = (() => {
    let result = remoteBranches.filter((branch) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "no-pr") return branch.prStatus === null;
      return branch.prStatus === activeFilter;
    });
    if (searchQuery) {
      const lowercaseQuery = searchQuery.toLowerCase();
      result = result.filter((branch) =>
        branch.name.toLowerCase().includes(lowercaseQuery)
      );
    }
    return result;
  })();

  const currentList =
    activeTab === "local" ? filteredLocalBranches : filteredRemoteBranches;

  const {
    highlightedIndex,
    setHighlightedIndex,
    scrollOffset,
    handleNavigation,
  } = useScrollableList({
    itemCount: currentList.length,
    visibleCount: BRANCH_VISIBLE_COUNT,
  });

  const prColumnWidth =
    columns -
    COMMIT_SELECTOR_WIDTH -
    BRANCH_NAME_COLUMN_WIDTH -
    BRANCH_AUTHOR_COLUMN_WIDTH -
    TABLE_COLUMN_GAP;

  const visibleItems = currentList.slice(
    scrollOffset,
    scrollOffset + BRANCH_VISIBLE_COUNT
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(stripMouseSequences(value));
      setHighlightedIndex(0);
    },
    [setHighlightedIndex]
  );

  const cycleFilter = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = PR_FILTERS.indexOf(activeFilter);
      const nextIndex =
        (currentIndex + direction + PR_FILTERS.length) % PR_FILTERS.length;
      setActiveFilter(PR_FILTERS[nextIndex]);
      setHighlightedIndex(0);
    },
    [activeFilter, setHighlightedIndex]
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

    if (handleNavigation(input, key)) return;

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
    <Box
      flexDirection="column"
      width="100%"
      paddingX={1}
      paddingTop={2}
      paddingBottom={1}
    >
      <ScreenHeading title="Switch branch" />
      <Box marginTop={1}>
        <Clickable
          fullWidth={false}
          onClick={() => {
            setActiveTab("local");
            setHighlightedIndex(0);
            setSearchQuery("");
          }}
        >
          <Text
            color={activeTab === "local" ? COLORS.TEXT : COLORS.DIM}
            bold={activeTab === "local"}
          >
            local
          </Text>
        </Clickable>
        <Text color={COLORS.DIM}> · </Text>
        <Clickable
          fullWidth={false}
          onClick={() => {
            setActiveTab("remote");
            setHighlightedIndex(0);
            setSearchQuery("");
          }}
        >
          <Text
            color={activeTab === "remote" ? COLORS.TEXT : COLORS.DIM}
            bold={activeTab === "remote"}
          >
            remote
          </Text>
        </Clickable>
        <Text color={COLORS.DIM}>
          {"  "}({currentList.length})
          {searchQuery ? ` matching "${searchQuery}"` : ""}
        </Text>
      </Box>

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
                <Box key={filter}>
                  <Clickable
                    fullWidth={false}
                    onClick={() => {
                      setActiveFilter(filter);
                      setHighlightedIndex(0);
                    }}
                  >
                    <Text color={isActive ? filterColors[filter] : COLORS.DIM}>
                      {isActive ? `[${filter}]` : filter}
                    </Text>
                  </Clickable>
                  <Text color={COLORS.DIM}>{separator}</Text>
                </Box>
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
          <Box
            marginTop={1}
            flexDirection="column"
            height={BRANCH_VISIBLE_COUNT}
            overflow="hidden"
          >
            {visibleItems.map((item, index) => {
              const actualIndex = index + scrollOffset;
              const isSelected = actualIndex === highlightedIndex;
              const branchName = typeof item === "string" ? item : item.name;
              const remoteBranch = typeof item === "string" ? null : item;

              return (
                <Clickable
                  key={branchName}
                  onClick={() => {
                    setHighlightedIndex(actualIndex);
                    storeSwitchBranch(branchName);
                  }}
                >
                  <Text color={isSelected ? COLORS.PRIMARY : COLORS.DIM}>
                    {isSelected ? `${figures.pointer} ` : "  "}
                  </Text>
                  <Text
                    color={isSelected ? COLORS.PRIMARY : COLORS.DIM}
                    bold={isSelected}
                  >
                    {visualPadEnd(
                      truncateText(branchName, BRANCH_NAME_COLUMN_WIDTH - 1),
                      BRANCH_NAME_COLUMN_WIDTH
                    )}
                  </Text>
                  {remoteBranch && (
                    <>
                      <Text color={COLORS.CYAN}>
                        {visualPadEnd(
                          truncateText(
                            remoteBranch.author || "—",
                            BRANCH_AUTHOR_COLUMN_WIDTH - 1
                          ),
                          BRANCH_AUTHOR_COLUMN_WIDTH
                        )}
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
                            `#${remoteBranch.prNumber} ${remoteBranch.prStatus}`,
                            prColumnWidth
                          )}
                        </Text>
                      ) : (
                        <Text color={COLORS.DIM}>—</Text>
                      )}
                    </>
                  )}
                </Clickable>
              );
            })}
            {currentList.length === 0 && (
              <Text color={COLORS.DIM}>No matching branches</Text>
            )}
          </Box>
        </>
      )}

      <SearchBar
        isSearching={isSearching}
        query={searchQuery}
        onChange={handleSearchChange}
      />
    </Box>
  );
};
