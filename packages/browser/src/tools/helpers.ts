import { Effect, Schedule } from "effect";
import {
  NETWORK_IDLE_MAX_WAIT_MS,
  NETWORK_IDLE_POLL_INTERVAL_MS,
  NETWORK_IDLE_THRESHOLD_COUNT,
} from "./constants";
import { NetworkIdleSampler, SnapshotTaker } from "./types";

// Best-effort debounce: we never let a probe failure abort the parent
// interaction. A failing probe is logged (via InteractionError → Warning) and
// converted to "assumed busy" so the time budget keeps ticking. The
// NETWORK_IDLE_MAX_WAIT_MS timeout guarantees the step always completes.
export const waitForNetworkIdle = Effect.fn("tools.waitForNetworkIdle")(function* () {
  const sampler = yield* NetworkIdleSampler;
  const isIdle = yield* sampler.inFlightCount().pipe(
    Effect.map((count) => count <= NETWORK_IDLE_THRESHOLD_COUNT),
    Effect.catchTag("InteractionError", (error) =>
      Effect.logWarning("network-idle-probe-failed", {
        action: error.action,
        cause: error.cause,
      }).pipe(Effect.as(false)),
    ),
    Effect.repeat({
      schedule: Schedule.spaced(`${NETWORK_IDLE_POLL_INTERVAL_MS} millis`),
      until: (idle) => idle,
    }),
    Effect.timeoutOption(`${NETWORK_IDLE_MAX_WAIT_MS} millis`),
  );
  yield* Effect.annotateCurrentSpan({
    networkIdleReached: isIdle._tag === "Some",
  });
});

export const captureSnapshot = Effect.fn("tools.captureSnapshot")(function* () {
  const taker = yield* SnapshotTaker;
  const snapshot = yield* taker.capture();
  yield* Effect.annotateCurrentSpan({ snapshotSize: snapshot.text.length });
  return snapshot;
});
