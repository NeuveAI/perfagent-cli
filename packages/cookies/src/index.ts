export { Cookies } from "./cookies.js";
export { ChromiumExtractor } from "./chromium-extractor.js";
export { FirefoxExtractor } from "./firefox-extractor.js";
export { SafariExtractor } from "./safari-extractor.js";
export { BrowserDetector, type DetectBrowserProfilesOptions } from "./browser-detector.js";
export { CdpClient } from "./cdp-client.js";
export { SqliteClient } from "./sqlite-client.js";

export {
  matchCookies,
  matchCookieHeader,
  toPlaywrightCookies,
  toPuppeteerCookies,
  type PlaywrightCookie,
  type PuppeteerCookie,
} from "./utils/cookie-format.js";
export { toCookieHeader, dedupeCookies } from "./utils/host-matching.js";

export {
  CookieDatabaseNotFoundError,
  CookieDatabaseCopyError,
  CookieDecryptionKeyError,
  CookieReadError,
  BinaryParseError,
  CdpConnectionError,
  BrowserSpawnError,
  UnsupportedPlatformError,
  UnsupportedBrowserError,
} from "./errors.js";

export { BROWSER_CONFIGS, configByKey } from "./browser-config.js";

export type {
  Browser,
  BrowserInfo,
  BrowserProfile,
  ChromiumBrowser,
  Cookie,
  ExtractOptions,
  ExtractProfileOptions,
  SameSitePolicy,
} from "./types.js";
