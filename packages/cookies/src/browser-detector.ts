import { homedir, platform } from "node:os";
import path from "node:path";
import { Effect, Layer, Match, ServiceMap } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { NodeServices } from "@effect/platform-node";
import type { Browser, BrowserInfo, BrowserProfile, LocalStateProfile } from "./types.js";
import {
  CHROMIUM_CONFIGS,
  FIREFOX_CONFIG,
  SAFARI_CONFIG,
  configByDisplayName,
  type ChromiumConfig,
} from "./browser-config.js";
import { naturalCompare, parseProfilesIni } from "./utils/profiles-ini.js";

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const resolveLocaleFromPreferenceValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  return value
    .split(",")
    .map((language) => language.trim())
    .find((language) => language.length > 0);
};

const getUserDataDir = (currentPlatform: string, config: ChromiumConfig): string | undefined =>
  Match.value(currentPlatform).pipe(
    Match.when("darwin", () =>
      path.join(homedir(), "Library", "Application Support", config.userData.darwin),
    ),
    Match.when("linux", () =>
      path.join(
        process.env["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config"),
        config.userData.linux,
      ),
    ),
    Match.when("win32", () =>
      path.join(
        process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local"),
        config.userData.win32,
      ),
    ),
    Match.orElse(() => undefined),
  );

const getFirefoxDataDir = (currentPlatform: string): string | undefined =>
  Match.value(currentPlatform).pipe(
    Match.when("darwin", () => path.join(homedir(), FIREFOX_CONFIG.dataDir.darwin)),
    Match.when("linux", () => path.join(homedir(), FIREFOX_CONFIG.dataDir.linux)),
    Match.when("win32", () => path.join(homedir(), FIREFOX_CONFIG.dataDir.win32)),
    Match.orElse(() => undefined),
  );

export interface DetectBrowserProfilesOptions {
  browser?: Browser;
}

interface ProfileMetadata {
  profileNames: Record<string, LocalStateProfile>;
  lastUsedProfileName: string | undefined;
}

const EMPTY_PROFILE_METADATA: ProfileMetadata = {
  profileNames: {},
  lastUsedProfileName: undefined,
};

export class BrowserDetector extends ServiceMap.Service<BrowserDetector>()(
  "@cookies/BrowserDetector",
  {
    make: Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner;

      const loadProfileMetadata = Effect.fn("BrowserDetector.loadProfileMetadata")(function* (
        userDataDir: string,
      ) {
        const localStatePath = path.join(userDataDir, "Local State");
        const content = yield* fileSystem
          .readFileString(localStatePath)
          .pipe(Effect.catch(() => Effect.succeed("")));
        if (!content) return EMPTY_PROFILE_METADATA;

        const localState = yield* Effect.try({
          try: () => JSON.parse(content),
          catch: () => undefined,
        });
        if (!isObjectRecord(localState)) return EMPTY_PROFILE_METADATA;

        const profileState = localState["profile"];
        if (!isObjectRecord(profileState)) return EMPTY_PROFILE_METADATA;

        const infoCache = profileState["info_cache"];
        const lastUsedProfileName =
          typeof profileState["last_used"] === "string" ? profileState["last_used"] : undefined;

        if (!isObjectRecord(infoCache)) return { ...EMPTY_PROFILE_METADATA, lastUsedProfileName };

        const profileNames: Record<string, LocalStateProfile> = {};
        for (const [profileId, profileEntry] of Object.entries(infoCache)) {
          if (!isObjectRecord(profileEntry)) continue;
          const displayName = profileEntry["name"];
          if (typeof displayName === "string") profileNames[profileId] = { name: displayName };
        }

        return { profileNames, lastUsedProfileName };
      });

      const loadProfileLocale = Effect.fn("BrowserDetector.loadProfileLocale")(function* (
        profilePath: string,
      ) {
        const preferencesPath = path.join(profilePath, "Preferences");
        const content = yield* fileSystem
          .readFileString(preferencesPath)
          .pipe(Effect.catch(() => Effect.succeed("")));
        if (!content) return undefined;

        const preferences = yield* Effect.try({
          try: () => JSON.parse(content),
          catch: () => undefined,
        });
        if (!isObjectRecord(preferences)) return undefined;

        const intlState = preferences["intl"];
        if (!isObjectRecord(intlState)) return undefined;

        return (
          resolveLocaleFromPreferenceValue(intlState["selected_languages"]) ??
          resolveLocaleFromPreferenceValue(intlState["accept_languages"])
        );
      });

      const isValidProfile = Effect.fn("BrowserDetector.isValidProfile")(function* (
        profilePath: string,
      ) {
        const stat = yield* fileSystem
          .stat(profilePath)
          .pipe(Effect.catch(() => Effect.succeed(undefined)));
        if (!stat || stat.type !== "Directory") return false;
        return yield* fileSystem.exists(path.join(profilePath, "Preferences"));
      });

      const detectProfilesForBrowser = Effect.fn("BrowserDetector.detectProfilesForBrowser")(
        function* (browser: BrowserInfo, userDataDir: string) {
          if (!(yield* fileSystem.exists(userDataDir))) return [];

          const { profileNames, lastUsedProfileName } = yield* loadProfileMetadata(userDataDir);
          const entries = yield* fileSystem
            .readDirectory(userDataDir)
            .pipe(Effect.catch(() => Effect.succeed([] as string[])));

          const profiles: BrowserProfile[] = [];
          for (const entry of entries) {
            const profilePath = path.join(userDataDir, entry);
            if (!(yield* isValidProfile(profilePath))) continue;

            const localStateProfile = profileNames[entry];
            const displayName = localStateProfile?.name ?? entry;
            const locale = yield* loadProfileLocale(profilePath);

            profiles.push({
              profileName: entry,
              profilePath,
              displayName,
              browser,
              ...(locale ? { locale } : {}),
            });
          }

          profiles.sort((left, right) => {
            const leftIsLastUsed = left.profileName === lastUsedProfileName;
            const rightIsLastUsed = right.profileName === lastUsedProfileName;
            if (leftIsLastUsed !== rightIsLastUsed) return leftIsLastUsed ? -1 : 1;
            return naturalCompare(left.profileName, right.profileName);
          });
          return profiles;
        },
      );

      const detectBrowsersDarwin = Effect.fn("BrowserDetector.detectBrowsersDarwin")(function* () {
        const browsers: BrowserInfo[] = [];
        for (const config of CHROMIUM_CONFIGS) {
          if (yield* fileSystem.exists(config.executable.darwin)) {
            browsers.push({ name: config.displayName, executablePath: config.executable.darwin });
          }
        }
        return browsers;
      });

      const detectBrowsersLinux = Effect.fn("BrowserDetector.detectBrowsersLinux")(function* () {
        const browsers: BrowserInfo[] = [];
        for (const config of CHROMIUM_CONFIGS) {
          for (const executablePath of config.executable.linux) {
            if (yield* fileSystem.exists(executablePath)) {
              browsers.push({ name: config.displayName, executablePath });
              break;
            }
          }
        }
        return browsers;
      });

      const detectBrowsersWin32 = Effect.fn("BrowserDetector.detectBrowsersWin32")(function* () {
        const browsers: BrowserInfo[] = [];
        const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
        const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
        const localAppData =
          process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local");

        for (const config of CHROMIUM_CONFIGS) {
          const regPath = `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${config.registryKey}`;
          const registryOutput = yield* spawner
            .string(ChildProcess.make("reg", ["query", regPath, "/ve"]))
            .pipe(
              Effect.map((output) => output.trim()),
              Effect.catch(() => Effect.succeed("")),
            );

          if (registryOutput) {
            const match = registryOutput.match(/REG_SZ\s+(.+)/);
            const registryExePath = match?.[1]?.trim();
            if (registryExePath && (yield* fileSystem.exists(registryExePath))) {
              browsers.push({ name: config.displayName, executablePath: registryExePath });
              continue;
            }
          }

          let found = false;
          for (const relativePath of config.executable.win32) {
            for (const base of [programFiles, programFilesX86, localAppData]) {
              const candidate = path.join(base, relativePath);
              if (yield* fileSystem.exists(candidate)) {
                browsers.push({ name: config.displayName, executablePath: candidate });
                found = true;
                break;
              }
            }
            if (found) break;
          }
        }
        return browsers;
      });

      const detectFirefoxProfiles = Effect.fn("BrowserDetector.detectFirefoxProfiles")(function* (
        currentPlatform: string,
      ) {
        const executablePath = yield* Match.value(currentPlatform).pipe(
          Match.when("darwin", () =>
            fileSystem
              .exists(FIREFOX_CONFIG.executable.darwin)
              .pipe(
                Effect.map((exists) => (exists ? FIREFOX_CONFIG.executable.darwin : undefined)),
              ),
          ),
          Match.when("linux", () =>
            Effect.gen(function* () {
              for (const exePath of FIREFOX_CONFIG.executable.linux) {
                if (yield* fileSystem.exists(exePath)) return exePath;
              }
              return undefined;
            }),
          ),
          Match.when("win32", () =>
            Effect.gen(function* () {
              const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
              const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
              for (const relativePath of FIREFOX_CONFIG.executable.win32) {
                for (const base of [programFiles, programFilesX86]) {
                  const candidate = path.join(base, relativePath);
                  if (yield* fileSystem.exists(candidate)) return candidate;
                }
              }
              return undefined;
            }),
          ),
          Match.orElse(() => Effect.succeed(undefined)),
        );

        if (!executablePath) return [];

        const dataDir = getFirefoxDataDir(currentPlatform);
        if (!dataDir) return [];

        const iniPath = path.join(dataDir, "profiles.ini");
        if (!(yield* fileSystem.exists(iniPath))) return [];

        const iniContent = yield* fileSystem
          .readFileString(iniPath)
          .pipe(Effect.catch(() => Effect.succeed("")));
        if (!iniContent) return [];

        const parsedProfiles = parseProfilesIni(iniContent);
        const browser: BrowserInfo = { name: FIREFOX_CONFIG.displayName, executablePath };
        const profiles: BrowserProfile[] = [];

        for (const parsed of parsedProfiles) {
          const profilePath = parsed.isRelative ? path.join(dataDir, parsed.path) : parsed.path;
          const cookiesPath = path.join(profilePath, "cookies.sqlite");
          if (!(yield* fileSystem.exists(cookiesPath))) continue;

          profiles.push({
            profileName: path.basename(profilePath),
            profilePath,
            displayName: parsed.name,
            browser,
          });
        }

        return profiles;
      });

      const detectSafariProfiles = Effect.fn("BrowserDetector.detectSafariProfiles")(function* (
        currentPlatform: string,
      ) {
        if (currentPlatform !== "darwin") return [];
        if (!(yield* fileSystem.exists(SAFARI_CONFIG.executable))) return [];

        const home = homedir();
        const browser: BrowserInfo = {
          name: SAFARI_CONFIG.displayName,
          executablePath: SAFARI_CONFIG.executable,
        };

        for (const relativePath of SAFARI_CONFIG.cookieRelativePaths) {
          const cookieDir = path.join(home, relativePath);
          const cookieFile = path.join(cookieDir, "Cookies.binarycookies");
          if (yield* fileSystem.exists(cookieFile)) {
            return [
              { profileName: "Default", profilePath: cookieDir, displayName: "Default", browser },
            ];
          }
        }

        return [];
      });

      const detect = Effect.fn("BrowserDetector.detect")(function* (
        options?: DetectBrowserProfilesOptions,
      ) {
        const currentPlatform = platform();
        const allProfiles: BrowserProfile[] = [];

        const installedBrowsers = yield* Match.value(currentPlatform).pipe(
          Match.when("darwin", () => detectBrowsersDarwin()),
          Match.when("linux", () => detectBrowsersLinux()),
          Match.when("win32", () => detectBrowsersWin32()),
          Match.orElse(() => Effect.succeed([] as BrowserInfo[])),
        );

        for (const browser of installedBrowsers) {
          const config = CHROMIUM_CONFIGS.find(
            (chromiumCfg) => chromiumCfg.displayName === browser.name,
          );
          if (!config) continue;

          const userDataDir = getUserDataDir(currentPlatform, config);
          if (!userDataDir) continue;

          const profiles = yield* detectProfilesForBrowser(browser, userDataDir);
          allProfiles.push(...profiles);
        }

        allProfiles.push(...(yield* detectFirefoxProfiles(currentPlatform)));
        allProfiles.push(...(yield* detectSafariProfiles(currentPlatform)));

        if (options?.browser) {
          return allProfiles.filter(
            (profile) => configByDisplayName(profile.browser.name)?.key === options.browser,
          );
        }

        yield* Effect.logDebug("Browser profiles detected", { count: allProfiles.length });
        return allProfiles;
      });

      return { detect } as const;
    }),
  },
) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(NodeServices.layer));
}
