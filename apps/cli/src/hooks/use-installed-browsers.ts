import { useQuery } from "@tanstack/react-query";
import { Effect, Option } from "effect";
import { Browsers, layerLive, browserKeyOf, browserDisplayName } from "@neuve/cookies";
import type { BrowserKey } from "@neuve/cookies";
import * as NodeServices from "@effect/platform-node/NodeServices";

export interface DetectedBrowser {
  key: BrowserKey;
  displayName: string;
  isDefault: boolean;
}

export const useInstalledBrowsers = () =>
  useQuery({
    queryKey: ["installed-browsers"],
    queryFn: (): Promise<DetectedBrowser[]> =>
      Effect.gen(function* () {
        const browsers = yield* Browsers;
        const allBrowsers = yield* browsers.list.pipe(
          Effect.catchTag("ListBrowsersError", () => Effect.succeed([])),
        );
        const maybeDefault = yield* browsers.defaultBrowser().pipe(
          Effect.map(Option.map(browserKeyOf)),
          Effect.map(Option.getOrUndefined),
          Effect.catchTag("ListBrowsersError", () => Effect.succeed(undefined)),
        );

        const seen = new Set<string>();
        const result: DetectedBrowser[] = [];
        for (const browser of allBrowsers) {
          const key = browserKeyOf(browser);
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({
            key,
            displayName: browserDisplayName(browser),
            isDefault: key === maybeDefault,
          });
        }
        return result;
      }).pipe(
        Effect.provide(layerLive),
        Effect.provide(NodeServices.layer),
        Effect.tapCause((cause) => Effect.logWarning("Browser detection failed", { cause })),
        Effect.catchCause(() => Effect.succeed([] as DetectedBrowser[])),
        Effect.runPromise,
      ),
  });
