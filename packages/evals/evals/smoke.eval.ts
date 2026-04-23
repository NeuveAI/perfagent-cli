import { evalite } from "evalite";
import { finalState } from "../src/scorers/final-state";
import { furthestKeyNode } from "../src/scorers/furthest-key-node";
import { stepCoverage } from "../src/scorers/step-coverage";
import { toolCallValidity } from "../src/scorers/tool-call-validity";
import { MockScenario, runMock } from "../src/runners/mock";
import { ExecutedTrace, EvalTask } from "../src/task";
import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90";
import { moderate1 } from "../tasks/moderate-1";
import { moderate2 } from "../tasks/moderate-2";
import { trivial1 } from "../tasks/trivial-1";
import { trivial2 } from "../tasks/trivial-2";

interface MockCaseInput {
  task: EvalTask;
  scenario: (typeof MockScenario)[number];
}

const tasks: ReadonlyArray<EvalTask> = [trivial1, trivial2, moderate1, moderate2, hardVolvoEx90];

const buildCases = (): Array<{ input: MockCaseInput; expected: EvalTask }> =>
  tasks.flatMap((task) =>
    MockScenario.map((scenario) => ({
      input: { task, scenario },
      expected: task,
    })),
  );

evalite<MockCaseInput, ExecutedTrace, EvalTask>("mock-runner smoke", {
  data: () => buildCases(),
  task: async (input) => runMock(input.task, input.scenario),
  scorers: [
    {
      name: "step-coverage",
      description: "Fraction of expected KeyNodes reached",
      scorer: ({ output, expected }) => {
        if (!expected) return 0;
        return stepCoverage(output.reachedKeyNodes, expected.keyNodes);
      },
    },
    {
      name: "final-state",
      description: "Final URL+DOM matches expected final state",
      scorer: ({ output, expected }) => {
        if (!expected) return 0;
        return finalState(output.finalUrl, output.finalDom, expected.expectedFinalState) ? 1 : 0;
      },
    },
    {
      name: "tool-call-validity",
      description: "Ratio of well-formed tool calls",
      scorer: ({ output }) => toolCallValidity(output.toolCalls),
    },
    {
      name: "furthest-key-node",
      description: "Deepest expected KeyNode reached, normalized to [0,1]",
      scorer: ({ output, expected }) => {
        if (!expected || expected.keyNodes.length === 0) return 0;
        const furthest = furthestKeyNode(output.reachedKeyNodes, expected.keyNodes);
        if (furthest < 0) return 0;
        return (furthest + 1) / expected.keyNodes.length;
      },
    },
  ],
  columns: ({ input, output }) => [
    { label: "task", value: input.task.id },
    { label: "scenario", value: input.scenario },
    { label: "reached", value: String(output.reachedKeyNodes.length) },
    { label: "tools", value: String(output.toolCalls.length) },
  ],
});
