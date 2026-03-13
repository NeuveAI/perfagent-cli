import type { BrowserInfo } from "./types.js";

export const CDP_RETRY_COUNT = 10;
export const CDP_RETRY_DELAY_MS = 1_000;
export const CDP_LOCAL_PORT = 9222;
export const BROWSER_STARTUP_DELAY_MS = 2_000;

export const HEADLESS_CHROME_ARGS = [
  "--headless",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-startup-window",
];

interface BrowserConfig {
  info: BrowserInfo;
  darwinUserDataPath: string;
  linuxUserDataPath: string;
  win32UserDataPath: string;
}

export const BROWSER_CONFIGS: BrowserConfig[] = [
  {
    info: {
      name: "Google Chrome",
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    darwinUserDataPath: "Google/Chrome",
    linuxUserDataPath: "google-chrome",
    win32UserDataPath: "Google\\Chrome\\User Data",
  },
  {
    info: {
      name: "Brave Browser",
      executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    },
    darwinUserDataPath: "BraveSoftware/Brave-Browser",
    linuxUserDataPath: "BraveSoftware/Brave-Browser",
    win32UserDataPath: "BraveSoftware\\Brave-Browser\\User Data",
  },
  {
    info: {
      name: "Microsoft Edge",
      executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    },
    darwinUserDataPath: "Microsoft Edge",
    linuxUserDataPath: "microsoft-edge",
    win32UserDataPath: "Microsoft\\Edge\\User Data",
  },
  {
    info: {
      name: "Chromium",
      executablePath: "/Applications/Chromium.app/Contents/MacOS/Chromium",
    },
    darwinUserDataPath: "Chromium",
    linuxUserDataPath: "chromium",
    win32UserDataPath: "Chromium\\User Data",
  },
  {
    info: { name: "Vivaldi", executablePath: "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi" },
    darwinUserDataPath: "Vivaldi",
    linuxUserDataPath: "vivaldi",
    win32UserDataPath: "Vivaldi\\User Data",
  },
  {
    info: { name: "Opera", executablePath: "/Applications/Opera.app/Contents/MacOS/Opera" },
    darwinUserDataPath: "com.operasoftware.Opera",
    linuxUserDataPath: "opera",
    win32UserDataPath: "Opera Software\\Opera Stable",
  },
  {
    info: { name: "Arc", executablePath: "/Applications/Arc.app/Contents/MacOS/Arc" },
    darwinUserDataPath: "Arc/User Data",
    linuxUserDataPath: "arc",
    win32UserDataPath: "Arc\\User Data",
  },
  {
    info: {
      name: "Ghost Browser",
      executablePath: "/Applications/Ghost Browser.app/Contents/MacOS/Ghost Browser",
    },
    darwinUserDataPath: "Ghost Browser",
    linuxUserDataPath: "ghost-browser",
    win32UserDataPath: "Ghost Browser\\User Data",
  },
  {
    info: {
      name: "Sidekick",
      executablePath: "/Applications/Sidekick.app/Contents/MacOS/Sidekick",
    },
    darwinUserDataPath: "Sidekick",
    linuxUserDataPath: "sidekick",
    win32UserDataPath: "Sidekick\\User Data",
  },
  {
    info: { name: "Yandex", executablePath: "/Applications/Yandex.app/Contents/MacOS/Yandex" },
    darwinUserDataPath: "YandexBrowser",
    linuxUserDataPath: "yandex-browser",
    win32UserDataPath: "Yandex\\YandexBrowser\\User Data",
  },
  {
    info: { name: "Iridium", executablePath: "/Applications/Iridium.app/Contents/MacOS/Iridium" },
    darwinUserDataPath: "Iridium",
    linuxUserDataPath: "iridium",
    win32UserDataPath: "Iridium\\User Data",
  },
  {
    info: { name: "Thorium", executablePath: "/Applications/Thorium.app/Contents/MacOS/Thorium" },
    darwinUserDataPath: "Thorium",
    linuxUserDataPath: "thorium",
    win32UserDataPath: "Thorium\\User Data",
  },
  {
    info: { name: "SigmaOS", executablePath: "/Applications/SigmaOS.app/Contents/MacOS/SigmaOS" },
    darwinUserDataPath: "SigmaOS",
    linuxUserDataPath: "sigmaos",
    win32UserDataPath: "SigmaOS\\User Data",
  },
  {
    info: { name: "Wavebox", executablePath: "/Applications/Wavebox.app/Contents/MacOS/Wavebox" },
    darwinUserDataPath: "Wavebox",
    linuxUserDataPath: "wavebox",
    win32UserDataPath: "Wavebox\\User Data",
  },
  {
    info: { name: "Comet", executablePath: "/Applications/Comet.app/Contents/MacOS/Comet" },
    darwinUserDataPath: "Comet",
    linuxUserDataPath: "comet",
    win32UserDataPath: "Comet\\User Data",
  },
  {
    info: { name: "Blisk", executablePath: "/Applications/Blisk.app/Contents/MacOS/Blisk" },
    darwinUserDataPath: "Blisk",
    linuxUserDataPath: "blisk",
    win32UserDataPath: "Blisk\\User Data",
  },
  {
    info: { name: "Helium", executablePath: "/Applications/Helium.app/Contents/MacOS/Helium" },
    darwinUserDataPath: "Helium",
    linuxUserDataPath: "helium",
    win32UserDataPath: "Helium\\User Data",
  },
  {
    info: { name: "Dia", executablePath: "/Applications/Dia.app/Contents/MacOS/Dia" },
    darwinUserDataPath: "Dia",
    linuxUserDataPath: "dia",
    win32UserDataPath: "Dia\\User Data",
  },
];
