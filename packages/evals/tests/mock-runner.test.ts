import { assert, describe, it } from "vite-plus/test";
import { runMock } from "../src/runners/mock";
import { finalState } from "../src/scorers/final-state";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import { moderate1 } from "../tasks/moderate-1";
import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90";

describe("mock runner", () => {
  it("scripted-success produces full coverage and passes final-state", () => {
    const trace = runMock(moderate1, "success");
    assert.strictEqual(stepCoverage(trace.reachedKeyNodes, moderate1.keyNodes), 1);
    assert.isTrue(finalState(trace.finalUrl, trace.finalDom, moderate1.expectedFinalState));
    assert.strictEqual(toolCallValidity(trace.toolCalls), 1);
  });

  it("stops-at-1 produces partial coverage and fails final-state", () => {
    const trace = runMock(hardVolvoEx90, "stops-at-1");
    const coverage = stepCoverage(trace.reachedKeyNodes, hardVolvoEx90.keyNodes);
    assert.isAbove(coverage, 0);
    assert.isBelow(coverage, 1);
    assert.isFalse(finalState(trace.finalUrl, trace.finalDom, hardVolvoEx90.expectedFinalState));
  });

  it("malformed-tools produces zero tool-call-validity and fails final-state", () => {
    const trace = runMock(moderate1, "malformed-tools");
    assert.strictEqual(toolCallValidity(trace.toolCalls), 0);
    assert.isFalse(finalState(trace.finalUrl, trace.finalDom, moderate1.expectedFinalState));
  });
});
