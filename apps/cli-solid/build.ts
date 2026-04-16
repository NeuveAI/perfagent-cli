import * as fs from "node:fs";
import * as path from "node:path";
import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["src/tui.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
  external: ["undici", "@effect/platform-node"],
});

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

const outPath = path.join("dist", "tui.js");
const content = fs.readFileSync(outPath, "utf-8");
if (!content.startsWith("#!")) {
  fs.writeFileSync(outPath, `#!/usr/bin/env bun\n${content}`);
  fs.chmodSync(outPath, 0o755);
}
