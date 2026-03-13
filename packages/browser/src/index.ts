export { createPage } from "./create-page";
export { injectCookies } from "./inject-cookies";
export { act } from "./act";
export { snapshot } from "./snapshot";
export {
  CookieJar,
  detectBrowserProfiles,
  toCookieHeader,
} from "@browser-tester/cookies";
export type {
  Browser,
  BrowserInfo,
  BrowserProfile,
  Cookie,
  ExtractResult,
} from "@browser-tester/cookies";
export type {
  AriaRole,
  CreatePageOptions,
  CreatePageResult,
  InjectCookiesOptions,
  RefEntry,
  RefMap,
  SnapshotOptions,
  SnapshotResult,
} from "./types";
