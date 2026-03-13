import type { CreatePageOptions } from "@browser-tester/browser";
import type { Command } from "commander";
import { parseBrowsers } from "./parse-browsers";

export interface SharedOptions extends CreatePageOptions {
  timeout?: number;
}

export const addSharedOptions = <T extends Command>(command: T): T =>
  command
    .option("-t, --timeout <ms>", "snapshot timeout in milliseconds", parseInt)
    .option("--headed", "run browser in headed mode")
    .option("--cookies", "inject cookies from local browsers")
    .option(
      "--cookie-browsers <browsers>",
      "comma-separated list of browsers for cookie extraction",
      parseBrowsers,
    )
    .option("--cookies-file <path>", "path to Playwright cookies JSON file")
    .option("--executable-path <path>", "path to browser executable") as T;
