import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Browsers } from "../src/browser-detector.js";
import { layerLive } from "../src/layers.js";

describe("Browsers", () => {
  it.effect("returns at least 2 browsers", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const results = yield* browsers.list;
      assert.isArray(results);
      assert.isAbove(results.length, 1);
    }).pipe(Effect.provide(layerLive))
  );

  it.effect("chromium browsers have an executablePath", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const results = yield* browsers.list;
      const chromium = results.filter(
        (browser) => browser._tag === "ChromiumBrowser"
      );
      assert.isAbove(chromium.length, 0);
      for (const browser of chromium) {
        assert.isString(browser.executablePath);
        assert.notStrictEqual(browser.executablePath, "");
      }
    }).pipe(Effect.provide(layerLive))
  );

  it.effect("defaultBrowser returns Safari", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const result = yield* browsers.defaultBrowser();
      assert.isTrue(Option.isSome(result));
      assert.strictEqual(result.value._tag, "SafariBrowser");
    }).pipe(Effect.provide(layerLive))
  );
});
