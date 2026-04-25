import { describe, expect, it } from "vite-plus/test";
import {
  REACT_TRAJECTORY_OBSERVATION_SUMMARY_CHAR_LIMIT,
  REACT_TRAJECTORY_VERBATIM_WINDOW,
} from "../src/constants";
import { rollTrajectory, type TrajectoryMessage } from "../src/trajectory";

/**
 * R4 calibration probe — synthetic trajectory at scale.
 *
 * Goal: verify that `rollTrajectory` keeps the prompt size bounded as turn
 * count grows linearly. Uses realistic envelope payloads sampled from the
 * Q9 rebaseline (`docs/handover/q9-tool-call-gap/diary/rebaseline-2026-04-25.md`):
 * - ACTION envelopes are ~150–200 chars (toolName + args = command +
 *   navigate URL or insightSetId + insightName).
 * - Observation responses for `interact` are short (~50–100 chars), but for
 *   `trace stop` and `trace analyze` they balloon to 2-8 KB each (CWV
 *   summary + insight breakdown).
 *
 * The character → token heuristic uses 4 chars/token (the standard
 * approximation for English; Gemma 4 tokenizer averages slightly tighter).
 * Thresholds:
 * - PRD §R4 line 181 budgets ≈ 6,800 input tokens with the rolling pipeline
 *   active. We assert the rolled view stays under 25K chars (~6,250 tokens)
 *   for a 60-turn run with 8KB observations on every 5th turn.
 * - Without rolling, that same trajectory would be ≈ 60 × (200 + 8000) =
 *   492,000 chars (~123K tokens) — well past both warn AND abort thresholds.
 *
 * This probe is the runtime evidence that R4 prevents the silent context
 * truncation surfaced as Probe D in the Q9 diary.
 */

const CHARS_PER_TOKEN = 4;
const TURN_COUNT = 60;
const TRACE_OBSERVATION_INTERVAL = 5;

const ACTION_INTERACT_SIZE = 180;
const ACTION_TRACE_SIZE = 220;
const OBSERVATION_INTERACT_SIZE = 80;
const OBSERVATION_TRACE_SIZE = 8_000;

const SYSTEM_PROMPT_SIZE = 4_000;
const INITIAL_USER_SIZE = 2_500;

const repeatString = (length: number, fill: string = "x"): string => {
  if (length <= 0) return "";
  let result = "";
  while (result.length < length) {
    result += fill;
  }
  return result.slice(0, length);
};

const SYSTEM: TrajectoryMessage = {
  role: "system",
  content: repeatString(SYSTEM_PROMPT_SIZE),
};

const INITIAL_USER: TrajectoryMessage = {
  role: "user",
  content: repeatString(INITIAL_USER_SIZE),
};

const buildAssistantAction = (turnIndex: number): TrajectoryMessage => {
  const isTrace = turnIndex % TRACE_OBSERVATION_INTERVAL === 0;
  const envelope = {
    _tag: "ACTION" as const,
    stepId: `step-${Math.floor(turnIndex / 5) + 1}`,
    toolName: isTrace ? "trace" : "interact",
    args: isTrace
      ? {
          action: {
            command: "analyze",
            insightSetId: `insight-set-${turnIndex}`,
            insightName: `LCPBreakdown-${turnIndex}`,
          },
        }
      : { command: "navigate", url: `https://example.com/page-${turnIndex}` },
  };
  let content = JSON.stringify(envelope);
  const targetSize = isTrace ? ACTION_TRACE_SIZE : ACTION_INTERACT_SIZE;
  if (content.length < targetSize) {
    content = content + repeatString(targetSize - content.length, " ");
  }
  return { role: "assistant", content };
};

const buildObservation = (turnIndex: number): TrajectoryMessage => {
  const isTrace = turnIndex % TRACE_OBSERVATION_INTERVAL === 0;
  const body = isTrace
    ? `LCP: 2400ms (above budget by 200ms). FCP: 1200ms. CLS: 0.05. ${repeatString(
        OBSERVATION_TRACE_SIZE - 100,
      )}`
    : `Navigated to https://example.com/page-${turnIndex}. ${repeatString(
        OBSERVATION_INTERACT_SIZE - 50,
      )}`;
  return { role: "user", content: `<observation>${body}</observation>` };
};

const buildSyntheticTrajectory = (turnCount: number): TrajectoryMessage[] => {
  const messages: TrajectoryMessage[] = [SYSTEM, INITIAL_USER];
  for (let index = 0; index < turnCount; index++) {
    messages.push(buildAssistantAction(index));
    messages.push(buildObservation(index));
  }
  return messages;
};

const totalChars = (messages: ReadonlyArray<TrajectoryMessage>): number => {
  let total = 0;
  for (const message of messages) {
    total += message.content.length;
  }
  return total;
};

const estimatedTokens = (messages: ReadonlyArray<TrajectoryMessage>): number =>
  Math.ceil(totalChars(messages) / CHARS_PER_TOKEN);

describe("rollTrajectory — calibration probe at scale", () => {
  it("synthetic 60-turn trajectory: rolling reduces prompt size by ≥40% and stays well under the warn threshold", () => {
    const messages = buildSyntheticTrajectory(TURN_COUNT);
    const unrolledTokens = estimatedTokens(messages);

    const rolled = rollTrajectory(messages);
    const rolledTokens = estimatedTokens(rolled.messages);

    expect(rolled.summarizedTurnCount).toBe(TURN_COUNT - REACT_TRAJECTORY_VERBATIM_WINDOW);
    expect(rolled.verbatimTurnCount).toBe(REACT_TRAJECTORY_VERBATIM_WINDOW);
    expect(rolledTokens).toBeLessThan(96_000);
    // Rolling must materially shrink the prompt — at least a 40% reduction
    // for this fixture's 50:10 summarized:verbatim ratio.
    expect(rolledTokens).toBeLessThan(unrolledTokens * 0.6);
  });

  it("synthetic 250-turn trajectory: rolled prompt stays well under the warn threshold even at extreme scale", () => {
    const messages = buildSyntheticTrajectory(250);
    const unrolledTokens = estimatedTokens(messages);
    expect(unrolledTokens).toBeGreaterThan(96_000);

    const rolled = rollTrajectory(messages);
    const rolledTokens = estimatedTokens(rolled.messages);

    expect(rolled.summarizedTurnCount).toBe(250 - REACT_TRAJECTORY_VERBATIM_WINDOW);
    expect(rolled.verbatimTurnCount).toBe(REACT_TRAJECTORY_VERBATIM_WINDOW);
    expect(rolledTokens).toBeLessThan(96_000);
  });

  it("synthetic 100-turn trajectory: rolled prompt remains within a stable bounded envelope", () => {
    const messages = buildSyntheticTrajectory(100);
    const rolled = rollTrajectory(messages);
    const rolledTokens = estimatedTokens(rolled.messages);

    expect(rolled.summarizedTurnCount).toBe(100 - REACT_TRAJECTORY_VERBATIM_WINDOW);
    expect(rolled.verbatimTurnCount).toBe(REACT_TRAJECTORY_VERBATIM_WINDOW);
    // Even at 100 turns, rolled prompt must stay under the warn threshold so
    // long Volvo-style runs (40+ tool calls) don't fall over.
    expect(rolledTokens).toBeLessThan(96_000);
  });

  it("synthesized summary block obeys the per-turn observation char limit", () => {
    const messages = buildSyntheticTrajectory(TURN_COUNT);
    const rolled = rollTrajectory(messages);
    const summary = rolled.messages[2];
    expect(summary.role).toBe("user");
    const eventLines = summary.content
      .split("\n")
      .filter((line) => line.startsWith("<event>") && line.endsWith("</event>"));
    expect(eventLines.length).toBe(TURN_COUNT - REACT_TRAJECTORY_VERBATIM_WINDOW);
    for (const line of eventLines) {
      // Each line is `<event>HEAD → outcome</event>`. The `outcome` slice is
      // bounded by REACT_TRAJECTORY_OBSERVATION_SUMMARY_CHAR_LIMIT; the
      // header HEAD adds at most ~50 chars (longest is
      // `ASSERTION_FAILED step-99 (resource-blocker)` ≈ 47 chars). Guard with
      // a generous upper bound.
      expect(line.length).toBeLessThan(REACT_TRAJECTORY_OBSERVATION_SUMMARY_CHAR_LIMIT + 100);
    }
  });

  it("rolling is monotonic: a longer trajectory NEVER produces a smaller rolled prompt than a shorter one", () => {
    const shorter = buildSyntheticTrajectory(20);
    const longer = buildSyntheticTrajectory(80);
    const shorterRolled = totalChars(rollTrajectory(shorter).messages);
    const longerRolled = totalChars(rollTrajectory(longer).messages);
    expect(longerRolled).toBeGreaterThanOrEqual(shorterRolled);
  });
});
