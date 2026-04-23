import type { ChangedFile, ChangesFor, CommitSummary, PerfPlan, SavedFlow } from "./models";

const EXECUTION_CONTEXT_FILE_LIMIT = 12;
const EXECUTION_RECENT_COMMIT_LIMIT = 5;
const DIFF_PREVIEW_CHAR_LIMIT = 12_000;
const DEFAULT_BROWSER_MCP_SERVER_NAME = "browser";

export interface DevServerHint {
  readonly url: string;
  readonly projectPath: string;
  readonly devCommand: string;
}

export interface ExecutionPromptOptions {
  readonly userInstruction: string;
  readonly scope: ChangesFor["_tag"];
  readonly currentBranch: string;
  readonly mainBranch: string | undefined;
  readonly changedFiles: readonly ChangedFile[];
  readonly recentCommits: readonly CommitSummary[];
  readonly diffPreview: string;
  readonly baseUrl: string | undefined;
  readonly isHeadless: boolean;
  readonly cookieBrowserKeys: readonly string[];
  readonly browserMcpServerName?: string;
  readonly savedFlow?: SavedFlow;
  readonly learnings?: string;
  readonly devServerHints?: readonly DevServerHint[];
  readonly perfPlan?: PerfPlan;
  readonly currentSubGoal?: string;
  readonly observedState?: string;
}

const formatSavedFlowGuidance = (savedFlow: SavedFlow | undefined): string[] => {
  if (!savedFlow) return [];

  return [
    "Saved flow guidance:",
    "You are replaying a previously saved flow. Follow these steps as guidance, but adapt if the UI has changed.",
    `Saved flow title: ${savedFlow.title}`,
    `Saved flow request: ${savedFlow.userInstruction}`,
    "",
    ...savedFlow.steps.flatMap((step, index) => [
      `Step ${index + 1}: ${step.title}`,
      `Instruction: ${step.instruction}`,
      `Expected: ${step.expectedOutcome}`,
      "",
    ]),
  ];
};

const getScopeStrategy = (scope: ChangesFor["_tag"]): string[] => {
  switch (scope) {
    case "Commit":
      return [
        "- Start narrow and prove the selected commit's intended change works first.",
        "- Treat the selected commit and its touched files as the primary testing hypothesis.",
        "- After the primary flow, test 2-4 adjacent flows that could regress from the same change. Think about what else touches the same components, routes, or data.",
        "- For UI changes, verify related views that render the same data or share the same components.",
      ];
    case "WorkingTree":
      return [
        "- Start with the exact user-requested flow against the local in-progress changes.",
        "- After the primary flow, test related flows that exercise the same code paths — aim for 2-3 follow-ups.",
        "- Pay extra attention to partially-implemented features: check that incomplete states don't break existing behavior.",
      ];
    case "Changes":
      return [
        "- Treat committed and uncommitted work as one body of change.",
        "- Cover the requested flow first, then the highest-risk adjacent flows.",
        "- Test 2-4 follow-up flows, prioritizing paths that share components or data with the changed files.",
        "- If the changes touch shared utilities or layouts, verify multiple pages that use them.",
      ];
    default:
      return [
        "- This is a branch-level review — be thorough. The goal is to catch regressions before merge, not to do a quick spot-check.",
        "- Cover the requested flow first, then systematically test each area affected by the changed files.",
        "- Aim for 5-8 total tested flows. Derive them from the changed files: each changed route, component, or data path should get its own verification.",
        "- Test cross-cutting concerns: if shared components, layouts, or utilities changed, verify them on multiple pages that consume them.",
        "- The per-flow edge-case rule applies — for branch reviews, prioritize security and authorization edge cases (unauthorized access, missing permissions, broken link).",
        "- Do not stop after the happy path passes. The value of a branch review is catching what the developer might have missed.",
      ];
  }
};

export const buildLocalAgentSystemPrompt = (): string =>
  [
    "You are a performance analysis agent backed by Chrome DevTools.",
    "",
    "You MUST use the provided tools. Never describe plans, steps, or intentions in prose — always call a tool.",
    "",
    "Workflow:",
    '1. Use `interact` to navigate to URLs (command: "navigate") and perform user interactions (click, type, fill).',
    "2. Use `observe` to read page state (snapshot for element UIDs, screenshot for visuals, console/network for logs).",
    '3. Use `trace` to profile performance: "start" begins a trace, "stop" returns Core Web Vitals + insight IDs, "analyze" drills into a specific insight.',
    "",
    "Core Web Vitals targets:",
    "- LCP < 2500 ms",
    "- FCP < 1800 ms",
    "- CLS < 0.1",
    "- INP < 200 ms",
    "- TTFB < 800 ms",
    "",
    "Rules:",
    '- Always start by calling `interact` with command="navigate" to reach the target URL.',
    '- Before interacting with elements, call `observe` with command="snapshot" to get element UIDs.',
    '- For cold-load performance: call `trace` with command="start", reload=true, autoStop=true. This records, auto-stops, and returns CWV + insights in one call.',
    '- For interaction profiling (INP): call `trace` with command="start", reload=false, autoStop=false; perform interactions via `interact`; then call `trace` with command="stop".',
    '- YOU MUST call `trace` with command="analyze" for EACH insight name returned in the trace response before you stop. Do not produce a final report until every insight has been analyzed. Every insight listed — LCPBreakdown, CLSCulprits, RenderBlocking, NetworkDependencyTree, DocumentLatency, and any others — requires its own analyze call. Skipping any insight means the report is incomplete.',
    "  Analyze call shape:",
    '    { "action": { "command": "analyze", "insightSetId": "NAVIGATION_0", "insightName": "LCPBreakdown" } }',
    '    { "action": { "command": "analyze", "insightSetId": "NAVIGATION_0", "insightName": "RenderBlocking" } }',
    "- Report findings concisely after tools return data. Do not narrate what you are about to do.",
    "",
    "Call tools. Do not narrate.",
  ].join("\n");

export const buildExecutionSystemPrompt = (browserMcpServerName?: string): string => {
  const mcpName = browserMcpServerName ?? DEFAULT_BROWSER_MCP_SERVER_NAME;
  return [
    "<identity>",
    "You are a performance analysis agent. You profile a running web app across a multi-step",
    "user journey and find real regressions. You do not stop early. You do not emit",
    "RUN_COMPLETED until every sub-goal in <plan> reaches a terminal status.",
    "</identity>",
    "<protocol>",
    "Every turn you receive <current_sub_goal>, <observed_state>, <available_actions>.",
    "Before acting, write one sentence of reasoning. Then emit exactly one tool call OR",
    "one status marker on its own line. No narration beyond the reasoning sentence.",
    "Status markers (exact format, one per line, no prose):",
    "  STEP_START|<step-id>|<short-title>",
    "  STEP_DONE|<step-id>|<short-summary>",
    "  ASSERTION_FAILED|<step-id>|category=<failure-category>; domain=<failure-domain>; reason=<short>; evidence=<metric-or-insight>",
    "  RUN_COMPLETED|passed|<one-sentence-summary>",
    "  RUN_COMPLETED|failed|<one-sentence-summary>",
    "To abort a run you cannot complete, emit on two consecutive lines:",
    "  ASSERTION_FAILED|<step-id>|category=abort; abort_reason=<what-blocked-you>",
    "  RUN_COMPLETED|failed|<why-aborted>",
    "</protocol>",
    `<tool_catalog server="${mcpName}">`,
    "- click(ref) — click an interactive element by its snapshot ref",
    "- fill(ref, text) — type into an input",
    "- hover(ref) — hover to reveal menus or tooltips",
    "- select(ref, option) — choose from a dropdown",
    "- wait_for(target, timeout?) — wait for an element, text, or network-idle state",
    "- navigate_page(url) — load a URL or go back/forward/reload",
    "- take_snapshot() — required after any navigation or state-changing action; yields element refs",
    "- take_screenshot() — visual evidence only; prefer take_snapshot for state",
    "- performance_start_trace({reload, autoStop}) — begin a trace (reload=true for cold-load)",
    "- performance_stop_trace() — stop the active trace and emit the Core Web Vitals summary",
    "- performance_analyze_insight(insightSetId, insightName) — drill into a trace insight",
    "- emulate({cpuThrottlingRate, networkConditions}) — simulate slow device or network",
    "- lighthouse_audit() — accessibility / SEO / best-practices only; use traces for perf",
    "- take_memory_snapshot() — heap capture for leak detection",
    "- list_network_requests() — network log since last navigation",
    "- list_console_messages() — console log since last navigation",
    "- evaluate_script(js) — LAST RESORT when no other tool applies",
    "- close() — final teardown after RUN_COMPLETED",
    "</tool_catalog>",
    "<failure_categories>",
    "budget-violation — a Core Web Vital exceeded its budget (LCP > 2500ms, INP > 200ms, CLS > 0.1, FCP > 1800ms, TTFB > 800ms).",
    "regression — a metric got measurably worse versus the baseline for this route.",
    "resource-blocker — a render-blocking asset, third-party script, or failed request blocks the critical path.",
    "memory-leak — detached DOM nodes, unbounded listeners, or growing retained heap across interactions.",
    "abort — you are truly stuck and cannot complete the remaining plan steps (missing auth, captcha, unreachable page).",
    "</failure_categories>",
    "<failure_domains>",
    "design, responsive, perf, a11y, other — choose the narrowest match.",
    "</failure_domains>",
    "<rules>",
    "- Measurement-first: take_snapshot, performance_start_trace, then act.",
    "- Emit STEP_START before each step. Emit STEP_DONE or ASSERTION_FAILED before the next STEP_START.",
    "- Never emit RUN_COMPLETED while plan steps are pending unless the previous line is ASSERTION_FAILED with category=abort and abort_reason set.",
    "- Always take_snapshot after navigate_page, evaluate_script, click, fill, hover, or select.",
    "- Every ASSERTION_FAILED needs one concrete signal (metric value, insight name, network error, or console error).",
    "- Prefer click/fill/hover/select/wait_for over evaluate_script for any user interaction.",
    "- Stay on the happy path of the plan. If blocked, try one alternate action; if still blocked, abort.",
    "- One tool call per turn. Do not batch or chain speculatively.",
    "</rules>",
  ].join("\n");
};

const formatPlanBlock = (perfPlan: PerfPlan | undefined): string[] => {
  if (!perfPlan || perfPlan.steps.length === 0) return [];
  const lines = perfPlan.steps.map((step) => `- [${step.status}] ${step.id} — ${step.title}`);
  return ["<plan>", ...lines, "</plan>", ""];
};

const formatCurrentSubGoal = (options: ExecutionPromptOptions): string[] => {
  if (options.currentSubGoal) {
    return ["<current_sub_goal>", options.currentSubGoal, "</current_sub_goal>", ""];
  }
  const plan = options.perfPlan;
  if (!plan) return [];
  const activeStep =
    plan.steps.find((step) => step.status === "active") ??
    plan.steps.find((step) => step.status === "pending");
  if (!activeStep) return [];
  return [
    "<current_sub_goal>",
    `${activeStep.id} — ${activeStep.title}`,
    activeStep.instruction,
    "</current_sub_goal>",
    "",
  ];
};

const formatObservedState = (observedState: string | undefined): string[] => {
  if (!observedState) return [];
  return ["<observed_state>", observedState, "</observed_state>", ""];
};

export const buildExecutionPrompt = (options: ExecutionPromptOptions): string => {
  const changedFiles = options.changedFiles.slice(0, EXECUTION_CONTEXT_FILE_LIMIT);
  const recentCommits = options.recentCommits.slice(0, EXECUTION_RECENT_COMMIT_LIMIT);
  const rawDiff = options.diffPreview || "";
  const diffPreview =
    rawDiff.length > DIFF_PREVIEW_CHAR_LIMIT
      ? rawDiff.slice(0, DIFF_PREVIEW_CHAR_LIMIT) + "\n... (truncated)"
      : rawDiff;

  const devServerLines =
    options.devServerHints && options.devServerHints.length > 0
      ? [
          "Dev servers (not running — start before testing):",
          ...options.devServerHints.map(
            (hint) => `  cd ${hint.projectPath} && ${hint.devCommand}  →  ${hint.url}`,
          ),
        ]
      : [];

  return [
    "<environment>",
    ...(options.baseUrl ? [`Base URL: ${options.baseUrl}`] : []),
    ...devServerLines,
    `Browser is headless: ${options.isHeadless ? "yes" : "no"}`,
    `Uses existing browser cookies: ${options.cookieBrowserKeys.length > 0 ? `yes (${options.cookieBrowserKeys.length})` : "no"}`,
    `Scope: ${options.scope}`,
    `Current branch: ${options.currentBranch}`,
    ...(options.mainBranch ? [`Main branch: ${options.mainBranch}`] : []),
    "</environment>",
    "",
    ...(changedFiles.length > 0
      ? [
          "<changed_files>",
          changedFiles.map((file) => `- [${file.status}] ${file.path}`).join("\n"),
          "</changed_files>",
          "",
        ]
      : []),
    ...(recentCommits.length > 0
      ? [
          "<recent_commits>",
          recentCommits.map((commit) => `${commit.shortHash} ${commit.subject}`).join("\n"),
          "</recent_commits>",
          "",
        ]
      : []),
    ...(diffPreview ? ["<diff_preview>", diffPreview, "</diff_preview>", ""] : []),
    ...formatPlanBlock(options.perfPlan),
    ...formatCurrentSubGoal(options),
    ...formatObservedState(options.observedState),
    ...formatSavedFlowGuidance(options.savedFlow),
    ...(options.learnings?.trim()
      ? ["<project_learnings>", options.learnings.trim(), "</project_learnings>", ""]
      : []),
    "<developer_request>",
    options.userInstruction,
    "</developer_request>",
    "",
    "<scope_strategy>",
    ...getScopeStrategy(options.scope),
    "</scope_strategy>",
  ].join("\n");
};

export interface WatchAssessmentPromptOptions {
  readonly diffPreview: string;
  readonly changedFiles: readonly ChangedFile[];
  readonly instruction: string;
}

export const buildWatchAssessmentPrompt = (options: WatchAssessmentPromptOptions): string =>
  [
    "You are a code-change classifier for a performance analysis tool.",
    "",
    "Given a git diff and a list of changed files, decide whether performance analysis should run.",
    "",
    "Respond with EXACTLY one line:",
    "  run — changes affect runtime behavior (UI, routes, API calls, styles, bundle config, data fetching, rendering logic, asset loading)",
    "  skip — changes are purely internal with no runtime effect (comments, type-only refactors, test files only, documentation, lock files, .gitignore, CI config)",
    "",
    "Rules:",
    "- If in doubt, respond with run.",
    "- Do NOT explain your reasoning. Output only the single word: run or skip.",
    "",
    "User's test instruction:",
    options.instruction,
    "",
    ...(options.changedFiles.length > 0
      ? [
          "Changed files:",
          options.changedFiles.map((file) => `- [${file.status}] ${file.path}`).join("\n"),
          "",
        ]
      : []),
    ...(options.diffPreview ? ["Diff preview:", options.diffPreview] : []),
  ].join("\n");
