export { Cookies } from "./cookies.js";
export { Browsers } from "./browser-detector.js";
export { CdpClient } from "./cdp-client.js";
export { SqliteClient, SqliteEngine } from "./sqlite-client.js";
export { ChromiumSource, ChromiumPlatform } from "./chromium.js";
export { FirefoxSource, FirefoxPlatform } from "./firefox.js";
export { SafariSource, SafariPlatform } from "./safari.js";
export { layerLive } from "./layers.js";

export {
  ExtractionError,
  RequiresFullDiskAccess,
  ListBrowsersError,
  CookieDatabaseNotFoundError,
  CookieDatabaseCopyError,
  CookieDecryptionKeyError,
  CookieReadError,
  BinaryParseError,
  CdpConnectionError,
  BrowserSpawnError,
  UnsupportedPlatformError,
  UnsupportedBrowserError,
  UnknownError,
} from "./errors.js";

export { BROWSER_CONFIGS, configByKey } from "./browser-config.js";

export {
  BrowserKey,
  ChromiumBrowserKey,
  ChromiumBrowser,
  FirefoxBrowser,
  SafariBrowser,
  Browser,
  Cookie,
  SameSitePolicy,
} from "./types.js";

export type { ExtractOptions } from "./types.js";
