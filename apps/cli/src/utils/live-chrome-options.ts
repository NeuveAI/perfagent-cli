import { Command, InvalidArgumentError } from "commander";
import type { BrowserEnvironmentHints } from "@browser-tester/orchestrator";

interface LiveChromeCliOptions {
  liveChrome?: boolean;
  cdpEndpoint?: string;
  attachTab?: boolean;
  newTab?: boolean;
  tabUrl?: string;
  tabTitle?: string;
  tabIndex?: number;
}

const parseTabIndex = (value: string): number => {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new InvalidArgumentError("Tab index must be a non-negative integer.");
  }

  return parsedValue;
};

const hasAttachSelection = (options: LiveChromeCliOptions): boolean =>
  Boolean(
    options.attachTab || options.tabUrl || options.tabTitle || typeof options.tabIndex === "number",
  );

export const addLiveChromeOptions = (command: Command): Command =>
  command
    .option("--live-chrome", "Connect to your existing Chrome session")
    .option(
      "--cdp-endpoint <url>",
      "Use a manual Chrome DevTools Protocol endpoint instead of Chrome's permission prompt flow",
    )
    .option("--attach-tab", "Attach to an existing tab in live Chrome")
    .option("--new-tab", "Open a fresh tab in live Chrome")
    .option("--tab-url <match>", "Attach to a live Chrome tab whose URL includes this text")
    .option("--tab-title <match>", "Attach to a live Chrome tab whose title includes this text")
    .option("--tab-index <number>", "Attach to a live Chrome tab by index", parseTabIndex);

export const resolveLiveChromeEnvironment = (
  options: LiveChromeCliOptions,
): BrowserEnvironmentHints => {
  if (!options.liveChrome) {
    if (options.cdpEndpoint || options.attachTab || options.newTab || hasAttachSelection(options)) {
      throw new Error("Live Chrome flags require --live-chrome.");
    }

    return {};
  }

  if (options.attachTab && options.newTab) {
    throw new Error("Use either --attach-tab or --new-tab, not both.");
  }

  if (
    options.newTab &&
    (options.tabUrl || options.tabTitle || typeof options.tabIndex === "number")
  ) {
    throw new Error("Tab selectors can only be used with attach mode.");
  }

  const liveChromeTabMode = options.attachTab || hasAttachSelection(options) ? "attach" : "new";

  return {
    liveChrome: true,
    liveChromeConnectionMode: options.cdpEndpoint ? "cdp" : "prompt",
    liveChromeCdpEndpoint: options.cdpEndpoint,
    liveChromeTabMode,
    liveChromeTabUrlMatch: liveChromeTabMode === "attach" ? options.tabUrl : undefined,
    liveChromeTabTitleMatch: liveChromeTabMode === "attach" ? options.tabTitle : undefined,
    liveChromeTabIndex: liveChromeTabMode === "attach" ? options.tabIndex : undefined,
  };
};
