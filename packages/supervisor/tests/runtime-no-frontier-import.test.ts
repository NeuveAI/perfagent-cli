import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

// Post-excision invariant: the supervisor package must not carry any frontier-
// planner surface area. All of the following symbols live exclusively in
// `@neuve/evals` and are reachable only through the eval A:B harness.
//
// This test greps the supervisor source tree (src/) and the package manifest
// (package.json) to catch regressions that re-introduce a LLM SDK dependency
// or a frontier-planner type. If someone adds one back, this test fails with
// the exact line the regression lives on.

const SUPERVISOR_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(SUPERVISOR_ROOT, "src");

const BANNED_SOURCE_TOKENS = [
  "PlanDecomposer",
  "PlannerAgent",
  "plannerMode",
  "PlannerMode",
  "parsePlannerMode",
  "DecomposeError",
  "frontier",
  // Prompt-authoring symbols that lived in the deleted `planner-prompt.ts`.
  "PLAN_DECOMPOSER_MODEL_ID",
  "PLAN_DECOMPOSER_MAX_STEPS",
] as const;

const BANNED_PACKAGE_DEPS = [
  "@ai-sdk/google",
  "@ai-sdk/provider",
  "ai",
  "zod",
] as const;

const listSourceFiles = (dir: string): readonly string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    files.push(fullPath);
  }
  return files;
};

describe("runtime-no-frontier-import invariant", () => {
  for (const token of BANNED_SOURCE_TOKENS) {
    it(`no supervisor source file references "${token}"`, () => {
      const offenders: string[] = [];
      for (const filePath of listSourceFiles(SRC_ROOT)) {
        const content = fs.readFileSync(filePath, "utf8");
        if (content.includes(token)) {
          offenders.push(path.relative(SUPERVISOR_ROOT, filePath));
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it("supervisor package.json does not declare AI SDK dependencies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(SUPERVISOR_ROOT, "package.json"), "utf8"),
    ) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    const dependencies = packageJson.dependencies ?? {};
    const devDependencies = packageJson.devDependencies ?? {};
    const present = BANNED_PACKAGE_DEPS.filter(
      (dep) => dep in dependencies || dep in devDependencies,
    );
    expect(present).toEqual([]);
  });
});
