import { Effect, Layer, Schema } from "effect";
import { DevToolsClient } from "../devtools-client";
import { InteractionError, RefNotFoundError, WaitTimeoutError } from "./errors";
import {
  countPendingNetworkRequests,
  extractText,
  findOptionsForSelect,
  snapshotContainsUid,
} from "./parse";
import {
  NetworkIdleSampler,
  RefResolver,
  SnapshotTaker,
  ToolRef,
  WaitForEngine,
  type ElementClickOptions,
  type ElementFillOptions,
  type ElementHandle,
  type WaitForState,
} from "./types";

const asToolRef = Schema.decodeSync(ToolRef);

const DEFAULT_WAIT_STEP_MS = 100;

export const refResolverLayerUid = Layer.effect(RefResolver)(
  Effect.gen(function* () {
    const devtools = yield* DevToolsClient;

    // HACK: Wave 2.A ships a chrome-devtools-mcp-uid pass-through resolver.
    // Wave 2.C will provide a SOM-backed Layer.effect(RefResolver) that maps
    // numbered SOM labels → uids using the overlay's refs table. The tool
    // wrappers in click.ts / fill.ts / hover.ts / select.ts / wait-for.ts are
    // resolver-agnostic; overriding this layer is the only change required.
    const buildElement = (ref: ToolRef): ElementHandle => ({
      ref,
      click: (options?: ElementClickOptions) =>
        devtools
          .callTool("click", {
            uid: ref,
            ...(options?.clickCount !== undefined && options.clickCount > 1 && { dblClick: true }),
          })
          .pipe(
            Effect.asVoid,
            Effect.catchTag("DevToolsToolError", (error) =>
              new InteractionError({ action: "click", ref, cause: error.cause }).asEffect(),
            ),
          ),
      fill: (text: string, options?: ElementFillOptions) =>
        Effect.gen(function* () {
          if (options?.clearFirst) {
            yield* devtools.callTool("fill", { uid: ref, value: "" });
          }
          yield* devtools.callTool("fill", { uid: ref, value: text });
        }).pipe(
          Effect.asVoid,
          Effect.catchTag("DevToolsToolError", (error) =>
            new InteractionError({ action: "fill", ref, cause: error.cause }).asEffect(),
          ),
        ),
      hover: () =>
        devtools.callTool("hover", { uid: ref }).pipe(
          Effect.asVoid,
          Effect.catchTag("DevToolsToolError", (error) =>
            new InteractionError({ action: "hover", ref, cause: error.cause }).asEffect(),
          ),
        ),
      select: (option: string | number) => {
        if (typeof option === "number") {
          return Effect.gen(function* () {
            const snapshot = yield* devtools.takeSnapshot({}).pipe(
              Effect.catchTag("DevToolsToolError", (error) =>
                new InteractionError({
                  action: "select",
                  ref,
                  cause: `failed to take snapshot: ${error.cause}`,
                }).asEffect(),
              ),
            );
            const options = findOptionsForSelect(extractText(snapshot), ref);
            if (options.length === 0) {
              return yield* new InteractionError({
                action: "select",
                ref,
                cause: "no option children found for this select",
              });
            }
            if (option < 0 || option >= options.length) {
              return yield* new InteractionError({
                action: "select",
                ref,
                cause: `index ${option} out of range (0..${options.length - 1})`,
              });
            }
            const picked = options[option];
            const label = picked?.name ?? picked?.value;
            if (label === undefined) {
              return yield* new InteractionError({
                action: "select",
                ref,
                cause: `option at index ${option} has neither name nor value`,
              });
            }
            yield* devtools
              .callTool("fill", { uid: ref, value: label })
              .pipe(
                Effect.catchTag("DevToolsToolError", (error) =>
                  new InteractionError({ action: "select", ref, cause: error.cause }).asEffect(),
                ),
              );
          });
        }
        return devtools.callTool("fill", { uid: ref, value: option }).pipe(
          Effect.asVoid,
          Effect.catchTag("DevToolsToolError", (error) =>
            new InteractionError({ action: "select", ref, cause: error.cause }).asEffect(),
          ),
        );
      },
    });

    return {
      resolveRef: Effect.fn("RefResolver.resolveRef")(function* (ref: ToolRef) {
        yield* Effect.annotateCurrentSpan({ ref });
        const snapshot = yield* devtools.takeSnapshot({}).pipe(
          Effect.catchTag("DevToolsToolError", (error) =>
            new RefNotFoundError({
              ref,
              reason: `failed to take snapshot: ${error.cause}`,
            }).asEffect(),
          ),
        );
        if (!snapshotContainsUid(extractText(snapshot), ref)) {
          return yield* new RefNotFoundError({
            ref,
            reason: "no node with matching uid in current snapshot",
          });
        }
        return buildElement(ref);
      }),
    };
  }),
);

const NETWORK_PROBE_REF = asToolRef("network-idle");
const SNAPSHOT_PROBE_REF = asToolRef("snapshot");

export const networkIdleSamplerLayer = Layer.effect(NetworkIdleSampler)(
  Effect.gen(function* () {
    const devtools = yield* DevToolsClient;
    return {
      inFlightCount: Effect.fn("NetworkIdleSampler.inFlightCount")(function* () {
        const result = yield* devtools.listNetworkRequests({}).pipe(
          Effect.catchTag("DevToolsToolError", (error) =>
            new InteractionError({
              action: "list_network_requests",
              ref: NETWORK_PROBE_REF,
              cause: error.cause,
            }).asEffect(),
          ),
        );
        return countPendingNetworkRequests(extractText(result));
      }),
    };
  }),
);

export const snapshotTakerLayer = Layer.effect(SnapshotTaker)(
  Effect.gen(function* () {
    const devtools = yield* DevToolsClient;
    return {
      capture: Effect.fn("SnapshotTaker.capture")(function* () {
        const result = yield* devtools.takeSnapshot({}).pipe(
          Effect.catchTag("DevToolsToolError", (error) =>
            new InteractionError({
              action: "take_snapshot",
              ref: SNAPSHOT_PROBE_REF,
              cause: error.cause,
            }).asEffect(),
          ),
        );
        return {
          text: extractText(result),
          capturedAt: Date.now(),
        };
      }),
    };
  }),
);

export const waitForEngineLayer = Layer.effect(WaitForEngine)(
  Effect.gen(function* () {
    const devtools = yield* DevToolsClient;

    const waitUntil = (
      target: string,
      state: WaitForState,
      timeoutMs: number,
      probe: () => Effect.Effect<boolean, InteractionError>,
    ) =>
      Effect.gen(function* () {
        const deadline = Date.now() + timeoutMs;
        const desired = state !== "hidden" && state !== "detached";
        let observedAtLeastOnce = false;
        while (Date.now() < deadline) {
          const actual = yield* probe();
          if (actual) observedAtLeastOnce = true;
          if (actual === desired) return;
          yield* Effect.sleep(`${DEFAULT_WAIT_STEP_MS} millis`);
        }
        return yield* new WaitTimeoutError({
          target,
          state,
          timeoutMs,
          observedAtLeastOnce,
        });
      });

    const WAIT_PROBE_REF = asToolRef("wait-for");

    const refProbe = (ref: ToolRef) =>
      devtools.takeSnapshot({}).pipe(
        Effect.map((snapshot) => snapshotContainsUid(extractText(snapshot), ref)),
        Effect.catchTag("DevToolsToolError", (error) =>
          new InteractionError({ action: "wait_for", ref, cause: error.cause }).asEffect(),
        ),
      );

    const textProbe = (needle: string) =>
      devtools.takeSnapshot({}).pipe(
        Effect.map((snapshot) => extractText(snapshot).includes(needle)),
        Effect.catchTag("DevToolsToolError", (error) =>
          new InteractionError({
            action: "wait_for",
            ref: WAIT_PROBE_REF,
            cause: error.cause,
          }).asEffect(),
        ),
      );

    return {
      waitForSelector: (selector: string, state: WaitForState, timeoutMs: number) =>
        waitUntil(`selector:${selector}`, state, timeoutMs, () => textProbe(selector)),
      waitForAria: (aria: string, state: WaitForState, timeoutMs: number) =>
        waitUntil(`aria:${aria}`, state, timeoutMs, () => textProbe(aria)),
      waitForRef: (ref: ToolRef, state: WaitForState, timeoutMs: number) =>
        waitUntil(`ref:${ref}`, state, timeoutMs, () => refProbe(ref)),
    };
  }),
);

// Production runtime stack; uses the uid-based RefResolver as an interim
// pending Wave 2.C's SOM-backed override.
export const toolsLiveLayer = Layer.mergeAll(
  refResolverLayerUid,
  networkIdleSamplerLayer,
  snapshotTakerLayer,
  waitForEngineLayer,
).pipe(Layer.provideMerge(DevToolsClient.layer));
