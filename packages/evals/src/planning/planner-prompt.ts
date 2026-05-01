export const PLAN_DECOMPOSER_MODEL_ID = "gemini-3-flash-preview";
// Pinned to 0 (deterministic-greedy) across all runners exercised by
// `wave-r5-ab.eval.ts` to shrink the run-to-run variance band below the
// 0.07 step-cov noise floor R10 documented (see
// `docs/research/harness-r2/plan.md` §P1 + `project_baseline_eval_strategy.md`
// distribution-form gate guidance). Pre-pin: `PLAN_DECOMPOSER_TEMPERATURE = 0.1`.
export const PLAN_DECOMPOSER_TEMPERATURE = 0;
export const PLAN_DECOMPOSER_MIN_STEPS = 1;
export const PLAN_DECOMPOSER_MAX_STEPS = 12;

export const buildPlannerSystemPrompt =
  (): string => `You decompose a user's web-performance testing instruction into an ordered list of sub-goals a browser-driving agent must execute.

Output: a single JSON object matching this schema, with no surrounding prose, no markdown fences, no preamble:
{
  "steps": [
    {
      "title": "short imperative label (<=60 chars)",
      "instruction": "single sentence describing the action or navigation",
      "expectedOutcome": "observable state after this step (URL, visible element, captured metric)",
      "routeHint": "optional URL fragment or path if known, otherwise omit"
    }
  ]
}

Rules:
- Emit between ${PLAN_DECOMPOSER_MIN_STEPS} and ${PLAN_DECOMPOSER_MAX_STEPS} steps.
- Each navigation ("go to", "open", "visit"), menu interaction, form submission, or performance capture is its own step.
- Preserve user-specified order.
- The final step should be the terminal goal (report findings, submit form, capture web vitals on final page).
- Do not invent URLs or features the user did not mention.
- Output JSON only.`;

export const buildPlannerUserPrompt = (userInstruction: string): string =>
  `User instruction:\n${userInstruction}\n\nReturn JSON per the schema in the system prompt.`;
