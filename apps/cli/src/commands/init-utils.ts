import { spawn } from "node:child_process";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { type SupportedAgent, toSkillsCliName } from "@expect/agent";
import { Effect } from "effect";
import { GIT_REMOTE_TIMEOUT_MS } from "../constants";
import { isRunningInAgent } from "../utils/is-running-in-agent";
import { isHeadless } from "../utils/is-headless";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "vp";

const SKILL_RUNNERS: Record<PackageManager, string> = {
  npm: "npx -y skills",
  pnpm: "pnpm dlx skills",
  yarn: "npx -y skills",
  bun: "bunx skills",
  vp: "npx -y skills",
};

const SKILL_SOURCE = "https://github.com/millionco/expect";

export const buildSkillCommand = (
  packageManager: PackageManager,
  agents: readonly SupportedAgent[],
): string => {
  const runner = SKILL_RUNNERS[packageManager];
  const agentFlags = agents.map(toSkillsCliName).join(" ");
  return `${runner} add ${SKILL_SOURCE} --skill expect --agent ${agentFlags} -y`;
};

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

export const detectNonInteractive = (yesFlag: boolean): boolean =>
  yesFlag || isRunningInAgent() || isHeadless();

export const hasGitHubRemote = Effect.tryPromise({
  try: () =>
    new Promise<string>((resolve, reject) => {
      const child = spawn("git", ["remote", "-v"], { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`git remote exited with ${code}`));
      });
      child.on("error", reject);
    }),
  catch: () => new Error("Failed to detect git remote"),
}).pipe(
  Effect.map((stdout) => stdout.includes("github.com")),
  Effect.timeout(GIT_REMOTE_TIMEOUT_MS),
  Effect.orElseSucceed(() => false),
);

const INSTALL_TIMEOUT_MS = 60_000;

export const tryRun = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: "ignore",
      timeout: INSTALL_TIMEOUT_MS,
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });

export const removeSkillsLock = () => {
  try {
    unlinkSync(join(process.cwd(), "skills-lock.json"));
  } catch {}
};
