import { describe, expect, it } from "vitest";
import {
  BROWSER_TESTER_LIVE_CHROME_CDP_ENDPOINT_ENV_NAME,
  BROWSER_TESTER_LIVE_CHROME_ENV_NAME,
  BROWSER_TESTER_LIVE_CHROME_TAB_INDEX_ENV_NAME,
  BROWSER_TESTER_LIVE_CHROME_TAB_MODE_ENV_NAME,
  BROWSER_TESTER_LIVE_CHROME_TAB_TITLE_MATCH_ENV_NAME,
  BROWSER_TESTER_LIVE_CHROME_TAB_URL_MATCH_ENV_NAME,
  BROWSER_TESTER_VIDEO_OUTPUT_ENV_NAME,
  buildBrowserMcpSettings,
  buildBrowserMcpServerEnv,
} from "../src/browser-mcp-config.js";

describe("buildBrowserMcpServerEnv", () => {
  it("returns undefined when no server defaults are needed", () => {
    expect(buildBrowserMcpServerEnv({})).toBeUndefined();
  });

  it("includes live Chrome defaults and video output when configured", () => {
    expect(
      buildBrowserMcpServerEnv({
        environment: {
          liveChrome: true,
          liveChromeConnectionMode: "cdp",
          liveChromeCdpEndpoint: "http://127.0.0.1:9222",
          liveChromeTabMode: "attach",
          liveChromeTabUrlMatch: "/onboarding",
          liveChromeTabTitleMatch: "Onboarding",
          liveChromeTabIndex: 2,
        },
        videoOutputPath: "/tmp/browser-flow.webm",
      }),
    ).toEqual({
      [BROWSER_TESTER_VIDEO_OUTPUT_ENV_NAME]: "/tmp/browser-flow.webm",
      [BROWSER_TESTER_LIVE_CHROME_ENV_NAME]: "true",
      [BROWSER_TESTER_LIVE_CHROME_CDP_ENDPOINT_ENV_NAME]: "http://127.0.0.1:9222",
      [BROWSER_TESTER_LIVE_CHROME_TAB_MODE_ENV_NAME]: "attach",
      [BROWSER_TESTER_LIVE_CHROME_TAB_URL_MATCH_ENV_NAME]: "/onboarding",
      [BROWSER_TESTER_LIVE_CHROME_TAB_TITLE_MATCH_ENV_NAME]: "Onboarding",
      [BROWSER_TESTER_LIVE_CHROME_TAB_INDEX_ENV_NAME]: "2",
    });
  });

  it("does not inject browser-tester live Chrome env in prompt mode", () => {
    expect(
      buildBrowserMcpServerEnv({
        environment: {
          liveChrome: true,
          liveChromeConnectionMode: "prompt",
          liveChromeTabMode: "new",
        },
      }),
    ).toBeUndefined();
  });
});

describe("buildBrowserMcpSettings", () => {
  it("uses chrome-devtools-mcp autoConnect for prompt-based live Chrome", () => {
    expect(
      buildBrowserMcpSettings({
        environment: {
          liveChrome: true,
          liveChromeConnectionMode: "prompt",
          liveChromeTabMode: "new",
        },
      }).mcpServers?.browser,
    ).toMatchObject({
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["-y", "chrome-devtools-mcp@latest", "--autoConnect"],
    });
  });
});
