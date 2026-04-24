import { assert, describe, it } from "vite-plus/test";
import { finalState } from "../src/scorers/final-state";
import { furthestKeyNode } from "../src/scorers/furthest-key-node";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import { KeyNode, ToolCall } from "../src/task";

const expectedKeyNodes = [
  new KeyNode({ urlPattern: "^https://site\\.com/?$", domAssertion: "nav" }),
  new KeyNode({ urlPattern: "^https://site\\.com/menu", domAssertion: "ul.menu" }),
  new KeyNode({ urlPattern: "^https://site\\.com/detail", domAssertion: "h1.detail" }),
];

const reachedAll = [
  new KeyNode({ urlPattern: "https://site.com/", domAssertion: "nav" }),
  new KeyNode({ urlPattern: "https://site.com/menu", domAssertion: "ul.menu" }),
  new KeyNode({ urlPattern: "https://site.com/detail", domAssertion: "h1.detail" }),
];

const reachedFirstOnly = [new KeyNode({ urlPattern: "https://site.com/", domAssertion: "nav" })];

describe("stepCoverage", () => {
  it("returns 1 when all expected key-nodes are reached", () => {
    assert.strictEqual(stepCoverage(reachedAll, expectedKeyNodes), 1);
  });

  it("returns fractional coverage when only some are reached", () => {
    assert.strictEqual(stepCoverage(reachedFirstOnly, expectedKeyNodes), 1 / 3);
  });

  it("returns 0 when none match", () => {
    const reachedWrong = [new KeyNode({ urlPattern: "https://other.com/", domAssertion: "nav" })];
    assert.strictEqual(stepCoverage(reachedWrong, expectedKeyNodes), 0);
  });

  it("returns 1 when no expected nodes (vacuous)", () => {
    assert.strictEqual(stepCoverage([], []), 1);
  });

  it("counts each expected node at most once", () => {
    const duplicateReached = [
      new KeyNode({ urlPattern: "https://site.com/", domAssertion: "nav" }),
      new KeyNode({ urlPattern: "https://site.com/", domAssertion: "nav" }),
    ];
    assert.strictEqual(stepCoverage(duplicateReached, expectedKeyNodes), 1 / 3);
  });
});

describe("finalState", () => {
  const expected = { urlPattern: "^https://site\\.com/detail/?$", domAssertion: "Thank you" };

  it("returns true when url matches and dom contains assertion", () => {
    assert.isTrue(finalState("https://site.com/detail", "<h1>Thank you</h1>", expected));
  });

  it("returns false when url does not match", () => {
    assert.isFalse(finalState("https://other.com/", "<h1>Thank you</h1>", expected));
  });

  it("returns false when dom does not contain assertion", () => {
    assert.isFalse(finalState("https://site.com/detail", "<h1>Oops</h1>", expected));
  });
});

describe("toolCallValidity", () => {
  it("returns 1 when all calls well-formed", () => {
    const calls = [
      new ToolCall({ name: "click", arguments: { ref: "1" }, wellFormed: true }),
      new ToolCall({ name: "fill", arguments: { ref: "2", text: "hi" }, wellFormed: true }),
    ];
    assert.strictEqual(toolCallValidity(calls), 1);
  });

  it("returns fractional ratio when some are malformed", () => {
    const calls = [
      new ToolCall({ name: "click", arguments: { ref: "1" }, wellFormed: true }),
      new ToolCall({ name: "bogus", arguments: {}, wellFormed: false }),
    ];
    assert.strictEqual(toolCallValidity(calls), 0.5);
  });

  it("returns 1 when there are no calls (vacuous)", () => {
    assert.strictEqual(toolCallValidity([]), 1);
  });

  it("returns 0 when all calls malformed", () => {
    const calls = [new ToolCall({ name: "x", arguments: {}, wellFormed: false })];
    assert.strictEqual(toolCallValidity(calls), 0);
  });
});

describe("furthestKeyNode", () => {
  it("returns -1 when nothing reached", () => {
    assert.strictEqual(furthestKeyNode([], expectedKeyNodes), -1);
  });

  it("returns 0 when only first reached", () => {
    assert.strictEqual(furthestKeyNode(reachedFirstOnly, expectedKeyNodes), 0);
  });

  it("returns last index when all reached", () => {
    assert.strictEqual(furthestKeyNode(reachedAll, expectedKeyNodes), expectedKeyNodes.length - 1);
  });

  it("returns the deepest reached index even when earlier ones skipped", () => {
    const reachedLastOnly = [
      new KeyNode({ urlPattern: "https://site.com/detail", domAssertion: "h1.detail" }),
    ];
    assert.strictEqual(furthestKeyNode(reachedLastOnly, expectedKeyNodes), 2);
  });
});
