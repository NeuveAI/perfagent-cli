import { getEpochSeconds } from "@browser-tester/utils";
import { SESSION_EXPIRES } from "./constants.js";
import type { Cookie, SameSitePolicy } from "./types.js";
import { toCookieHeader } from "./utils/format-cookie-header.js";
import { hostMatchesCookieDomain } from "./utils/host-matching.js";

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSitePolicy;
}

export interface PuppeteerCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: SameSitePolicy;
}

const ensureDotPrefix = (domain: string): string =>
  domain.startsWith(".") ? domain : `.${domain}`;

const resolveCookieDomain = (cookie: Cookie): string =>
  cookie.name.startsWith("__Host-")
    ? cookie.domain.replace(/^\./, "")
    : ensureDotPrefix(cookie.domain);

const toBaseCookie = (cookie: Cookie) => ({
  name: cookie.name,
  value: cookie.value,
  domain: resolveCookieDomain(cookie),
  path: cookie.path,
  expires: cookie.expires ?? SESSION_EXPIRES,
  secure: cookie.secure,
  httpOnly: cookie.httpOnly,
});

export const matchCookies = (cookies: Cookie[], url: string): Cookie[] => {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const pathname = parsed.pathname || "/";
  const currentTime = getEpochSeconds();

  return cookies.filter((cookie) => {
    if (!hostMatchesCookieDomain(host, cookie.domain)) return false;
    if (!pathname.startsWith(cookie.path)) return false;
    if (cookie.secure && parsed.protocol !== "https:") return false;
    if (cookie.expires && cookie.expires < currentTime) return false;
    return true;
  });
};

export const matchCookieHeader = (cookies: Cookie[], url: string): string =>
  toCookieHeader(matchCookies(cookies, url));

export const toPlaywrightCookies = (cookies: Cookie[]): PlaywrightCookie[] =>
  cookies.map((cookie) => ({
    ...toBaseCookie(cookie),
    sameSite: cookie.sameSite ?? "Lax",
  }));

export const toPuppeteerCookies = (cookies: Cookie[]): PuppeteerCookie[] =>
  cookies.map((cookie) => ({
    ...toBaseCookie(cookie),
    sameSite: cookie.sameSite,
  }));
