import { Effect } from "effect";
import { captureSnapshot, waitForNetworkIdle } from "./helpers";
import { RefResolver, type ToolRef } from "./types";

export const hover = Effect.fn("browser.tools.hover")(function* (ref: ToolRef) {
  yield* Effect.annotateCurrentSpan({ ref });
  const resolver = yield* RefResolver;
  const element = yield* resolver.resolveRef(ref);
  yield* element.hover();
  yield* waitForNetworkIdle();
  const snapshot = yield* captureSnapshot();
  yield* Effect.logInfo("browser.tools.hover", { ref });
  return { snapshot } as const;
});
