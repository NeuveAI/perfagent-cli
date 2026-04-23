import { Effect } from "effect";
import { WAIT_FOR_DEFAULT_STATE, WAIT_FOR_DEFAULT_TIMEOUT_MS } from "./constants";
import { captureSnapshot } from "./helpers";
import { WaitForEngine, type WaitForOptions, type WaitForTarget } from "./types";

const describeTarget = (target: WaitForTarget): string => {
  if (target.kind === "ref") return `ref:${target.ref}`;
  if (target.kind === "selector") return `selector:${target.selector}`;
  return `aria:${target.aria}`;
};

export const waitFor = Effect.fn("browser.tools.waitFor")(function* (
  target: WaitForTarget,
  options?: WaitForOptions,
) {
  const state = options?.state ?? WAIT_FOR_DEFAULT_STATE;
  const timeout = options?.timeout ?? WAIT_FOR_DEFAULT_TIMEOUT_MS;
  yield* Effect.annotateCurrentSpan({
    target: describeTarget(target),
    state,
    timeoutMs: timeout,
  });
  const engine = yield* WaitForEngine;
  if (target.kind === "selector") {
    yield* engine.waitForSelector(target.selector, state, timeout);
  } else if (target.kind === "aria") {
    yield* engine.waitForAria(target.aria, state, timeout);
  } else {
    yield* engine.waitForRef(target.ref, state, timeout);
  }
  const snapshot = yield* captureSnapshot();
  yield* Effect.logInfo("browser.tools.waitFor", {
    target: describeTarget(target),
    state,
  });
  return { snapshot } as const;
});
