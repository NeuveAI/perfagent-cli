import { describe, expect, it } from "vite-plus/test";
import {
  partitionTrajectory,
  rollTrajectory,
  summarizeTrajectoryTurn,
  type TrajectoryMessage,
  type TrajectoryTurn,
} from "../src/trajectory";

const SYSTEM: TrajectoryMessage = { role: "system", content: "You are an agent." };
const INITIAL_USER: TrajectoryMessage = {
  role: "user",
  content: "<environment>...</environment>\n<developer_request>Run the test</developer_request>",
};

const assistantThought = (stepId: string, thought: string): TrajectoryMessage => ({
  role: "assistant",
  content: JSON.stringify({ _tag: "THOUGHT", stepId, thought }),
});

const assistantAction = (
  stepId: string,
  toolName: string,
  args: Record<string, unknown>,
): TrajectoryMessage => ({
  role: "assistant",
  content: JSON.stringify({ _tag: "ACTION", stepId, toolName, args }),
});

const assistantPlanUpdate = (
  stepId: string,
  action: "insert" | "replace" | "remove" | "replace_step",
): TrajectoryMessage => ({
  role: "assistant",
  content: JSON.stringify({ _tag: "PLAN_UPDATE", stepId, action, payload: {} }),
});

const assistantStepDone = (stepId: string, summary: string): TrajectoryMessage => ({
  role: "assistant",
  content: JSON.stringify({ _tag: "STEP_DONE", stepId, summary }),
});

const assistantAssertionFailed = (
  stepId: string,
  category: "budget-violation" | "regression" | "resource-blocker" | "memory-leak" | "abort",
): TrajectoryMessage => ({
  role: "assistant",
  content: JSON.stringify({
    _tag: "ASSERTION_FAILED",
    stepId,
    category,
    domain: "perf",
    reason: "metric exceeded",
    evidence: "LCP=3000ms",
  }),
});

const assistantRunCompleted = (
  status: "passed" | "failed",
  summary: string,
): TrajectoryMessage => ({
  role: "assistant",
  content: JSON.stringify({ _tag: "RUN_COMPLETED", status, summary }),
});

const observation = (text: string): TrajectoryMessage => ({
  role: "user",
  content: `<observation>${text}</observation>`,
});

describe("partitionTrajectory", () => {
  it("returns preface=messages and turns=[] when there is no assistant message", () => {
    const messages = [SYSTEM, INITIAL_USER];
    const result = partitionTrajectory(messages);
    expect(result.preface).toEqual(messages);
    expect(result.turns).toEqual([]);
    expect(result.trailing).toEqual([]);
  });

  it("partitions a single assistant/user pair into one turn", () => {
    const assistant = assistantThought("step-1", "navigate first");
    const user = observation("noted");
    const messages = [SYSTEM, INITIAL_USER, assistant, user];
    const result = partitionTrajectory(messages);
    expect(result.preface).toEqual([SYSTEM, INITIAL_USER]);
    expect(result.turns).toEqual([{ assistant, observation: user }]);
    expect(result.trailing).toEqual([]);
  });

  it("partitions multiple turns and reports a trailing assistant as `trailing`", () => {
    const turn1Assistant = assistantThought("step-1", "first");
    const turn1Observation = observation("first-obs");
    const turn2Assistant = assistantAction("step-1", "interact", { command: "navigate" });
    const turn2Observation = observation("second-obs");
    const dangling = assistantThought("step-2", "dangling");
    const messages = [
      SYSTEM,
      INITIAL_USER,
      turn1Assistant,
      turn1Observation,
      turn2Assistant,
      turn2Observation,
      dangling,
    ];
    const result = partitionTrajectory(messages);
    expect(result.preface).toEqual([SYSTEM, INITIAL_USER]);
    expect(result.turns).toEqual([
      { assistant: turn1Assistant, observation: turn1Observation },
      { assistant: turn2Assistant, observation: turn2Observation },
    ]);
    expect(result.trailing).toEqual([dangling]);
  });
});

describe("summarizeTrajectoryTurn", () => {
  const make = (assistant: TrajectoryMessage, observationContent: string): TrajectoryTurn => ({
    assistant,
    observation: observation(observationContent),
  });

  it("formats a THOUGHT envelope into <event>THOUGHT step → outcome</event>", () => {
    const turn = make(assistantThought("step-1", "navigate first"), "noted");
    expect(summarizeTrajectoryTurn(turn)).toEqual("<event>THOUGHT step-1 → noted</event>");
  });

  it("formats an ACTION envelope as <event>ACTION toolName → outcome</event>", () => {
    const turn = make(
      assistantAction("step-1", "interact", { command: "navigate", url: "https://x" }),
      "navigated to https://x",
    );
    expect(summarizeTrajectoryTurn(turn)).toEqual(
      "<event>ACTION interact → navigated to https://x</event>",
    );
  });

  it("formats a PLAN_UPDATE envelope as <event>PLAN_UPDATE action stepId → outcome</event>", () => {
    const turn = make(assistantPlanUpdate("step-1", "insert"), "ok");
    expect(summarizeTrajectoryTurn(turn)).toEqual("<event>PLAN_UPDATE insert step-1 → ok</event>");
  });

  it("formats a STEP_DONE envelope", () => {
    const turn = make(assistantStepDone("step-1", "done"), "advance");
    expect(summarizeTrajectoryTurn(turn)).toEqual("<event>STEP_DONE step-1 → advance</event>");
  });

  it("formats an ASSERTION_FAILED envelope with category in parens", () => {
    const turn = make(assistantAssertionFailed("step-1", "budget-violation"), "retry");
    expect(summarizeTrajectoryTurn(turn)).toEqual(
      "<event>ASSERTION_FAILED step-1 (budget-violation) → retry</event>",
    );
  });

  it("formats a RUN_COMPLETED envelope", () => {
    const turn = make(assistantRunCompleted("passed", "all good"), "ack");
    expect(summarizeTrajectoryTurn(turn)).toEqual("<event>RUN_COMPLETED passed → ack</event>");
  });

  it("emits UNPARSED for assistant content that is not valid AgentTurn JSON", () => {
    const turn: TrajectoryTurn = {
      assistant: { role: "assistant", content: "not json" },
      observation: observation("ignored"),
    };
    expect(summarizeTrajectoryTurn(turn)).toEqual("<event>UNPARSED → ignored</event>");
  });

  it("strips channel-tagged thinking from the observation body", () => {
    const turn = make(
      assistantAction("step-1", "interact", { command: "click" }),
      "<|channel>thought\nplanning\n<channel|>clicked the button",
    );
    expect(summarizeTrajectoryTurn(turn)).toEqual(
      "<event>ACTION interact → clicked the button</event>",
    );
  });

  it("collapses internal whitespace and truncates long observations to the limit", () => {
    const longBody = "lorem    ipsum\n\n\tdolor sit amet ".repeat(40);
    const turn = make(assistantAction("step-1", "interact", {}), longBody);
    const result = summarizeTrajectoryTurn(turn, 50);
    expect(result.length).toBeLessThanOrEqual("<event>ACTION interact → </event>".length + 50);
    expect(result.endsWith("…</event>")).toBe(true);
    expect(result.includes("\n")).toBe(false);
    expect(result.includes("\t")).toBe(false);
  });

  it("emits an event line without arrow when the observation is empty", () => {
    const turn: TrajectoryTurn = {
      assistant: assistantStepDone("step-1", "done"),
      observation: { role: "user", content: "<observation></observation>" },
    };
    expect(summarizeTrajectoryTurn(turn)).toEqual("<event>STEP_DONE step-1</event>");
  });
});

describe("rollTrajectory", () => {
  const buildPair = (index: number): readonly [TrajectoryMessage, TrajectoryMessage] => [
    assistantAction(`step-${index}`, "interact", { command: "navigate" }),
    observation(`outcome-${index}`),
  ];

  const buildMessages = (turnCount: number): TrajectoryMessage[] => {
    const messages: TrajectoryMessage[] = [SYSTEM, INITIAL_USER];
    for (let index = 0; index < turnCount; index++) {
      const [assistant, user] = buildPair(index);
      messages.push(assistant, user);
    }
    return messages;
  };

  it("returns the input unchanged when turn count <= verbatimWindow", () => {
    const messages = buildMessages(10);
    const rolled = rollTrajectory(messages, { verbatimWindow: 10 });
    expect(rolled.messages).toEqual(messages);
    expect(rolled.summarizedTurnCount).toEqual(0);
    expect(rolled.verbatimTurnCount).toEqual(10);
  });

  it("collapses older turns into a single trajectory_summary block when above the window", () => {
    const messages = buildMessages(13);
    const rolled = rollTrajectory(messages, { verbatimWindow: 10 });
    expect(rolled.summarizedTurnCount).toEqual(3);
    expect(rolled.verbatimTurnCount).toEqual(10);
    // preface (2) + summary (1) + verbatim (10 turns × 2 messages = 20)
    expect(rolled.messages.length).toEqual(2 + 1 + 20);
    const summary = rolled.messages[2];
    expect(summary.role).toEqual("user");
    expect(summary.content.startsWith("<trajectory_summary>")).toBe(true);
    expect(summary.content.endsWith("</trajectory_summary>")).toBe(true);
    for (let index = 0; index < 3; index++) {
      expect(summary.content.includes(`outcome-${index}`)).toBe(true);
    }
    for (let index = 3; index < 13; index++) {
      const verbatimAssistant = rolled.messages[3 + (index - 3) * 2];
      expect(verbatimAssistant.content).toEqual(messages[2 + index * 2].content);
    }
  });

  it("preserves the system + initial user preface verbatim", () => {
    const messages = buildMessages(15);
    const rolled = rollTrajectory(messages, { verbatimWindow: 10 });
    expect(rolled.messages[0]).toEqual(SYSTEM);
    expect(rolled.messages[1]).toEqual(INITIAL_USER);
  });

  it("preserves a trailing dangling assistant message after the verbatim window", () => {
    const messages = buildMessages(11);
    const dangling = assistantThought("step-final", "thinking");
    messages.push(dangling);
    const rolled = rollTrajectory(messages, { verbatimWindow: 10 });
    expect(rolled.messages[rolled.messages.length - 1]).toEqual(dangling);
  });

  it("uses the default verbatim window when none is provided", () => {
    const messages = buildMessages(15);
    const rolled = rollTrajectory(messages);
    expect(rolled.verbatimTurnCount).toEqual(10);
    expect(rolled.summarizedTurnCount).toEqual(5);
  });

  it("returns the input unchanged when there are no assistant messages", () => {
    const messages = [SYSTEM, INITIAL_USER];
    const rolled = rollTrajectory(messages);
    expect(rolled.messages).toEqual(messages);
    expect(rolled.summarizedTurnCount).toEqual(0);
    expect(rolled.verbatimTurnCount).toEqual(0);
  });
});
