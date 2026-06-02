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

// harness-r3 P1: structural REFLECT-injection threshold. Strictly less than
// the doom-loop abort threshold so injection precedes abort by one step.
// When 2 consecutive tool-error rejections share `stepId + tool + argsHash`
// the next observation gains a REFLECT directive prefix to prompt a
// PLAN_UPDATE. Mirrors `REFLECT_INJECTION_THRESHOLD` in
// `@neuve/local-agent/tool-loop.ts`. See `docs/research/harness-r3/plan.md`
// §P1.
export const GEMINI_REACT_REFLECT_INJECTION_THRESHOLD = 2;
export const GEMINI_REACT_REFLECT_DIRECTIVE_TEXT =
  "REFLECT: This step is failing in the same shape twice in a row. The next envelope MUST be PLAN_UPDATE with action=insert (missing prerequisite step), action=replace (corrected step), or action=remove (now-redundant step). Do not retry the same ACTION.";

// harness-r4 vary-each-attempt: Generalize REFLECT-injection to fire on N
// consecutive parse-fails on same stepId regardless of shapeHash match.
// Closes P3 autopsy finding where varying rejection shapes reset the streak.
export const GEMINI_REACT_VARY_EACH_ATTEMPT_THRESHOLD = 2;

// harness-r4 THOUGHT-only loop: Fire REFLECT after N consecutive THOUGHTs
// without progress, then abort after threshold+1. Mirrors rejection ladder.
export const GEMINI_REACT_THOUGHT_ONLY_THRESHOLD = 5;
export const GEMINI_REACT_THOUGHT_LOOP_ABORT_THRESHOLD = 6;

// Display name for the runner — drives trace filenames, log annotations, and
// the eval scoreboard column. Re-exported from the canonical
// `runner-names.ts` so the constants stay single-sourced for the
// aggregator / report builder.
export { GEMINI_REACT_RUNNER_NAME } from "./runner-names";

// Default model id for the Gemini Pro 3 teacher / frontier baseline.
// `gemini-3-pro-preview` was the alias that auto-resolved server-side to
// `gemini-3.1-pro-preview`; Google retired the alias on 2026-03-26 and
// requires the explicit `gemini-3.1-pro-preview` id (no GA text-reasoning
// model exists as of 2026-06). Pro 3 replaces Flash 3 as of R10 — see
// `docs/handover/harness-evals/baselines/wave-r10-pro-preview.md`. Flash 3
// sat at gemma's noise floor on the wave-r5-ab sweep (R7 phase-7 evidence)
// and was not a viable teacher; Pro 3 lifts step-coverage by +0.166 and
// wins decisively on the journey-* bridge tasks where distillation has
// signal. Override via PERF_AGENT_GEMINI_REACT_MODEL when probing a newer
// preview SKU. Pro 3 emits `thoughtSignature` + ~140 reasoning tokens per
// round transparently — relevant for token accounting on the gemini-react
// lane.
export const GEMINI_REACT_DEFAULT_MODEL_ID = "gemini-3.1-pro-preview";
