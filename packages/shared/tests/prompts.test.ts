import { describe, expect, it } from "vite-plus/test";
import {
  buildExecutionPrompt,
  buildExecutionSystemPrompt,
  buildLocalAgentSystemPrompt,
  buildWatchAssessmentPrompt,
  type ExecutionPromptOptions,
  type WatchAssessmentPromptOptions,
} from "../src/prompts";

const makeDefaultOptions = (
  overrides?: Partial<ExecutionPromptOptions>,
): ExecutionPromptOptions => ({
  userInstruction: "Test the login flow",
  scope: "Changes",
  currentBranch: "feat/login",
  mainBranch: "main",
  changedFiles: [
    { path: "src/auth/login.ts", status: "M" },
    { path: "src/auth/signup.ts", status: "A" },
  ],
  recentCommits: [{ hash: "abc123def456", shortHash: "abc123d", subject: "feat: add login form" }],
  diffPreview: "diff --git a/src/auth/login.ts\n+export const login = () => {}",
  baseUrl: "http://localhost:3000",
  isHeadless: false,
  cookieBrowserKeys: [],
  ...overrides,
});

describe("buildExecutionPrompt", () => {
  it("includes the user instruction in the prompt", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("Test the login flow");
  });

  it("wraps user prompt sections in XML tags", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("</environment>");
    expect(prompt).toContain("<changed_files>");
    expect(prompt).toContain("<diff_preview>");
    expect(prompt).toContain("<developer_request>");
    expect(prompt).toContain("<scope_strategy>");
  });

  it("includes DevTools tool descriptions in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("navigate_page: navigate to a URL");
    expect(prompt).toContain("take_snapshot: get accessibility tree");
    expect(prompt).toContain("take_screenshot: capture page as PNG");
    expect(prompt).toContain("performance_start_trace: start a performance trace");
    expect(prompt).toContain("performance_stop_trace: stop the active trace");
    expect(prompt).toContain("performance_analyze_insight: get detailed info");
    expect(prompt).toContain("emulate: apply CPU/network throttling");
    expect(prompt).toContain("lighthouse_audit: run Lighthouse");
    expect(prompt).toContain("take_memory_snapshot: capture heap snapshot");
    expect(prompt).toContain("list_network_requests: list all network requests");
    expect(prompt).toContain("list_console_messages: list console messages");
    expect(prompt).toContain("evaluate_script: execute JavaScript");
    expect(prompt).toContain("close: close the DevTools session");
  });

  it("includes profiling workflow in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<profiling_workflow>");
    expect(prompt).toContain("cold-load profiling");
    expect(prompt).toContain("interaction profiling");
    expect(prompt).toContain("cpuThrottlingRate=4");
  });

  it("includes step marker protocol in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("STEP_START|<step-id>|<step-title>");
    expect(prompt).toContain("STEP_DONE|<step-id>|<short-summary>");
    expect(prompt).toContain("ASSERTION_FAILED|<step-id>|<why-it-failed>");
    expect(prompt).toContain("RUN_COMPLETED|passed|<session-summary>");
    expect(prompt).toContain("RUN_COMPLETED|failed|<session-summary>");
  });

  it("describes session summary as a handoff to the outer agent", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("handoff to the outer agent");
    expect(prompt).toContain("what was profiled");
    expect(prompt).toContain("regressions found");
    expect(prompt).toContain("anything learned");
  });

  it("includes changed files", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("[M] src/auth/login.ts");
    expect(prompt).toContain("[A] src/auth/signup.ts");
  });

  it("includes recent commits", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("abc123d feat: add login form");
  });

  it("includes diff preview", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("export const login = () => {}");
  });

  it("puts data before developer request and scope strategy at the end", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    const diffIndex = prompt.indexOf("<diff_preview>");
    const requestIndex = prompt.indexOf("<developer_request>");
    const scopeIndex = prompt.indexOf("<scope_strategy>");
    expect(diffIndex).toBeLessThan(requestIndex);
    expect(requestIndex).toBeLessThan(scopeIndex);
  });

  it("includes environment context", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("Base URL: http://localhost:3000");
    expect(prompt).toContain("Browser is headless: no");
    expect(prompt).toContain("Uses existing browser cookies: no");
  });

  it("includes branch context", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("Current branch: feat/login");
    expect(prompt).toContain("Main branch: main");
  });

  it("includes scope strategy for branch scope", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions({ scope: "Branch" }));
    expect(prompt).toContain("branch-level review");
    expect(prompt).toContain("5-8 total tested flows");
  });

  it("includes scope strategy for commit scope", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions({ scope: "Commit" }));
    expect(prompt).toContain("Start narrow and prove the selected commit");
  });

  it("includes scope strategy for working tree scope", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions({ scope: "WorkingTree" }));
    expect(prompt).toContain("local in-progress changes");
  });

  it("includes scope strategy for changes scope", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions({ scope: "Changes" }));
    expect(prompt).toContain("committed and uncommitted work as one body");
  });

  it("includes saved flow guidance when provided", () => {
    const prompt = buildExecutionPrompt(
      makeDefaultOptions({
        savedFlow: {
          title: "Login Flow",
          userInstruction: "Test login",
          steps: [
            {
              id: "step-01",
              title: "Open login page",
              instruction: "Navigate to /login",
              expectedOutcome: "Login form visible",
            },
          ],
        },
      }),
    );
    expect(prompt).toContain("Saved flow guidance:");
    expect(prompt).toContain("Saved flow title: Login Flow");
    expect(prompt).toContain("Open login page");
  });

  it("omits saved flow guidance when not provided", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).not.toContain("Saved flow guidance:");
  });

  it("includes learnings when provided", () => {
    const prompt = buildExecutionPrompt(
      makeDefaultOptions({ learnings: "Auth requires a redirect to /callback after login" }),
    );
    expect(prompt).toContain("Auth requires a redirect to /callback");
  });

  it("omits learnings section when not provided", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).not.toContain("<project_learnings>");
  });

  it("truncates long diff previews", () => {
    const longDiff = "x".repeat(15000);
    const prompt = buildExecutionPrompt(makeDefaultOptions({ diffPreview: longDiff }));
    expect(prompt).toContain("... (truncated)");
    expect(prompt).not.toContain("x".repeat(13000));
  });

  it("instructs agent to create steps dynamically in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("Create your own step structure while executing");
    expect(prompt).toContain("step-01, step-02, step-03");
  });

  it("includes snapshot workflow in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<snapshot_workflow>");
    expect(prompt).toContain("take_snapshot");
    expect(prompt).toContain("Always snapshot first");
  });

  it("wraps system prompt sections in XML tags", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<change_analysis>");
    expect(prompt).toContain("<coverage_rules>");
    expect(prompt).toContain("<execution_strategy>");
    expect(prompt).toContain("<profiling_workflow>");
    expect(prompt).toContain("<tools");
    expect(prompt).toContain("<snapshot_workflow>");
    expect(prompt).toContain("<status_markers>");
    expect(prompt).toContain("<failure_reporting>");
    expect(prompt).toContain("<run_completion>");
  });

  it("places sections in correct order", () => {
    const prompt = buildExecutionSystemPrompt();
    const changeAnalysis = prompt.indexOf("<change_analysis>");
    const executionStrategy = prompt.indexOf("<execution_strategy>");
    const profilingWorkflow = prompt.indexOf("<profiling_workflow>");
    const tools = prompt.indexOf("<tools");
    const statusMarkers = prompt.indexOf("<status_markers>");
    const runCompletion = prompt.indexOf("<run_completion>");
    expect(changeAnalysis).toBeLessThan(executionStrategy);
    expect(executionStrategy).toBeLessThan(profilingWorkflow);
    expect(profilingWorkflow).toBeLessThan(tools);
    expect(tools).toBeLessThan(statusMarkers);
    expect(statusMarkers).toBeLessThan(runCompletion);
  });

  it("includes assertion depth guidance in execution strategy", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("two independent signals");
  });

  it("includes change-analysis guidance in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<change_analysis>");
    expect(prompt).toContain("Scan the provided changed files list and diff preview");
    expect(prompt).toContain("developer request is a starting point");
  });

  it("includes coverage rules in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<coverage_rules>");
    expect(prompt).toContain("profile multiple consumers");
  });

  it("includes code-level testing guidance in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<code_testing>");
    expect(prompt).toContain("no user-visible surface");
  });

  it("includes project healthcheck guidance in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("healthcheck");
    expect(prompt).toContain("package.json");
    expect(prompt).toContain("lock files");
  });

  it("includes stability and recovery guidance in system prompt", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<stability_and_recovery>");
    expect(prompt).toContain("four attempts fail");
    expect(prompt).toContain("stop and report");
  });

  it("requires structured failure reports with good/bad example", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("category=<allowed-category>;");
    expect(prompt).toContain("next-agent-prompt=<one sentence");
    expect(prompt).toContain("Bad: ASSERTION_FAILED|step-03|page is slow");
    expect(prompt).toContain("Good: ASSERTION_FAILED|step-03|category=perf-regression");
  });

  it("includes performance regression failure categories", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("perf-regression");
    expect(prompt).toContain("core-web-vitals");
    expect(prompt).toContain("memory");
    expect(prompt).toContain("bundle-size");
  });

  it("includes self-check before RUN_COMPLETED", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain(
      "Review the changed files list and confirm every file is accounted for",
    );
  });

  it("includes emulation guidance for mobile profiling", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("cpuThrottlingRate=4");
    expect(prompt).toContain("Slow 3G");
  });

  it("includes memory profiling guidance", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("take_memory_snapshot");
    expect(prompt).toContain("memory");
  });

  it("includes Core Web Vitals thresholds in run completion", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("LCP > 4s");
    expect(prompt).toContain("INP > 500ms");
    expect(prompt).toContain("CLS > 0.25");
  });
});

describe("buildLocalAgentSystemPrompt", () => {
  it("names the three local-agent tool categories", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("`interact`");
    expect(prompt).toContain("`observe`");
    expect(prompt).toContain("`trace`");
  });

  it("includes Core Web Vitals thresholds", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("LCP < 2500 ms");
    expect(prompt).toContain("CLS < 0.1");
    expect(prompt).toContain("INP < 200 ms");
  });

  it("mandates per-insight analyze drill-ins with directive language", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain('YOU MUST call `trace` with command="analyze" for EACH insight');
    expect(prompt).toContain("Do not produce a final report until every insight has been analyzed");
    expect(prompt).toContain("LCPBreakdown");
    expect(prompt).toContain("CLSCulprits");
    expect(prompt).toContain("RenderBlocking");
  });

  it("fits a small-model context budget (<= 4 KB)", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt.length).toBeLessThanOrEqual(4 * 1024);
  });

  it("includes the analyze call-shape example", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain('"command": "analyze"');
    expect(prompt).toContain('"insightSetId": "NAVIGATION_0"');
  });
});

describe("buildWatchAssessmentPrompt", () => {
  const makeWatchOptions = (
    overrides?: Partial<WatchAssessmentPromptOptions>,
  ): WatchAssessmentPromptOptions => ({
    instruction: "Test the login flow",
    changedFiles: [
      { path: "src/auth/login.ts", status: "M" },
      { path: "src/auth/signup.ts", status: "A" },
    ],
    diffPreview: "diff --git a/src/auth/login.ts\n+export const login = () => {}",
    ...overrides,
  });

  it("includes the user instruction", () => {
    const prompt = buildWatchAssessmentPrompt(makeWatchOptions());
    expect(prompt).toContain("Test the login flow");
  });

  it("includes changed files", () => {
    const prompt = buildWatchAssessmentPrompt(makeWatchOptions());
    expect(prompt).toContain("[M] src/auth/login.ts");
    expect(prompt).toContain("[A] src/auth/signup.ts");
  });

  it("includes diff preview", () => {
    const prompt = buildWatchAssessmentPrompt(makeWatchOptions());
    expect(prompt).toContain("export const login = () => {}");
  });

  it("instructs single-word response", () => {
    const prompt = buildWatchAssessmentPrompt(makeWatchOptions());
    expect(prompt).toContain("run or skip");
  });

  it("handles empty changed files", () => {
    const prompt = buildWatchAssessmentPrompt(makeWatchOptions({ changedFiles: [] }));
    expect(prompt).not.toContain("Changed files:");
  });

  it("handles empty diff", () => {
    const prompt = buildWatchAssessmentPrompt(makeWatchOptions({ diffPreview: "" }));
    expect(prompt).not.toContain("Diff preview:");
  });
});
