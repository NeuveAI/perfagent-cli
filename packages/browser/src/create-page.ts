import { Effect, Layer, Option } from "effect";
import {
  Browsers,
  Cookies,
  layerLive,
  type Browser,
  type Cookie,
} from "@browser-tester/cookies";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import {
  DEFAULT_VIDEO_HEIGHT_PX,
  DEFAULT_VIDEO_WIDTH_PX,
  HEADLESS_CHROMIUM_ARGS,
} from "./constants";
import { injectCookies } from "./inject-cookies";
import type {
  CreatePageOptions,
  CreatePageResult,
  VideoOptions,
} from "./types";

const CookiesRuntime = Layer.mergeAll(layerLive, Cookies.layer);

const resolveDefaultBrowser = async (): Promise<Browser | undefined> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const defaultBrowserOption = yield* browsers.defaultBrowser();
      return Option.getOrUndefined(defaultBrowserOption);
    }).pipe(
      Effect.provide(CookiesRuntime),
      Effect.catch(() => Effect.succeed(undefined))
    )
  );

const extractCookiesFromBrowser = async (
  browser: Browser
): Promise<readonly Cookie[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cookies = yield* Cookies;
      return yield* cookies.extract(browser);
    }).pipe(
      Effect.scoped,
      Effect.provide(CookiesRuntime),
      Effect.catch(() => Effect.succeed([] as Cookie[]))
    )
  );

const resolveVideoOptions = (
  video: boolean | VideoOptions | undefined
): VideoOptions | undefined => {
  if (!video) return undefined;
  if (video === true) {
    return {
      dir: tmpdir(),
      size: { width: DEFAULT_VIDEO_WIDTH_PX, height: DEFAULT_VIDEO_HEIGHT_PX },
    };
  }
  return {
    ...video,
    size: video.size ?? {
      width: DEFAULT_VIDEO_WIDTH_PX,
      height: DEFAULT_VIDEO_HEIGHT_PX,
    },
  };
};

const resolveContextOptions = (
  video: VideoOptions | undefined,
  locale: string | undefined
) => {
  if (!video && !locale) return undefined;

  return {
    ...(video ? { recordVideo: video } : {}),
    ...(locale ? { locale } : {}),
  };
};

const navigatePage = async (
  page: CreatePageResult["page"],
  url: string | undefined,
  waitUntil: CreatePageOptions["waitUntil"]
) => {
  if (!url) return;
  await page.goto(url, { waitUntil: waitUntil ?? "load" });
};

export const createPage = async (
  url: string | undefined,
  options: CreatePageOptions = {}
): Promise<CreatePageResult> => {
  const browser = await chromium.launch({
    headless: !options.headed,
    executablePath: options.executablePath,
    args: HEADLESS_CHROMIUM_ARGS,
  });

  try {
    const defaultBrowser =
      options.cookies === true ? await resolveDefaultBrowser() : undefined;

    const locale =
      defaultBrowser?._tag === "ChromiumBrowser"
        ? defaultBrowser.locale
        : undefined;

    const recordVideo = resolveVideoOptions(options.video);
    const context = await browser.newContext(
      resolveContextOptions(recordVideo, locale)
    );

    if (options.cookies) {
      const cookies = Array.isArray(options.cookies)
        ? options.cookies
        : defaultBrowser
        ? await extractCookiesFromBrowser(defaultBrowser)
        : [];
      await injectCookies(context, cookies);
    }

    const page = await context.newPage();
    await navigatePage(page, url, options.waitUntil);

    return { browser, context, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
};
