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
import { BrowserDetector, type DetectBrowserProfilesOptions } from "./browser-detector.js";
import { parseBinaryCookies } from "./utils/binary-cookies.js";
import { CdpClient } from "./cdp-client.js";
import { ChromiumExtractor } from "./chromium-extractor.js";
import { FirefoxExtractor } from "./firefox-extractor.js";
import { SafariExtractor } from "./safari-extractor.js";
import { CookieDatabaseNotFoundError, CookieReadError } from "./errors.js";
import { SqliteClient } from "./sqlite-client.js";
import { dedupeCookies, originsToHosts, stripLeadingDot } from "./utils/host-matching.js";
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

const DEFAULT_BROWSERS: Browser[] = ["chrome", "brave", "edge", "arc", "firefox", "safari"];

const SUPPORTED_BROWSER_KEYS: Browser[] = [
  ...CHROMIUM_CONFIGS.map((config) => config.key),
  "firefox",
  "safari",
] as Browser[];

const isChromiumBrowser = (browser: Browser): browser is ChromiumBrowser =>
  CHROMIUM_CONFIGS.some((config) => config.key === browser);

export class Cookies extends ServiceMap.Service<Cookies>()("@cookies/Cookies", {
  make: Effect.gen(function* () {
    const chromiumExtractor = yield* ChromiumExtractor;
    const firefoxExtractor = yield* FirefoxExtractor;
    const safariExtractor = yield* SafariExtractor;
    const cdpClient = yield* CdpClient;
    const browserDetector = yield* BrowserDetector;
    const sqliteClient = yield* SqliteClient;
    const fileSystem = yield* FileSystem.FileSystem;

    const extract = Effect.fn("Cookies.extract")(function* (options: ExtractOptions) {
      yield* Effect.annotateCurrentSpan({ url: options.url });
      const browsers = options.browsers ?? DEFAULT_BROWSERS;
      const hosts = originsToHosts([options.url]);

      const extractBrowser = (browser: Browser) =>
        Effect.gen(function* () {
          if (isChromiumBrowser(browser)) {
            return yield* chromiumExtractor.extract(browser, hosts, {
              names: options.names,
              includeExpired: options.includeExpired,
            });
          }
          if (browser === "firefox") {
            return yield* firefoxExtractor.extract(hosts, {
              names: options.names,
              includeExpired: options.includeExpired,
            });
          }
          if (browser === "safari") {
            return yield* safariExtractor.extract(hosts, {
              names: options.names,
              includeExpired: options.includeExpired,
            });
          }
          return [] as Cookie[];
        }).pipe(
          Effect.catchTags({
            CookieDatabaseNotFoundError: () => Effect.succeed([] as Cookie[]),
            CookieDatabaseCopyError: () => Effect.succeed([] as Cookie[]),
            CookieDecryptionKeyError: () => Effect.succeed([] as Cookie[]),
            CookieReadError: () => Effect.succeed([] as Cookie[]),
            UnsupportedPlatformError: () => Effect.succeed([] as Cookie[]),
            BinaryParseError: () => Effect.succeed([] as Cookie[]),
          }),
        );

      const results = yield* Effect.forEach(browsers, extractBrowser, {
        concurrency: "unbounded",
      });

      return dedupeCookies(results.flat());
    });

    const extractProfile = Effect.fn("Cookies.extractProfile")(function* (
      options: ExtractProfileOptions,
    ) {
      yield* Effect.annotateCurrentSpan({ profile: options.profile.profileName });
      const browserKey = configByDisplayName(options.profile.browser.name)?.key;

      return yield* Match.value(browserKey).pipe(
        Match.when("firefox", () => extractFirefoxProfileCookies(options.profile)),
        Match.when("safari", () => extractSafariProfileCookies(options.profile)),
        Match.orElse(() => cdpClient.extractFromProfile(options)),
      );
    });

    const extractAllProfiles = Effect.fn("Cookies.extractAllProfiles")(function* (
      profiles: BrowserProfile[],
    ) {
      const results = yield* Effect.forEach(profiles, (profile) => extractProfile({ profile }));
      return results.flat();
    });

    const detectProfiles = Effect.fn("Cookies.detectProfiles")(function* (
      options?: DetectBrowserProfilesOptions,
    ) {
      return yield* browserDetector.detect(options);
    });

    const detectDefault = Effect.fn("Cookies.detectDefaultBrowser")(function* () {
      const result = yield* Effect.tryPromise({
        try: () => getDefaultBrowser(),
        catch: (cause) => new CookieReadError({ browser: "unknown", cause: String(cause) }),
      }).pipe(
        Effect.catchTag("CookieReadError", (error) =>
          Effect.logWarning("Failed to detect default browser", { cause: error.cause }).pipe(
            Effect.map(() => undefined),
          ),
        ),
      );
      if (!result) return Option.none<Browser>();

      const identifier = result.id;
      const normalizedId = identifier.toLowerCase();
      const desktopKey = normalizedId.replace(/\.desktop$/, "");

      const config = configByBundleId(normalizedId) ?? configByDesktopFile(desktopKey);
      return Option.fromNullOr(config?.key);
    });

    const extractFirefoxProfileCookies = Effect.fn("Cookies.extractFirefoxProfileCookies")(
      function* (profile: BrowserProfile) {
        const cookieDbPath = path.join(profile.profilePath, "cookies.sqlite");
        const { tempDatabasePath } = yield* sqliteClient.copyToTemp(
          cookieDbPath,
          "cookies-firefox-profile-",
          "cookies.sqlite",
          "firefox",
        );

        const sqlQuery =
          `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite ` +
          `FROM moz_cookies ORDER BY expiry DESC`;

        const cookieRows = yield* sqliteClient.query(tempDatabasePath, sqlQuery, "firefox");
        const cookies: Cookie[] = [];

        for (const cookieRow of cookieRows) {
          const cookieName = stringField(cookieRow.name);
          const cookieValue = stringField(cookieRow.value);
          const cookieHost = stringField(cookieRow.host);
          if (!cookieName || cookieValue === undefined || !cookieHost) continue;

          cookies.push({
            name: cookieName,
            value: cookieValue,
            domain: stripLeadingDot(cookieHost),
            path: stringField(cookieRow.path) || "/",
            expires: parseFirefoxExpiry(cookieRow.expiry),
            secure: sqliteBool(cookieRow.isSecure),
            httpOnly: sqliteBool(cookieRow.isHttpOnly),
            sameSite: normalizeSameSite(cookieRow.sameSite),
            browser: "firefox",
          });
        }

        return cookies;
      },
      Effect.scoped,
    );

    const extractSafariProfileCookies = Effect.fn("Cookies.extractSafariProfileCookies")(function* (
      profile: BrowserProfile,
    ) {
      const cookieFilePath = path.join(profile.profilePath, "Cookies.binarycookies");
      const data = yield* fileSystem
        .readFile(cookieFilePath)
        .pipe(
          Effect.catchTag("PlatformError", () =>
            new CookieDatabaseNotFoundError({ browser: "safari" }).asEffect(),
          ),
        );
      const cookies = parseBinaryCookies(Buffer.from(data));
      return cookies.filter((cookie) => Boolean(cookie.name) && Boolean(cookie.domain));
    });

    return {
      extract,
      extractProfile,
      extractAllProfiles,
      detectProfiles,
      detectDefaultBrowser: detectDefault,
      supportedBrowsers: SUPPORTED_BROWSER_KEYS,
    } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(
    Layer.provide(ChromiumExtractor.layer),
    Layer.provide(FirefoxExtractor.layer),
    Layer.provide(SafariExtractor.layer),
    Layer.provide(CdpClient.layer),
    Layer.provide(BrowserDetector.layer),
    Layer.provide(SqliteClient.layer),
    Layer.provide(NodeServices.layer),
  );

  static layerTest = Layer.effect(this)(this.make).pipe(
    Layer.provide(ChromiumExtractor.layer),
    Layer.provide(FirefoxExtractor.layer),
    Layer.provide(SafariExtractor.layer),
    Layer.provide(CdpClient.layerTest),
    Layer.provide(BrowserDetector.layer),
    Layer.provide(SqliteClient.layer),
    Layer.provide(NodeServices.layer),
  );
}
