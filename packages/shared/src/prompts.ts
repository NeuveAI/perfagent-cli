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
    "Every turn you emit exactly one AgentTurn JSON envelope. The output grammar",
    "is enforced server-side; non-conforming output is impossible. No prose, no markdown.",
    "",
    "<envelopes>",
    "Each envelope is a JSON object with a `_tag` discriminator. Dispatch by `_tag`.",
    '- THOUGHT          { "_tag":"THOUGHT","stepId":"...","thought":"..." }',
    '- ACTION           { "_tag":"ACTION","stepId":"...","toolName":"...","args":{...} }',
    '- PLAN_UPDATE      { "_tag":"PLAN_UPDATE","stepId":"...","action":"insert|replace|remove|replace_step","payload":{...} }',
    '- STEP_DONE        { "_tag":"STEP_DONE","stepId":"...","summary":"..." }',
    '- ASSERTION_FAILED { "_tag":"ASSERTION_FAILED","stepId":"...","category":"...","domain":"...","reason":"...","evidence":"..." }',
    '- RUN_COMPLETED    { "_tag":"RUN_COMPLETED","status":"passed|failed","summary":"..." }',
    "</envelopes>",
    "",
    "<thought_protocol>",
    "Before each ACTION emit a THOUGHT envelope with one sentence stating why this action.",
    "One tag per turn — never concatenate THOUGHT and ACTION.",
    "</thought_protocol>",
    "",
    "<plan_update_protocol>",
    "Emit PLAN_UPDATE when the existing plan needs revision (new step, replacement, removal).",
    "`action` is one of: insert | replace | remove | replace_step (replace_step is an alias of replace).",
    "`payload` is an AnalysisStep object describing the new or replacement step.",
    "</plan_update_protocol>",
    "",
    "<reflect_trigger>",
    "After 2 consecutive ASSERTION_FAILED envelopes on the same stepId, the next turn's",
    "observation will contain a REFLECT directive. Read it and revise your approach via",
    "PLAN_UPDATE or by trying a different ACTION path.",
    "</reflect_trigger>",
    "",
    "<failure_categories>",
    "budget-violation | regression | resource-blocker | memory-leak | abort",
    "</failure_categories>",
    "",
    "<failure_domains>",
    "design | responsive | perf | a11y | other — choose the narrowest match.",
    "</failure_domains>",
    "",
    "<tool_catalog>",
    "Invoke tools via ACTION.toolName + args.",
    '- interact — navigate, click, type, fill. command="navigate" with `url` is the entry path.',
    '- observe — read page state. command="snapshot" returns element UIDs; "screenshot" / "console" / "network" for visuals and logs.',
    '- trace — profile performance. command="start" begins a trace; "stop" returns CWV + insight IDs; "analyze" drills into one insight (insightSetId + insightName required).',
    "</tool_catalog>",
    "",
    "<cwv_targets>",
    "- LCP < 2500 ms",
    "- FCP < 1800 ms",
    "- CLS < 0.1",
    "- INP < 200 ms",
    "- TTFB < 800 ms",
    "</cwv_targets>",
    "",
    "<rules>",
    '- Begin every run with ACTION → interact { command: "navigate", url: ... }.',
    '- Before clicking, typing, or filling, ACTION → observe { command: "snapshot" } to obtain element UIDs.',
    '- Cold-load performance: ACTION → trace { command: "start", reload: true, autoStop: true } — records, auto-stops, returns CWV + insights in one call.',
    '- Interaction profiling (INP): trace { command: "start", reload: false, autoStop: false } → interact … → trace { command: "stop" }.',
    "- Drill every insight returned by `trace stop`: emit ACTION → trace { action: { command: \"analyze\", insightSetId, insightName } } for each insight name (LCPBreakdown, CLSCulprits, RenderBlocking, NetworkDependencyTree, DocumentLatency, and any others). Skipping insights leaves the report incomplete.",
    "- Emit STEP_DONE after a successful step. Do not emit RUN_COMPLETED while plan steps remain pending unless the previous envelope was ASSERTION_FAILED with category=abort.",
    "- One envelope per turn. No prose. No chained tool calls.",
    "</rules>",
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
    "Emit either one tool call OR one status marker on its own line. Each ACTION is",
    "preceded by a THOUGHT marker (one sentence of reasoning). No prose beyond markers.",
    "Status markers (exact format, one per line, no prose):",
    "  THOUGHT|<step-id>|<one-sentence-reasoning>",
    "  STEP_START|<step-id>|<short-title>",
    "  STEP_DONE|<step-id>|<short-summary>",
    "  ASSERTION_FAILED|<step-id>|category=<failure-category>; domain=<failure-domain>; reason=<short>; evidence=<metric-or-insight>",
    "  RUN_COMPLETED|passed|<one-sentence-summary>",
    "  RUN_COMPLETED|failed|<one-sentence-summary>",
    "To abort a run you cannot complete, emit on two consecutive lines:",
    "  ASSERTION_FAILED|<step-id>|category=abort; abort_reason=<what-blocked-you>",
    "  RUN_COMPLETED|failed|<why-aborted>",
    "</protocol>",
    "<plan_update_protocol>",
    "Emit a PLAN_UPDATE marker BEFORE the next STEP_START to revise the plan:",
    "  PLAN_UPDATE|<step-id>|action=insert; payload=<json-AnalysisStep>",
    "  PLAN_UPDATE|<step-id>|action=replace; payload=<json-AnalysisStep>",
    "  PLAN_UPDATE|<step-id>|action=replace_step; payload=<json-AnalysisStep>  # alias of replace",
    "  PLAN_UPDATE|<step-id>|action=remove",
    "Cap: at most 5 PLAN_UPDATE markers per run. The reducer enforces this.",
    "</plan_update_protocol>",
    "<reflect_trigger>",
    "After 2 consecutive ASSERTION_FAILED markers on the same step-id, the next turn's",
    "<observed_state> will contain a REFLECT directive. Read it and revise via",
    "PLAN_UPDATE or a different ACTION path before retrying the step.",
    "</reflect_trigger>",
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
