import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";

// Prevents the `--planner` CLI flag from coming back. The frontier planner is
// now eval-only (`EVAL_PLANNER=oracle-plan`); re-introducing the runtime flag
// would reopen the Gemma-only runtime invariant landed in the
// frontier-planner-removal branch.
const CLI_SOURCES = [
  "apps/cli/src/index.tsx",
  "apps/cli/src/commands/watch.ts",
  "apps/cli-solid/src/tui.ts",
] as const;

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("help surface regression", () => {
  for (const relativePath of CLI_SOURCES) {
    it(`${relativePath} does not register a --planner option`, () => {
      const absolutePath = path.join(REPO_ROOT, relativePath);
      const source = fs.readFileSync(absolutePath, "utf8");
      expect(source).not.toContain("--planner");
      expect(source).not.toContain("parsePlannerMode");
    });
  }
});
