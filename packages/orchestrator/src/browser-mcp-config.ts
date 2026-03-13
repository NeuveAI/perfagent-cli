import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DEFAULT_BROWSER_MCP_SERVER_NAME } from "./constants.js";
import type { AgentProviderSettings, McpServerConfig } from "@browser-tester/agent";
import type { BrowserEnvironmentHints } from "./types.js";

const require = createRequire(join(process.cwd(), "package.json"));
const CHROME_DEVTOOLS_MCP_PACKAGE_NAME = "chrome-devtools-mcp@latest";

export const BROWSER_TESTER_VIDEO_OUTPUT_ENV_NAME = "BROWSER_TESTER_VIDEO_OUTPUT_PATH";
export const BROWSER_TESTER_LIVE_CHROME_ENV_NAME = "BROWSER_TESTER_LIVE_CHROME";
export const BROWSER_TESTER_LIVE_CHROME_CDP_ENDPOINT_ENV_NAME =
  "BROWSER_TESTER_LIVE_CHROME_CDP_ENDPOINT";
export const BROWSER_TESTER_LIVE_CHROME_TAB_MODE_ENV_NAME = "BROWSER_TESTER_LIVE_CHROME_TAB_MODE";
export const BROWSER_TESTER_LIVE_CHROME_TAB_URL_MATCH_ENV_NAME =
  "BROWSER_TESTER_LIVE_CHROME_TAB_URL_MATCH";
export const BROWSER_TESTER_LIVE_CHROME_TAB_TITLE_MATCH_ENV_NAME =
  "BROWSER_TESTER_LIVE_CHROME_TAB_TITLE_MATCH";
export const BROWSER_TESTER_LIVE_CHROME_TAB_INDEX_ENV_NAME = "BROWSER_TESTER_LIVE_CHROME_TAB_INDEX";

export const getBrowserMcpEntrypoint = (): string => {
  const mcpPackageEntrypoint = require.resolve("@browser-tester/mcp");
  return join(dirname(mcpPackageEntrypoint), "start.js");
};

const getNpxCommand = (): string => (process.platform === "win32" ? "npx.cmd" : "npx");

export const resolveLiveChromeConnectionMode = (
  environment: BrowserEnvironmentHints | undefined,
): "prompt" | "cdp" | undefined => {
  if (environment?.liveChrome !== true) return undefined;
  if (environment.liveChromeConnectionMode) return environment.liveChromeConnectionMode;
  return environment.liveChromeCdpEndpoint ? "cdp" : "prompt";
};

const addEnvValue = (
  serverEnv: Record<string, string>,
  key: string,
  value: string | number | undefined,
) => {
  if (value === undefined) return;
  serverEnv[key] = String(value);
};

export const buildBrowserMcpServerEnv = (options: {
  environment?: BrowserEnvironmentHints;
  videoOutputPath?: string;
}): Record<string, string> | undefined => {
  const serverEnv: Record<string, string> = {};
  const environment = options.environment;

  addEnvValue(serverEnv, BROWSER_TESTER_VIDEO_OUTPUT_ENV_NAME, options.videoOutputPath);

  if (resolveLiveChromeConnectionMode(environment) === "cdp" && environment) {
    serverEnv[BROWSER_TESTER_LIVE_CHROME_ENV_NAME] = "true";
    addEnvValue(
      serverEnv,
      BROWSER_TESTER_LIVE_CHROME_CDP_ENDPOINT_ENV_NAME,
      environment.liveChromeCdpEndpoint,
    );
    addEnvValue(
      serverEnv,
      BROWSER_TESTER_LIVE_CHROME_TAB_MODE_ENV_NAME,
      environment.liveChromeTabMode,
    );
    addEnvValue(
      serverEnv,
      BROWSER_TESTER_LIVE_CHROME_TAB_URL_MATCH_ENV_NAME,
      environment.liveChromeTabUrlMatch,
    );
    addEnvValue(
      serverEnv,
      BROWSER_TESTER_LIVE_CHROME_TAB_TITLE_MATCH_ENV_NAME,
      environment.liveChromeTabTitleMatch,
    );
    addEnvValue(
      serverEnv,
      BROWSER_TESTER_LIVE_CHROME_TAB_INDEX_ENV_NAME,
      environment.liveChromeTabIndex,
    );
  }

  return Object.keys(serverEnv).length > 0 ? serverEnv : undefined;
};

const buildBrowserTesterMcpServerConfig = (
  serverEnv: Record<string, string> | undefined,
): McpServerConfig => ({
  command: process.execPath,
  args: [getBrowserMcpEntrypoint()],
  ...(serverEnv ? { env: serverEnv } : {}),
});

const buildChromeDevtoolsMcpServerConfig = (): McpServerConfig => ({
  command: getNpxCommand(),
  args: ["-y", CHROME_DEVTOOLS_MCP_PACKAGE_NAME, "--autoConnect"],
});

export const buildBrowserMcpSettings = (options: {
  providerSettings?: AgentProviderSettings;
  browserMcpServerName?: string;
  environment?: BrowserEnvironmentHints;
  videoOutputPath?: string;
}): AgentProviderSettings => {
  const browserMcpServerName =
    options.browserMcpServerName ?? DEFAULT_BROWSER_MCP_SERVER_NAME;
  const serverEnv = buildBrowserMcpServerEnv({
    environment: options.environment,
    videoOutputPath: options.videoOutputPath,
  });
  const existingBrowserServerConfig =
    options.providerSettings?.mcpServers?.[browserMcpServerName];
  const resolvedBrowserServerConfig =
    resolveLiveChromeConnectionMode(options.environment) === "prompt"
      ? buildChromeDevtoolsMcpServerConfig()
      : buildBrowserTesterMcpServerConfig(serverEnv);

  return {
    ...(options.providerSettings ?? {}),
    mcpServers: {
      ...(options.providerSettings?.mcpServers ?? {}),
      [browserMcpServerName]: {
        ...(existingBrowserServerConfig ?? {}),
        ...resolvedBrowserServerConfig,
        ...(existingBrowserServerConfig?.env || resolvedBrowserServerConfig.env
          ? {
              env: {
                ...(existingBrowserServerConfig?.env ?? {}),
                ...(resolvedBrowserServerConfig.env ?? {}),
              },
            }
          : {}),
      },
    },
  };
};
