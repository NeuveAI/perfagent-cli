import { Config, Effect, Layer, Option, ServiceMap } from "effect";
import { DevToolsClient } from "../devtools-client";
import { PERF_AGENT_BASE_URL_ENV_NAME } from "./constants";

export class McpSession extends ServiceMap.Service<McpSession>()("@devtools/McpSession", {
  make: Effect.gen(function* () {
    const baseUrlConfig = yield* Config.option(Config.string(PERF_AGENT_BASE_URL_ENV_NAME));
    const configuredBaseUrl = Option.getOrUndefined(baseUrlConfig);

    const resolveUrl = (url: string): string => {
      if (configuredBaseUrl && !url.startsWith("http://") && !url.startsWith("https://")) {
        try {
          return new URL(url, configuredBaseUrl).toString();
        } catch {
          return url;
        }
      }
      return url;
    };

    return {
      resolveUrl,
    } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(DevToolsClient.layer));
}
