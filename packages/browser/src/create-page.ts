import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { HEADLESS_CHROMIUM_ARGS } from "./constants";
import { injectCookies } from "./inject-cookies";
import type { CreatePageOptions, CreatePageResult } from "./types";

export const createPage = async (
  url: string,
  options: CreatePageOptions = {},
): Promise<CreatePageResult> => {
  const browser = await chromium.launch({
    headless: !options.headed,
    executablePath: options.executablePath,
    args: HEADLESS_CHROMIUM_ARGS,
  });
  const context = await browser.newContext();

  if (options.cookiesFile) {
    const cookies = JSON.parse(readFileSync(options.cookiesFile, "utf-8"));
    await context.addCookies(cookies);
  } else if (options.cookies) {
    await injectCookies(context, { url, browsers: options.cookieBrowsers });
  }

  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });

  return { browser, context, page };
};
