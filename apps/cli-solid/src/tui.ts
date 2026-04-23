import { render } from "@opentui/solid";
import { Command } from "commander";
import { parsePlannerMode, type PlannerMode } from "@neuve/supervisor";
import App from "./app";
import { installSignalHandlers } from "./lifecycle/shutdown";

const TARGET_FPS = 60;

const launch = async (options: { agent: string; url?: string[]; planner: PlannerMode }) => {
  installSignalHandlers();

  await render(
    () =>
      App({
        agent: options.agent,
        urls: options.url,
        plannerMode: options.planner,
      }),
    {
      targetFps: TARGET_FPS,
      screenMode: "alternate-screen",
      externalOutputMode: "passthrough",
      exitOnCtrlC: false,
      useKittyKeyboard: {},
      useMouse: false,
    },
  );
};

const program = new Command()
  .name("perf-agent")
  .description("Performance analysis CLI");

program
  .command("tui")
  .description("open the interactive TUI")
  .option(
    "-a, --agent <provider>",
    "agent provider to use (claude, codex, copilot, gemini, cursor, opencode, droid, pi, or local)",
    "claude",
  )
  .option(
    "-u, --url <urls...>",
    "base URL(s) for the dev server — skips port picker",
  )
  .option(
    "-p, --planner <mode>",
    "pre-planner mode: frontier (Gemini Flash 3), template (rule-based), or none",
    "frontier",
  )
  .action(async (opts: { agent: string; url?: string[]; planner: string }) => {
    await launch({ agent: opts.agent, url: opts.url, planner: parsePlannerMode(opts.planner) });
  });

program.parse();
