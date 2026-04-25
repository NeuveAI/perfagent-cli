// Tunables for the Gemini-react eval runner. Mirror the local-agent
// thresholds verbatim — the loops do the same work; the only difference is
// the LLM backend (Gemini Flash 3 vs. Gemma via Ollama). Keeping the
// thresholds in lockstep is what makes the gemini-react ↔ gemma-react A:B
// comparison apples-to-apples.

// Hard cap on rounds before the loop self-terminates. Matches MAX_TOOL_ROUNDS
// in `@neuve/local-agent/tool-loop.ts`. A round is one generateObject
// call regardless of envelope kind (THOUGHT and ACTION each consume one).
export const GEMINI_REACT_MAX_TOOL_ROUNDS = 15;

// After this many identical consecutive ACTION envelopes (same toolName +
// stringified args), the loop aborts to avoid burning rounds on a stuck
// model. Matches DOOM_LOOP_THRESHOLD in `@neuve/local-agent/tool-loop.ts`.
export const GEMINI_REACT_DOOM_LOOP_THRESHOLD = 3;

// Display name for the runner — drives trace filenames, log annotations, and
// the eval scoreboard column. Re-exported from the canonical
// `runner-names.ts` so the constants stay single-sourced for the
// aggregator / report builder.
export { GEMINI_REACT_RUNNER_NAME } from "./runner-names";

// Default model id for the Gemini Flash 3 frontier baseline. The 3.0 line is
// the configured default per `project_react_migration_plan.md` Decision #5
// (Gemini Flash 3 for A:B). Override via PERF_AGENT_GEMINI_REACT_MODEL when
// re-evaluating against a newer Gemini SKU.
export const GEMINI_REACT_DEFAULT_MODEL_ID = "gemini-3-flash-preview";
