import { Effect, Layer, Ref, Schema, ServiceMap } from "effect";

/**
 * TokenUsageBus — process-local sink for per-call token-usage telemetry.
 *
 * Publishers (frontier PlannerAgent, Executor tapping ACP usage_update) push
 * a `TokenUsageEntry` after each model call. Consumers (eval runners) drain
 * the buffer once the task stream terminates to emit trace events + compute
 * aggregates (total, peak prompt, per-source split).
 *
 * Production wiring uses `layerNoop` (no collection, zero overhead). The eval
 * harness wires `layerRef` so each task gets its own buffer. Services that
 * depend on this bus are pure publishers — they don't assume any specific
 * backend, so the bus can be swapped without touching service implementations.
 */
export const TokenUsageSource = Schema.Literals(["planner", "executor"] as const);
export type TokenUsageSource = typeof TokenUsageSource.Type;

export class TokenUsageEntry extends Schema.Class<TokenUsageEntry>("@shared/TokenUsageEntry")({
  source: TokenUsageSource,
  promptTokens: Schema.Number,
  completionTokens: Schema.Number,
  totalTokens: Schema.Number,
  timestamp: Schema.Number,
}) {}

export class TokenUsageBus extends ServiceMap.Service<
  TokenUsageBus,
  {
    readonly publish: (entry: TokenUsageEntry) => Effect.Effect<void>;
    readonly drain: Effect.Effect<ReadonlyArray<TokenUsageEntry>>;
  }
>()("@shared/TokenUsageBus") {
  static layerNoop = Layer.succeed(this, {
    publish: () => Effect.void,
    drain: Effect.succeed([] as ReadonlyArray<TokenUsageEntry>),
  });

  static layerRef = Layer.effect(this)(
    Effect.gen(function* () {
      const ref = yield* Ref.make<ReadonlyArray<TokenUsageEntry>>([]);

      const publish = Effect.fn("TokenUsageBus.publish")(function* (entry: TokenUsageEntry) {
        yield* Effect.annotateCurrentSpan({
          source: entry.source,
          promptTokens: entry.promptTokens,
          completionTokens: entry.completionTokens,
        });
        yield* Ref.update(ref, (current) => [...current, entry]);
      });

      const drain = Effect.gen(function* () {
        return yield* Ref.getAndSet(ref, [] as ReadonlyArray<TokenUsageEntry>);
      });

      return { publish, drain } as const;
    }),
  );
}
