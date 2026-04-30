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
/**
 * R11 P6 — browsing-gemma-react. The fine-tuned LoRA adapter (browsing-gemma)
 * served by llama.cpp's llama-server (locked decision #9 in
 * `docs/research/distillation-pipeline/plan.md`: Ollama 0.22.0 doesn't yet
 * implement LoRA inference). The runner uses `runtime: "llama-server"` on
 * `GemmaRunnerOptions`; the OllamaApiAdapter HTTP proxy translates Ollama
 * `/api/chat` to llama-server `/v1/chat/completions` so production code in
 * `@neuve/local-agent` remains untouched.
 */
export const BROWSING_GEMMA_REACT_RUNNER_NAME = "browsing-gemma-react";
