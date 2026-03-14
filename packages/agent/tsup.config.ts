import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@ai-sdk/provider", "@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk", "ai"],
});
