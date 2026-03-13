import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { BROWSER_CONFIGS, CONFIG_DIR_NAME, CUSTOM_BROWSERS_FILE } from "../constants.js";
import type { BrowserInfo, BrowserProfile, CustomBrowser, LocalStateProfile } from "../types.js";

const getConfigDir = (): string => {
  const configDir = path.join(homedir(), CONFIG_DIR_NAME);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return configDir;
};

const extractNumber = (value: string): number => {
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

const naturalLess = (left: string, right: string): number => {
  const leftNum = extractNumber(left);
  const rightNum = extractNumber(right);
  if (leftNum !== rightNum) {
    return leftNum - rightNum;
  }
  return left.localeCompare(right);
};

const loadProfileNamesFromLocalState = (userDataDir: string): Record<string, LocalStateProfile> => {
  const localStatePath = path.join(userDataDir, "Local State");
  try {
    const content = readFileSync(localStatePath, "utf-8");
    const localState = JSON.parse(content);
    const infoCache = localState?.profile?.info_cache;
    if (!infoCache || typeof infoCache !== "object") {
      return {};
    }
    const profiles: Record<string, LocalStateProfile> = {};
    for (const [key, value] of Object.entries(infoCache)) {
      const entry = value as Record<string, unknown>;
      if (entry?.name && typeof entry.name === "string") {
        profiles[key] = { name: entry.name };
      }
    }
    return profiles;
  } catch {
    return {};
  }
};

const isValidProfile = (profilePath: string): boolean => {
  try {
    const stats = statSync(profilePath);
    if (!stats.isDirectory()) return false;

    const preferencesPath = path.join(profilePath, "Preferences");
    return existsSync(preferencesPath);
  } catch {
    return false;
  }
};

const getUserDataDirMacOS = (darwinPath: string): string =>
  path.join(homedir(), "Library", "Application Support", darwinPath);

const getUserDataDirLinux = (linuxPath: string): string =>
  path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config"), linuxPath);

const getUserDataDirWin32 = (win32Path: string): string => {
  const localAppData = process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local");
  return path.join(localAppData, win32Path);
};

const getUserDataDir = (config: {
  darwinUserDataPath: string;
  linuxUserDataPath: string;
  win32UserDataPath: string;
}): string | null => {
  const currentPlatform = platform();
  switch (currentPlatform) {
    case "darwin":
      return getUserDataDirMacOS(config.darwinUserDataPath);
    case "linux":
      return getUserDataDirLinux(config.linuxUserDataPath);
    case "win32":
      return getUserDataDirWin32(config.win32UserDataPath);
    default:
      return null;
  }
};

const detectProfilesForBrowser = (browser: BrowserInfo, userDataDir: string): BrowserProfile[] => {
  if (!existsSync(userDataDir)) return [];

  const profileNames = loadProfileNamesFromLocalState(userDataDir);
  const profiles: BrowserProfile[] = [];

  try {
    const entries = readdirSync(userDataDir);

    for (const entry of entries) {
      const profilePath = path.join(userDataDir, entry);
      if (!isValidProfile(profilePath)) continue;

      const localStateProfile = profileNames[entry];
      const displayName = localStateProfile?.name ?? entry;

      profiles.push({
        profileName: entry,
        profilePath,
        displayName,
        browser,
      });
    }
  } catch {
    return [];
  }

  profiles.sort((left, right) => naturalLess(left.profileName, right.profileName));
  return profiles;
};

const detectBrowsersMacOS = (): BrowserInfo[] =>
  BROWSER_CONFIGS.filter((config) => existsSync(config.info.executablePath)).map(
    (config) => config.info,
  );

const detectBrowsersLinux = (): BrowserInfo[] => {
  const browsers: BrowserInfo[] = [];
  for (const config of BROWSER_CONFIGS) {
    const binaryName = config.linuxUserDataPath.split("/").pop() ?? config.linuxUserDataPath;
    const commonPaths = [
      `/usr/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/snap/bin/${binaryName}`,
    ];
    for (const execPath of commonPaths) {
      if (existsSync(execPath)) {
        browsers.push({ name: config.info.name, executablePath: execPath });
        break;
      }
    }
  }
  return browsers;
};

export const loadCustomBrowsers = (): CustomBrowser[] => {
  const configPath = path.join(getConfigDir(), CUSTOM_BROWSERS_FILE);
  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
};

export const saveCustomBrowser = (browser: CustomBrowser): void => {
  const browsers = loadCustomBrowsers();
  browsers.push(browser);
  const configPath = path.join(getConfigDir(), CUSTOM_BROWSERS_FILE);
  writeFileSync(configPath, JSON.stringify(browsers, null, 2));
};

export const getCustomUserDataDir = (executablePath: string): string | null => {
  const customBrowsers = loadCustomBrowsers();
  const found = customBrowsers.find((browser) => browser.executablePath === executablePath);
  return found?.userDataDir ?? null;
};

export const detectBrowserProfiles = (): BrowserProfile[] => {
  const currentPlatform = platform();
  const allProfiles: BrowserProfile[] = [];

  const installedBrowsers =
    currentPlatform === "darwin"
      ? detectBrowsersMacOS()
      : currentPlatform === "linux"
        ? detectBrowsersLinux()
        : [];

  for (const browser of installedBrowsers) {
    const config = BROWSER_CONFIGS.find(
      (browserConfig) => browserConfig.info.name === browser.name,
    );
    if (!config) continue;

    const userDataDir = getUserDataDir(config);
    if (!userDataDir) continue;

    const profiles = detectProfilesForBrowser(browser, userDataDir);
    allProfiles.push(...profiles);
  }

  const customBrowsers = loadCustomBrowsers();
  for (const custom of customBrowsers) {
    const browser: BrowserInfo = { name: custom.name, executablePath: custom.executablePath };
    const profiles = detectProfilesForBrowser(browser, custom.userDataDir);
    allProfiles.push(...profiles);
  }

  return allProfiles;
};
