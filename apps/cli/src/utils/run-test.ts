import type { BrowserEnvironmentHints, BrowserRunEvent } from "@browser-tester/orchestrator";
import { VERSION } from "../constants.js";
import { fetchCommits } from "./fetch-commits.js";
import { getGitState, getRecommendedScope } from "./get-git-state.js";
import { executeApprovedPlan, generateBrowserPlan, type TestAction } from "./browser-agent.js";

const ACTION_LABELS: Record<TestAction, string> = {
  "test-unstaged": "unstaged changes",
  "test-branch": "branch",
  "select-commit": "commit",
};

const DEFAULT_INSTRUCTIONS: Record<TestAction, string> = {
  "test-unstaged": "Test all unstaged changes in the browser and verify they work correctly.",
  "test-branch": "Test all branch changes in the browser and verify they work correctly.",
  "select-commit":
    "Test the selected commit's changes in the browser and verify they work correctly.",
};

const resolveLiveChromeConnectionMode = (
  environment: BrowserEnvironmentHints,
): "prompt" | "cdp" | undefined => {
  if (environment.liveChrome !== true) return undefined;
  if (environment.liveChromeConnectionMode) return environment.liveChromeConnectionMode;
  return environment.liveChromeCdpEndpoint ? "cdp" : "prompt";
};

const formatLiveChromeMode = (environment: BrowserEnvironmentHints): string | null => {
  if (environment.liveChrome !== true) return null;

  const liveChromeConnectionMode = resolveLiveChromeConnectionMode(environment);
  const tabMode =
    environment.liveChromeTabMode === "attach" ? "attach existing tab" : "open new tab";
  const selectionHints = [
    environment.liveChromeTabUrlMatch
      ? `url contains "${environment.liveChromeTabUrlMatch}"`
      : null,
    environment.liveChromeTabTitleMatch
      ? `title contains "${environment.liveChromeTabTitleMatch}"`
      : null,
    typeof environment.liveChromeTabIndex === "number"
      ? `tab index ${environment.liveChromeTabIndex}`
      : null,
  ].filter((value): value is string => value !== null);

  if (liveChromeConnectionMode === "prompt") {
    return `Live Chrome mode: ${tabMode} by requesting access to your existing Chrome session${selectionHints.length > 0 ? ` (${selectionHints.join(", ")})` : ""}`;
  }

  return `Live Chrome mode: ${tabMode} via ${environment.liveChromeCdpEndpoint ?? "auto-detect from your Chrome profile"}${selectionHints.length > 0 ? ` (${selectionHints.join(", ")})` : ""}`;
};

const formatRunEvent = (event: BrowserRunEvent): string | null => {
  switch (event.type) {
    case "run-started":
      return `Starting ${event.planTitle}`;
    case "step-started":
      return `→ ${event.stepId} ${event.title}`;
    case "step-completed":
      return `  ✓ ${event.stepId} ${event.summary}`;
    case "assertion-failed":
      return `  ✗ ${event.stepId} ${event.message}`;
    case "browser-log":
      return `    browser:${event.action} ${event.message}`;
    case "text":
      return event.text;
    case "error":
      return `Error: ${event.message}`;
    case "run-completed":
      return `Run ${event.status}: ${event.summary}`;
    default:
      return null;
  }
};

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface RunTestOptions {
  environmentOverrides?: BrowserEnvironmentHints;
}

export const runTest = async (
  action: TestAction,
  commitHash?: string,
  options: RunTestOptions = {},
): Promise<void> => {
  const gitState = getGitState();

  let commit;
  if (action === "select-commit") {
    if (commitHash) {
      const commits = fetchCommits();
      commit = commits.find(
        (candidate) => candidate.shortHash === commitHash || candidate.hash.startsWith(commitHash),
      );
      if (!commit) {
        console.error(`Commit "${commitHash}" not found in recent history.`);
        process.exit(1);
      }
    }
  }

  console.error(`testie v${VERSION}`);
  console.error(`Testing ${ACTION_LABELS[action]} on ${gitState.currentBranch}\n`);

  try {
    console.error("Planning browser flow...");
    const { target, plan, environment } = await generateBrowserPlan({
      action,
      commit,
      userInstruction: DEFAULT_INSTRUCTIONS[action],
      environmentOverrides: options.environmentOverrides,
    });

    const liveChromeMode = formatLiveChromeMode(environment);
    if (liveChromeMode) {
      console.error(`${liveChromeMode}`);
      if (resolveLiveChromeConnectionMode(environment) === "prompt") {
        console.error(
          "Enable remote debugging in chrome://inspect/#remote-debugging and allow Chrome's permission prompt when it appears.\n",
        );
      } else {
        console.error(
          "Chrome remote debugging must already be enabled in chrome://inspect/#remote-debugging.\n",
        );
      }
    }

    console.error(`Plan: ${plan.title} (${plan.steps.length} steps)\n`);

    for await (const event of executeApprovedPlan({ target, plan, environment })) {
      const line = formatRunEvent(event);
      if (line) {
        process.stdout.write(line + "\n");
      }
    }
  } catch (error) {
    console.error(`Error: ${formatErrorMessage(error)}`);
    process.exit(1);
  }
};

export const autoDetectAndTest = async (options: RunTestOptions = {}): Promise<void> => {
  const gitState = getGitState();
  const scope = getRecommendedScope(gitState);
  const action: TestAction = scope === "unstaged-changes" ? "test-unstaged" : "test-branch";
  await runTest(action, undefined, options);
};
