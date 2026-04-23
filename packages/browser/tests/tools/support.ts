import { Effect, Layer, Schema } from "effect";
import { InteractionError, RefNotFoundError, WaitTimeoutError } from "../../src/tools/errors";
import {
  NetworkIdleSampler,
  RefResolver,
  SnapshotTaker,
  ToolRef,
  WaitForEngine,
  type ElementClickOptions,
  type ElementFillOptions,
  type ElementHandle,
  type ToolSnapshot,
  type WaitForState,
  type WaitForTarget,
} from "../../src/tools/types";

export interface InteractionCall {
  readonly action: string;
  readonly ref: string;
  readonly payload?: unknown;
}

export interface TestHooks {
  readonly calls: Array<InteractionCall>;
  readonly snapshots: Array<ToolSnapshot>;
  readonly networkSamples: Array<number>;
}

export interface TestLayerOptions {
  readonly knownRefs?: ReadonlyArray<string>;
  readonly failOn?: ReadonlyArray<string>;
  readonly networkIdleAfter?: number;
  readonly snapshotTextByAction?: Record<string, string>;
  readonly waitForShouldTimeout?: boolean;
}

export const asRef = Schema.decodeSync(ToolRef);

export const makeTestLayers = (options: TestLayerOptions = {}) => {
  const hooks: TestHooks = {
    calls: [],
    snapshots: [],
    networkSamples: [],
  };
  const knownRefs = new Set<string>(options.knownRefs ?? []);
  const failOn = new Set<string>(options.failOn ?? []);
  const snapshotTextByAction = options.snapshotTextByAction ?? {};
  let networkCallCount = 0;
  const networkIdleAfter = options.networkIdleAfter ?? 1;

  const recordCall = (action: string, ref: string, payload?: unknown) => {
    hooks.calls.push(payload === undefined ? { action, ref } : { action, ref, payload });
  };

  const makeElement = (ref: ToolRef): ElementHandle => ({
    ref,
    click: (clickOptions?: ElementClickOptions) =>
      Effect.gen(function* () {
        if (failOn.has("click")) {
          return yield* new InteractionError({
            action: "click",
            ref,
            cause: "simulated click failure",
          });
        }
        recordCall("click", ref, clickOptions);
      }),
    fill: (text: string, fillOptions?: ElementFillOptions) =>
      Effect.gen(function* () {
        if (failOn.has("fill")) {
          return yield* new InteractionError({
            action: "fill",
            ref,
            cause: "simulated fill failure",
          });
        }
        recordCall("fill", ref, { text, fillOptions });
      }),
    hover: () =>
      Effect.gen(function* () {
        if (failOn.has("hover")) {
          return yield* new InteractionError({
            action: "hover",
            ref,
            cause: "simulated hover failure",
          });
        }
        recordCall("hover", ref);
      }),
    select: (option: string | number) =>
      Effect.gen(function* () {
        if (failOn.has("select")) {
          return yield* new InteractionError({
            action: "select",
            ref,
            cause: "simulated select failure",
          });
        }
        recordCall("select", ref, option);
      }),
  });

  const refResolverLayer = Layer.succeed(RefResolver, {
    resolveRef: (ref: ToolRef) =>
      Effect.gen(function* () {
        if (!knownRefs.has(ref)) {
          return yield* new RefNotFoundError({ ref, reason: "unknown ref in test fixture" });
        }
        return makeElement(ref);
      }),
  });

  const networkIdleSamplerLayer = Layer.succeed(NetworkIdleSampler, {
    inFlightCount: () =>
      Effect.sync(() => {
        networkCallCount += 1;
        const count = networkCallCount >= networkIdleAfter ? 0 : 1;
        hooks.networkSamples.push(count);
        return count;
      }),
  });

  const snapshotTakerLayer = Layer.succeed(SnapshotTaker, {
    capture: () =>
      Effect.sync(() => {
        const lastCall = hooks.calls[hooks.calls.length - 1];
        const text =
          lastCall && snapshotTextByAction[lastCall.action]
            ? snapshotTextByAction[lastCall.action]
            : `snapshot-after-${lastCall?.action ?? "initial"}`;
        const snapshot: ToolSnapshot = { text, capturedAt: Date.now() };
        hooks.snapshots.push(snapshot);
        return snapshot;
      }),
  });

  const waitForEngineLayer = Layer.succeed(WaitForEngine, {
    waitForSelector: (selector: string, state: WaitForState, timeoutMs: number) =>
      Effect.gen(function* () {
        if (options.waitForShouldTimeout) {
          return yield* new WaitTimeoutError({
            target: `selector:${selector}`,
            state,
            timeoutMs,
            observedAtLeastOnce: false,
          });
        }
        recordCall("wait_for_selector", selector, { state });
      }),
    waitForAria: (aria: string, state: WaitForState, timeoutMs: number) =>
      Effect.gen(function* () {
        if (options.waitForShouldTimeout) {
          return yield* new WaitTimeoutError({
            target: `aria:${aria}`,
            state,
            timeoutMs,
            observedAtLeastOnce: false,
          });
        }
        recordCall("wait_for_aria", aria, { state });
      }),
    waitForRef: (ref: ToolRef, state: WaitForState, timeoutMs: number) =>
      Effect.gen(function* () {
        if (!knownRefs.has(ref)) {
          return yield* new RefNotFoundError({ ref, reason: "unknown ref in test fixture" });
        }
        if (options.waitForShouldTimeout) {
          return yield* new WaitTimeoutError({
            target: `ref:${ref}`,
            state,
            timeoutMs,
            observedAtLeastOnce: false,
          });
        }
        recordCall("wait_for_ref", ref, { state });
      }),
  });

  const layer = Layer.mergeAll(
    refResolverLayer,
    networkIdleSamplerLayer,
    snapshotTakerLayer,
    waitForEngineLayer,
  );

  return { layer, hooks } as const;
};

export const asWaitForTargetRef = (ref: string): WaitForTarget => ({
  kind: "ref",
  ref: asRef(ref),
});

export const asWaitForTargetSelector = (selector: string): WaitForTarget => ({
  kind: "selector",
  selector,
});

export const asWaitForTargetAria = (aria: string): WaitForTarget => ({
  kind: "aria",
  aria,
});
