import path from "node:path";
import { Command } from "commander";
import { logger } from "../utils/logger";
import { addSharedOptions } from "../utils/shared-options";
import { withPage } from "../utils/with-page";

const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

export const screenshot = addSharedOptions(
  new Command()
    .command("screenshot")
    .description("take a screenshot of a URL")
    .argument("<url>", "URL to screenshot")
    .argument("<path>", "file path to save the screenshot"),
).action(async (url: string, outputPath: string, options) => {
  const extension = path.extname(outputPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    logger.error(`Unsupported file extension "${extension || "(none)"}". Use .png, .jpg, or .jpeg`);
    process.exit(1);
  }

  await withPage(url, options, async (page) => {
    await page.screenshot({ path: outputPath, fullPage: true });
    logger.success(`Screenshot saved to ${outputPath}`);
  });
});
