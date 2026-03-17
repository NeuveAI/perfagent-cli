import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { COMMENT_DIRECTORY_PREFIX, GITHUB_TIMEOUT_MS } from "./constants.js";
import type { BrowserRunPullRequest, BrowserRunReport } from "./types.js";
import { commandExists } from "./utils/command-exists.js";

const execFileAsync = promisify(execFile);

interface PullRequestJson {
  number?: unknown;
  url?: unknown;
  title?: unknown;
  headRefName?: unknown;
}

export interface PostPullRequestCommentOptions {
  cwd: string;
  report: BrowserRunReport;
}

export interface PostPullRequestCommentResult {
  bodyPath: string;
  pullRequest: BrowserRunPullRequest;
}

const runGhCommand = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("gh", args, {
    cwd,
    encoding: "utf-8",
    timeout: GITHUB_TIMEOUT_MS,
  });
  return stdout.trim();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parsePullRequest = (value: unknown): BrowserRunPullRequest | null => {
  if (!isRecord(value)) return null;

  const pullRequest: PullRequestJson = value;
  if (
    typeof pullRequest.number !== "number" ||
    typeof pullRequest.url !== "string" ||
    typeof pullRequest.title !== "string" ||
    typeof pullRequest.headRefName !== "string"
  ) {
    return null;
  }

  return {
    number: pullRequest.number,
    url: pullRequest.url,
    title: pullRequest.title,
    headRefName: pullRequest.headRefName,
  };
};

const isRemoteShareUrl = (shareUrl: string | undefined): boolean =>
  typeof shareUrl === "string" &&
  (shareUrl.startsWith("https://") || shareUrl.startsWith("http://"));

export const getPullRequestForBranch = async (
  cwd: string,
  branch: string,
): Promise<BrowserRunPullRequest | null> => {
  if (!(await commandExists("gh"))) return null;

  try {
    const output = await runGhCommand(cwd, [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--limit",
      "1",
      "--json",
      "number,url,title,headRefName",
    ]);
    const parsedValue: unknown = JSON.parse(output);
    if (!Array.isArray(parsedValue) || parsedValue.length === 0) return null;
    return parsePullRequest(parsedValue[0]);
  } catch {
    return null;
  }
};

export const buildPullRequestCommentBody = (report: BrowserRunReport): string => {
  const findingLines =
    report.findings.length > 0
      ? report.findings.slice(0, 5).map((finding) => `- ${finding.title}: ${finding.detail}`)
      : ["- No blocking findings detected."];

  const riskLines =
    report.confirmedRiskAreas.length > 0
      ? report.confirmedRiskAreas.map((riskArea) => `- Confirmed risk: ${riskArea}`)
      : report.unresolvedRiskAreas.length > 0
        ? report.unresolvedRiskAreas.map((riskArea) => `- Needs follow-up: ${riskArea}`)
        : ["- No outstanding risk areas called out by the plan."];

  const artifactLines: string[] = [];
  if (isRemoteShareUrl(report.artifacts.shareUrl)) {
    artifactLines.push(`- Full report: ${report.artifacts.shareUrl}`);
  }
  if (report.artifacts.highlightVideoPath) {
    artifactLines.push(
      `- Highlight reel saved locally at \`${report.artifacts.highlightVideoPath}\``,
    );
  } else if (report.artifacts.rawVideoPath) {
    artifactLines.push(`- Raw video saved locally at \`${report.artifacts.rawVideoPath}\``);
  }
  if (report.artifacts.redactedScreenshotPaths.length > 0) {
    artifactLines.push(
      `- ${report.artifacts.redactedScreenshotPaths.length} redacted screenshot(s) saved locally`,
    );
  } else if (report.artifacts.screenshotPaths.length > 0) {
    artifactLines.push(`- ${report.artifacts.screenshotPaths.length} screenshot(s) saved locally`);
  }

  return [
    `## Browser test ${report.status}`,
    "",
    report.summary,
    "",
    "### Findings",
    ...findingLines,
    "",
    "### Risk areas",
    ...riskLines,
    ...(artifactLines.length > 0 ? ["", "### Artifacts", ...artifactLines] : []),
  ].join("\n");
};

export const postPullRequestComment = async (
  options: PostPullRequestCommentOptions,
): Promise<PostPullRequestCommentResult> => {
  if (!options.report.pullRequest) {
    throw new Error("No open pull request is associated with this branch.");
  }

  if (!(await commandExists("gh"))) {
    throw new Error("GitHub CLI is not installed or is not available in PATH.");
  }

  const body = buildPullRequestCommentBody(options.report);
  const outputDirectoryPath = mkdtempSync(join(tmpdir(), COMMENT_DIRECTORY_PREFIX));
  const bodyPath = join(outputDirectoryPath, "pull-request-comment.md");
  writeFileSync(bodyPath, body, "utf-8");

  await runGhCommand(options.cwd, [
    "pr",
    "comment",
    String(options.report.pullRequest.number),
    "--body-file",
    bodyPath,
  ]);

  return {
    bodyPath,
    pullRequest: options.report.pullRequest,
  };
};
