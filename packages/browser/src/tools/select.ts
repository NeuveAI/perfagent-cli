import { Effect } from "effect";
import { captureSnapshot, waitForNetworkIdle } from "./helpers";
import { RefResolver, type ToolRef } from "./types";

export const select = Effect.fn("browser.tools.select")(function* (
  ref: ToolRef,
  option: string | number,
) {
  yield* Effect.annotateCurrentSpan({ ref, option });
  const resolver = yield* RefResolver;
  const element = yield* resolver.resolveRef(ref);
  yield* element.select(option);
  yield* waitForNetworkIdle();
  const snapshot = yield* captureSnapshot();
  yield* Effect.logInfo("browser.tools.select", { ref, option });
  return { snapshot } as const;
});
