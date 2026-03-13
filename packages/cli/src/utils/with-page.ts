import { createPage } from "@browser-tester/browser";
import type { Page } from "playwright";
import { handleError } from "./handle-error";
import type { SharedOptions } from "./shared-options";

export const withPage = async (
  url: string,
  options: SharedOptions,
  action: (page: Page) => Promise<void>,
) => {
  const { browser, page } = await createPage(url, options);
  try {
    await action(page);
  } catch (error) {
    handleError(error);
  }
  await browser.close();
};
