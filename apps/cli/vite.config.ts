import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "rolldown";
import { defineConfig } from "vite-plus";
import { reactCompilerPlugin } from "./react-compiler-plugin";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const collectSkillFiles = (baseDir: string, dir: string = ""): Record<string, string> => {
  const result: Record<string, string> = {};
  const target = path.join(baseDir, dir);
  if (!fs.existsSync(target)) return result;
  for (const entry of fs.readdirSync(target)) {
    const fullPath = path.join(target, entry);
    const relPath = dir ? `${dir}/${entry}` : entry;
    if (fs.statSync(fullPath).isDirectory()) {
      Object.assign(result, collectSkillFiles(baseDir, relPath));
    } else if (entry.endsWith(".md") || entry.endsWith(".js")) {
      result[relPath] = fs.readFileSync(fullPath, "utf-8");
    }
  }
  return result;
};

const buildSkillContent = (): string => {
  const configDir = fileURLToPath(new URL(".", import.meta.url));
  const skillDir = path.resolve(configDir, "..", "..", "packages", "perf-agent-skill");
  return JSON.stringify(collectSkillFiles(skillDir));
};

const resolveExportFile = (entry: unknown): string | undefined => {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    if (typeof record.default === "string") return record.default;
    if (typeof record.import === "string") return record.import;
    if (record.import && typeof record.import === "object") {
      const nested = record.import as Record<string, unknown>;
      return typeof nested.default === "string" ? nested.default : undefined;
    }
  }
  return undefined;
};

const findPackageDir = (packageName: string): string | undefined => {
  const searchPaths = require.resolve.paths(packageName);
  if (!searchPaths) return undefined;

  for (const searchPath of searchPaths) {
    const candidate = path.join(searchPath, packageName);
    try {
      fs.realpathSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
};

const distToSource = (distPath: string): string =>
  distPath
    .replace(/dist\//, "src/")
    .replace(/\.mjs$/, ".ts")
    .replace(/\.d\.mts$/, ".ts");

const buildNeuveSubpathMap = (): Record<string, string> => {
  const map: Record<string, string> = {};
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const packageName of Object.keys(allDeps)) {
    if (!packageName.startsWith("@neuve/")) continue;

    const packageDir = findPackageDir(packageName);
    if (!packageDir) continue;

    const packageJsonPath = path.join(packageDir, "package.json");
    const packageJson: { exports?: Record<string, unknown> } = JSON.parse(
      fs.readFileSync(fs.realpathSync(packageJsonPath), "utf8"),
    );
    if (!packageJson.exports) continue;

    for (const subpath of Object.keys(packageJson.exports)) {
      if (subpath === ".") continue;

      const specifier = `${packageName}/${subpath.slice(2)}`;
      const file = resolveExportFile(packageJson.exports[subpath]);
      if (file) {
        map[specifier] = path.join(fs.realpathSync(packageDir), distToSource(file));
      }
    }
  }

  return map;
};

const neuveSubpathPlugin = (): Plugin => {
  const subpathMap = buildNeuveSubpathMap();
  return {
    name: "neuve-subpath-resolve",
    resolveId(source) {
      if (subpathMap[source]) return subpathMap[source];
    },
  };
};

export default defineConfig({
  pack: {
    entry: ["src/index.tsx", "src/browser-mcp.ts", "src/browser-daemon.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    platform: "node",
    fixedExtension: false,
    banner: "#!/usr/bin/env node",
    define: {
      __VERSION__: JSON.stringify(pkg.version),
      __RULES_CONTENT__: JSON.stringify({}),
      __SKILL_CONTENT__: buildSkillContent(),
    },
    deps: {
      alwaysBundle: [/^@neuve\//],
      neverBundle: [
        "@agentclientprotocol/claude-agent-acp",
        "@neuve/local-agent",
        "@zed-industries/codex-acp",
        "oxc-resolver",
      ],
    },
    minify: true,
    plugins: [neuveSubpathPlugin(), reactCompilerPlugin()],
  },
});
