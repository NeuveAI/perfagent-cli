import { defineConfig } from "evalite/config";

export default defineConfig({
  maxConcurrency: 5,
  testTimeout: 600_000,
});
