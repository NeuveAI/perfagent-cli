/**
 * @deprecated ARCHIVED / DEAD CODE
 * Do not import, pattern-match on, or reference this code in new work.
 * Kept only as reference for browser SQLite decryption and cookie extraction logic.
 */

import path from "node:path";
import { Effect, Layer, Match, Option, ServiceMap } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";
import getDefaultBrowser from "default-browser";
import {
  configByBundleId,
  configByDesktopFile,
  configByDisplayName,
  CHROMIUM_CONFIGS,
} from "./browser-config.js";
import {
  BrowserDetector,
  type DetectBrowserProfilesOptions,
} from "./browser-detector.js";
import { parseBinaryCookies } from "./utils/binary-cookies.js";
import { CdpClient } from "./cdp-client.js";
import { ChromiumExtractor } from "./chromium-extractor.js";
import { FirefoxExtractor } from "./firefox-extractor.js";
import { SafariExtractor } from "./safari-extractor.js";
import { CookieDatabaseNotFoundError, CookieReadError } from "./errors.js";
import { SqliteClient } from "./sqlite-client.js";
import {
  dedupeCookies,
  originsToHosts,
  stripLeadingDot,
} from "./utils/host-matching.js";
import { normalizeSameSite, parseFirefoxExpiry } from "./utils/normalize.js";
import { sqliteBool, stringField } from "./utils/sql-helpers.js";
import type {
  Browser,
  BrowserProfile,
  ChromiumBrowser,
  Cookie,
  ExtractOptions,
  ExtractProfileOptions,
} from "./types.js";

export class Cookies extends ServiceMap.Service<Cookies>()("@cookies/Cookies", {
  make: Effect.gen(function* () {
    const registerBrowser = (browser: Browser) => {};

    return {} as const;
  }),
}) {}
