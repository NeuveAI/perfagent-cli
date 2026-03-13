import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCookiesFromBrowser, getWebSocketDebuggerUrl } from "./cdp/cdp.js";
import { BROWSER_STARTUP_DELAY_MS, CDP_LOCAL_PORT, HEADLESS_CHROME_ARGS } from "./constants.js";
import type {
  BrowserProfile,
  CdpRawCookie,
  ExtractProfileOptions,
  ExtractProfileResult,
  ProfileCookie,
  SameSitePolicy,
} from "./types.js";

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const copyDir = (source: string, destination: string): void => {
  mkdirSync(destination, { recursive: true });

  const entries = readdirSync(source);

  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    const destinationPath = path.join(destination, entry);

    try {
      const stats = statSync(sourcePath);

      if (stats.isDirectory()) {
        copyDir(sourcePath, destinationPath);
      } else {
        copyFileSync(sourcePath, destinationPath);
      }
    } catch {
      // HACK: some files may be locked or inaccessible while Chrome is running, skip them
    }
  }
};

const startHeadlessBrowser = (
  executablePath: string,
  userDataDir: string,
  port: number,
): ChildProcess => {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...HEADLESS_CHROME_ARGS,
  ];

  const childProcess = spawn(executablePath, args, {
    stdio: "ignore",
    detached: true,
  });

  childProcess.unref();
  return childProcess;
};

const VALID_SAME_SITE_POLICIES = new Set<string>(["Strict", "Lax", "None"]);

const normalizeSameSite = (value: string): SameSitePolicy | undefined => {
  if (VALID_SAME_SITE_POLICIES.has(value)) {
    return value as SameSitePolicy;
  }
  return undefined;
};

const toProfileCookie = (raw: CdpRawCookie): ProfileCookie => ({
  name: raw.name,
  value: raw.value,
  domain: raw.domain,
  path: raw.path,
  expires: raw.expires > 0 ? raw.expires : undefined,
  secure: raw.secure,
  httpOnly: raw.httpOnly,
  sameSite: normalizeSameSite(raw.sameSite),
});

const removeSingletonLocks = (profileDir: string): void => {
  const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
  for (const lockFile of lockFiles) {
    const lockPath = path.join(profileDir, lockFile);
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  }
};

export const extractProfileCookies = async (
  options: ExtractProfileOptions,
): Promise<ExtractProfileResult> => {
  const { profile } = options;
  const port = options.port ?? CDP_LOCAL_PORT;
  const warnings: string[] = [];

  const tempDir = mkdtempSync(path.join(tmpdir(), "profile-sync-"));
  let browser: ChildProcess | null = null;

  try {
    const profileCopyPath = path.join(tempDir, "profile");
    copyDir(profile.profilePath, profileCopyPath);
    removeSingletonLocks(profileCopyPath);

    browser = startHeadlessBrowser(profile.browser.executablePath, profileCopyPath, port);

    await sleep(BROWSER_STARTUP_DELAY_MS);

    const webSocketUrl = await getWebSocketDebuggerUrl(port);
    const rawCookies = await getCookiesFromBrowser(webSocketUrl);

    if (rawCookies.length === 0) {
      warnings.push(`no cookies found in profile: ${profile.displayName}`);
      return { cookies: [], warnings };
    }

    const cookies = rawCookies.map(toProfileCookie);
    return { cookies, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`failed to extract cookies from ${profile.displayName}: ${message}`);
    return { cookies: [], warnings };
  } finally {
    if (browser) {
      try {
        browser.kill();
      } catch {
        // HACK: process may have already exited
      }
    }

    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // HACK: temp dir cleanup failure is non-fatal
    }
  }
};

export const extractAllProfileCookies = async (
  profiles: BrowserProfile[],
): Promise<ExtractProfileResult> => {
  const allCookies: ProfileCookie[] = [];
  const allWarnings: string[] = [];

  for (const profile of profiles) {
    const result = await extractProfileCookies({ profile });
    allCookies.push(...result.cookies);
    allWarnings.push(...result.warnings);
  }

  return { cookies: allCookies, warnings: allWarnings };
};
