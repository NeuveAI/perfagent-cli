# @expect/cookies

Extract cookies from local browsers for use in automated testing.

## Install

```bash
pnpm add @expect/cookies
```

## Quick Start

Extract cookies for a URL from your installed browsers:

```ts
import {
  extractCookies,
  matchCookieHeader,
  toPlaywrightCookies,
  toPuppeteerCookies,
} from "@expect/cookies";

const { cookies } = await extractCookies({ url: "https://github.com" });

matchCookieHeader(cookies, "https://github.com"); // "session=abc; user=xyz"
toPlaywrightCookies(cookies); // ready for Playwright's addCookies()
toPuppeteerCookies(cookies); // ready for Puppeteer's setCookie()
```

Extract cookies from a specific browser profile:

```ts
import { detectBrowserProfiles, extractProfileCookies } from "@expect/cookies";

const profiles = detectBrowserProfiles({ browser: "chrome" });
const { cookies } = await extractProfileCookies({ profile: profiles[0] });
```

Detect the system default browser:

```ts
import { detectDefaultBrowser } from "@expect/cookies";

const browser = await detectDefaultBrowser(); // "chrome" | "safari" | ... | null
```

---

## API Reference

### `extractCookies(options)`

Reads cookies from browser SQLite databases on disk. Searches multiple browsers in parallel and deduplicates results.

```ts
const { cookies, warnings } = await extractCookies({
  url: "https://github.com",
  browsers: ["chrome", "firefox"],
  names: ["session"],
  includeExpired: false,
  timeoutMs: 5000,
  onKeychainAccess: async (browser) => {
    console.log(`Requesting credential access for ${browser}...`);
  },
});
```

| Option             | Type                | Default                                              | Description                    |
| ------------------ | ------------------- | ---------------------------------------------------- | ------------------------------ |
| `url`              | `string`            | required                                             | URL to match cookies against   |
| `browsers`         | `Browser[]`         | `["chrome","brave","edge","arc","firefox","safari"]` | Browsers to search             |
| `names`            | `string[]`          | all                                                  | Filter by cookie name          |
| `includeExpired`   | `boolean`           | `false`                                              | Include expired cookies        |
| `timeoutMs`        | `number`            | `5000`                                               | Keychain/DPAPI command timeout |
| `onKeychainAccess` | `(browser) => void` | -                                                    | Fires before credential prompt |

Supported browsers: `chrome` `edge` `brave` `arc` `dia` `helium` `chromium` `vivaldi` `opera` `ghost` `sidekick` `yandex` `iridium` `thorium` `sigmaos` `wavebox` `comet` `blisk` `firefox` `safari`

### `detectBrowserProfiles(options?)`

Detects installed browser profiles across Chromium, Firefox, and Safari.

```ts
const allProfiles = detectBrowserProfiles();
const chromeOnly = detectBrowserProfiles({ browser: "chrome" });
```

| Option    | Type      | Default | Description                  |
| --------- | --------- | ------- | ---------------------------- |
| `browser` | `Browser` | all     | Filter to a specific browser |

Returns `BrowserProfile[]`.

### `extractProfileCookies(options)`

Extracts all cookies from a browser profile. Chromium browsers are launched headless via CDP. Firefox and Safari profiles are read directly from disk.

```ts
const { cookies, warnings } = await extractProfileCookies({
  profile: profiles[0],
  port: 9222,
});
```

| Option    | Type             | Default  | Description                          |
| --------- | ---------------- | -------- | ------------------------------------ |
| `profile` | `BrowserProfile` | required | Profile from `detectBrowserProfiles` |
| `port`    | `number`         | `9222`   | CDP debugging port (Chromium only)   |

### `extractAllProfileCookies(profiles)`

Extracts cookies from multiple profiles sequentially, aggregating results.

```ts
const { cookies, warnings } = await extractAllProfileCookies(profiles);
```

### Cookie helpers

All helpers take a plain `Cookie[]` as input.

| Function                          | Returns              | Description                                            |
| --------------------------------- | -------------------- | ------------------------------------------------------ |
| `matchCookies(cookies, url)`      | `Cookie[]`           | Cookies matching domain, path, secure flag, and expiry |
| `matchCookieHeader(cookies, url)` | `string`             | `matchCookies` + format as `"name=value; ..."` header  |
| `toCookieHeader(cookies)`         | `string`             | Format all cookies as a header string (no matching)    |
| `toPlaywrightCookies(cookies)`    | `PlaywrightCookie[]` | Playwright format (sameSite defaults to `"Lax"`)       |
| `toPuppeteerCookies(cookies)`     | `PuppeteerCookie[]`  | Puppeteer format                                       |

### `detectDefaultBrowser()`

Returns the system default browser key, or `null` if detection fails.

```ts
const browser = await detectDefaultBrowser(); // "chrome" | "safari" | ... | null
```

### Types

```ts
interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  browser: Browser;
}

interface ExtractResult {
  cookies: Cookie[];
  warnings: string[];
}

interface BrowserProfile {
  profileName: string;
  profilePath: string;
  displayName: string;
  browser: BrowserInfo;
}

interface BrowserInfo {
  name: string;
  executablePath: string;
}
```

### SQLite vs Profile Extraction

|                            | SQLite                   | Profile                               |
| -------------------------- | ------------------------ | ------------------------------------- |
| Speed                      | Fast (no browser launch) | ~3s startup (Chromium), fast (others) |
| Keychain popup (macOS)     | Yes                      | No                                    |
| Firefox/Safari             | Yes                      | Yes                                   |
| Requires browser installed | No (reads DB files)      | Yes                                   |
| Cookie decryption          | Manual (keychain/DPAPI)  | Chromium handles it / not needed      |

---

## Approach

Two strategies exist for reading cookies from a local browser: reading the cookie store directly from disk, or asking a running browser for them via DevTools.

### Strategy A: SQLite extraction (`extractCookies`)

Reads cookie databases without launching a browser. Each step below happens for every requested browser in parallel:

1. Locate the database. Each browser has a known path per platform (e.g. `~/Library/Application Support/Google/Chrome/Default/Network/Cookies` on macOS). If the path doesn't exist, the browser is skipped with a warning.
2. Copy to a temp directory. The database file and its WAL/SHM sidecars are copied so reads never conflict with a running browser.
3. Decrypt (Chromium only). Cookie values may be encrypted in `encrypted_value`. The decryption method depends on the OS:
   - macOS - password from Keychain → PBKDF2-SHA1 (1003 iterations, salt `"saltysalt"`) → AES-128-CBC.
   - Linux - password from `secret-tool` (fallback `"peanuts"`) → PBKDF2-SHA1 (1 iteration) → AES-128-CBC. Multiple key candidates are tried.
   - Windows - encrypted key from `Local State` → unwrap with DPAPI via PowerShell → AES-256-GCM.
   - Databases with meta version ≥ 24 prepend a 32-byte hash to the plaintext, which is stripped after decryption.
4. Query and parse.
   - Chromium - SQL query on `cookies` table, filtered by host. Plaintext values are used directly; encrypted values go through step 3.
   - Firefox - SQL query on `moz_cookies` in `cookies.sqlite`. Values are stored in plaintext. The default profile is found by preferring directories containing `default-release`.
   - Safari - binary format (`Cookies.binarycookies`) parsed by walking its page/record structure. Each record contains flags, domain, name, path, value, and a Mac-epoch expiration. macOS only.
5. Normalize. Expiration is converted to Unix seconds, sameSite is mapped to `"Strict" | "Lax" | "None"`, and leading dots are stripped from domains.
6. Deduplicate. Cookies are keyed by `name|domain|path`. First occurrence wins.
7. Clean up. Temp directories are removed.

### Strategy B: Profile extraction via CDP (`extractProfileCookies`)

Works with any detected `BrowserProfile`, not just the default. For Firefox and Safari, it reads from disk the same way as strategy A. For Chromium browsers, it uses the Chrome DevTools Protocol so the browser handles its own decryption - no Keychain/DPAPI prompts:

1. Copy the profile to a temp directory so the real profile stays untouched.
2. Remove singleton locks (`SingletonLock`, `SingletonSocket`, `SingletonCookie`) so the headless instance can open the profile even if the browser is already running.
3. Spawn a headless browser with `--remote-debugging-port`, `--headless=new`, and the copied `--user-data-dir`.
4. Wait for startup (3-second delay).
5. Poll for a page target by hitting `http://localhost:{port}/json` until a target with `type === "page"` appears (up to 10 retries, 1-second intervals).
6. Open a WebSocket to the target's `webSocketDebuggerUrl` and send `Network.getAllCookies`. The response is awaited with a 10-second timeout to prevent hangs.
7. Map and normalize the raw CDP cookies to the standard `Cookie` shape.
8. Kill the browser, wait for process exit, and clean up the temp directory.

### Output

Both strategies return an `ExtractResult` containing a plain `Cookie[]` and any `warnings`. The cookies array is the primary output - helper functions handle conversion from there:

- `matchCookies(cookies, url)` filters by domain, path, secure flag, and expiry.
- `toCookieHeader(cookies)` formats cookies as a `Cookie` header string.
- `toPlaywrightCookies(cookies)` / `toPuppeteerCookies(cookies)` convert to the shapes expected by each automation library.
- JSON serialization is just `JSON.stringify` / `JSON.parse` on the `Cookie[]`.
