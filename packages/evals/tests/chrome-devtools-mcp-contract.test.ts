import { createRequire } from "node:module";
import { assert, describe, it } from "vite-plus/test";
import { CHROME_DEVTOOLS_MCP_EXPECTED_VERSION } from "../src/runners/url-extraction";

// Pins the chrome-devtools-mcp version whose text-format templates the
// url-extraction fallback mirrors. Upstream ships no exported typed
// surface and no magic-string constants we could import, so this test
// is the tripwire for silent drift.
//
// If this test fails after a chrome-devtools-mcp bump:
//   1. Read the new McpResponse.js / SnapshotFormatter.js / tools/pages.js
//      and diff the template literals for `Successfully navigated to`,
//      the `${pageId}: ${url} [selected]` page-list line, `URL: ${url}`
//      in trace summaries, and SnapshotFormatter's `url="..."` attribute.
//   2. Update the regex patterns in src/runners/url-extraction.ts if
//      they drifted.
//   3. Update CHROME_DEVTOOLS_MCP_EXPECTED_VERSION to the new version.
describe("chrome-devtools-mcp contract", () => {
  it(`pins to ${CHROME_DEVTOOLS_MCP_EXPECTED_VERSION} — re-verify text-scan patterns when this trips`, () => {
    const require = createRequire(import.meta.url);
    const manifest: { readonly version: string } = require("chrome-devtools-mcp/package.json");
    assert.strictEqual(
      manifest.version,
      CHROME_DEVTOOLS_MCP_EXPECTED_VERSION,
      `chrome-devtools-mcp@${manifest.version} differs from pinned ${CHROME_DEVTOOLS_MCP_EXPECTED_VERSION}. Re-verify url-extraction.ts patterns against the new upstream templates, then bump CHROME_DEVTOOLS_MCP_EXPECTED_VERSION.`,
    );
  });
});
