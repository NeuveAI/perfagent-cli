import * as path from "node:path";
import { type SupportedAgent, toSkillDir } from "@neuve/agent";
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { SKILL_FETCH_TIMEOUT_MS } from "../constants";

export const AGENTS_SKILLS_DIR = ".agents/skills";
export const SKILL_NAME = "perf-agent";
const SKILL_REPO = "millionco/perf-agent";
const SKILL_BRANCH = "main";
export const SKILL_SOURCE_DIR = "packages/perf-agent-skill";
export const SKILL_TARBALL_URL = `https://codeload.github.com/${SKILL_REPO}/tar.gz/${SKILL_BRANCH}`;
export const SKILL_RAW_URL = `https://raw.githubusercontent.com/${SKILL_REPO}/${SKILL_BRANCH}/${SKILL_SOURCE_DIR}/SKILL.md`;

export interface PerfAgentSkillStatus {
  installed: boolean;
  isLatest: boolean | undefined;
  installedVersion: string | undefined;
  latestVersion: string | undefined;
}

export class PerfAgentSkillReadError extends Schema.ErrorClass<PerfAgentSkillReadError>(
  "PerfAgentSkillReadError",
)({
  _tag: Schema.tag("PerfAgentSkillReadError"),
  installedSkillPath: Schema.String,
  reason: Schema.String,
}) {
  message = `Failed to read installed perf-agent skill at ${this.installedSkillPath}: ${this.reason}`;
}

export class PerfAgentSkillFetchError extends Schema.ErrorClass<PerfAgentSkillFetchError>(
  "PerfAgentSkillFetchError",
)({
  _tag: Schema.tag("PerfAgentSkillFetchError"),
  url: Schema.String,
  reason: Schema.String,
}) {
  message = `Failed to fetch latest perf-agent skill from ${this.url}: ${this.reason}`;
}

const SKILL_VERSION_PATTERN = /^ {2}version:\s*"([^"]+)"/m;

const readSkillVersion = (content: string | undefined): string | undefined => {
  if (content === undefined) return undefined;
  return content.match(SKILL_VERSION_PATTERN)?.[1];
};

export const formatSkillVersion = (version: string | undefined): string =>
  version === undefined ? "unknown version" : `v${version}`;

export const getInstalledSkillFilePath = (projectRoot: string): string =>
  path.join(projectRoot, AGENTS_SKILLS_DIR, SKILL_NAME, "SKILL.md");

export const readInstalledSkill = Effect.fn("Skill.readInstalledSkill")(function* (
  projectRoot: string,
) {
  const fileSystem = yield* FileSystem;
  const installedSkillPath = getInstalledSkillFilePath(projectRoot);

  return yield* fileSystem.readFileString(installedSkillPath).pipe(
    Effect.map((content): string | undefined => content),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
    Effect.catchTag("PlatformError", (cause) =>
      new PerfAgentSkillReadError({
        installedSkillPath,
        reason: cause.message,
      }).asEffect(),
    ),
  );
});

export const fetchLatestSkill = Effect.fn("Skill.fetchLatestSkill")(function* () {
  const response: Response = yield* Effect.tryPromise({
    try: () => fetch(SKILL_RAW_URL, { cache: "no-store" }),
    catch: (cause) =>
      new PerfAgentSkillFetchError({
        url: SKILL_RAW_URL,
        reason: String(cause),
      }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: SKILL_FETCH_TIMEOUT_MS,
      onTimeout: () =>
        new PerfAgentSkillFetchError({
          url: SKILL_RAW_URL,
          reason: "request timed out",
        }).asEffect(),
    }),
  );

  if (!response.ok) {
    return yield* new PerfAgentSkillFetchError({
      url: SKILL_RAW_URL,
      reason: `GitHub returned ${response.status}`,
    });
  }

  return yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new PerfAgentSkillFetchError({
        url: SKILL_RAW_URL,
        reason: String(cause),
      }),
  });
});

export const getPerfAgentSkillStatus = Effect.fn("Skill.getPerfAgentSkillStatus")(function* (
  projectRoot: string,
) {
  yield* Effect.annotateCurrentSpan({ projectRoot });

  const installedSkill = yield* readInstalledSkill(projectRoot).pipe(
    Effect.catchTag("PerfAgentSkillReadError", () => Effect.succeed(undefined)),
  );

  const latestSkill = yield* fetchLatestSkill().pipe(
    Effect.catchTag("PerfAgentSkillFetchError", () => Effect.succeed(undefined)),
  );

  return {
    installed: installedSkill !== undefined,
    isLatest:
      installedSkill !== undefined && latestSkill !== undefined
        ? installedSkill === latestSkill
        : undefined,
    installedVersion: readSkillVersion(installedSkill),
    latestVersion: readSkillVersion(latestSkill),
  };
});

export const detectInstalledSkillAgents = Effect.fn("Skill.detectInstalledSkillAgents")(function* (
  projectRoot: string,
  agents: readonly SupportedAgent[],
) {
  const fileSystem = yield* FileSystem;
  const results: SupportedAgent[] = [];
  for (const agent of agents) {
    const skillPath = path.join(projectRoot, toSkillDir(agent), SKILL_NAME);
    const exists = yield* fileSystem.access(skillPath).pipe(
      Effect.as(true),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
      Effect.catchTag("PlatformError", () => Effect.succeed(false)),
    );
    if (exists) results.push(agent);
  }
  return results;
});

export const hasInstalledPerfAgentSkill = Effect.fn("Skill.hasInstalledPerfAgentSkill")(function* (
  projectRoot: string,
  agents: readonly SupportedAgent[],
) {
  const fileSystem = yield* FileSystem;
  const skillFilePath = getInstalledSkillFilePath(projectRoot);
  const mainSkillExists = yield* fileSystem.access(skillFilePath).pipe(
    Effect.as(true),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
    Effect.catchTag("PlatformError", () => Effect.succeed(false)),
  );
  if (mainSkillExists) return true;
  const installedAgents = yield* detectInstalledSkillAgents(projectRoot, agents);
  return installedAgents.length > 0;
});
