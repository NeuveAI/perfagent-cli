import { assert, describe, it } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { TokenUsageBus, TokenUsageEntry } from "../src/token-usage-bus";

const makePlannerEntry = (promptTokens: number, completionTokens: number): TokenUsageEntry =>
  new TokenUsageEntry({
    source: "planner",
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    timestamp: 1_700_000_000_000,
  });

const makeExecutorEntry = (
  promptTokens: number,
  completionTokens: number,
  timestamp: number,
): TokenUsageEntry =>
  new TokenUsageEntry({
    source: "executor",
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    timestamp,
  });

describe("TokenUsageBus.layerNoop", () => {
  it("drain returns an empty array without publishing anything", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      const drained = yield* bus.drain;
      return drained;
    });

    const drained = await Effect.runPromise(program.pipe(Effect.provide(TokenUsageBus.layerNoop)));
    assert.deepStrictEqual(drained, []);
  });

  it("publish is a no-op: subsequent drain still returns empty", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      yield* bus.publish(makePlannerEntry(100, 50));
      yield* bus.publish(makeExecutorEntry(200, 75, 1));
      return yield* bus.drain;
    });

    const drained = await Effect.runPromise(program.pipe(Effect.provide(TokenUsageBus.layerNoop)));
    assert.deepStrictEqual(drained, []);
  });

  it("publish never fails or throws", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      // The noop publish is `() => Effect.void` — calling it N times must succeed.
      for (let index = 0; index < 50; index += 1) {
        yield* bus.publish(makeExecutorEntry(index, index, index));
      }
      return yield* bus.drain;
    });

    const drained = await Effect.runPromise(program.pipe(Effect.provide(TokenUsageBus.layerNoop)));
    assert.deepStrictEqual(drained, []);
  });
});

describe("TokenUsageBus.layerRef", () => {
  it("collects entries in publish order and drain returns them", async () => {
    const plannerEntry = makePlannerEntry(150, 60);
    const executorEntry = makeExecutorEntry(400, 80, 1_700_000_000_100);

    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      yield* bus.publish(plannerEntry);
      yield* bus.publish(executorEntry);
      return yield* bus.drain;
    });

    const drained = await Effect.runPromise(program.pipe(Effect.provide(TokenUsageBus.layerRef)));
    assert.strictEqual(drained.length, 2);
    assert.strictEqual(drained[0].source, "planner");
    assert.strictEqual(drained[0].promptTokens, 150);
    assert.strictEqual(drained[0].completionTokens, 60);
    assert.strictEqual(drained[0].totalTokens, 210);
    assert.strictEqual(drained[1].source, "executor");
    assert.strictEqual(drained[1].promptTokens, 400);
    assert.strictEqual(drained[1].completionTokens, 80);
    assert.strictEqual(drained[1].totalTokens, 480);
  });

  it("drain clears the buffer: a second drain after no intervening publish returns empty", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      yield* bus.publish(makePlannerEntry(10, 5));
      yield* bus.publish(makeExecutorEntry(20, 15, 2));
      const first = yield* bus.drain;
      const second = yield* bus.drain;
      return { first, second };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(TokenUsageBus.layerRef)));
    assert.strictEqual(result.first.length, 2);
    assert.deepStrictEqual(result.second, []);
  });

  it("publishes after drain accumulate into the next drain", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      yield* bus.publish(makePlannerEntry(50, 25));
      const afterFirstPublish = yield* bus.drain;
      yield* bus.publish(makeExecutorEntry(300, 50, 5));
      yield* bus.publish(makeExecutorEntry(400, 70, 6));
      const afterSecondPublish = yield* bus.drain;
      return { afterFirstPublish, afterSecondPublish };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(TokenUsageBus.layerRef)));
    assert.strictEqual(result.afterFirstPublish.length, 1);
    assert.strictEqual(result.afterFirstPublish[0].source, "planner");
    assert.strictEqual(result.afterSecondPublish.length, 2);
    assert.strictEqual(result.afterSecondPublish[0].timestamp, 5);
    assert.strictEqual(result.afterSecondPublish[1].timestamp, 6);
  });

  it("each Layer build gets an isolated Ref (per-task isolation)", async () => {
    // Simulate two independent tasks under the same runner: each should see
    // only its own publishes, never the other's. `Layer.effect(this)(make)`
    // constructs a fresh Ref per layer build, so two independent `Effect.provide(
    // TokenUsageBus.layerRef)` wrappers must share NO state.
    const taskEffect = (prompt: number) =>
      Effect.gen(function* () {
        const bus = yield* TokenUsageBus;
        yield* bus.publish(makeExecutorEntry(prompt, 10, 1));
        return yield* bus.drain;
      });

    const [taskA, taskB] = await Promise.all([
      Effect.runPromise(taskEffect(100).pipe(Effect.provide(TokenUsageBus.layerRef))),
      Effect.runPromise(taskEffect(200).pipe(Effect.provide(TokenUsageBus.layerRef))),
    ]);

    assert.strictEqual(taskA.length, 1);
    assert.strictEqual(taskA[0].promptTokens, 100);
    assert.strictEqual(taskB.length, 1);
    assert.strictEqual(taskB[0].promptTokens, 200);
  });

  it("sequential task scopes under the same runner see fresh buses", async () => {
    // Stronger version of the isolation guarantee: same makeTaskLayer invoked
    // twice sequentially, no cross-task leakage.
    const runTask = (prompt: number) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* TokenUsageBus;
          yield* bus.publish(makeExecutorEntry(prompt, 5, 0));
          yield* bus.publish(makeExecutorEntry(prompt + 10, 5, 1));
          return yield* bus.drain;
        }).pipe(Effect.provide(TokenUsageBus.layerRef)),
      );

    const firstDrained = await runTask(1000);
    const secondDrained = await runTask(2000);
    assert.strictEqual(firstDrained.length, 2);
    assert.strictEqual(firstDrained[0].promptTokens, 1000);
    assert.strictEqual(firstDrained[1].promptTokens, 1010);
    assert.strictEqual(secondDrained.length, 2);
    assert.strictEqual(secondDrained[0].promptTokens, 2000);
    assert.strictEqual(secondDrained[1].promptTokens, 2010);
  });

  it("integrates with downstream composition via Layer.provide", async () => {
    // Callers wire `TokenUsageBus.layerRef` underneath their Executor/
    // PlanDecomposer layers. Confirm the service is reachable through a
    // provideMerge composition and still drains a single shared buffer.
    const upstreamLayer = Layer.effect(TokenUsageBus)(
      Effect.gen(function* () {
        const underlying = yield* TokenUsageBus;
        return underlying;
      }),
    ).pipe(Layer.provideMerge(TokenUsageBus.layerRef));

    const program = Effect.gen(function* () {
      const bus = yield* TokenUsageBus;
      yield* bus.publish(makePlannerEntry(5, 5));
      yield* bus.publish(makeExecutorEntry(10, 5, 1));
      return yield* bus.drain;
    });

    const drained = await Effect.runPromise(program.pipe(Effect.provide(upstreamLayer)));
    assert.strictEqual(drained.length, 2);
  });
});
