import { exec } from "node:child_process";
import { detectAvailableAgents } from "@expect/agent";
import figures from "figures";
import pc from "picocolors";
import { VERSION } from "../constants";
import { highlighter } from "../utils/highlighter";
import { logger } from "../utils/logger";
import { prompts } from "../utils/prompts";
import { spinner } from "../utils/spinner";
import { isRunningInAgent } from "../utils/is-running-in-agent";
import { isHeadless } from "../utils/is-headless";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "vp";

const GLOBAL_INSTALL_COMMANDS: Record<PackageManager, string> = {
  npm: "npm install -g expect-cli@latest",
  pnpm: "pnpm add -g expect-cli@latest",
  yarn: "yarn global add expect-cli@latest",
  bun: "bun add -g expect-cli@latest",
  vp: "vp install -g expect-cli@latest",
};

const SKILL_COMMANDS: Record<PackageManager, string> = {
  npm: "npx -y skills add https://github.com/millionco/expect --skill expect",
  pnpm: "pnpm dlx skills add https://github.com/millionco/expect --skill expect",
  yarn: "npx -y skills add https://github.com/millionco/expect --skill expect",
  bun: "bunx skills add https://github.com/millionco/expect --skill expect",
  vp: "npx -y skills add https://github.com/millionco/expect --skill expect",
};

export { detectAvailableAgents };

export const detectPackageManager = (): PackageManager => {
  if (process.env.VITE_PLUS_CLI_BIN) return "vp";

  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.startsWith("pnpm")) return "pnpm";
    if (userAgent.startsWith("yarn")) return "yarn";
    if (userAgent.startsWith("bun")) return "bun";
    if (userAgent.startsWith("npm")) return "npm";
  }
  return "npm";
};

const detectNonInteractive = (yesFlag: boolean): boolean =>
  yesFlag || isRunningInAgent() || isHeadless();

const INSTALL_TIMEOUT_MS = 10_000;

const tryRun = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = exec(command, { timeout: INSTALL_TIMEOUT_MS }, (error) => {
      resolve(Boolean(!error));
    });
    child.stdin?.end();
  });

interface InitOptions {
  yes?: boolean;
}

export const runInit = async (options: InitOptions = {}) => {
  const nonInteractive = detectNonInteractive(options.yes ?? false);
  const packageManager = detectPackageManager();
  const installCommand = GLOBAL_INSTALL_COMMANDS[packageManager];

  logger.break();
  logger.log(
    `  ${pc.red(figures.cross)}${pc.green(figures.tick)} ${pc.bold("Expect")} ${highlighter.dim(`v${VERSION}`)}`,
  );
  logger.dim("  Let agents test your code in a real browser.");
  logger.break();

  const availableAgents = detectAvailableAgents();

  if (availableAgents.length === 0) {
    logger.error(
      "No supported coding agent found. expect requires one of: Claude Code, Codex, or Cursor.",
    );
    logger.break();
    logger.log(`  Install one to get started:`);
    logger.log(
      `    ${highlighter.info("Claude Code")}  ${highlighter.dim("https://docs.anthropic.com/en/docs/claude-code")}`,
    );
    logger.log(
      `    ${highlighter.info("Codex")}        ${highlighter.dim("https://github.com/openai/codex")}`,
    );
    logger.log(`    ${highlighter.info("Cursor")}       ${highlighter.dim("https://cursor.com")}`);
    logger.break();
    process.exit(1);
  }

  const globalSpinner = spinner("Installing expect-cli globally...").start();
  const globalSuccess = await tryRun(installCommand);

  if (globalSuccess) {
    globalSpinner.succeed(
      `Installed! ${highlighter.info("expect-cli")} is now available globally.`,
    );
  } else {
    globalSpinner.fail("Failed to install globally.");
    logger.dim(`  Run manually: ${highlighter.info(installCommand)}`);
  }

  logger.break();

  let installSkill = nonInteractive;

  if (!nonInteractive) {
    const response = await prompts({
      type: "confirm",
      name: "installSkill",
      message: `Install the ${highlighter.info("expect")} skill for your coding agent?`,
      initial: true,
    });
    installSkill = response.installSkill;
  }

  if (installSkill) {
    const skillCommand = SKILL_COMMANDS[packageManager];
    const skillSpinner = spinner("Installing skill...").start();
    const skillSuccess = await tryRun(skillCommand);

    if (skillSuccess) {
      skillSpinner.succeed("Skill installed.");
    } else {
      skillSpinner.fail("Failed to install skill.");
      logger.dim(`  Run manually: ${highlighter.info(skillCommand)}`);
    }
  }

  logger.break();
  logger.success("Setup complete! Here's how to get started:");
  logger.break();
  logger.log(`  1. ${highlighter.info("cd")} into your project directory`);
  logger.log(`  2. Start your dev server (e.g. ${highlighter.dim("npm run dev")})`);
  logger.log(`  3. Run ${highlighter.info("expect-cli")} to open the interactive test runner`);
  logger.break();
  logger.log(`  Or run headlessly from your coding agent:`);
  logger.break();
  logger.log(
    `     ${highlighter.dim("$")} ${highlighter.info('expect-cli -m "test the login flow" -y')}`,
  );
  logger.break();
  logger.log(`  Set ${highlighter.info("EXPECT_BASE_URL")} if your app is not on localhost:3000:`);
  logger.break();
  logger.log(
    `     ${highlighter.dim("$")} ${highlighter.info('EXPECT_BASE_URL=http://localhost:5173 expect-cli -m "test the homepage" -y')}`,
  );
  logger.break();
};
