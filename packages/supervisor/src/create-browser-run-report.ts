import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  HIGHLIGHT_OVERLAY_FONT_SIZE_PX,
  HIGHLIGHT_OVERLAY_HEIGHT_PX,
  HIGHLIGHT_OVERLAY_OPACITY,
  HIGHLIGHT_OVERLAY_PADDING_X_PX,
  HIGHLIGHT_VIDEO_FILE_NAME,
  HIGHLIGHT_WINDOW_LEADING_MS,
  HIGHLIGHT_WINDOW_MERGE_GAP_MS,
  HIGHLIGHT_WINDOW_MIN_DURATION_MS,
  HIGHLIGHT_WINDOW_TRAILING_MS,
  MIN_RUN_DURATION_MS,
  PII_TESSERACT_CONFIDENCE_THRESHOLD,
  REDACTED_VIDEO_FILE_NAME,
  SHARE_ASSET_DIRECTORY_NAME,
  SHARE_DIRECTORY_PREFIX,
  SHARE_REPORT_FILE_NAME,
  SHARE_SUMMARY_FILE_NAME,
} from "./constants.js";
import type { BrowserRunEvent } from "./events.js";
import { getPullRequestForBranch } from "./github-comment.js";
import type {
  BrowserFlowPlan,
  BrowserRunArtifacts,
  BrowserRunFinding,
  BrowserRunReport,
  BrowserRunStepResult,
  TestTarget,
} from "./types.js";

interface CreateBrowserRunReportOptions {
  target: TestTarget;
  plan: BrowserFlowPlan;
  events: BrowserRunEvent[];
  completionEvent: Extract<BrowserRunEvent, { type: "run-completed" }>;
  rawVideoPath?: string;
  screenshotPaths: string[];
}

interface TimeWindow {
  startMs: number;
  endMs: number;
  title?: string;
}

interface RedactionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ArtifactPreparationResult {
  artifacts: BrowserRunArtifacts;
  warnings: string[];
}

const execFileAsync = promisify(execFile);

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const commandExists = async (command: string): Promise<boolean> => {
  try {
    await execFileAsync("which", [command], { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
};

const ffmpegFilterAvailable = async (filterName: string): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-filters"], {
      encoding: "utf-8",
    });
    return stdout.includes(filterName);
  } catch {
    return false;
  }
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const matchesRiskArea = (riskArea: string, texts: string[]): boolean => {
  const normalizedRiskArea = normalizeText(riskArea);
  return texts.some((text) => normalizeText(text).includes(normalizedRiskArea));
};

const getStepResults = (
  plan: BrowserFlowPlan,
  events: BrowserRunEvent[],
): BrowserRunStepResult[] => {
  const stepResultById = new Map<string, BrowserRunStepResult>();

  for (const step of plan.steps) {
    stepResultById.set(step.id, {
      stepId: step.id,
      title: step.title,
      status: "not-run",
      summary: "Step was not completed.",
    });
  }

  for (const event of events) {
    if (event.type === "step-completed") {
      const existingStepResult = stepResultById.get(event.stepId);
      if (!existingStepResult) continue;
      stepResultById.set(event.stepId, {
        ...existingStepResult,
        status: "passed",
        summary: event.summary,
      });
    }

    if (event.type === "assertion-failed") {
      const existingStepResult = stepResultById.get(event.stepId);
      if (!existingStepResult) continue;
      stepResultById.set(event.stepId, {
        ...existingStepResult,
        status: "failed",
        summary: event.message,
      });
    }
  }

  return plan.steps
    .map((step) => stepResultById.get(step.id))
    .filter((stepResult): stepResult is BrowserRunStepResult => Boolean(stepResult));
};

const getFindings = (
  events: BrowserRunEvent[],
  plan: BrowserFlowPlan,
  completionEvent: Extract<BrowserRunEvent, { type: "run-completed" }>,
): BrowserRunFinding[] => {
  const findings: BrowserRunFinding[] = [];

  for (const event of events) {
    if (event.type !== "assertion-failed") continue;

    const planStep = plan.steps.find((step) => step.id === event.stepId);
    findings.push({
      id: `${event.stepId}-${findings.length + 1}`,
      severity: "error",
      title: planStep ? `${planStep.title} failed` : `${event.stepId} failed`,
      detail: event.message,
      stepId: event.stepId,
      stepTitle: planStep?.title,
    });
  }

  if (completionEvent.status === "failed" && findings.length === 0) {
    findings.push({
      id: "run-failed",
      severity: "warning",
      title: "Run completed with unresolved issues",
      detail: completionEvent.summary,
    });
  }

  return findings;
};

const getRiskAreaSummary = (
  plan: BrowserFlowPlan,
  stepResults: BrowserRunStepResult[],
  findings: BrowserRunFinding[],
): Pick<BrowserRunReport, "confirmedRiskAreas" | "clearedRiskAreas" | "unresolvedRiskAreas"> => {
  const confirmedRiskAreas: string[] = [];
  const clearedRiskAreas: string[] = [];
  const unresolvedRiskAreas: string[] = [];

  const failedTexts = stepResults
    .filter((stepResult) => stepResult.status === "failed")
    .flatMap((stepResult) => [stepResult.title, stepResult.summary]);
  const findingTexts = findings.flatMap((finding) => [finding.title, finding.detail]);
  const passedTexts = stepResults
    .filter((stepResult) => stepResult.status === "passed")
    .flatMap((stepResult) => [stepResult.title, stepResult.summary]);

  for (const riskArea of plan.riskAreas) {
    if (matchesRiskArea(riskArea, [...failedTexts, ...findingTexts])) {
      confirmedRiskAreas.push(riskArea);
      continue;
    }

    if (matchesRiskArea(riskArea, passedTexts)) {
      clearedRiskAreas.push(riskArea);
      continue;
    }

    unresolvedRiskAreas.push(riskArea);
  }

  return {
    confirmedRiskAreas,
    clearedRiskAreas,
    unresolvedRiskAreas,
  };
};

const isInterestingToolName = (toolName: string): boolean => {
  const ignoredSuffixes = ["__close"];
  return !ignoredSuffixes.some((suffix) => toolName.endsWith(suffix));
};

export const escapeFilterText = (text: string): string => text.replaceAll("'", "''");

export const buildStepTitleOverlayFilter = (title: string): string => {
  const escapedTitle = escapeFilterText(title);
  return [
    `drawbox=x=0:y=0:w=iw:h=${HIGHLIGHT_OVERLAY_HEIGHT_PX}:color=black@${HIGHLIGHT_OVERLAY_OPACITY}:t=fill`,
    `drawtext=text='${escapedTitle}':fontsize=${HIGHLIGHT_OVERLAY_FONT_SIZE_PX}:fontcolor=white:x=${HIGHLIGHT_OVERLAY_PADDING_X_PX}:y=(${HIGHLIGHT_OVERLAY_HEIGHT_PX}-text_h)/2`,
  ].join(",");
};

export const getHighlightWindows = (events: BrowserRunEvent[]): TimeWindow[] => {
  const runStartedAt =
    events.find((event) => event.type === "run-started")?.timestamp ?? Date.now();
  const lastTimestamp = events.at(-1)?.timestamp ?? runStartedAt + MIN_RUN_DURATION_MS;
  const runDurationMs = Math.max(lastTimestamp - runStartedAt, MIN_RUN_DURATION_MS);

  let currentStepTitle: string | undefined;
  const interestingMoments: Array<{ timestampMs: number; title?: string }> = [];

  for (const event of events) {
    if (event.type === "step-started") {
      currentStepTitle = event.title;
    }

    const isInteresting =
      event.type === "step-started" ||
      event.type === "step-completed" ||
      event.type === "assertion-failed" ||
      (event.type === "tool-call" && isInterestingToolName(event.toolName));

    if (isInteresting) {
      interestingMoments.push({
        timestampMs: Math.max(0, event.timestamp - runStartedAt),
        title: currentStepTitle,
      });
    }
  }

  if (interestingMoments.length === 0) {
    return [{ startMs: 0, endMs: runDurationMs }];
  }

  const windows = interestingMoments
    .map((moment) => ({
      startMs: Math.max(0, moment.timestampMs - HIGHLIGHT_WINDOW_LEADING_MS),
      endMs: Math.min(
        runDurationMs,
        Math.max(
          moment.timestampMs + HIGHLIGHT_WINDOW_TRAILING_MS,
          moment.timestampMs + HIGHLIGHT_WINDOW_MIN_DURATION_MS,
        ),
      ),
      title: moment.title,
    }))
    .sort((leftWindow, rightWindow) => leftWindow.startMs - rightWindow.startMs);

  const mergedWindows: TimeWindow[] = [];
  for (const window of windows) {
    const previousWindow = mergedWindows.at(-1);
    if (previousWindow && window.startMs <= previousWindow.endMs + HIGHLIGHT_WINDOW_MERGE_GAP_MS) {
      previousWindow.endMs = Math.max(previousWindow.endMs, window.endMs);
      previousWindow.title ??= window.title;
      continue;
    }
    mergedWindows.push(window);
  }

  return mergedWindows;
};

const createHighlightVideo = async (
  rawVideoPath: string | undefined,
  events: BrowserRunEvent[],
) => {
  if (!rawVideoPath || !existsSync(rawVideoPath)) {
    return { highlightVideoPath: undefined, warning: undefined };
  }

  if (!(await commandExists("ffmpeg"))) {
    return {
      highlightVideoPath: undefined,
      warning: "Highlight reel skipped because ffmpeg is not installed.",
    };
  }

  const windows = getHighlightWindows(events);
  if (windows.length === 0) {
    return { highlightVideoPath: undefined, warning: undefined };
  }

  const canDrawText = await ffmpegFilterAvailable("drawtext");
  const temporaryDirectoryPath = mkdtempSync(join(tmpdir(), "browser-tester-highlight-"));
  const highlightVideoPath = join(dirname(resolve(rawVideoPath)), HIGHLIGHT_VIDEO_FILE_NAME);

  try {
    const segmentPaths: string[] = [];

    for (const [index, window] of windows.entries()) {
      const segmentPath = join(temporaryDirectoryPath, `segment-${index}.webm`);
      const ffmpegArguments = [
        "-y",
        "-ss",
        String(window.startMs / 1000),
        "-to",
        String(window.endMs / 1000),
        "-i",
        rawVideoPath,
      ];

      if (window.title && canDrawText) {
        ffmpegArguments.push("-vf", buildStepTitleOverlayFilter(window.title));
      }

      ffmpegArguments.push("-c:v", "libvpx-vp9", "-c:a", "libopus", segmentPath);
      await execFileAsync("ffmpeg", ffmpegArguments);
      segmentPaths.push(segmentPath);
    }

    const concatFilePath = join(temporaryDirectoryPath, "segments.txt");
    writeFileSync(
      concatFilePath,
      segmentPaths
        .map((segmentPath) => `file '${segmentPath.replaceAll("'", "'\\''")}'`)
        .join("\n"),
      "utf-8",
    );

    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFilePath,
      "-c:v",
      "libvpx-vp9",
      "-c:a",
      "libopus",
      highlightVideoPath,
    ]);

    return { highlightVideoPath, warning: undefined };
  } catch {
    return {
      highlightVideoPath: undefined,
      warning: "Highlight reel generation failed.",
    };
  } finally {
    rmSync(temporaryDirectoryPath, { recursive: true, force: true });
  }
};

const getScreenshotEmailBoxes = async (screenshotPath: string): Promise<RedactionBox[]> => {
  if (!(await commandExists("tesseract"))) return [];

  try {
    const { stdout } = await execFileAsync("tesseract", [screenshotPath, "stdout", "tsv"], {
      encoding: "utf-8",
    });
    const lines = stdout.split("\n").slice(1);
    const boxes: RedactionBox[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const columns = line.split("\t");
      if (columns.length < 12) continue;

      const left = Number(columns[6]);
      const top = Number(columns[7]);
      const width = Number(columns[8]);
      const height = Number(columns[9]);
      const confidence = Number(columns[10]);
      const text = columns[11] ?? "";

      if (
        Number.isNaN(left) ||
        Number.isNaN(top) ||
        Number.isNaN(width) ||
        Number.isNaN(height) ||
        Number.isNaN(confidence)
      ) {
        continue;
      }

      if (confidence < PII_TESSERACT_CONFIDENCE_THRESHOLD) continue;
      if (!EMAIL_PATTERN.test(text)) continue;

      boxes.push({ left, top, width, height });
    }

    return boxes;
  } catch {
    return [];
  }
};

const buildDrawBoxFilter = (boxes: RedactionBox[]): string =>
  boxes
    .map(
      (box) =>
        `drawbox=x=${box.left}:y=${box.top}:w=${box.width}:h=${box.height}:color=black@1:t=fill`,
    )
    .join(",");

const redactImage = async (
  imagePath: string,
  boxes: RedactionBox[],
): Promise<string | undefined> => {
  if (boxes.length === 0 || !(await commandExists("ffmpeg"))) return undefined;

  const imageExtension = extname(imagePath) || ".png";
  const redactedImagePath = imagePath.replace(imageExtension, `-redacted${imageExtension}`);

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      imagePath,
      "-vf",
      buildDrawBoxFilter(boxes),
      redactedImagePath,
    ]);
    return redactedImagePath;
  } catch {
    return undefined;
  }
};

const redactVideo = async (
  videoPath: string | undefined,
  boxes: RedactionBox[],
): Promise<string | undefined> => {
  if (!videoPath || !existsSync(videoPath) || boxes.length === 0) return undefined;
  if (!(await commandExists("ffmpeg"))) return undefined;

  const redactedVideoPath = join(dirname(resolve(videoPath)), REDACTED_VIDEO_FILE_NAME);
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-vf",
      buildDrawBoxFilter(boxes),
      "-c:a",
      "copy",
      redactedVideoPath,
    ]);
    return redactedVideoPath;
  } catch {
    return undefined;
  }
};

const copyArtifact = (
  assetDirectoryPath: string,
  filePath: string,
  preferredPrefix: string,
): string | undefined => {
  if (!existsSync(filePath)) return undefined;

  const targetPath = join(
    assetDirectoryPath,
    `${preferredPrefix}-${randomUUID().slice(0, 8)}${extname(filePath)}`,
  );
  copyFileSync(filePath, targetPath);
  return `${SHARE_ASSET_DIRECTORY_NAME}/${basename(targetPath)}`;
};

const createShareBundle = (options: {
  report: Omit<BrowserRunReport, "artifacts">;
  artifacts: BrowserRunArtifacts;
}): Pick<BrowserRunArtifacts, "shareBundlePath" | "shareSummaryPath" | "shareUrl"> => {
  const shareOutputDirectoryPath = process.env.BROWSER_TESTER_SHARE_OUTPUT_DIR;
  const shareBaseUrl = process.env.BROWSER_TESTER_SHARE_BASE_URL;
  const bundleId = randomUUID().slice(0, 8);
  const shareBundlePath =
    shareOutputDirectoryPath && shareBaseUrl
      ? join(resolve(shareOutputDirectoryPath), bundleId)
      : mkdtempSync(join(tmpdir(), SHARE_DIRECTORY_PREFIX));

  mkdirSync(shareBundlePath, { recursive: true });
  const assetDirectoryPath = join(shareBundlePath, SHARE_ASSET_DIRECTORY_NAME);
  mkdirSync(assetDirectoryPath, { recursive: true });

  const sharedVideoPath =
    options.artifacts.redactedVideoPath ??
    options.artifacts.highlightVideoPath ??
    options.artifacts.rawVideoPath;
  const sharedScreenshotPaths =
    options.artifacts.redactedScreenshotPaths.length > 0
      ? options.artifacts.redactedScreenshotPaths
      : options.artifacts.screenshotPaths;

  const bundledVideoRelativePath = sharedVideoPath
    ? copyArtifact(assetDirectoryPath, sharedVideoPath, "video")
    : undefined;
  const bundledScreenshotRelativePaths = sharedScreenshotPaths
    .map((screenshotPath, index) =>
      copyArtifact(assetDirectoryPath, screenshotPath, `screenshot-${index}`),
    )
    .filter((relativePath): relativePath is string => Boolean(relativePath));

  const shareSummaryPath = join(shareBundlePath, SHARE_SUMMARY_FILE_NAME);
  const shareReportPath = join(shareBundlePath, SHARE_REPORT_FILE_NAME);

  const summaryLines = [
    `# ${options.report.title}`,
    "",
    `Status: ${options.report.status}`,
    "",
    options.report.summary,
    "",
    "## Findings",
    ...(options.report.findings.length > 0
      ? options.report.findings.map((finding) => `- ${finding.title}: ${finding.detail}`)
      : ["- No blocking findings detected."]),
  ];

  const htmlSections = [
    `<h1>${options.report.title}</h1>`,
    `<p><strong>Status:</strong> ${options.report.status}</p>`,
    `<p>${options.report.summary}</p>`,
    "<h2>Findings</h2>",
    options.report.findings.length > 0
      ? `<ul>${options.report.findings
          .map((finding) => `<li><strong>${finding.title}</strong>: ${finding.detail}</li>`)
          .join("")}</ul>`
      : "<p>No blocking findings detected.</p>",
    "<h2>Steps</h2>",
    `<ul>${options.report.stepResults
      .map(
        (stepResult) =>
          `<li><strong>${stepResult.status.toUpperCase()}</strong> ${stepResult.title}: ${stepResult.summary}</li>`,
      )
      .join("")}</ul>`,
  ];

  if (bundledVideoRelativePath) {
    htmlSections.push(
      "<h2>Video</h2>",
      `<video controls style="max-width: 100%;" src="${bundledVideoRelativePath}"></video>`,
    );
  }

  if (bundledScreenshotRelativePaths.length > 0) {
    htmlSections.push(
      "<h2>Screenshots</h2>",
      bundledScreenshotRelativePaths
        .map(
          (relativePath) =>
            `<img src="${relativePath}" style="display: block; max-width: 100%; margin-bottom: 16px;" />`,
        )
        .join(""),
    );
  }

  writeFileSync(shareSummaryPath, summaryLines.join("\n"), "utf-8");
  writeFileSync(
    shareReportPath,
    [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<meta charset="utf-8" />',
      `<title>${options.report.title}</title>`,
      "<style>body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:960px;margin:0 auto;padding:32px;background:#0f172a;color:#e2e8f0}h1,h2{color:#f8fafc}a{color:#93c5fd}</style>",
      "</head>",
      "<body>",
      ...htmlSections,
      "</body>",
      "</html>",
    ].join(""),
    "utf-8",
  );

  return {
    shareBundlePath,
    shareSummaryPath,
    shareUrl:
      shareOutputDirectoryPath && shareBaseUrl
        ? `${shareBaseUrl.replace(/\/$/, "")}/${bundleId}/${SHARE_REPORT_FILE_NAME}`
        : pathToFileURL(shareReportPath).href,
  };
};

const prepareArtifacts = async (
  rawVideoPath: string | undefined,
  screenshotPaths: string[],
  events: BrowserRunEvent[],
): Promise<ArtifactPreparationResult> => {
  const warnings: string[] = [];
  const existingScreenshotPaths = screenshotPaths.filter((screenshotPath) =>
    existsSync(screenshotPath),
  );
  const existingRawVideoPath = rawVideoPath && existsSync(rawVideoPath) ? rawVideoPath : undefined;
  const highlightVideoResult = await createHighlightVideo(existingRawVideoPath, events);
  if (highlightVideoResult.warning) warnings.push(highlightVideoResult.warning);

  const redactionBoxResults = await Promise.all(
    existingScreenshotPaths.map((screenshotPath) => getScreenshotEmailBoxes(screenshotPath)),
  );
  const redactionBoxes = redactionBoxResults.flat();

  if (
    existingScreenshotPaths.length > 0 &&
    redactionBoxes.length === 0 &&
    !(await commandExists("tesseract"))
  ) {
    warnings.push("PII redaction skipped because tesseract is not installed.");
  }

  if (redactionBoxes.length > 0 && !(await commandExists("ffmpeg"))) {
    warnings.push("PII redaction skipped because ffmpeg is not installed.");
  }

  const redactedScreenshotResults = await Promise.all(
    existingScreenshotPaths.map((screenshotPath) => redactImage(screenshotPath, redactionBoxes)),
  );
  const redactedScreenshotPaths = redactedScreenshotResults.filter(
    (screenshotPath): screenshotPath is string => Boolean(screenshotPath),
  );
  const redactedVideoPath = await redactVideo(
    highlightVideoResult.highlightVideoPath ?? existingRawVideoPath,
    redactionBoxes,
  );

  return {
    warnings,
    artifacts: {
      rawVideoPath: existingRawVideoPath,
      highlightVideoPath: highlightVideoResult.highlightVideoPath,
      redactedVideoPath,
      screenshotPaths: existingScreenshotPaths,
      redactedScreenshotPaths,
    },
  };
};

export const createBrowserRunReport = async (
  options: CreateBrowserRunReportOptions,
): Promise<BrowserRunReport> => {
  const stepResults = getStepResults(options.plan, options.events);
  const findings = getFindings(options.events, options.plan, options.completionEvent);
  const riskAreaSummary = getRiskAreaSummary(options.plan, stepResults, findings);
  const [artifactPreparation, pullRequest] = await Promise.all([
    prepareArtifacts(options.rawVideoPath, options.screenshotPaths, options.events),
    getPullRequestForBranch(options.target.cwd, options.target.branch.current),
  ]);

  const partialReport = {
    title: options.plan.title,
    status: options.completionEvent.status,
    summary: options.completionEvent.summary,
    findings,
    stepResults,
    warnings: artifactPreparation.warnings,
    pullRequest,
    ...riskAreaSummary,
  };

  return {
    ...partialReport,
    artifacts: {
      ...artifactPreparation.artifacts,
      ...createShareBundle({
        report: partialReport,
        artifacts: artifactPreparation.artifacts,
      }),
    },
  };
};
