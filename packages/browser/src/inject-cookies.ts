import type { Cookie } from "@browser-tester/cookies";
import type { BrowserContext } from "playwright";

export const injectCookies = async (
  context: BrowserContext,
  cookies: readonly Cookie[]
): Promise<void> => {
  await context.addCookies(cookies.map((cookie) => cookie.playwrightFormat));
};
