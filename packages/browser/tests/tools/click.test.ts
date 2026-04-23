import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { click } from "../../src/tools/click";
import { asRef, makeTestLayers } from "./support";

describe("tools/click", () => {
  it("resolves ref, clicks, waits for network idle, returns post-click snapshot", async () => {
    const { layer, hooks } = makeTestLayers({ knownRefs: ["3"], networkIdleAfter: 2 });

    const result = await Effect.runPromise(
      click(asRef("3"), { button: "left", clickCount: 1 }).pipe(Effect.provide(layer)),
    );

    expect(hooks.calls.filter((c) => c.action === "click")).toHaveLength(1);
    expect(hooks.calls[0]).toMatchObject({ action: "click", ref: "3" });
    expect(hooks.snapshots).toHaveLength(1);
    expect(result.snapshot.text).toContain("snapshot-after-click");
    expect(hooks.networkSamples.length).toBeGreaterThanOrEqual(1);
  });

  it("fails with RefNotFoundError when ref is unknown", async () => {
    const { layer } = makeTestLayers({ knownRefs: ["3"] });

    const exit = await Effect.runPromiseExit(click(asRef("99")).pipe(Effect.provide(layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause;
      expect(JSON.stringify(error)).toContain("RefNotFoundError");
    }
  });

  it("fails with InteractionError when the element click throws", async () => {
    const { layer } = makeTestLayers({ knownRefs: ["3"], failOn: ["click"] });

    const exit = await Effect.runPromiseExit(click(asRef("3")).pipe(Effect.provide(layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("InteractionError");
    }
  });
});
