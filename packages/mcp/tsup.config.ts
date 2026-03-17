import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts", "src/start.ts"],
  format: ["esm"],
  dts: false,
  clean: !options.watch,
  sourcemap: true,
  platform: "node",
  external: ["playwright", "@browser-tester/browser", "@modelcontextprotocol/sdk", "zod"],
}));
