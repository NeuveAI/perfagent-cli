import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { waitFor } from "../../src/tools/wait-for";
import {
  asWaitForTargetAria,
  asWaitForTargetRef,
  asWaitForTargetSelector,
  makeTestLayers,
} from "./support";

describe("tools/wait_for", () => {
  it("waits for a CSS selector and returns a snapshot", async () => {
    const { layer, hooks } = makeTestLayers();

    const result = await Effect.runPromise(
      waitFor(asWaitForTargetSelector("button.submit"), { timeout: 1_000, state: "visible" }).pipe(
        Effect.provide(layer),
      ),
    );

    const calls = hooks.calls.filter((c) => c.action === "wait_for_selector");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ref).toBe("button.submit");
    expect(result.snapshot.text).toContain("snapshot-after-wait_for_selector");
  });

  it("waits for an ARIA target", async () => {
    const { layer, hooks } = makeTestLayers();

    await Effect.runPromise(
      waitFor(asWaitForTargetAria("Submit form")).pipe(Effect.provide(layer)),
    );

    expect(hooks.calls.find((c) => c.action === "wait_for_aria")?.ref).toBe("Submit form");
  });

  it("waits for a ref target", async () => {
    const { layer, hooks } = makeTestLayers({ knownRefs: ["5"] });

    await Effect.runPromise(waitFor(asWaitForTargetRef("5")).pipe(Effect.provide(layer)));

    expect(hooks.calls.find((c) => c.action === "wait_for_ref")?.ref).toBe("5");
  });

  it("fails with RefNotFoundError when ref target is unknown", async () => {
    const { layer } = makeTestLayers({ knownRefs: [] });

    const exit = await Effect.runPromiseExit(
      waitFor(asWaitForTargetRef("missing")).pipe(Effect.provide(layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("RefNotFoundError");
    }
  });

  it("fails with WaitTimeoutError when the engine times out", async () => {
    const { layer } = makeTestLayers({ waitForShouldTimeout: true });

    const exit = await Effect.runPromiseExit(
      waitFor(asWaitForTargetSelector("button.never-shows"), { timeout: 50 }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("WaitTimeoutError");
    }
  });
});
