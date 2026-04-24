import { Effect, Option } from "effect";
import { Command } from "commander";
import { ChangesFor } from "@neuve/supervisor";
import { runHeadless } from "./utils/run-test";
import { runInit } from "./commands/init";
import { runAddGithubAction } from "./commands/add-github-action";
import { runAddSkill } from "./commands/add-skill";
import { runWatchCommand } from "./commands/watch";
import { runUpdateCommand } from "./commands/update";
import { isRunningInAgent } from "@neuve/shared/launched-from";
import { resolveAgentProvider } from "@neuve/shared/infer-agent";
import { isHeadless } from "./utils/is-headless";
import { type AgentBackend, detectAvailableAgents } from "@neuve/agent";
import { useNavigationStore, Screen } from "./stores/use-navigation";
import { usePreferencesStore } from "./stores/use-preferences";
import { resolveChangesFor } from "./utils/resolve-changes-for";
import { renderApp } from "./program";
import { CI_EXECUTION_TIMEOUT_MS, VERSION, VERSION_API_URL } from "./constants";
import { prompts } from "./utils/prompts";
import { highlighter } from "./utils/highlighter";
import { logger } from "./utils/logger";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  formatSkillVersion,
  getPerfAgentSkillStatus,
  hasInstalledPerfAgentSkill,
} from "./utils/perf-agent-skill";
import {
  type BrowserMode,
  isValidBrowserMode,
  readProjectPreference,
} from "./utils/project-preferences-io";
import { resolveProjectRoot } from "./utils/project-root";
import { callTool, killDaemon, printToolResult } from "./utils/browser-client";

try {
  fetch(`${VERSION_API_URL}?source=cli&t=${Date.now()}`).catch(() => {});
} catch {}

const lazyBrowserMode = (() => {
  let cached: BrowserMode | undefined;
  let resolved = false;
  return async () => {
    if (!resolved) {
      const value = readProjectPreference(await resolveProjectRoot(), "browserMode");
      cached = isValidBrowserMode(value) ? value : undefined;
      resolved = true;
    }
    return cached;
  };
})();

const DEFAULT_INSTRUCTION = "Analyze the performance impact of all changes from main.";

type Target = "unstaged" | "branch" | "changes";

const TARGETS: readonly Target[] = ["unstaged", "branch", "changes"];

type OutputFormat = "text" | "json";

interface CommanderOpts {
  message?: string;
  flow?: string;
  yes?: boolean;
  agent?: AgentBackend;
  target?: Target;
  verbose?: boolean;
  browserMode?: string;
  cdp?: string;
  profile?: string;
  noCookies?: boolean;
  ci?: boolean;
  timeout?: number;
  output?: OutputFormat;
  url?: string[];
}

// HACK: when adding or changing options/commands below, update the Options and Commands tables in README.md
const program = new Command()
  .name("perf-agent")
  .description("AI-powered performance analysis for your code changes")
  .version(VERSION, "-v, --version")
  .addHelpText(
    "after",
    `
Examples:
  $ perf-agent tui                                          open interactive TUI
  $ perf-agent tui -m "analyze homepage performance" -y     run immediately
  $ perf-agent tui --browser-mode headless -m "trace LCP"   run headless
  $ perf-agent tui --cdp ws://localhost:9222 -m "trace" -y  connect to existing Chrome via CDP
  $ perf-agent tui --target branch                          analyze all branch changes
  $ perf-agent update                                       update to the latest CLI release
  $ perf-agent tui --no-cookies -m "test" -y                skip system browser cookie extraction
  $ perf-agent tui -u http://localhost:3000 -m "test" -y    specify dev server URL directly
  $ perf-agent watch -m "test the login flow"               watch mode`,
  );

const resolveBrowserMode = async (opts: CommanderOpts) => {
  if (opts.browserMode) {
    if (isValidBrowserMode(opts.browserMode)) return opts.browserMode;
    logger.warn(`  Unknown browser mode "${opts.browserMode}". Expected: headed or headless.`);
  }
  return (await lazyBrowserMode()) ?? "headed";
};

const seedStores = async (opts: CommanderOpts, changesFor: ChangesFor) => {
  const browserMode = await resolveBrowserMode(opts);
  usePreferencesStore.setState({
    verbose: opts.verbose ?? false,
    browserMode,
    browserHeaded: browserMode !== "headless",
    browserProfile: opts.profile,
    cdpUrl: opts.cdp,
  });

  if (opts.message) {
    useNavigationStore.setState({
      screen: Screen.Testing({ changesFor, instruction: opts.message, baseUrls: opts.url }),
    });
  } else {
    useNavigationStore.setState({ screen: Screen.Main() });
  }

  if (opts.url) {
    usePreferencesStore.setState({ cliBaseUrls: opts.url });
  }
};

const runHeadlessForTarget = async (target: Target, opts: CommanderOpts) => {
  const ciMode = opts.ci || isRunningInAgent() || isHeadless();
  const timeoutMs = opts.timeout
    ? Option.some(opts.timeout)
    : ciMode
      ? Option.some(CI_EXECUTION_TIMEOUT_MS)
      : Option.none();

  const { changesFor } = await resolveChangesFor(target);
  const browserMode = await resolveBrowserMode(opts);
  return runHeadless({
    changesFor,
    instruction: opts.message ?? DEFAULT_INSTRUCTION,
    agent: resolveAgentProvider(opts.agent),
    verbose: opts.verbose ?? false,
    headed: opts.browserMode ? browserMode !== "headless" : !ciMode,
    ci: ciMode,
    noCookies: opts.noCookies ?? ciMode,
    timeoutMs,
    output: opts.output ?? "text",
    baseUrl: opts.url?.join(", "),
  });
};

const promptSkillInstall = async () => {
  const agents = detectAvailableAgents();
  const projectRoot = await resolveProjectRoot();
  const skillInstalled = await Effect.runPromise(
    hasInstalledPerfAgentSkill(projectRoot, agents).pipe(Effect.provide(NodeServices.layer)),
  );

  if (!skillInstalled) {
    logger.break();
    const response = await prompts({
      type: "confirm",
      name: "installSkill",
      message: `Install the ${highlighter.info("perf-agent")} skill for your coding agents?`,
      initial: true,
    });

    if (response.installSkill) {
      await runAddSkill({ agents });
      logger.break();
    }
    return;
  }

  const skillStatus = await Effect.runPromise(
    getPerfAgentSkillStatus(projectRoot).pipe(Effect.provide(NodeServices.layer)),
  );

  if (skillStatus.isLatest !== false) return;

  logger.break();
  const installedLabel = formatSkillVersion(skillStatus.installedVersion);
  const latestLabel = formatSkillVersion(skillStatus.latestVersion);
  const response = await prompts({
    type: "confirm",
    name: "updateSkill",
    message: `Update the ${highlighter.info("perf-agent")} skill (${installedLabel} → ${latestLabel})?`,
    initial: true,
  });

  if (response.updateSkill) {
    await runAddSkill({ agents });
    logger.break();
  }
};

const waitForHydration = async () => {
  if (usePreferencesStore.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsub = usePreferencesStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
};

const runInteractiveForTarget = async (target: Target, opts: CommanderOpts) => {
  const { changesFor } = await resolveChangesFor(target);
  await seedStores(opts, changesFor);
  await waitForHydration();
  const persistedAgent = usePreferencesStore.getState().agentBackend;
  renderApp(resolveAgentProvider(opts.agent ?? persistedAgent));
};

program
  .command("init")
  .alias("setup")
  .description("set up the Perf Agent MCP server for your coding agent")
  .option("-y, --yes", "skip confirmation prompts")
  .option("--dry", "skip install steps, only run prompts")
  .option("--headed", "use headed browser mode (launch a browser window)")
  .option("--headless", "use headless browser mode (no visible browser)")
  .addHelpText(
    "after",
    `
Examples:
  $ perf-agent init                     interactive setup
  $ perf-agent init -y                  non-interactive, use defaults
  $ perf-agent init --headed            set browser mode to headed
  $ perf-agent init --headless          set browser mode to headless`,
  )
  .action(async (opts: { yes?: boolean; dry?: boolean; headed?: boolean; headless?: boolean }) => {
    await runInit(opts);
  });

const addCommand = program.command("add").description("add integrations to your project");

addCommand
  .command("github-action")
  .description("add a GitHub Actions workflow that tests every PR in CI")
  .option("-y, --yes", "use defaults without prompting")
  .action(async (opts: { yes?: boolean }) => {
    await runAddGithubAction(opts);
  });

addCommand
  .command("skill")
  .description("install the perf-agent skill for your coding agent")
  .option("-y, --yes", "skip confirmation prompts")
  .action(async (opts: { yes?: boolean }) => {
    const agents = detectAvailableAgents();
    await runAddSkill({ ...opts, agents });
  });

program
  .command("watch")
  .description("watch for file changes and auto-run browser tests")
  .option("-m, --message <instruction>", "natural language instruction for what to test")
  .option(
    "-a, --agent <provider>",
    "agent provider to use (claude, codex, copilot, gemini, cursor, opencode, droid, pi, or local)",
  )
  .option("-t, --target <target>", "what to test: unstaged, branch, or changes", "changes")
  .option("--verbose", "enable verbose logging")
  .option("--browser-mode <mode>", "browser mode: headed or headless")
  .option("--cdp <url>", "connect to an existing Chrome via CDP WebSocket URL")
  .option("--profile <name>", "reuse a Chrome profile by name (e.g. Default)")
  .option("--no-cookies", "skip system browser cookie extraction")
  .option("-u, --url <urls...>", "base URL(s) for the dev server")
  .action(async (opts: CommanderOpts) => {
    await runWatchCommand(opts);
  });

program
  .command("mcp")
  .description("start as a standalone MCP server (stdio transport)")
  .action(async () => {
    const { execFileSync } = await import("node:child_process");
    const mcpBin = new URL("./browser-mcp.js", import.meta.url).pathname;
    execFileSync(process.execPath, [mcpBin], { stdio: "inherit" });
  });

program
  .command("update")
  .description("update the installed Perf Agent MCP server config")
  .argument("[version]", "version or dist-tag to install")
  .action(async (version?: string) => {
    await runUpdateCommand(version);
  });

program
  .command("navigate")
  .description("navigate to a URL in the browser")
  .argument("<url>", "URL to navigate to")
  .action(async (url: string) => {
    const result = await callTool("navigate_page", { url });
    printToolResult(result);
  });

program
  .command("snapshot")
  .description("take an accessibility tree snapshot of the current page")
  .option("--verbose", "include all available a11y tree information")
  .action(async (opts: { verbose?: boolean }) => {
    const result = await callTool("take_snapshot", { verbose: opts.verbose });
    printToolResult(result);
  });

program
  .command("screenshot")
  .description("capture the current page as an image")
  .option("--format <fmt>", "image format: png (default), jpeg, or webp")
  .option("--file <path>", "save screenshot to file")
  .action(async (opts: { format?: string; file?: string }) => {
    const result = await callTool("take_screenshot", {
      format: opts.format,
      filePath: opts.file,
    });
    printToolResult(result);
  });

program
  .command("trace")
  .description("start a performance trace (stops automatically)")
  .option("--no-reload", "skip page reload before tracing")
  .option("--no-auto-stop", "keep recording until manually stopped")
  .option("--file <path>", "save raw trace to file (e.g. trace.json.gz)")
  .action(async (opts: { reload?: boolean; autoStop?: boolean; file?: string }) => {
    const result = await callTool("performance_start_trace", {
      reload: opts.reload,
      autoStop: opts.autoStop,
      filePath: opts.file,
    });
    printToolResult(result);
  });

program
  .command("trace-stop")
  .description("stop the active performance trace")
  .option("--file <path>", "save raw trace to file")
  .action(async (opts: { file?: string }) => {
    const result = await callTool("performance_stop_trace", { filePath: opts.file });
    printToolResult(result);
  });

program
  .command("insight")
  .description("analyze a specific performance insight from a trace")
  .argument("<insightSetId>", "insight set ID from trace results")
  .argument("<insightName>", "insight name (e.g. LCPBreakdown, RenderBlocking)")
  .action(async (insightSetId: string, insightName: string) => {
    const result = await callTool("performance_analyze_insight", { insightSetId, insightName });
    printToolResult(result);
  });

program
  .command("emulate")
  .description("apply CPU/network throttling and device emulation")
  .option("--cpu <rate>", "CPU slowdown factor (1-20)")
  .option("--network <preset>", "network preset: Slow 3G, Fast 3G, Offline")
  .option("--viewport <size>", "viewport as WIDTHxHEIGHT (e.g. 375x812)")
  .action(async (opts: { cpu?: string; network?: string; viewport?: string }) => {
    const result = await callTool("emulate", {
      cpuThrottlingRate: opts.cpu ? Number(opts.cpu) : undefined,
      networkConditions: opts.network,
      viewport: opts.viewport,
    });
    printToolResult(result);
  });

program
  .command("lighthouse")
  .description("run Lighthouse audit (accessibility, SEO, best practices)")
  .option("--mode <mode>", "navigation or snapshot (default: navigation)")
  .option("--device <device>", "desktop or mobile (default: desktop)")
  .action(async (opts: { mode?: string; device?: string }) => {
    const result = await callTool("lighthouse_audit", {
      mode: opts.mode,
      device: opts.device,
    });
    printToolResult(result);
  });

program
  .command("close")
  .description("close the browser and stop the daemon")
  .action(async () => {
    const result = await callTool("close");
    printToolResult(result);
    killDaemon();
  });

const tuiCommand = program
  .command("tui")
  .description("open the interactive testing TUI")
  .option("-m, --message <instruction>", "natural language instruction for what to test")
  .option("-f, --flow <slug>", "reuse a saved flow by its slug")
  .option("-y, --yes", "run immediately without confirmation")
  .option(
    "-a, --agent <provider>",
    "agent provider to use (claude, codex, copilot, gemini, cursor, opencode, droid, pi, or local)",
  )
  .option("-t, --target <target>", "what to test: unstaged, branch, or changes", "changes")
  .option("--verbose", "enable verbose logging")
  .option("--browser-mode <mode>", "browser mode: headed or headless")
  .option("--cdp <url>", "connect to an existing Chrome via CDP WebSocket URL")
  .option("--profile <name>", "reuse a Chrome profile by name (e.g. Default)")
  .option("--no-cookies", "skip system browser cookie extraction")
  .option("--ci", "force CI mode: headless, no cookies, auto-yes, 30-minute timeout")
  .option("--timeout <ms>", "execution timeout in milliseconds", (value: string) =>
    parseInt(value, 10),
  )
  .option("--output <format>", "output format: text (default) or json")
  .option("-u, --url <urls...>", "base URL(s) for the dev server (skips port picker)")
  .action(async () => {
    const opts = tuiCommand.opts<CommanderOpts>();

    const target = opts.target ?? "changes";

    if (!TARGETS.includes(target)) {
      tuiCommand.error(`Unknown target: ${target}. Use ${TARGETS.join(", ")}.`);
    }

    if (opts.ci || isRunningInAgent() || isHeadless()) return runHeadlessForTarget(target, opts);

    await promptSkillInstall();

    const hasDirectOptions = Boolean(opts.message || opts.flow || opts.yes);

    if (hasDirectOptions) {
      await runInteractiveForTarget(target, opts);
    } else {
      const browserMode = await resolveBrowserMode(opts);
      usePreferencesStore.setState({
        verbose: opts.verbose ?? false,
        browserMode,
        browserHeaded: browserMode !== "headless",
        browserProfile: opts.profile,
      });
      if (opts.url) {
        usePreferencesStore.setState({ cliBaseUrls: opts.url });
      }
      await waitForHydration();
      const persistedAgent = usePreferencesStore.getState().agentBackend;
      renderApp(resolveAgentProvider(opts.agent ?? persistedAgent));
    }
  });

program.action(() => {
  program.outputHelp();
});

program.parse();
