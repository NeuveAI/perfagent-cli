import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { fill } from "../../src/tools/fill";
import { asRef, makeTestLayers } from "./support";

describe("tools/fill", () => {
  it("resolves ref, fills text, returns post-fill snapshot", async () => {
    const { layer, hooks } = makeTestLayers({ knownRefs: ["input-7"] });

    const result = await Effect.runPromise(
      fill(asRef("input-7"), "hello world", { clearFirst: true }).pipe(Effect.provide(layer)),
    );

    const fillCalls = hooks.calls.filter((c) => c.action === "fill");
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0]?.payload).toMatchObject({
      text: "hello world",
      fillOptions: { clearFirst: true },
    });
    expect(result.snapshot.text).toContain("snapshot-after-fill");
  });

  it("fails with RefNotFoundError when ref is unknown", async () => {
    const { layer } = makeTestLayers({ knownRefs: [] });

    const exit = await Effect.runPromiseExit(
      fill(asRef("missing"), "value").pipe(Effect.provide(layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("RefNotFoundError");
    }
  });

  it("fails with InteractionError when fill throws", async () => {
    const { layer } = makeTestLayers({ knownRefs: ["input-7"], failOn: ["fill"] });

    const exit = await Effect.runPromiseExit(
      fill(asRef("input-7"), "boom").pipe(Effect.provide(layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("InteractionError");
    }
  });
});
