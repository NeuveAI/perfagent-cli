import * as fs from "node:fs";
import * as path from "node:path";
import { type SupportedAgent, toDisplayName, toSkillDir } from "@neuve/agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { highlighter } from "../utils/highlighter";
import { logger } from "../utils/logger";
import { prompts } from "../utils/prompts";
import { spinner } from "../utils/spinner";
import {
  AGENTS_SKILLS_DIR,
  formatSkillVersion,
  getPerfAgentSkillStatus,
  SKILL_NAME,
} from "../utils/perf-agent-skill";
import { resolveProjectRoot } from "../utils/project-root";
import { detectNonInteractive } from "./init-utils";

declare const __SKILL_CONTENT__: Record<string, string>;

const BUNDLED_SKILL_FILES: Record<string, string> =
  typeof __SKILL_CONTENT__ !== "undefined" ? __SKILL_CONTENT__ : {};

interface AddSkillOptions {
  yes?: boolean;
  agents: readonly SupportedAgent[];
}

const writeBundledSkill = (skillDir: string): boolean => {
  const files = Object.entries(BUNDLED_SKILL_FILES);
  if (files.length === 0) return false;
  fs.mkdirSync(skillDir, { recursive: true });
  for (const [relativePath, content] of files) {
    const destPath = path.join(skillDir, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
  }
  return true;
};

const selectAgents = async (agents: readonly SupportedAgent[], nonInteractive: boolean) => {
  if (nonInteractive) return [...agents];

  if (agents.length === 0) {
    logger.error("No supported coding agents detected on your machine.");
    return [];
  }

  const response = await prompts({
    type: "multiselect",
    name: "agents",
    message: `Install the ${highlighter.info("perf-agent")} skill for:`,
    choices: agents.map((agent) => ({
      title: toDisplayName(agent),
      value: agent,
      selected: true,
    })),
    instructions: false,
  });

  return (response.agents ?? []) as SupportedAgent[];
};

type AgentSkillCopyResult = "copied" | "already-copied" | string;
const RECOVERABLE_SKILL_DIR_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);

const getExistingPathStats = (targetPath: string): fs.Stats | undefined => {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const haveMatchingContents = (sourcePath: string, targetPath: string): boolean => {
  const sourcePathStats = getExistingPathStats(sourcePath);
  const targetPathStats = getExistingPathStats(targetPath);

  if (sourcePathStats === undefined || targetPathStats === undefined) return false;
  if (sourcePathStats.isSymbolicLink() || targetPathStats.isSymbolicLink()) return false;

  if (sourcePathStats.isDirectory() && targetPathStats.isDirectory()) {
    const sourceEntries = fs.readdirSync(sourcePath).sort();
    const targetEntries = fs.readdirSync(targetPath).sort();

    if (sourceEntries.length !== targetEntries.length) return false;

    for (let index = 0; index < sourceEntries.length; index++) {
      if (sourceEntries[index] !== targetEntries[index]) return false;
      if (
        !haveMatchingContents(
          path.join(sourcePath, sourceEntries[index]),
          path.join(targetPath, targetEntries[index]),
        )
      ) {
        return false;
      }
    }

    return true;
  }

  if (sourcePathStats.isFile() && targetPathStats.isFile()) {
    return fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath));
  }

  return false;
};

const isRecoverableSkillDirectory = (targetPath: string): boolean =>
  fs.readdirSync(targetPath).every((entry) => RECOVERABLE_SKILL_DIR_ENTRIES.has(entry));

const copySkillDirectoryContents = (sourceDir: string, targetDir: string) => {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir)) {
    fs.cpSync(path.join(sourceDir, entry), path.join(targetDir, entry), { recursive: true });
  }
};

export const ensureAgentSkillCopy = (
  projectRoot: string,
  agent: SupportedAgent,
): AgentSkillCopyResult => {
  const skillSourceDir = path.join(projectRoot, AGENTS_SKILLS_DIR, SKILL_NAME);
  const agentSkillDir = path.join(projectRoot, toSkillDir(agent));
  const installedSkillDir = path.join(agentSkillDir, SKILL_NAME);
  const installedSkillFilePath = path.join(installedSkillDir, "SKILL.md");

  try {
    const existingPathStats = getExistingPathStats(installedSkillDir);
    if (existingPathStats?.isDirectory()) {
      if (!fs.existsSync(installedSkillFilePath)) {
        if (isRecoverableSkillDirectory(installedSkillDir)) {
          fs.rmSync(installedSkillDir, { recursive: true, force: true });
        } else {
          return `${installedSkillDir} exists and is not a perf-agent skill directory`;
        }
      } else if (haveMatchingContents(skillSourceDir, installedSkillDir)) {
        return "already-copied";
      } else {
        fs.rmSync(installedSkillDir, { recursive: true, force: true });
      }
    } else if (existingPathStats !== undefined) {
      fs.unlinkSync(installedSkillDir);
    }

    fs.mkdirSync(path.dirname(installedSkillDir), { recursive: true });

    // Copying is more reliable than symlinking across agent CLIs and avoids path, permission, and broken-link edge cases.
    copySkillDirectoryContents(skillSourceDir, installedSkillDir);
    if (!fs.existsSync(installedSkillFilePath)) {
      throw new Error("copied skill is missing SKILL.md");
    }
    return "copied";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `Failed to copy skill: ${reason}`;
  }
};

export const runAddSkill = async (options: AddSkillOptions) => {
  const projectRoot = await resolveProjectRoot();
  const nonInteractive = detectNonInteractive(options.yes ?? false);
  const selectedAgents = await selectAgents(options.agents, nonInteractive);
  if (selectedAgents.length === 0) return;

  const skillSpinner = spinner("Installing skill...").start();
  const skillDir = path.join(projectRoot, AGENTS_SKILLS_DIR, SKILL_NAME);
  const skillStatus = await Effect.runPromise(
    getPerfAgentSkillStatus(projectRoot).pipe(Effect.provide(NodeServices.layer)),
  );
  let skillOperation: "installed" | "updated" | "current" | "unverified" = "installed";

  if (skillStatus.installed && skillStatus.isLatest === true) {
    skillSpinner.stop();
    skillOperation = "current";
  } else if (skillStatus.installed && skillStatus.isLatest === undefined) {
    skillSpinner.stop();
    skillOperation = "unverified";
  } else {
    if (skillStatus.installed) {
      skillSpinner.text = "Updating skill...";
      skillOperation = "updated";
    }

    const wrote = writeBundledSkill(skillDir);
    if (!wrote) {
      skillSpinner.fail("Skill files are not bundled with this CLI build.");
      logger.error("Run `pnpm build` in apps/cli to rebundle, or reinstall the CLI.");
      return;
    }
  }

  const results = selectedAgents.map((agent) => ({
    agent,
    result: ensureAgentSkillCopy(projectRoot, agent),
  }));

  const copied = results
    .filter((entry) => entry.result === "copied")
    .map((entry) => toDisplayName(entry.agent));
  const alreadyCopied = results
    .filter((entry) => entry.result === "already-copied")
    .map((entry) => toDisplayName(entry.agent));
  const failed = results.filter(
    (entry) => entry.result !== "copied" && entry.result !== "already-copied",
  );

  for (const { agent, result } of failed) {
    logger.warn(`  ${toDisplayName(agent)}: ${result}`);
  }

  if (copied.length === 0 && alreadyCopied.length === 0 && failed.length > 0) {
    if (skillOperation === "updated") {
      skillSpinner.warn("Skill files were updated, but agent copies could not be created.");
      return;
    }

    if (skillOperation === "installed") {
      skillSpinner.warn("Skill files were installed, but agent copies could not be created.");
      return;
    }

    logger.warn("Skill files are present, but agent copies could not be created.");
    return;
  }

  if (skillOperation === "current") {
    const version = formatSkillVersion(skillStatus.latestVersion ?? skillStatus.installedVersion);
    if (alreadyCopied.length > 0 && copied.length === 0) {
      logger.success(`Skill already installed (${version}) for ${alreadyCopied.join(", ")}.`);
      return;
    }
    if (copied.length > 0) {
      logger.success(`Skill already up to date (${version}). Copied it for ${copied.join(", ")}.`);
      return;
    }
    logger.success(`Skill already installed (${version}).`);
    return;
  }

  if (skillOperation === "unverified") {
    logger.warn("Could not verify whether the installed skill is the latest version.");
    if (alreadyCopied.length > 0 && copied.length === 0) {
      logger.success(`Skill already installed for ${alreadyCopied.join(", ")}.`);
      return;
    }
    if (copied.length > 0) {
      logger.success(`Skill already present. Copied it for ${copied.join(", ")}.`);
      return;
    }
    logger.success("Skill already installed.");
    return;
  }

  if (skillOperation === "updated") {
    if (copied.length > 0 || alreadyCopied.length > 0) {
      skillSpinner.succeed(`Skill updated for ${[...copied, ...alreadyCopied].join(", ")}.`);
      return;
    }
    skillSpinner.succeed("Skill updated.");
    return;
  }

  if (copied.length > 0) {
    skillSpinner.succeed(`Skill installed for ${copied.join(", ")}.`);
  } else if (alreadyCopied.length > 0) {
    skillSpinner.succeed(`Skill installed for ${alreadyCopied.join(", ")}.`);
  } else {
    skillSpinner.succeed("Skill installed.");
  }
};
