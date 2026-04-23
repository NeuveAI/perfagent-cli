import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { select } from "../../src/tools/select";
import { asRef, makeTestLayers } from "./support";

describe("tools/select", () => {
  it("resolves ref, selects option, returns snapshot", async () => {
    const { layer, hooks } = makeTestLayers({ knownRefs: ["dropdown-1"] });

    const result = await Effect.runPromise(
      select(asRef("dropdown-1"), "red").pipe(Effect.provide(layer)),
    );

    const calls = hooks.calls.filter((c) => c.action === "select");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toBe("red");
    expect(result.snapshot.text).toContain("snapshot-after-select");
  });

  it("accepts numeric options (indexes)", async () => {
    const { layer, hooks } = makeTestLayers({ knownRefs: ["dropdown-1"] });

    await Effect.runPromise(select(asRef("dropdown-1"), 2).pipe(Effect.provide(layer)));

    expect(hooks.calls.find((c) => c.action === "select")?.payload).toBe(2);
  });

  it("fails with RefNotFoundError on unknown ref", async () => {
    const { layer } = makeTestLayers({ knownRefs: [] });

    const exit = await Effect.runPromiseExit(
      select(asRef("missing"), "red").pipe(Effect.provide(layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("RefNotFoundError");
    }
  });

  it("fails with InteractionError when select throws", async () => {
    const { layer } = makeTestLayers({
      knownRefs: ["dropdown-1"],
      failOn: ["select"],
    });

    const exit = await Effect.runPromiseExit(
      select(asRef("dropdown-1"), "red").pipe(Effect.provide(layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("InteractionError");
    }
  });
});
