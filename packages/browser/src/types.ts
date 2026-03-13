import type { Browser } from "@browser-tester/extract-cookie";
import type { ElementInfo as BaseElementInfo } from "element-source";
import type { Browser as PlaywrightBrowser, BrowserContext, Locator, Page } from "playwright";

export interface ElementInfo extends BaseElementInfo {
  selector: string;
}

export type AriaRole = Parameters<Page["getByRole"]>[0];

export interface SnapshotOptions {
  timeout?: number;
}

export interface RefEntry {
  role: AriaRole;
  name: string;
  nth?: number;
}

export interface RefMap {
  [ref: string]: RefEntry;
}

export interface SnapshotResult {
  tree: string;
  refs: RefMap;
  locator: (ref: string) => Locator;
  inspect: (refOrLocator: string | Locator) => Promise<ElementInfo>;
}

export interface ParsedAriaLine {
  role: AriaRole;
  name: string;
}

export interface InjectCookiesOptions {
  url: string;
  browsers?: Browser[];
  names?: string[];
}

export interface CreatePageOptions {
  headed?: boolean;
  executablePath?: string;
  cookies?: boolean;
  cookieBrowsers?: Browser[];
  cookiesFile?: string;
}

export interface CreatePageResult {
  browser: PlaywrightBrowser;
  context: BrowserContext;
  page: Page;
}
