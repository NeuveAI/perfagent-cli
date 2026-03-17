import { Effect } from "effect";
import {
  planBrowserFlow,
  resolveTestTarget,
  type BrowserEnvironmentHints,
  type BrowserFlowPlan,
  type CommitSummary,
  type TestTarget,
  type TestTargetSelection,
} from "@browser-tester/supervisor";
import type { EnvironmentOverrides } from "./test-run-config.js";

export type TestAction = "test-unstaged" | "test-branch" | "test-changes" | "select-commit";

interface GenerateBrowserPlanOptions {
  action: TestAction;
  commit?: CommitSummary;
  userInstruction: string;
  environmentOverrides?: EnvironmentOverrides;
}

export interface GenerateBrowserPlanResult {
  target: TestTarget;
  plan: BrowserFlowPlan;
  environment: BrowserEnvironmentHints;
}

const parseBooleanEnvironmentValue = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "true" || normalizedValue === "1" || normalizedValue === "yes")
    return true;
  if (normalizedValue === "false" || normalizedValue === "0" || normalizedValue === "no")
    return false;
  return undefined;
};

export const getBrowserEnvironment = (
  overrides?: EnvironmentOverrides,
): BrowserEnvironmentHints => ({
  baseUrl: overrides?.baseUrl ?? process.env.BROWSER_TESTER_BASE_URL,
  headed: overrides?.headed ?? parseBooleanEnvironmentValue(process.env.BROWSER_TESTER_HEADED),
  cookies: overrides?.cookies ?? parseBooleanEnvironmentValue(process.env.BROWSER_TESTER_COOKIES),
});

const createTargetSelection = (action: TestAction, commit?: CommitSummary): TestTargetSelection => {
  if (action === "select-commit") {
    return {
      action,
      commitHash: commit?.hash,
      commitShortHash: commit?.shortHash,
      commitSubject: commit?.subject,
    };
  }

  return { action };
};

export const resolveBrowserTarget = (options: {
  action: TestAction;
  commit?: CommitSummary;
  cwd?: string;
}): TestTarget =>
  resolveTestTarget({
    cwd: options.cwd,
    selection: createTargetSelection(options.action, options.commit),
  });

export const generateBrowserPlan = (options: GenerateBrowserPlanOptions) =>
  Effect.gen(function* () {
    const target = resolveBrowserTarget(options);
    const environment = getBrowserEnvironment(options.environmentOverrides);
    const plan = yield* planBrowserFlow({
      target,
      userInstruction: options.userInstruction,
      environment,
    });

    return {
      target,
      plan,
      environment,
    } satisfies GenerateBrowserPlanResult;
  });
