import { Effect } from "effect";
import { captureSnapshot, waitForNetworkIdle } from "./helpers";
import { RefResolver, type FillOptions, type ToolRef } from "./types";

export const fill = Effect.fn("browser.tools.fill")(function* (
  ref: ToolRef,
  text: string,
  options?: FillOptions,
) {
  yield* Effect.annotateCurrentSpan({
    ref,
    textLength: text.length,
    clearFirst: options?.clearFirst,
  });
  const resolver = yield* RefResolver;
  const element = yield* resolver.resolveRef(ref);
  yield* element.fill(text, {
    ...(options?.clearFirst !== undefined && { clearFirst: options.clearFirst }),
  });
  yield* waitForNetworkIdle();
  const snapshot = yield* captureSnapshot();
  yield* Effect.logInfo("browser.tools.fill", { ref, textLength: text.length });
  return { snapshot } as const;
});
