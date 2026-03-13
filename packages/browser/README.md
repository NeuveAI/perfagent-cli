# @browser-tester/browser

Launch Playwright pages with cookie injection, accessibility snapshots, and ref-based interaction.

## Install

```bash
pnpm add @browser-tester/browser
```

## `createPage`

Launch a Chromium page navigated to a URL. Optionally inject cookies from local browsers.

```ts
import { createPage } from "@browser-tester/browser";

const { browser, context, page } = await createPage("https://github.com", {
  headed: true, // optional, default false
  executablePath: "/usr/bin/chromium", // optional, custom browser binary
  cookies: true, // optional, true = auto-extract, or pass Cookie[]
  waitUntil: "networkidle", // optional, default "load"
});

// ... interact with page ...
await browser.close();
```

## `snapshot`

Capture an accessibility tree from the page. Each element gets a ref (e.g. `e1`, `e2`) for use with `act`.

```ts
import { snapshot } from "@browser-tester/browser";

const { tree, refs, locator } = await snapshot(page, {
  timeout: 30000, // optional, snapshot timeout in ms
  interactive: true, // optional, only include interactive elements
  compact: true, // optional, collapse structural-only nodes
  maxDepth: 5, // optional, limit tree depth
});

console.log(tree);
// - button "Sign in" [ref=e1]
// - link "Pricing" [ref=e2]
// - textbox "Search" [ref=e3]

const signIn = locator("e1"); // Playwright Locator for the ref
```

## `act`

Perform an action on a ref and return a fresh snapshot.

```ts
import { act } from "@browser-tester/browser";

const result = await act(page, "e1", async (locator) => {
  await locator.click();
});

console.log(result.tree); // updated accessibility tree
```

## `injectCookies`

Inject cookies into a Playwright `BrowserContext`.

```ts
import { injectCookies } from "@browser-tester/browser";

await injectCookies(context, cookies);
```

## Types

```ts
interface CreatePageOptions {
  headed?: boolean;
  executablePath?: string;
  cookies?: boolean | Cookie[];
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

interface CreatePageResult {
  browser: PlaywrightBrowser;
  context: BrowserContext;
  page: Page;
}

interface SnapshotOptions {
  timeout?: number;
  interactive?: boolean;
  compact?: boolean;
  maxDepth?: number;
}

interface SnapshotResult {
  tree: string;
  refs: RefMap;
  locator: (ref: string) => Locator;
}

interface RefEntry {
  role: AriaRole;
  name: string;
  nth?: number;
}

interface RefMap {
  [ref: string]: RefEntry;
}
```

## Re-exports

Cookie utilities are re-exported from `@browser-tester/cookies` for convenience:

`extractCookies` `extractProfileCookies` `extractAllProfileCookies` `detectBrowserProfiles` `CookieJar` `toCookieHeader`

See [@browser-tester/cookies](../cookies/README.md) for full cookie API docs.
