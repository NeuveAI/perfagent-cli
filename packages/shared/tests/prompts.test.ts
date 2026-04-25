import { Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  AnalysisStep,
  ChangesFor,
  PerfPlan,
  PlanId,
  StepId,
  type PerfPlan as PerfPlanType,
} from "../src/models";
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

const makePlanWithSteps = (): PerfPlanType =>
  new PerfPlan({
    id: PlanId.makeUnsafe("plan-01"),
    title: "Login journey",
    rationale: "Verify login flow end-to-end",
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    currentBranch: "feat/login",
    diffPreview: "",
    fileStats: [],
    instruction: "Test the login flow",
    baseUrl: Option.some("http://localhost:3000"),
    isHeadless: false,
    cookieBrowserKeys: [],
    targetUrls: [],
    perfBudget: Option.none(),
    steps: [
      new AnalysisStep({
        id: StepId.makeUnsafe("step-01"),
        title: "Navigate to /login",
        instruction: "Open the login page",
        expectedOutcome: "Login form visible",
        routeHint: Option.some("/login"),
        status: "active",
        summary: Option.none(),
        startedAt: Option.none(),
        endedAt: Option.none(),
      }),
      new AnalysisStep({
        id: StepId.makeUnsafe("step-02"),
        title: "Submit credentials",
        instruction: "Fill and submit the login form",
        expectedOutcome: "Redirect to /dashboard",
        routeHint: Option.none(),
        status: "pending",
        summary: Option.none(),
        startedAt: Option.none(),
        endedAt: Option.none(),
      }),
    ],
  });

describe("buildExecutionSystemPrompt — shape & invariants", () => {
  it("emits at most 80 non-blank lines", () => {
    const prompt = buildExecutionSystemPrompt();
    const nonBlank = prompt.split("\n").filter((line) => line.trim().length > 0);
    expect(nonBlank.length).toBeLessThanOrEqual(80);
  });

  it("contains every mandatory status marker invariant", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("STEP_START");
    expect(prompt).toContain("STEP_DONE");
    expect(prompt).toContain("ASSERTION_FAILED");
    expect(prompt).toContain("RUN_COMPLETED");
    expect(prompt).toContain("abort_reason");
    expect(prompt).toContain("category=");
    expect(prompt).toContain("domain=");
  });

  it("lists every failure category from wave 1.B", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("budget-violation");
    expect(prompt).toContain("regression");
    expect(prompt).toContain("resource-blocker");
    expect(prompt).toContain("memory-leak");
    expect(prompt).toContain("abort");
  });

  it("lists every wave-2.A interaction tool in the catalog", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("click(ref)");
    expect(prompt).toContain("fill(ref, text)");
    expect(prompt).toContain("hover(ref)");
    expect(prompt).toContain("select(ref, option)");
    expect(prompt).toContain("wait_for(target");
  });

  it("lists every chrome-devtools-mcp tool in the catalog", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("navigate_page(url)");
    expect(prompt).toContain("take_snapshot()");
    expect(prompt).toContain("take_screenshot()");
    expect(prompt).toContain("performance_start_trace");
    expect(prompt).toContain("performance_stop_trace()");
    expect(prompt).toContain("performance_analyze_insight");
    expect(prompt).toContain("emulate(");
    expect(prompt).toContain("lighthouse_audit()");
    expect(prompt).toContain("take_memory_snapshot()");
    expect(prompt).toContain("list_network_requests()");
    expect(prompt).toContain("list_console_messages()");
    expect(prompt).toContain("evaluate_script(js)");
    expect(prompt).toContain("close()");
  });

  it("relegates evaluate_script to last resort", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("LAST RESORT");
  });

  it("wraps every section in the required XML block", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("</identity>");
    expect(prompt).toContain("<protocol>");
    expect(prompt).toContain("</protocol>");
    expect(prompt).toContain("<tool_catalog");
    expect(prompt).toContain("</tool_catalog>");
    expect(prompt).toContain("<failure_categories>");
    expect(prompt).toContain("</failure_categories>");
    expect(prompt).toContain("<rules>");
    expect(prompt).toContain("</rules>");
  });

  it("identity section comes first and rules section comes last", () => {
    const prompt = buildExecutionSystemPrompt();
    const identityIndex = prompt.indexOf("<identity>");
    const protocolIndex = prompt.indexOf("<protocol>");
    const catalogIndex = prompt.indexOf("<tool_catalog");
    const categoriesIndex = prompt.indexOf("<failure_categories>");
    const rulesIndex = prompt.indexOf("<rules>");
    expect(identityIndex).toBe(0);
    expect(identityIndex).toBeLessThan(protocolIndex);
    expect(protocolIndex).toBeLessThan(catalogIndex);
    expect(catalogIndex).toBeLessThan(categoriesIndex);
    expect(categoriesIndex).toBeLessThan(rulesIndex);
  });

  it("uses the default browser MCP server name when none provided", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain('server="browser"');
  });

  it("honors a custom browser MCP server name", () => {
    const prompt = buildExecutionSystemPrompt("chrome-devtools");
    expect(prompt).toContain('server="chrome-devtools"');
  });

  it("explicitly forbids RUN_COMPLETED with pending steps absent an abort", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("Never emit RUN_COMPLETED");
    expect(prompt).toContain("category=abort");
  });

  it("teaches the THOUGHT marker before each ACTION", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("THOUGHT|<step-id>|<one-sentence-reasoning>");
    expect(prompt).toContain("Each ACTION is");
    expect(prompt).toContain("preceded by a THOUGHT marker");
  });

  it("includes the PLAN_UPDATE protocol with all four actions", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<plan_update_protocol>");
    expect(prompt).toContain("PLAN_UPDATE|<step-id>|action=insert");
    expect(prompt).toContain("PLAN_UPDATE|<step-id>|action=replace;");
    expect(prompt).toContain("PLAN_UPDATE|<step-id>|action=replace_step");
    expect(prompt).toContain("PLAN_UPDATE|<step-id>|action=remove");
    expect(prompt).toContain("at most 5 PLAN_UPDATE markers per run");
  });

  it("includes the REFLECT trigger guidance", () => {
    const prompt = buildExecutionSystemPrompt();
    expect(prompt).toContain("<reflect_trigger>");
    expect(prompt).toContain("2 consecutive ASSERTION_FAILED markers");
    expect(prompt).toContain("REFLECT directive");
  });

  it("golden snapshot — output is stable across invocations", () => {
    const promptOne = buildExecutionSystemPrompt();
    const promptTwo = buildExecutionSystemPrompt();
    expect(promptOne).toBe(promptTwo);
  });

  it("golden snapshot — custom server name output is stable", () => {
    const promptOne = buildExecutionSystemPrompt("my-server");
    const promptTwo = buildExecutionSystemPrompt("my-server");
    expect(promptOne).toBe(promptTwo);
    expect(promptOne).not.toBe(buildExecutionSystemPrompt());
  });
});

describe("buildExecutionPrompt — per-turn state blocks", () => {
  it("wraps the base state blocks in XML tags", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("</environment>");
    expect(prompt).toContain("<changed_files>");
    expect(prompt).toContain("<diff_preview>");
    expect(prompt).toContain("<developer_request>");
    expect(prompt).toContain("<scope_strategy>");
  });

  it("includes the user instruction", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).toContain("Test the login flow");
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

  it("places data before developer request and scope strategy at the end", () => {
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

  it("populates <plan> when a PerfPlan is provided", () => {
    const plan = makePlanWithSteps();
    const prompt = buildExecutionPrompt(makeDefaultOptions({ perfPlan: plan }));
    expect(prompt).toContain("<plan>");
    expect(prompt).toContain("[active] step-01 — Navigate to /login");
    expect(prompt).toContain("[pending] step-02 — Submit credentials");
    expect(prompt).toContain("</plan>");
  });

  it("populates <current_sub_goal> from the active step when a PerfPlan is provided", () => {
    const plan = makePlanWithSteps();
    const prompt = buildExecutionPrompt(makeDefaultOptions({ perfPlan: plan }));
    expect(prompt).toContain("<current_sub_goal>");
    expect(prompt).toContain("step-01 — Navigate to /login");
    expect(prompt).toContain("Open the login page");
    expect(prompt).toContain("</current_sub_goal>");
  });

  it("honors an explicit currentSubGoal override", () => {
    const prompt = buildExecutionPrompt(
      makeDefaultOptions({ currentSubGoal: "Reach /dashboard and measure LCP" }),
    );
    expect(prompt).toContain("<current_sub_goal>");
    expect(prompt).toContain("Reach /dashboard and measure LCP");
  });

  it("omits <plan> and <current_sub_goal> when no plan or sub-goal is provided", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).not.toContain("<plan>");
    expect(prompt).not.toContain("<current_sub_goal>");
  });

  it("populates <observed_state> when provided", () => {
    const prompt = buildExecutionPrompt(
      makeDefaultOptions({ observedState: "Current URL: /login. Form fields: email, password." }),
    );
    expect(prompt).toContain("<observed_state>");
    expect(prompt).toContain("Current URL: /login");
    expect(prompt).toContain("</observed_state>");
  });

  it("omits <observed_state> when not provided", () => {
    const prompt = buildExecutionPrompt(makeDefaultOptions());
    expect(prompt).not.toContain("<observed_state>");
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

  it("includes dev server hints when provided", () => {
    const prompt = buildExecutionPrompt(
      makeDefaultOptions({
        devServerHints: [
          { projectPath: "apps/web", devCommand: "pnpm dev", url: "http://localhost:3000" },
        ],
      }),
    );
    expect(prompt).toContain("Dev servers");
    expect(prompt).toContain("cd apps/web && pnpm dev");
  });
});

describe("buildLocalAgentSystemPrompt", () => {
  it("names the three local-agent tool categories in the catalog", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("interact");
    expect(prompt).toContain("observe");
    expect(prompt).toContain("trace");
  });

  it("includes Core Web Vitals thresholds", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("LCP < 2500 ms");
    expect(prompt).toContain("CLS < 0.1");
    expect(prompt).toContain("INP < 200 ms");
  });

  it("teaches the per-insight drill in the rules block", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("Drill every insight returned by `trace stop`");
    expect(prompt).toContain("LCPBreakdown");
    expect(prompt).toContain("CLSCulprits");
    expect(prompt).toContain("RenderBlocking");
  });

  it("documents the AgentTurn envelope grammar (Variant B)", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("<envelopes>");
    expect(prompt).toContain('"_tag":"THOUGHT"');
    expect(prompt).toContain('"_tag":"ACTION"');
    expect(prompt).toContain('"_tag":"PLAN_UPDATE"');
    expect(prompt).toContain('"_tag":"STEP_DONE"');
    expect(prompt).toContain('"_tag":"ASSERTION_FAILED"');
    expect(prompt).toContain('"_tag":"RUN_COMPLETED"');
  });

  it("includes the THOUGHT-before-ACTION protocol section", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("<thought_protocol>");
    expect(prompt).toContain("Before each ACTION emit a THOUGHT envelope");
    expect(prompt).toContain("One tag per turn");
  });

  it("includes the PLAN_UPDATE protocol section with all four actions", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("<plan_update_protocol>");
    expect(prompt).toContain("insert");
    expect(prompt).toContain("replace");
    expect(prompt).toContain("remove");
    expect(prompt).toContain("replace_step");
  });

  it("includes the REFLECT trigger guidance", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("<reflect_trigger>");
    expect(prompt).toContain("2 consecutive ASSERTION_FAILED envelopes");
    expect(prompt).toContain("REFLECT");
  });

  it("lists every failure category", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("budget-violation");
    expect(prompt).toContain("regression");
    expect(prompt).toContain("resource-blocker");
    expect(prompt).toContain("memory-leak");
    expect(prompt).toContain("abort");
  });

  it("lists every failure domain", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt).toContain("design");
    expect(prompt).toContain("responsive");
    expect(prompt).toContain("perf");
    expect(prompt).toContain("a11y");
    expect(prompt).toContain("other");
  });

  it("emits at most 80 non-blank lines", () => {
    const prompt = buildLocalAgentSystemPrompt();
    const nonBlank = prompt.split("\n").filter((line) => line.trim().length > 0);
    expect(nonBlank.length).toBeLessThanOrEqual(80);
  });

  it("fits a small-model context budget (<= 4 KB)", () => {
    const prompt = buildLocalAgentSystemPrompt();
    expect(prompt.length).toBeLessThanOrEqual(4 * 1024);
  });

  it("golden snapshot — output is stable across invocations", () => {
    expect(buildLocalAgentSystemPrompt()).toBe(buildLocalAgentSystemPrompt());
  });
});

describe("buildLocalAgentSystemPrompt + buildExecutionSystemPrompt — protocol convergence", () => {
  // Per PRD §R2: both prompts must teach the same THOUGHT / PLAN_UPDATE / REFLECT
  // protocol so frontier model (Gemini, via execution prompt) eval-runner output is
  // shape-comparable to Gemma's (local prompt). Wire format may differ — local emits
  // AgentTurn JSON envelopes, executor uses pipe-delimited markers — but the
  // concepts are unified.

  it("both prompts teach the THOUGHT-before-ACTION discipline", () => {
    const localPrompt = buildLocalAgentSystemPrompt();
    const executorPrompt = buildExecutionSystemPrompt();
    expect(localPrompt).toContain("THOUGHT");
    expect(executorPrompt).toContain("THOUGHT");
  });

  it("both prompts document PLAN_UPDATE with the four actions", () => {
    const localPrompt = buildLocalAgentSystemPrompt();
    const executorPrompt = buildExecutionSystemPrompt();
    for (const action of ["insert", "replace", "remove", "replace_step"]) {
      expect(localPrompt).toContain(action);
      expect(executorPrompt).toContain(action);
    }
  });

  it("both prompts document the REFLECT trigger after 2 consecutive same-step failures", () => {
    const localPrompt = buildLocalAgentSystemPrompt();
    const executorPrompt = buildExecutionSystemPrompt();
    expect(localPrompt).toContain("REFLECT");
    expect(localPrompt).toContain("2 consecutive ASSERTION_FAILED");
    expect(executorPrompt).toContain("REFLECT");
    expect(executorPrompt).toContain("2 consecutive ASSERTION_FAILED");
  });

  it("both prompts list the same five failure categories", () => {
    const localPrompt = buildLocalAgentSystemPrompt();
    const executorPrompt = buildExecutionSystemPrompt();
    for (const category of [
      "budget-violation",
      "regression",
      "resource-blocker",
      "memory-leak",
      "abort",
    ]) {
      expect(localPrompt).toContain(category);
      expect(executorPrompt).toContain(category);
    }
  });

  it("both prompts list the same five failure domains", () => {
    const localPrompt = buildLocalAgentSystemPrompt();
    const executorPrompt = buildExecutionSystemPrompt();
    for (const domain of ["design", "responsive", "perf", "a11y", "other"]) {
      expect(localPrompt).toContain(domain);
      expect(executorPrompt).toContain(domain);
    }
  });

  it("both prompts stay under the 80 non-blank-line budget", () => {
    const localNonBlank = buildLocalAgentSystemPrompt()
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
    const executorNonBlank = buildExecutionSystemPrompt()
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
    expect(localNonBlank).toBeLessThanOrEqual(80);
    expect(executorNonBlank).toBeLessThanOrEqual(80);
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
