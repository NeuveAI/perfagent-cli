import { assert, describe, it } from "vite-plus/test";
import { EvalTask } from "../src/task";
import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90";
import { moderate1 } from "../tasks/moderate-1";
import { moderate2 } from "../tasks/moderate-2";
import { trivial1 } from "../tasks/trivial-1";
import { trivial2 } from "../tasks/trivial-2";

const fixtures = [trivial1, trivial2, moderate1, moderate2, hardVolvoEx90];

describe("EvalTask fixtures", () => {
  for (const fixture of fixtures) {
    it(`decodes fixture ${fixture.id} via Schema.Class`, () => {
      const encoded = EvalTask.make({
        id: fixture.id,
        prompt: fixture.prompt,
        keyNodes: fixture.keyNodes,
        expectedFinalState: fixture.expectedFinalState,
        perfBudget: fixture.perfBudget,
      });
      assert.strictEqual(encoded.id, fixture.id);
      assert.isAbove(encoded.keyNodes.length, 0);
    });
  }

  it("has 2 trivial, 2 moderate, and 1 hard fixture with calibrated key-node counts", () => {
    assert.strictEqual(trivial1.keyNodes.length, 1);
    assert.strictEqual(trivial2.keyNodes.length, 1);
    assert.isAtLeast(moderate1.keyNodes.length, 2);
    assert.isAtMost(moderate1.keyNodes.length, 3);
    assert.isAtLeast(moderate2.keyNodes.length, 2);
    assert.isAtMost(moderate2.keyNodes.length, 3);
    assert.isAtLeast(hardVolvoEx90.keyNodes.length, 5);
  });
});
