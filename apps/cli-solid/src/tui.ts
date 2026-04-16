import { render } from "@opentui/solid";
import { Command } from "commander";
import App from "./app";

const TARGET_FPS = 60;

const launch = async (options: { agent: string; url?: string[] }) => {
  await render(() => App({ agent: options.agent, urls: options.url }), {
    targetFps: TARGET_FPS,
    screenMode: "alternate-screen",
    exitOnCtrlC: true,
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true,
    },
    useMouse: false,
  });
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
  .action(async (opts: { agent: string; url?: string[] }) => {
    await launch(opts);
  });

program.parse();
