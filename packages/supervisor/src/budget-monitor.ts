import { REACT_BUDGET_ABORT_TOKENS, REACT_BUDGET_WARN_TOKENS } from "./constants";
import { ReactRunState, ReducerSignal } from "./react-reducer";

export interface BudgetEvaluation {
  readonly signals: ReadonlyArray<ReducerSignal>;
  readonly runState: ReactRunState;
  readonly shouldAbort: boolean;
}

const noChange = (runState: ReactRunState): BudgetEvaluation => ({
  signals: [],
  runState,
  shouldAbort: false,
});

/**
 * Pure budget evaluation. Called once per usage_update event. Returns the
 * (possibly empty) signal list, the (possibly mutated) run state, and a
 * `shouldAbort` flag the executor uses to synthesize a `RunFinished` event
 * with `abort.reason = "context-budget-exceeded"`.
 *
 * The warn-once guard lives in `runState.budgetExceeded`. An abort-level
 * crossing always emits a fresh `BudgetExceeded(level: "abort")` signal even
 * if a warn already fired, so the operator gets visibility into the harder
 * boundary independently. The flag is set after either crossing so a stable
 * "above-warn" run does not spam the log.
 */
export const evaluateBudget = (
  promptTokens: number,
  runState: ReactRunState,
): BudgetEvaluation => {
  if (promptTokens >= REACT_BUDGET_ABORT_TOKENS) {
    return {
      signals: [
        ReducerSignal.BudgetExceeded({
          level: "abort",
          promptTokens,
          threshold: REACT_BUDGET_ABORT_TOKENS,
        }),
      ],
      runState: new ReactRunState({ ...runState, budgetExceeded: true }),
      shouldAbort: true,
    };
  }
  if (promptTokens >= REACT_BUDGET_WARN_TOKENS && !runState.budgetExceeded) {
    return {
      signals: [
        ReducerSignal.BudgetExceeded({
          level: "warn",
          promptTokens,
          threshold: REACT_BUDGET_WARN_TOKENS,
        }),
      ],
      runState: new ReactRunState({ ...runState, budgetExceeded: true }),
      shouldAbort: false,
    };
  }
  return noChange(runState);
};
