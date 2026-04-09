import { detectAvailableAgents, toDisplayName } from "@neuve/agent";
import { highlighter } from "../utils/highlighter";
import { logger } from "../utils/logger";
import { spinner } from "../utils/spinner";
import { resolveProjectRoot } from "../utils/project-root";
import {
  detectInstalledPerfAgentMcpAgents,
  formatPerfAgentMcpInstallSummary,
  formatPerfAgentMcpVersion,
  getSupportedPerfAgentMcpAgents,
  getUnsupportedPerfAgentMcpAgents,
  installPerfAgentMcpForAgents,
  type McpInstallScope,
} from "../mcp/install-perf-agent-mcp";

export const runUpdateCommand = async (version?: string) => {
  const availableAgents = detectAvailableAgents();
  const supportedMcpAgents = getSupportedPerfAgentMcpAgents(availableAgents);
  const unsupportedMcpAgents = getUnsupportedPerfAgentMcpAgents(availableAgents);
  const versionLabel = formatPerfAgentMcpVersion(version);

  if (supportedMcpAgents.length === 0) {
    logger.break();
    logger.error(
      "No supported coding agent found for Perf Agent MCP. Perf Agent MCP currently supports Claude Code, Codex, GitHub Copilot, Gemini CLI, Cursor, OpenCode, and Pi.",
    );
    process.exitCode = 1;
    return;
  }

  if (unsupportedMcpAgents.length > 0) {
    logger.break();
    logger.warn(`  Skipping MCP update for ${unsupportedMcpAgents.map(toDisplayName).join(", ")}.`);
  }

  const projectRoot = await resolveProjectRoot();
  const summaries = [];
  const scopes: readonly McpInstallScope[] = ["global", "project"];
  let foundInstalledConfig = false;

  logger.break();
  const updateSpinner = spinner(`Updating Perf Agent MCP to ${versionLabel}...`).start();

  for (const scope of scopes) {
    const installedAgents = detectInstalledPerfAgentMcpAgents(projectRoot, supportedMcpAgents, scope);
    if (installedAgents.length === 0) continue;
    foundInstalledConfig = true;
    summaries.push(
      installPerfAgentMcpForAgents(projectRoot, installedAgents, {
        scope,
        version,
      }),
    );
  }

  if (!foundInstalledConfig) {
    summaries.push(
      installPerfAgentMcpForAgents(projectRoot, supportedMcpAgents, {
        scope: "global",
        version,
      }),
    );
  }

  const allSelected = summaries.flatMap((summary) => summary.selectedAgents);
  const allFailed = summaries.flatMap((summary) => summary.failed);

  if (allSelected.length > 0 && allFailed.length === allSelected.length) {
    updateSpinner.fail(`Failed to update Perf Agent MCP to ${versionLabel}.`);
    for (const failure of allFailed) {
      logger.warn(`  ${toDisplayName(failure.agent)}: ${failure.reason}`);
    }
    logger.dim(
      `  Re-run ${highlighter.info("perf-agent init")} to recreate the global or project MCP config if needed.`,
    );
    process.exitCode = 1;
    return;
  }

  updateSpinner.succeed(summaries.map(formatPerfAgentMcpInstallSummary).join(" "));

  if (!foundInstalledConfig) {
    logger.dim(
      "  No existing Perf Agent MCP config was found, so it was installed globally for detected agents.",
    );
  }

  for (const failure of allFailed) {
    logger.warn(`  ${toDisplayName(failure.agent)}: ${failure.reason}`);
  }
};
