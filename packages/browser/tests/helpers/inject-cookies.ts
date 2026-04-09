import type { BrowserContext } from "playwright";
import type { Cookie } from "@neuve/cookies";

export const injectCookies = async (context: BrowserContext, cookies: Cookie[]) => {
  await context.addCookies(cookies.map((cookie) => cookie.playwrightFormat));
};
