import { Box, Text, useInput } from "ink";
import figures from "figures";
import cliTruncate from "cli-truncate";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useAtom, useAtomValue } from "@effect/atom-react";
import type { ReportManifest } from "@neuve/supervisor";
import { useNavigationStore, Screen } from "../../stores/use-navigation";
import { useColors } from "../theme-context";
import { useStdoutDimensions } from "../../hooks/use-stdout-dimensions";
import { useScrollableList } from "../../hooks/use-scrollable-list";
import { ScreenHeading } from "../ui/screen-heading";
import { Spinner } from "../ui/spinner";
import { visualPadEnd } from "../../utils/visual-pad-end";
import { formatRelativeTime } from "../../utils/format-relative-time";
import { formatHostPath } from "../../utils/format-host-path";
import { recentReportsAtom, loadReportFn } from "../../data/recent-reports-atom";
import {
  RECENT_REPORTS_BRANCH_COLUMN_WIDTH,
  RECENT_REPORTS_GUTTER_WIDTH,
  RECENT_REPORTS_STATUS_COLUMN_WIDTH,
  RECENT_REPORTS_TIME_COLUMN_WIDTH,
  RECENT_REPORTS_URL_MIN_WIDTH,
  RECENT_REPORTS_VISIBLE_ROWS,
} from "../../constants";

const formatManifestUrl = (manifestUrl: string | undefined, maxWidth: number): string => {
  const formatted = formatHostPath(manifestUrl);
  if (!formatted) return "(no url)";
  return cliTruncate(formatted, maxWidth);
};

export const RecentReportsPickerScreen = () => {
  const COLORS = useColors();
  const [columns] = useStdoutDimensions();
  const setScreen = useNavigationStore((state) => state.setScreen);
  const reportsResult = useAtomValue(recentReportsAtom);
  const [loadResult, triggerLoad] = useAtom(loadReportFn, { mode: "promiseExit" });

  const selectManifest = (manifest: ReportManifest) => {
    void triggerLoad({ absolutePath: manifest.absolutePath }).then((exit) => {
      if (exit._tag === "Success") {
        setScreen(Screen.Results({ report: exit.value }));
      }
    });
  };

  const urlColumnWidth = Math.max(
    RECENT_REPORTS_URL_MIN_WIDTH,
    columns -
      RECENT_REPORTS_BRANCH_COLUMN_WIDTH -
      RECENT_REPORTS_STATUS_COLUMN_WIDTH -
      RECENT_REPORTS_TIME_COLUMN_WIDTH -
      RECENT_REPORTS_GUTTER_WIDTH,
  );

  const isLoadingReport = loadResult.waiting;
  const loadFailure = AsyncResult.isFailure(loadResult) ? loadResult.cause : undefined;
  const loadFailureMessage = loadFailure ? loadFailure.toString() : undefined;

  return AsyncResult.builder(reportsResult)
    .onWaiting(() => (
      <Box flexDirection="column" width="100%" paddingY={1}>
        <Box paddingX={1}>
          <ScreenHeading title="Past runs" subtitle="" />
        </Box>
        <Box marginTop={1} paddingX={1}>
          <Spinner message="Loading past runs..." />
        </Box>
      </Box>
    ))
    .onSuccess((manifests) => (
      <ListBody
        manifests={manifests}
        isLoadingReport={isLoadingReport}
        loadFailureMessage={loadFailureMessage}
        urlColumnWidth={urlColumnWidth}
        selectManifest={selectManifest}
      />
    ))
    .orNull();
};

interface ListBodyProps {
  readonly manifests: readonly ReportManifest[];
  readonly isLoadingReport: boolean;
  readonly loadFailureMessage: string | undefined;
  readonly urlColumnWidth: number;
  readonly selectManifest: (manifest: ReportManifest) => void;
}

const ListBody = ({
  manifests,
  isLoadingReport,
  loadFailureMessage,
  urlColumnWidth,
  selectManifest,
}: ListBodyProps) => {
  const COLORS = useColors();
  const setScreen = useNavigationStore((state) => state.setScreen);
  const { highlightedIndex, scrollOffset, handleNavigation } = useScrollableList({
    itemCount: manifests.length,
    visibleCount: RECENT_REPORTS_VISIBLE_ROWS,
  });

  useInput((input, key) => {
    if (isLoadingReport) return;
    if (handleNavigation(input, key)) return;

    if (key.return) {
      const selected = manifests[highlightedIndex];
      if (selected) selectManifest(selected);
      return;
    }

    if (key.escape) {
      setScreen(Screen.Main());
    }
  });

  const plural = manifests.length === 1 ? "" : "s";
  const visibleItems = manifests.slice(scrollOffset, scrollOffset + RECENT_REPORTS_VISIBLE_ROWS);

  return (
    <Box flexDirection="column" width="100%" paddingY={1}>
      <Box paddingX={1}>
        <ScreenHeading title="Past runs" subtitle={`${manifests.length} report${plural}`} />
      </Box>

      {manifests.length === 0 && (
        <Box marginTop={1} paddingX={1} flexDirection="column">
          <Text color={COLORS.DIM}>
            No past runs yet. Run a performance analysis — reports are saved under{" "}
            <Text color={COLORS.PRIMARY}>.perf-agent/reports</Text>.
          </Text>
        </Box>
      )}

      {manifests.length > 0 && (
        <Box
          marginTop={1}
          flexDirection="column"
          height={RECENT_REPORTS_VISIBLE_ROWS}
          overflow="hidden"
          paddingX={1}
        >
          {visibleItems.map((manifest, index) => (
            <ManifestRow
              key={manifest.absolutePath}
              manifest={manifest}
              isSelected={index + scrollOffset === highlightedIndex}
              urlColumnWidth={urlColumnWidth}
            />
          ))}
        </Box>
      )}

      {isLoadingReport && (
        <Box marginTop={1} paddingX={1}>
          <Spinner message="Loading report..." />
        </Box>
      )}

      {!isLoadingReport && loadFailureMessage && (
        <Box marginTop={1} paddingX={1}>
          <Text color={COLORS.RED}>Failed to open report: {loadFailureMessage}</Text>
        </Box>
      )}
    </Box>
  );
};

interface ManifestRowProps {
  readonly manifest: ReportManifest;
  readonly isSelected: boolean;
  readonly urlColumnWidth: number;
}

const ManifestRow = ({ manifest, isSelected, urlColumnWidth }: ManifestRowProps) => {
  const COLORS = useColors();
  const statusIcon = manifest.status === "passed" ? figures.tick : figures.cross;
  const statusColor = manifest.status === "passed" ? COLORS.GREEN : COLORS.RED;
  const urlLabel = formatManifestUrl(manifest.url, urlColumnWidth - 1);
  const branchLabel = cliTruncate(manifest.branch, RECENT_REPORTS_BRANCH_COLUMN_WIDTH - 1);
  const relativeTime = formatRelativeTime(manifest.collectedAt);
  const pointer = isSelected ? `${figures.pointer} ` : "  ";
  const titleColor = isSelected ? COLORS.PRIMARY : COLORS.TEXT;
  const pointerColor = isSelected ? COLORS.PRIMARY : COLORS.DIM;

  return (
    <Box>
      <Text color={pointerColor}>{pointer}</Text>
      <Text color={titleColor} bold={isSelected}>
        {visualPadEnd(urlLabel, urlColumnWidth)}
      </Text>
      <Text color={COLORS.DIM}>
        {visualPadEnd(branchLabel, RECENT_REPORTS_BRANCH_COLUMN_WIDTH)}
      </Text>
      <Text color={statusColor}>
        {visualPadEnd(statusIcon, RECENT_REPORTS_STATUS_COLUMN_WIDTH)}
      </Text>
      <Text color={COLORS.DIM}>
        {visualPadEnd(relativeTime, RECENT_REPORTS_TIME_COLUMN_WIDTH)}
      </Text>
    </Box>
  );
};
