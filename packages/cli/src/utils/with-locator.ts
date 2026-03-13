import { interact } from "@browser-tester/browser";
import type { Locator } from "playwright";
import { logger } from "./logger";
import type { SharedOptions } from "./shared-options";
import { withPage } from "./with-page";

export const withLocator = async (
  url: string,
  ref: string,
  options: SharedOptions,
  action: (locator: Locator) => Promise<void>,
) => {
  await withPage(url, options, async (page) => {
    const result = await interact(page, ref, action, { timeout: options.timeout });
    logger.log(result.tree);
  });
};
