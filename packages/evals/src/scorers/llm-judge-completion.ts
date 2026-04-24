import { Effect } from "effect";
import type { JudgeOutput } from "./llm-judge";
import { LlmJudge, type JudgeInput } from "./llm-judge";

export interface JudgeCompletionScore {
  readonly score: number;
  readonly completed: boolean;
  readonly confidence: number;
  readonly reasoning: string;
}

/**
 * judgeCompletion — runs the LlmJudge against a trajectory and produces a
 * [0, 1] scorer row. The score is `completed ? confidence : 1 - confidence`:
 * a high-confidence "completed" is 1.0, a high-confidence "not completed" is
 * 0.0, and the judge's uncertainty surfaces as scores near 0.5. Downstream
 * reports can flatten to binary `completed`, aggregate mean score, or cite
 * the `reasoning` directly in regression narratives.
 */
export const judgeCompletion = Effect.fn("judgeCompletion")(function* (input: JudgeInput) {
  const judge = yield* LlmJudge;
  const verdict: JudgeOutput = yield* judge.judge(input);
  const score = verdict.completed ? verdict.confidence : 1 - verdict.confidence;
  return {
    score,
    completed: verdict.completed,
    confidence: verdict.confidence,
    reasoning: verdict.reasoning,
  } satisfies JudgeCompletionScore;
});
