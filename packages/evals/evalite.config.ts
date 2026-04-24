import { defineConfig } from "evalite/config";

export default defineConfig({
  maxConcurrency: 1,
  testTimeout: 600_000,
});
