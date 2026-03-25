import { Effect } from "effect";
import { Analytics } from "@expect/shared/observability";
import { usePreferencesStore } from "../stores/use-preferences";

export const trackSessionStarted = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const analytics = yield* Analytics;
      yield* analytics.capture("session:started", {
        mode: "interactive",
        skip_planning: false,
        browser_headed: usePreferencesStore.getState().browserHeaded,
      });
    }).pipe(Effect.provide(Analytics.layerPostHog)),
  );

export const flushSession = (sessionStartedAt: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const analytics = yield* Analytics;
      yield* analytics.capture("session:ended", {
        session_ms: Date.now() - sessionStartedAt,
      });
      yield* analytics.flush;
    }).pipe(Effect.provide(Analytics.layerPostHog)),
  );