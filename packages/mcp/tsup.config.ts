import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/start.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["playwright", "@browser-tester/browser", "@modelcontextprotocol/sdk", "zod"],
});
