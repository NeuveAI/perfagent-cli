import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  pack: {
    entry: ["src/main.ts"],
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    platform: "node",
    fixedExtension: false,
    banner: "#!/usr/bin/env node",
    minify: false,
    // `@neuve/shared` exports `.ts` source files (its package.json `exports`
    // map points at `./src/*.ts`, not built `.js`). Vitest/vite transform
    // those at runtime, but when `AcpAdapter.layerLocal` spawns this binary
    // via raw `node`, Node ESM cannot load the `.ts` subpaths and the child
    // dies immediately with `ERR_UNKNOWN_FILE_EXTENSION` — starving the ACP
    // stdio handshake and silently hanging every eval task for the full
    // `testTimeout`. Bundling `@neuve/shared` into `dist/main.js` closes
    // that gap without touching shared's broader contract.
    deps: {
      alwaysBundle: [/@neuve\/shared/],
    },
  },
});
