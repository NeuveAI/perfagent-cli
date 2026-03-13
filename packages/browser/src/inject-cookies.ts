import {
  CookieJar,
  extractCookies,
  extractProfileCookies,
} from "@browser-tester/cookies";
import type { Cookie } from "@browser-tester/cookies";
import type { BrowserContext } from "playwright";
import type { InjectCookiesOptions } from "./types";

const resolveCookies = async (options: InjectCookiesOptions): Promise<Cookie[]> => {
  if (options.cookies) return options.cookies;

  if (options.profile) {
    const { cookies } = await extractProfileCookies({
      profile: options.profile,
      port: options.port,
    });
    return cookies;
  }

  if (!options.url) {
    throw new Error("url is required for SQLite cookie extraction");
  }

  const { cookies } = await extractCookies({
    url: options.url,
    browsers: options.browsers,
    names: options.names,
    includeExpired: options.includeExpired,
    timeoutMs: options.timeoutMs,
  });
  return cookies;
};

export const injectCookies = async (
  context: BrowserContext,
  options: InjectCookiesOptions,
): Promise<void> => {
  const cookies = await resolveCookies(options);
  const jar = new CookieJar(cookies);
  await context.addCookies(jar.toPlaywright());
};
