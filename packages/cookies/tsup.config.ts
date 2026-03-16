import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: !options.watch,
  sourcemap: true,
  platform: "node",
  external: ["bun:sqlite", "libsql"],
}));
