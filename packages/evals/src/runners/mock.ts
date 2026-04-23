import { ExecutedTrace, KeyNode, ToolCall, type EvalTask } from "../task";

export const MockScenario = ["success", "stops-at-1", "malformed-tools"] as const;
export type MockScenario = (typeof MockScenario)[number];

const buildToolCalls = (count: number, wellFormedCount: number): ReadonlyArray<ToolCall> => {
  const calls: ToolCall[] = [];
  for (let index = 0; index < count; index += 1) {
    calls.push(
      new ToolCall({
        name: `navigate_step_${index + 1}`,
        arguments: { url: `step-${index + 1}` },
        wellFormed: index < wellFormedCount,
      }),
    );
  }
  return calls;
};

const toReachedKeyNode = (expected: KeyNode): KeyNode =>
  new KeyNode({
    urlPattern: expected.urlPattern,
    domAssertion: expected.domAssertion,
    perfCapture: expected.perfCapture,
  });

export const runMock = (task: EvalTask, scenario: MockScenario): ExecutedTrace => {
  const expectedNodes = task.keyNodes;
  if (expectedNodes.length === 0) {
    return new ExecutedTrace({
      reachedKeyNodes: [],
      toolCalls: [],
      finalUrl: task.expectedFinalState.urlPattern,
      finalDom: task.expectedFinalState.domAssertion,
    });
  }

  if (scenario === "success") {
    const reached = expectedNodes.map(toReachedKeyNode);
    return new ExecutedTrace({
      reachedKeyNodes: reached,
      toolCalls: buildToolCalls(expectedNodes.length, expectedNodes.length),
      finalUrl: task.expectedFinalState.urlPattern,
      finalDom: task.expectedFinalState.domAssertion,
    });
  }

  if (scenario === "stops-at-1") {
    const firstNode = expectedNodes[0];
    const reached = firstNode ? [toReachedKeyNode(firstNode)] : [];
    return new ExecutedTrace({
      reachedKeyNodes: reached,
      toolCalls: buildToolCalls(1, 1),
      finalUrl: firstNode ? firstNode.urlPattern : "",
      finalDom: "stopped-early",
    });
  }

  const reached = expectedNodes.map(toReachedKeyNode);
  return new ExecutedTrace({
    reachedKeyNodes: reached,
    toolCalls: buildToolCalls(expectedNodes.length, 0),
    finalUrl: "",
    finalDom: "",
  });
};
