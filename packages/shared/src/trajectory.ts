import { Exit, Schema } from "effect";
import {
  Action,
  AgentTurn,
  AssertionFailed,
  PlanUpdate,
  RunCompleted,
  StepDone,
  Thought,
} from "./react-envelope";
import {
  REACT_TRAJECTORY_OBSERVATION_SUMMARY_CHAR_LIMIT,
  REACT_TRAJECTORY_VERBATIM_WINDOW,
} from "./constants";
import { stripThoughtChannel } from "./strip-thought-channel";

const decodeAgentTurnFromString = Schema.decodeExit(Schema.fromJsonString(AgentTurn));

export interface TrajectoryMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

export interface TrajectoryTurn {
  readonly assistant: TrajectoryMessage;
  readonly observation: TrajectoryMessage;
}

export interface PartitionedTrajectory {
  readonly preface: ReadonlyArray<TrajectoryMessage>;
  readonly turns: ReadonlyArray<TrajectoryTurn>;
  readonly trailing: ReadonlyArray<TrajectoryMessage>;
}

export interface RollOptions {
  readonly verbatimWindow?: number;
  readonly observationCharLimit?: number;
}

const OBSERVATION_OPEN = "<observation>";
const OBSERVATION_CLOSE = "</observation>";
const ELLIPSIS = "…";

const truncate = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - ELLIPSIS.length)) + ELLIPSIS;
};

const collapseWhitespace = (text: string): string => {
  let result = "";
  let previousWasWhitespace = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const isWhitespace = character === " " || character === "\t" || character === "\n" ||
      character === "\r";
    if (isWhitespace) {
      if (!previousWasWhitespace && result.length > 0) {
        result += " ";
      }
      previousWasWhitespace = true;
      continue;
    }
    result += character;
    previousWasWhitespace = false;
  }
  if (result.endsWith(" ")) return result.slice(0, result.length - 1);
  return result;
};

const extractObservationBody = (content: string): string => {
  const openIndex = content.indexOf(OBSERVATION_OPEN);
  if (openIndex === -1) return content;
  const bodyStart = openIndex + OBSERVATION_OPEN.length;
  const closeIndex = content.indexOf(OBSERVATION_CLOSE, bodyStart);
  if (closeIndex === -1) return content.slice(bodyStart);
  return content.slice(bodyStart, closeIndex);
};

const summarizeObservation = (content: string, charLimit: number): string => {
  const body = extractObservationBody(content);
  const stripped = stripThoughtChannel(body);
  const collapsed = collapseWhitespace(stripped);
  return truncate(collapsed, charLimit);
};

const summarizeAgentTurn = (turn: AgentTurn): string => {
  if (turn instanceof Thought) {
    return `THOUGHT ${turn.stepId}`;
  }
  if (turn instanceof Action) {
    return `ACTION ${turn.toolName}`;
  }
  if (turn instanceof PlanUpdate) {
    return `PLAN_UPDATE ${turn.action} ${turn.stepId}`;
  }
  if (turn instanceof StepDone) {
    return `STEP_DONE ${turn.stepId}`;
  }
  if (turn instanceof AssertionFailed) {
    return `ASSERTION_FAILED ${turn.stepId} (${turn.category})`;
  }
  if (turn instanceof RunCompleted) {
    return `RUN_COMPLETED ${turn.status}`;
  }
  return "UNKNOWN";
};

const formatEventLine = (
  turn: TrajectoryTurn,
  observationCharLimit: number,
): string => {
  const decodeExit = decodeAgentTurnFromString(turn.assistant.content);
  const head = Exit.isFailure(decodeExit)
    ? "UNPARSED"
    : summarizeAgentTurn(decodeExit.value);
  const outcome = summarizeObservation(turn.observation.content, observationCharLimit);
  if (outcome.length === 0) return `<event>${head}</event>`;
  return `<event>${head} → ${outcome}</event>`;
};

export const partitionTrajectory = (
  messages: ReadonlyArray<TrajectoryMessage>,
): PartitionedTrajectory => {
  let firstAssistantIndex = -1;
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].role === "assistant") {
      firstAssistantIndex = index;
      break;
    }
  }
  if (firstAssistantIndex === -1) {
    return { preface: messages, turns: [], trailing: [] };
  }
  const preface = messages.slice(0, firstAssistantIndex);
  const tail = messages.slice(firstAssistantIndex);
  const turns: TrajectoryTurn[] = [];
  let cursor = 0;
  while (cursor + 1 < tail.length) {
    const assistant = tail[cursor];
    const observation = tail[cursor + 1];
    if (assistant.role !== "assistant" || observation.role !== "user") break;
    turns.push({ assistant, observation });
    cursor += 2;
  }
  const trailing = tail.slice(cursor);
  return { preface, turns, trailing };
};

export const summarizeTrajectoryTurn = (
  turn: TrajectoryTurn,
  observationCharLimit: number = REACT_TRAJECTORY_OBSERVATION_SUMMARY_CHAR_LIMIT,
): string => formatEventLine(turn, observationCharLimit);

export interface RolledTrajectory {
  readonly messages: ReadonlyArray<TrajectoryMessage>;
  readonly summarizedTurnCount: number;
  readonly verbatimTurnCount: number;
}

const buildSummaryMessage = (
  olderTurns: ReadonlyArray<TrajectoryTurn>,
  observationCharLimit: number,
): TrajectoryMessage => {
  const lines = olderTurns.map((turn) => formatEventLine(turn, observationCharLimit));
  const body = ["<trajectory_summary>", ...lines, "</trajectory_summary>"].join("\n");
  return { role: "user", content: body };
};

export const rollTrajectory = (
  messages: ReadonlyArray<TrajectoryMessage>,
  options: RollOptions = {},
): RolledTrajectory => {
  const verbatimWindow = options.verbatimWindow ?? REACT_TRAJECTORY_VERBATIM_WINDOW;
  const observationCharLimit =
    options.observationCharLimit ?? REACT_TRAJECTORY_OBSERVATION_SUMMARY_CHAR_LIMIT;
  const partitioned = partitionTrajectory(messages);
  if (partitioned.turns.length <= verbatimWindow) {
    return {
      messages,
      summarizedTurnCount: 0,
      verbatimTurnCount: partitioned.turns.length,
    };
  }
  const splitIndex = partitioned.turns.length - verbatimWindow;
  const olderTurns = partitioned.turns.slice(0, splitIndex);
  const recentTurns = partitioned.turns.slice(splitIndex);
  const summaryMessage = buildSummaryMessage(olderTurns, observationCharLimit);
  const recentFlattened = recentTurns.flatMap((turn) => [turn.assistant, turn.observation]);
  return {
    messages: [
      ...partitioned.preface,
      summaryMessage,
      ...recentFlattened,
      ...partitioned.trailing,
    ],
    summarizedTurnCount: olderTurns.length,
    verbatimTurnCount: recentTurns.length,
  };
};
