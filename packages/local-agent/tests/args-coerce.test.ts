import { Effect } from "effect";
import { assert, describe, it } from "vite-plus/test";

import { Action, parseAgentTurnFromString } from "@neuve/shared/react-envelope";

import { coerceAgentTurnArgs } from "../src/args-coerce.ts";

// Fixture: real failing envelope shape captured from
// `packages/evals/evals/traces/wave-r9-prompt-v3/gemma-react__journey-2-ecom-checkout.ndjson`
// turn 8. Gemma emitted `{command:"type", uid:"1_23", text:"pajamas"}` against
// the strict per-tool union which only accepts that shape on `fill` (with
// `value` not `text`). Three R9 prompt iterations failed to eliminate this
// pattern.
const FAILING_TYPE_UID_ENVELOPE = JSON.stringify({
  _tag: "ACTION",
  stepId: "search-step",
  toolName: "interact",
  args: { command: "type", uid: "1_23", text: "pajamas" },
});

describe("coerceAgentTurnArgs", () => {
  it("rewrites the captured journey-2 type+uid+text envelope to fill+uid+value", () => {
    const result = coerceAgentTurnArgs(FAILING_TYPE_UID_ENVELOPE);
    assert.isTrue(result.rewrote);
    const parsed = JSON.parse(result.content) as { args: Record<string, unknown> };
    assert.deepEqual(parsed.args, {
      command: "fill",
      uid: "1_23",
      value: "pajamas",
    });
  });

  it("post-coercion envelope parses against the strict AgentTurn union", () =>
    Effect.gen(function* () {
      const result = coerceAgentTurnArgs(FAILING_TYPE_UID_ENVELOPE);
      assert.isTrue(result.rewrote);
      const envelope = yield* parseAgentTurnFromString(result.content);
      assert.instanceOf(envelope, Action);
      const action = envelope as Action;
      assert.strictEqual(action.toolName, "interact");
      assert.deepEqual(action.args, { command: "fill", uid: "1_23", value: "pajamas" });
    }).pipe(Effect.runPromise));

  it("pre-coercion envelope is rejected by the strict parser (regression guard)", () =>
    Effect.gen(function* () {
      const error = yield* parseAgentTurnFromString(FAILING_TYPE_UID_ENVELOPE).pipe(Effect.flip);
      const message = String(error);
      assert.match(message, /command/);
    }).pipe(Effect.runPromise));

  it("preserves includeSnapshot when present", () => {
    const envelope = JSON.stringify({
      _tag: "ACTION",
      stepId: "step",
      toolName: "interact",
      args: { command: "type", uid: "1_99", text: "value", includeSnapshot: true },
    });
    const result = coerceAgentTurnArgs(envelope);
    assert.isTrue(result.rewrote);
    const parsed = JSON.parse(result.content) as { args: Record<string, unknown> };
    assert.deepEqual(parsed.args, {
      command: "fill",
      uid: "1_99",
      value: "value",
      includeSnapshot: true,
    });
  });

  it("leaves canonical type{text} (no uid) unchanged — that is a valid InteractType", () => {
    const envelope = JSON.stringify({
      _tag: "ACTION",
      stepId: "step",
      toolName: "interact",
      args: { command: "type", text: "hello" },
    });
    const result = coerceAgentTurnArgs(envelope);
    assert.isFalse(result.rewrote);
    assert.strictEqual(result.content, envelope);
  });

  it("leaves type+uid envelope unchanged when text is missing (insufficient signal to map to fill)", () => {
    const envelope = JSON.stringify({
      _tag: "ACTION",
      stepId: "step",
      toolName: "interact",
      args: { command: "type", uid: "1_4" },
    });
    const result = coerceAgentTurnArgs(envelope);
    assert.isFalse(result.rewrote);
    assert.strictEqual(result.content, envelope);
  });

  it("leaves canonical fill{uid,value} envelopes unchanged", () => {
    const envelope = JSON.stringify({
      _tag: "ACTION",
      stepId: "step",
      toolName: "interact",
      args: { command: "fill", uid: "1_4", value: "hello" },
    });
    const result = coerceAgentTurnArgs(envelope);
    assert.isFalse(result.rewrote);
    assert.strictEqual(result.content, envelope);
  });

  it("leaves observe envelopes untouched even with type-shaped args", () => {
    const envelope = JSON.stringify({
      _tag: "ACTION",
      stepId: "step",
      toolName: "observe",
      args: { command: "type", uid: "1_4", text: "x" },
    });
    const result = coerceAgentTurnArgs(envelope);
    assert.isFalse(result.rewrote);
    assert.strictEqual(result.content, envelope);
  });

  it("leaves THOUGHT/STEP_DONE/RUN_COMPLETED envelopes untouched", () => {
    const thought = JSON.stringify({
      _tag: "THOUGHT",
      stepId: "step",
      thought: "thinking",
    });
    assert.isFalse(coerceAgentTurnArgs(thought).rewrote);

    const stepDone = JSON.stringify({
      _tag: "STEP_DONE",
      stepId: "step",
      summary: "done",
    });
    assert.isFalse(coerceAgentTurnArgs(stepDone).rewrote);

    const runCompleted = JSON.stringify({
      _tag: "RUN_COMPLETED",
      status: "passed",
      summary: "all done",
    });
    assert.isFalse(coerceAgentTurnArgs(runCompleted).rewrote);
  });

  it("returns malformed JSON unchanged (let the strict parser report it)", () => {
    const garbage = "not json at all";
    const result = coerceAgentTurnArgs(garbage);
    assert.isFalse(result.rewrote);
    assert.strictEqual(result.content, garbage);
  });

  it("returns null/non-object JSON unchanged", () => {
    const nullJson = "null";
    const result = coerceAgentTurnArgs(nullJson);
    assert.isFalse(result.rewrote);

    const arrayJson = "[1,2,3]";
    const arrayResult = coerceAgentTurnArgs(arrayJson);
    assert.isFalse(arrayResult.rewrote);
  });

  it("rewrites every captured v3 type+uid trace envelope to a parseable fill envelope", () => {
    // All four v3 type+uid traces (calibration-5, j-2, j-3, j-6) — confirmed
    // via grep on packages/evals/evals/traces/wave-r9-prompt-v3/.
    const fixtures: ReadonlyArray<{ uid: string; text: string }> = [
      { uid: "1_4", text: "typescript" },
      { uid: "1_23", text: "pajamas" },
      { uid: "2_27", text: "New York" },
      { uid: "1_35", text: "moving-image" },
    ];

    for (const fixture of fixtures) {
      const envelope = JSON.stringify({
        _tag: "ACTION",
        stepId: "step",
        toolName: "interact",
        args: { command: "type", uid: fixture.uid, text: fixture.text },
      });
      const result = coerceAgentTurnArgs(envelope);
      assert.isTrue(result.rewrote, `failed to rewrite uid=${fixture.uid}`);
      const parsed = JSON.parse(result.content) as { args: Record<string, unknown> };
      assert.deepEqual(parsed.args, {
        command: "fill",
        uid: fixture.uid,
        value: fixture.text,
      });
    }
  });
});
