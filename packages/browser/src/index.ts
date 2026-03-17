export { createPage } from "./create-page";
export { injectCookies } from "./inject-cookies";
export { act } from "./act";
export { snapshot } from "./snapshot";
export { annotatedScreenshot } from "./annotated-screenshot";
export { diffSnapshots } from "./diff";
export { saveVideo } from "./save-video";
export { waitForNavigationSettle } from "./utils/wait-for-settle";
export {
  Browsers,
  Cookies,
  layerLive,
} from "@browser-tester/cookies";
export type {
  Browser,
  BrowserKey,
  ChromiumBrowser,
  FirefoxBrowser,
  SafariBrowser,
  Cookie,
  SameSitePolicy,
} from "@browser-tester/cookies";
export type {
  AnnotatedScreenshotOptions,
  AnnotatedScreenshotResult,
  Annotation,
} from "./annotated-screenshot";
export type { SnapshotDiff } from "./diff";
export type {
  AriaRole,
  CreatePageOptions,
  CreatePageResult,
  RefEntry,
  RefMap,
  SnapshotOptions,
  SnapshotResult,
  SnapshotStats,
  VideoOptions,
} from "./types";
