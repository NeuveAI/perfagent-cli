/**
 * REDACTED_KEY_PATTERN — single source of truth for what counts as a
 * sensitive key across the evals package. Consumed by:
 *   - `src/runners/trajectory-summary.ts` — LLM-as-judge trajectory summarizer.
 *   - `src/distill/filters.ts` — teacher-data exporter redaction + detection.
 *
 * If a new family of secret-bearing keys shows up upstream (e.g. `session_id`,
 * `cookie`, `bearer`), extend this pattern in THIS file and both consumers
 * pick up the change. Round 1 review M1 caught the previous duplication —
 * one export per regex is non-negotiable.
 */
export const REDACTED_KEY_PATTERN = /api[_-]?key|token|password|secret|authorization/i;
