import { context } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const watchMode = process.argv.includes("--watch");

const RUNTIME_ENTRY = "src/runtime/index.ts";

const extractExportedFunctionNames = (source) => {
  const regex = /export\s+const\s+(\w+)\s*=/g;
  const names = [];
  let match;
  while ((match = regex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
};

const generateRuntimeTypes = (exportNames) => {
  const fields = exportNames.map((name) => `  ${name}: typeof Runtime.${name};`).join("\n");
  return [
    `import type * as Runtime from "../runtime/index";`,
    ``,
    `export interface BrowserTesterRuntime {`,
    fields,
    `}`,
    ``,
  ].join("\n");
};

const emitPlugin = {
  name: "emit-runtime-script",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      const runtimeCode =
        `${result.outputFiles[0].text}\n` +
        "globalThis.__browserTesterRuntime = __browserTesterRuntime;\n";
      mkdirSync("src/generated", { recursive: true });
      writeFileSync(
        "src/generated/runtime-script.ts",
        `export const RUNTIME_SCRIPT = ${JSON.stringify(runtimeCode)};\n`,
      );

      const source = readFileSync(RUNTIME_ENTRY, "utf-8");
      const exportNames = extractExportedFunctionNames(source);
      writeFileSync("src/generated/runtime-types.ts", generateRuntimeTypes(exportNames));
    });
  },
};

const ctx = await context({
  entryPoints: ["src/runtime/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "__browserTesterRuntime",
  write: false,
  minify: true,
  target: "es2020",
  plugins: [emitPlugin],
});

if (watchMode) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
