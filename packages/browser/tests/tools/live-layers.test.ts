import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  networkIdleSamplerLayer,
  refResolverLayerUid,
  snapshotTakerLayer,
  waitForEngineLayer,
} from "../../src/tools/live";
import {
  NetworkIdleSampler,
  RefResolver,
  SnapshotTaker,
  ToolRef,
  WaitForEngine,
} from "../../src/tools/types";
import { makeFakeDevTools, networkResponse, snapshotResponse } from "./live-layer-support";

const ref = Schema.decodeSync(ToolRef);

const SNAPSHOT_WITH_UIDS = `[0-1] <body uid=2_0>
  [0-2] <nav uid=2_1 role=navigation>
    [0-3] <button uid=2_10 "Buy">
    [0-4] <button uid=2_100 "Build your Volvo">`;

const NETWORK_TWO_PENDING = `Showing 1-3 of 3 (Page 1 of 1).
reqid=1 GET https://example.com/ [200]
reqid=2 GET https://example.com/app.js [pending]
reqid=3 GET https://example.com/data.json [pending]`;

const NETWORK_IDLE_TEXT = `Showing 1-1 of 1 (Page 1 of 1).
reqid=1 GET https://example.com/ [200]`;

describe("live RefResolver (uid pass-through)", () => {
  it("resolves a ref that appears verbatim as uid= in the snapshot", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SNAPSHOT_WITH_UIDS) },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        const handle = yield* resolver.resolveRef(ref("2_10"));
        expect(handle.ref).toBe("2_10");
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );
  });

  it("distinguishes uid=2_10 from uid=2_100 (no substring false-positive)", async () => {
    // The snapshot contains BOTH 2_10 and 2_100. Resolving "2_10" must bind to
    // the "Buy" button; a hypothetical ref "2_1000" must fail.
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SNAPSHOT_WITH_UIDS) },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        return yield* resolver.resolveRef(ref("2_1000"));
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("RefNotFoundError");
    }
  });

  it("fails with RefNotFoundError when uid is simply absent", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SNAPSHOT_WITH_UIDS) },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        return yield* resolver.resolveRef(ref("nonexistent"));
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

const SELECT_SNAPSHOT = `uid=10 combobox "Color"
  uid=11 option "Red" value="red"
  uid=12 option "Green" value="green"
  uid=13 option "Blue" value="blue"
uid=20 button "Submit"`;

describe("live RefResolver select semantics", () => {
  it("numeric select(index) resolves via snapshot and calls fill with the Nth option's name", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SELECT_SNAPSHOT) },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        const handle = yield* resolver.resolveRef(ref("10"));
        yield* handle.select(1);
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );

    const fillCalls = fake.calls.filter((c) => c.tool === "fill");
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0]?.args).toEqual({ uid: "10", value: "Green" });
    expect(fake.calls.map((c) => c.tool)).not.toContain("evaluate_script");
  });

  it("numeric select(0) picks the first option's name", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SELECT_SNAPSHOT) },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        const handle = yield* resolver.resolveRef(ref("10"));
        yield* handle.select(0);
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );

    const fillCalls = fake.calls.filter((c) => c.tool === "fill");
    expect(fillCalls[0]?.args.value).toBe("Red");
  });

  it("numeric select fails with InteractionError when index is out of range", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SELECT_SNAPSHOT) },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        const handle = yield* resolver.resolveRef(ref("10"));
        yield* handle.select(99);
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("out of range");
    }
  });

  it("numeric select fails with InteractionError when ref has no option children", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SNAPSHOT_WITH_UIDS) },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        const handle = yield* resolver.resolveRef(ref("2_10"));
        yield* handle.select(0);
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("no option children");
    }
  });

  it("string select(option) passes the string verbatim to fill (combobox by label)", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SELECT_SNAPSHOT) },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* RefResolver;
        const handle = yield* resolver.resolveRef(ref("10"));
        yield* handle.select("Red");
      }).pipe(Effect.provide(refResolverLayerUid), Effect.provide(fake.layer)),
    );

    const fillCalls = fake.calls.filter((c) => c.tool === "fill");
    expect(fillCalls[0]?.args).toEqual({ uid: "10", value: "Red" });
    expect(fake.calls.map((c) => c.tool)).not.toContain("evaluate_script");
  });
});

describe("live NetworkIdleSampler", () => {
  it("returns the count of [pending] lines against real chrome-devtools-mcp output", async () => {
    const fake = makeFakeDevTools({
      responses: { list_network_requests: networkResponse(NETWORK_TWO_PENDING) },
    });

    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const sampler = yield* NetworkIdleSampler;
        return yield* sampler.inFlightCount();
      }).pipe(Effect.provide(networkIdleSamplerLayer), Effect.provide(fake.layer)),
    );

    expect(count).toBe(2);
  });

  it("returns 0 when all requests are settled", async () => {
    const fake = makeFakeDevTools({
      responses: { list_network_requests: networkResponse(NETWORK_IDLE_TEXT) },
    });

    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const sampler = yield* NetworkIdleSampler;
        return yield* sampler.inFlightCount();
      }).pipe(Effect.provide(networkIdleSamplerLayer), Effect.provide(fake.layer)),
    );

    expect(count).toBe(0);
  });

  it("propagates DevToolsToolError as InteractionError (no silent swallowing)", async () => {
    const fake = makeFakeDevTools({
      failures: { list_network_requests: "connection refused" },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sampler = yield* NetworkIdleSampler;
        return yield* sampler.inFlightCount();
      }).pipe(Effect.provide(networkIdleSamplerLayer), Effect.provide(fake.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("InteractionError");
    }
  });
});

describe("live SnapshotTaker", () => {
  it("returns the accessibility tree text verbatim", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SNAPSHOT_WITH_UIDS) },
    });

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const taker = yield* SnapshotTaker;
        return yield* taker.capture();
      }).pipe(Effect.provide(snapshotTakerLayer), Effect.provide(fake.layer)),
    );

    expect(snapshot.text).toBe(SNAPSHOT_WITH_UIDS);
  });

  it("propagates DevToolsToolError as InteractionError (no silent swallowing)", async () => {
    const fake = makeFakeDevTools({ failures: { take_snapshot: "protocol error" } });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const taker = yield* SnapshotTaker;
        return yield* taker.capture();
      }).pipe(Effect.provide(snapshotTakerLayer), Effect.provide(fake.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("InteractionError");
    }
  });
});

describe("live WaitForEngine", () => {
  it("waitForRef succeeds when the uid appears in the snapshot", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SNAPSHOT_WITH_UIDS) },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* WaitForEngine;
        yield* engine.waitForRef(ref("2_10"), "visible", 500);
      }).pipe(Effect.provide(waitForEngineLayer), Effect.provide(fake.layer)),
    );
  });

  it("waitForRef times out when the uid never appears", async () => {
    const fake = makeFakeDevTools({
      responses: { take_snapshot: snapshotResponse(SNAPSHOT_WITH_UIDS) },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const engine = yield* WaitForEngine;
        yield* engine.waitForRef(ref("nonexistent"), "visible", 200);
      }).pipe(Effect.provide(waitForEngineLayer), Effect.provide(fake.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("WaitTimeoutError");
    }
  });
});
