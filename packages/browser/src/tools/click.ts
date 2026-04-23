import { Effect } from "effect";
import { captureSnapshot, waitForNetworkIdle } from "./helpers";
import { RefResolver, type ClickOptions, type ToolRef } from "./types";

export const click = Effect.fn("browser.tools.click")(function* (
  ref: ToolRef,
  options?: ClickOptions,
) {
  yield* Effect.annotateCurrentSpan({
    ref,
    button: options?.button,
    clickCount: options?.clickCount,
  });
  const resolver = yield* RefResolver;
  const element = yield* resolver.resolveRef(ref);
  yield* element.click({
    ...(options?.button !== undefined && { button: options.button }),
    ...(options?.clickCount !== undefined && { clickCount: options.clickCount }),
  });
  yield* waitForNetworkIdle();
  const snapshot = yield* captureSnapshot();
  yield* Effect.logInfo("browser.tools.click", { ref });
  return { snapshot } as const;
});
