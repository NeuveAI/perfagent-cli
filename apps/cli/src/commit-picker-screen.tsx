import { useCallback, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import {
  COMMIT_HASH_COLUMN_WIDTH,
  COMMIT_AUTHOR_COLUMN_WIDTH,
  COMMIT_DATE_COLUMN_WIDTH,
  COMMIT_SELECTOR_WIDTH,
  VISIBLE_COMMIT_COUNT,
} from "./constants.js";
import { useColors } from "./theme-context.js";
import { fetchCommits } from "./utils/fetch-commits.js";
import { truncateText } from "./utils/truncate-text.js";
import { useAppStore } from "./store.js";

export const CommitPickerScreen = () => {
  const { stdout } = useStdout();
  const selectCommit = useAppStore((state) => state.selectCommit);
  const COLORS = useColors();
  const [commits] = useState(() => fetchCommits());
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const filteredCommits = useMemo(() => {
    if (!searchQuery) return commits;
    const lower = searchQuery.toLowerCase();
    return commits.filter(
      (commit) =>
        commit.subject.toLowerCase().includes(lower) ||
        commit.shortHash.toLowerCase().includes(lower) ||
        commit.author.toLowerCase().includes(lower),
    );
  }, [commits, searchQuery]);

  const subjectColumnWidth =
    stdout.columns -
    COMMIT_SELECTOR_WIDTH -
    COMMIT_HASH_COLUMN_WIDTH -
    COMMIT_AUTHOR_COLUMN_WIDTH -
    COMMIT_DATE_COLUMN_WIDTH -
    2;

  const scrollOffset = useMemo(() => {
    if (filteredCommits.length <= VISIBLE_COMMIT_COUNT) return 0;
    const half = Math.floor(VISIBLE_COMMIT_COUNT / 2);
    const maxOffset = filteredCommits.length - VISIBLE_COMMIT_COUNT;
    return Math.min(maxOffset, Math.max(0, highlightedIndex - half));
  }, [filteredCommits.length, highlightedIndex]);

  const visibleCommits = filteredCommits.slice(scrollOffset, scrollOffset + VISIBLE_COMMIT_COUNT);

  const handleInput = useCallback((value: string) => {
    setSearchQuery(value);
    setHighlightedIndex(0);
  }, []);

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
      }
      return;
    }

    if (key.downArrow || input === "j" || (key.ctrl && input === "n")) {
      setHighlightedIndex((previous) => Math.min(filteredCommits.length - 1, previous + 1));
    }
    if (key.upArrow || input === "k" || (key.ctrl && input === "p")) {
      setHighlightedIndex((previous) => Math.max(0, previous - 1));
    }
    if (key.return && filteredCommits.length > 0) {
      selectCommit(filteredCommits[highlightedIndex]);
    }
    if (input === "/") {
      setIsSearching(true);
    }
  });

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
      <Text bold color={COLORS.TEXT}>
        Recent commits
      </Text>
      <Text color={COLORS.DIM}>
        {filteredCommits.length} commits
        {searchQuery ? ` matching "${searchQuery}"` : ""}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.DIM}>
          {"  "}
          {"Hash".padEnd(COMMIT_HASH_COLUMN_WIDTH)}
          {"Message".padEnd(subjectColumnWidth)}
          {"Author".padEnd(COMMIT_AUTHOR_COLUMN_WIDTH)}
          {"Date"}
        </Text>
      </Box>

      <Box flexDirection="column" height={VISIBLE_COMMIT_COUNT} overflow="hidden">
        {visibleCommits.map((commit, index) => {
          const actualIndex = index + scrollOffset;
          const isSelected = actualIndex === highlightedIndex;
          return (
            <Text key={commit.hash}>
              <Text color={isSelected ? COLORS.ORANGE : COLORS.DIM}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color={COLORS.PURPLE}>
                {commit.shortHash.padEnd(COMMIT_HASH_COLUMN_WIDTH)}
              </Text>
              <Text color={isSelected ? COLORS.TEXT : COLORS.DIM} bold={isSelected}>
                {truncateText(commit.subject, subjectColumnWidth - 1).padEnd(subjectColumnWidth)}
              </Text>
              <Text color={COLORS.CYAN}>
                {truncateText(commit.author, COMMIT_AUTHOR_COLUMN_WIDTH - 1).padEnd(
                  COMMIT_AUTHOR_COLUMN_WIDTH,
                )}
              </Text>
              <Text color={COLORS.DIM}>
                {truncateText(commit.relativeDate, COMMIT_DATE_COLUMN_WIDTH)}
              </Text>
            </Text>
          );
        })}
        {filteredCommits.length === 0 && (
          <Text color={COLORS.DIM}>No matching commits</Text>
        )}
      </Box>

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
