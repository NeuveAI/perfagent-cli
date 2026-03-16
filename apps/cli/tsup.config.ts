import { defineConfig } from "tsup";
import { reactCompilerPlugin } from "./esbuild-react-compiler-plugin";

export default defineConfig((options) => ({
  entry: ["src/index.tsx"],
  format: ["esm"],
  dts: true,
  clean: !options.watch,
  sourcemap: true,
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  noExternal: [/^@browser-tester\//],
  external: ["playwright", "playwright-core", "chromium-bidi", "libsql", "ws"],
  esbuildPlugins: [reactCompilerPlugin()],
  esbuildOptions(esbuildOptions) {
    esbuildOptions.inject = [...(esbuildOptions.inject ?? []), "./ink-grab/inject-hook.js"];
    esbuildOptions.supported = { ...esbuildOptions.supported, "import-meta": true };
  },
}));
