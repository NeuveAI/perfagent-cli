import { defineConfig } from "evalite/config";

export default defineConfig({
  maxConcurrency: 5,
  testTimeout: 30_000,
});
