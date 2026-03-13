# @browser-tester/cookies

Extract cookies from local browsers. Two methods: **SQLite** (reads cookie databases from disk) and **CDP** (launches headless Chrome via DevTools Protocol).

## Install

```bash
pnpm add @browser-tester/cookies
```

## SQLite Extraction

Reads cookies directly from browser SQLite databases. Requires keychain/DPAPI access on macOS/Windows.

```ts
import { extractCookies } from "@browser-tester/cookies";

const { cookies, warnings } = await extractCookies({
  url: "https://github.com",
  browsers: ["chrome", "firefox"], // optional, defaults to chrome/brave/edge/arc/firefox/safari
  names: ["session"], // optional, filter by cookie name
  includeExpired: false, // optional, default false
  timeoutMs: 5000, // optional, keychain command timeout
});
```

### Supported browsers

`chrome` `edge` `brave` `arc` `dia` `helium` `chromium` `vivaldi` `opera` `ghost` `sidekick` `yandex` `iridium` `thorium` `sigmaos` `wavebox` `comet` `blisk` `firefox` `safari`

### Per-browser extraction

```ts
import {
  extractChromiumCookies,
  extractFirefoxCookies,
  extractSafariCookies,
} from "@browser-tester/cookies";

const result = await extractChromiumCookies("chrome", ["github.com"], { names: ["session"] });
const firefox = await extractFirefoxCookies(["github.com"]);
const safari = await extractSafariCookies(["github.com"]);
```

## CDP Extraction

Launches a headless browser with a copied profile, extracts cookies via `Network.getAllCookies`. No keychain popup -- Chrome decrypts its own cookies.

```ts
import { detectBrowserProfiles, extractProfileCookies } from "@browser-tester/cookies";

const profiles = detectBrowserProfiles();
// [{ profileName: "Default", displayName: "Person 1", browser: { name: "Google Chrome", ... }, ... }]

const { cookies, warnings } = await extractProfileCookies({
  profile: profiles[0],
  port: 9222, // optional, CDP debugging port
});
```

### Extract from all profiles

```ts
import { detectBrowserProfiles, extractAllProfileCookies } from "@browser-tester/cookies";

const profiles = detectBrowserProfiles();
const { cookies, warnings } = await extractAllProfileCookies(profiles);
```

## CookieJar

Utility for matching, converting, and serializing cookies.

```ts
import { CookieJar } from "@browser-tester/cookies";

const jar = new CookieJar(cookies);

jar.match("https://github.com/settings"); // Cookie[] matching domain/path/secure/expiry
jar.toCookieHeader("https://github.com"); // "name=value; name2=value2"
jar.toPlaywright(); // PlaywrightCookie[] (sameSite defaults to "Lax")
jar.toPuppeteer(); // PuppeteerCookie[]
jar.toJSON(); // serialized string
CookieJar.fromJSON(json); // deserialize
```

## `toCookieHeader`

Format a cookie array as a `Cookie` header string without URL matching.

```ts
import { toCookieHeader } from "@browser-tester/cookies";

toCookieHeader(cookies); // "name=value; name2=value2"
```

## Types

```ts
interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number; // unix seconds, undefined = session
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  browser: Browser;
}

interface ExtractOptions {
  url: string;
  browsers?: Browser[];
  names?: string[];
  includeExpired?: boolean;
  timeoutMs?: number;
}

interface ExtractResult {
  cookies: Cookie[];
  warnings: string[];
}

interface BrowserProfile {
  profileName: string; // directory name ("Default", "Profile 1")
  profilePath: string; // absolute path to profile directory
  displayName: string; // human-readable name from Local State
  browser: BrowserInfo;
}

interface BrowserInfo {
  name: string; // display name ("Google Chrome", "Arc")
  executablePath: string;
}

interface ExtractProfileOptions {
  profile: BrowserProfile;
  port?: number; // CDP port, default 9222
}
```

## SQLite vs CDP

|                            | SQLite                   | CDP                       |
| -------------------------- | ------------------------ | ------------------------- |
| Speed                      | Fast (no browser launch) | ~3s startup               |
| Keychain popup (macOS)     | Yes                      | No                        |
| Firewall popup (macOS)     | No                       | Once (remembered)         |
| Firefox/Safari             | Yes                      | No (Chromium only)        |
| Requires browser installed | No (reads DB files)      | Yes (launches executable) |
| Cookie decryption          | Manual (keychain/DPAPI)  | Chrome handles it         |
