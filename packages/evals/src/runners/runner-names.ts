// Lightweight, dependency-free runner-name constants. Lives in its own
// file so the wave-r5-ab aggregator + report builder can import the
// constants without transitively pulling the runner modules' heavy
// dependency graph (`@neuve/agent` → `@neuve/shared/observability` →
// `node-machine-id` + `posthog-node`), which causes ESM-loader failures
// when the report builder is invoked via `tsx` outside the vitest
// resolver.
//
// The runner factory modules (`gemma.ts`, `gemma-oracle-plan.ts`,
// `gemini-react-constants.ts`) re-export their respective constants from
// this module so the wire contract stays single-sourced.

export const GEMMA_RUNNER_NAME = "gemma";
export const GEMMA_REACT_RUNNER_NAME = "gemma-react";
export const GEMINI_REACT_RUNNER_NAME = "gemini-react";
export const GEMMA_ORACLE_PLAN_RUNNER_NAME = "gemma-oracle-plan";
