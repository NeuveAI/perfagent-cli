import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["src/tui.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}
