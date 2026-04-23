import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { hover } from "../../src/tools/hover";
import { asRef, makeTestLayers } from "./support";

describe("tools/hover", () => {
  it("resolves ref, hovers, returns post-hover snapshot", async () => {
    const { layer, hooks } = makeTestLayers({ knownRefs: ["menu-2"] });

    const result = await Effect.runPromise(hover(asRef("menu-2")).pipe(Effect.provide(layer)));

    expect(hooks.calls.filter((c) => c.action === "hover")).toHaveLength(1);
    expect(result.snapshot.text).toContain("snapshot-after-hover");
  });

  it("fails with RefNotFoundError on unknown ref", async () => {
    const { layer } = makeTestLayers({ knownRefs: [] });

    const exit = await Effect.runPromiseExit(hover(asRef("missing")).pipe(Effect.provide(layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("RefNotFoundError");
    }
  });

  it("fails with InteractionError when hover throws", async () => {
    const { layer } = makeTestLayers({ knownRefs: ["menu-2"], failOn: ["hover"] });

    const exit = await Effect.runPromiseExit(hover(asRef("menu-2")).pipe(Effect.provide(layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("InteractionError");
    }
  });
});
