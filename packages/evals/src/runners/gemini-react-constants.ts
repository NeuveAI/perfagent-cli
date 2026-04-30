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

// Default model id for the Gemini Pro 3 teacher / frontier baseline. Pro 3
// (`gemini-3-pro-preview`, server-resolved to `gemini-3.1-pro-preview` per
// the response `modelVersion` field) replaces Flash 3 as of R10 — see
// `docs/handover/harness-evals/baselines/wave-r10-pro-preview.md`. Flash 3
// sat at gemma's noise floor on the wave-r5-ab sweep (R7 phase-7 evidence)
// and was not a viable teacher; Pro 3 lifts step-coverage by +0.166 and
// wins decisively on the journey-* bridge tasks where distillation has
// signal. Override via PERF_AGENT_GEMINI_REACT_MODEL when probing a newer
// preview SKU. Pro 3 emits `thoughtSignature` + ~140 reasoning tokens per
// round transparently — relevant for token accounting on the gemini-react
// lane.
export const GEMINI_REACT_DEFAULT_MODEL_ID = "gemini-3-pro-preview";
