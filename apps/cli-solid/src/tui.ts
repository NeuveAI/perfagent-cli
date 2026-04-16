import { render } from "@opentui/solid";
import { Command } from "commander";
import App from "./app";

const TARGET_FPS = 60;

const program = new Command()
  .option(
    "-a, --agent <provider>",
    "agent provider to use (claude, codex, copilot, gemini, cursor, opencode, droid, pi, or local)",
    "claude",
  )
  .parse();

const options = program.opts<{ agent: string }>();

await render(() => App({ agent: options.agent }), {
  targetFps: TARGET_FPS,
  screenMode: "alternate-screen",
  exitOnCtrlC: true,
  useKittyKeyboard: {
    disambiguate: true,
    alternateKeys: true,
  },
  useMouse: false,
});
