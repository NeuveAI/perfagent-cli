export type SameSitePolicy = "Strict" | "Lax" | "None";

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: SameSitePolicy;
  browser: Browser;
}

export type Browser =
  | "chrome"
  | "edge"
  | "brave"
  | "arc"
  | "dia"
  | "helium"
  | "chromium"
  | "vivaldi"
  | "opera"
  | "ghost"
  | "sidekick"
  | "yandex"
  | "iridium"
  | "thorium"
  | "sigmaos"
  | "wavebox"
  | "comet"
  | "blisk"
  | "firefox"
  | "safari";

export type ChromiumBrowser = Exclude<Browser, "firefox" | "safari">;

export interface ExtractOptions {
  url: string;
  browsers?: Browser[];
  names?: string[];
  includeExpired?: boolean;
  timeoutMs?: number;
  onKeychainAccess?: (browser: Browser) => void | Promise<void>;
}

export interface BrowserInfo {
  name: string;
  executablePath: string;
}

export interface BrowserProfile {
  profileName: string;
  profilePath: string;
  displayName: string;
  browser: BrowserInfo;
  locale?: string;
}

export interface LocalStateProfile {
  name: string;
}

export interface ExtractProfileOptions {
  profile: BrowserProfile;
  port?: number;
}
