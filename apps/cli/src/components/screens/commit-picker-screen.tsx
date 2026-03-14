import { useCallback, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions.js";
import figures from "figures";
import { execSync } from "child_process";
import { GIT_TIMEOUT_MS, type CommitSummary } from "@browser-tester/supervisor";
import {
  COMMIT_HASH_COLUMN_WIDTH,
  COMMIT_AUTHOR_COLUMN_WIDTH,
  COMMIT_DATE_COLUMN_WIDTH,
  COMMIT_LIMIT,
  COMMIT_SELECTOR_WIDTH,
  TABLE_COLUMN_GAP,
  VISIBLE_COMMIT_COUNT,
} from "../../constants.js";
import { useColors } from "../../theme-context.js";
import { stripMouseSequences } from "../../hooks/mouse-context.js";
import { Clickable } from "../ui/clickable.js";
import { SearchBar } from "../ui/search-bar.js";
import { truncateText } from "../../utils/truncate-text.js";
import { visualPadEnd } from "../../utils/visual-pad-end.js";
import { useScrollableList } from "../../hooks/use-scrollable-list.js";
import { useAppStore } from "../../store.js";
import { ScreenHeading } from "../ui/screen-heading.js";

interface CommitWithMeta extends CommitSummary {
  author: string;
  relativeDate: string;
}

const FIELD_SEPARATOR = "---FIELD---";

const fetchCommitsWithMeta = (
  limit: number = COMMIT_LIMIT
): CommitWithMeta[] => {
  try {
    const format = ["%H", "%h", "%s", "%an", "%cr"].join(FIELD_SEPARATOR);
    const output = execSync(`git log --format="${format}" -n ${limit}`, {
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
    }).trim();

    if (!output) return [];

    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, subject, author, relativeDate] =
          line.split(FIELD_SEPARATOR);
        return { hash, shortHash, subject, author, relativeDate };
      });
  } catch {
    return [];
  }
};

export const CommitPickerScreen = () => {
  const [columns] = useStdoutDimensions();
  const selectCommit = useAppStore((state) => state.selectCommit);
  const pendingSavedFlow = useAppStore((state) => state.pendingSavedFlow);
  const COLORS = useColors();
  const [commits] = useState(() => fetchCommitsWithMeta());
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const filteredCommits = (() => {
    if (!searchQuery) return commits;
    const lowercaseQuery = searchQuery.toLowerCase();
    return commits.filter(
      (commit) =>
        commit.subject.toLowerCase().includes(lowercaseQuery) ||
        commit.shortHash.toLowerCase().includes(lowercaseQuery) ||
        commit.author.toLowerCase().includes(lowercaseQuery)
    );
  })();

  const {
    highlightedIndex,
    setHighlightedIndex,
    scrollOffset,
    handleNavigation,
  } = useScrollableList({
    itemCount: filteredCommits.length,
    visibleCount: VISIBLE_COMMIT_COUNT,
  });

  const subjectColumnWidth =
    columns -
    COMMIT_SELECTOR_WIDTH -
    COMMIT_HASH_COLUMN_WIDTH -
    COMMIT_AUTHOR_COLUMN_WIDTH -
    COMMIT_DATE_COLUMN_WIDTH -
    TABLE_COLUMN_GAP;

  const visibleCommits = filteredCommits.slice(
    scrollOffset,
    scrollOffset + VISIBLE_COMMIT_COUNT
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(stripMouseSequences(value));
      setHighlightedIndex(0);
    },
    [setHighlightedIndex]
  );

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
      }
      return;
    }

    if (handleNavigation(input, key)) return;

    if (key.return && filteredCommits.length > 0) {
      selectCommit(filteredCommits[highlightedIndex]);
    }
    if (input === "/") {
      setIsSearching(true);
    }
  });

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <ScreenHeading
        title={
          pendingSavedFlow
            ? "Select a commit for the saved flow"
            : "Select a commit to test"
        }
        subtitle={`${filteredCommits.length} commits${
          searchQuery ? ` matching "${searchQuery}"` : ""
        }${pendingSavedFlow ? ` · ${pendingSavedFlow.title}` : ""}`}
      />

      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.DIM}>
          {"  "}
          {"Hash".padEnd(COMMIT_HASH_COLUMN_WIDTH)}
          {"Message".padEnd(subjectColumnWidth)}
          {"Author".padEnd(COMMIT_AUTHOR_COLUMN_WIDTH)}
          {"Date"}
        </Text>
      </Box>

      <Box
        flexDirection="column"
        height={VISIBLE_COMMIT_COUNT}
        overflow="hidden"
      >
        {visibleCommits.map((commit, index) => {
          const actualIndex = index + scrollOffset;
          const isSelected = actualIndex === highlightedIndex;
          const truncatedSubject = truncateText(
            commit.subject,
            subjectColumnWidth - (isSelected ? 4 : 1)
          );
          const subjectGap =
            subjectColumnWidth - truncatedSubject.length - (isSelected ? 2 : 0);
          return (
            <Clickable key={commit.hash} onClick={() => selectCommit(commit)}>
              <Text color={isSelected ? COLORS.PRIMARY : COLORS.DIM}>
                {isSelected ? `${figures.pointer} ` : "  "}
              </Text>
              <Text color={COLORS.PURPLE}>
                {visualPadEnd(commit.shortHash, COMMIT_HASH_COLUMN_WIDTH)}
              </Text>
              {isSelected ? (
                <>
                  <Text color={COLORS.PRIMARY} bold>
                    {truncatedSubject}
                  </Text>
                  <Text>{"".padEnd(Math.max(0, subjectGap + 2))}</Text>
                </>
              ) : (
                <Text color={COLORS.DIM}>
                  {visualPadEnd(truncatedSubject, subjectColumnWidth)}
                </Text>
              )}
              <Text color={COLORS.CYAN}>
                {visualPadEnd(
                  truncateText(commit.author, COMMIT_AUTHOR_COLUMN_WIDTH - 1),
                  COMMIT_AUTHOR_COLUMN_WIDTH
                )}
              </Text>
              <Text color={COLORS.DIM}>
                {truncateText(commit.relativeDate, COMMIT_DATE_COLUMN_WIDTH)}
              </Text>
            </Clickable>
          );
        })}
        {filteredCommits.length === 0 && (
          <Text color={COLORS.DIM}>No matching commits</Text>
        )}
      </Box>

      <SearchBar
        isSearching={isSearching}
        query={searchQuery}
        onChange={handleSearchChange}
      />
    </Box>
  );
};
