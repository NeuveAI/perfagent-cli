# Wave R6 Post-Investigation — Multi-modality alone did not lift gemini-react

**Date:** 2026-04-27
**Predecessor:** `docs/research/multi-modal-react/plan.md` (Wave R6, planned 2026-04-26)
**Trigger:** R6-T1 partial-sweep gate failed. The wave does not proceed to full re-run.
**Author:** react-r6 / engineer

## Headline

| Runner | Task | Reached / expected | Step coverage |
|---|---|---|---|
| gemma-react | calibration-1-single-nav-python-docs | 1 / 1 | 1.000 |
| gemma-react | journey-4-account-signup | 5 / 5 | 1.000 |
| gemma-react | moderate-2-mdn-web-api-detail | 1 / 3 | 0.333 |
| gemma-react mean | — | — | **0.778** |
| gemini-react | calibration-1-single-nav-python-docs | 0 / 1 | 0.000 |
| gemini-react | journey-4-account-signup | 0 / 5 | 0.000 |
| gemini-react | moderate-2-mdn-web-api-detail | 0 / 3 | 0.000 |
| gemini-react mean | — | — | **0.000** |

R5b A:B baseline mean step-coverage on the same 3 tasks:
- gemma-react: (1.000 + 0.800 + 0.333) / 3 = 0.711
- gemini-react: (0.000 + 0.000 + 0.000) / 3 = 0.000

**Multi-modality lifted gemma-react** on these 3 tasks (+0.067 mean — driven by `journey-4` going from 4/5 → 5/5; calibration-1 and moderate-2 unchanged).
**Multi-modality did NOT lift gemini-react** — still 0/9 keynodes across all three tasks. The headline gate (gemini-react > 0.465) remains unreachable on this sweep, and the partial-sweep ≥ 0.5 floor was missed by a full margin.

## Failure-axis evidence — gemini-react is failing tool-schema adherence, not vision

Reading the gemini-react traces under `packages/evals/evals/traces/wave-r5-ab/gemini-react__*.ndjson`, every tool call gemini emits matches one of three failure shapes — none of them touch the multi-modal observation pipeline:

1. **Hallucinated tool names from the legacy executor catalog.** Gemini repeatedly calls `navigate_page`, `performance_start_trace`, `take_snapshot` — names that haven't been MCP tools since Wave 2 was decomposed. Trace excerpt (`gemini-react__calibration-1`):
   ```
   CALL: navigate_page {'url': 'https://docs.python.org/3/'}
   RESULT: ERR Unknown tool: navigate_page. Available: interact, observe, trace, click, fill, hover, select, wait_for
   CALL: performance_start_trace {'reload': True}
   RESULT: ERR Unknown tool: performance_start_trace. ...
   ```
2. **Flat-action shape instead of nested-action shape.** When gemini does pick `interact`, it ships `args: {action: "navigate", url: "..."}` (the action-as-string Wave-2 shape) instead of the current `args: {action: {command: "navigate", url: "..."}}` (action-as-object). The MCP bridge's auto-wrap only fires when `"command" in args && wrapperKey not in args` — `"action" in args` already-shaped-wrong is the path gemini lands on, so no recovery.
3. **The `action` array hallucination.** Gemini once emits `args: {action: ['navigate', 'https://docs.python.org/3/']}` — neither the legacy tuple shape nor the current object shape, just made-up. The structured-output `responseSchema` doesn't constrain `ACTION.args` (it's `Schema.Unknown`), so any args shape passes the AgentTurn grammar.

Across all three tasks the model burns the entire 15-round budget on this dance, eventually hitting `Reached maximum tool call rounds (15). Stopping.`. Every turn looks like the previous one — the doom-loop detector keys on `(toolName, argsHash)` so a sequence of `navigate_page → interact(action:'navigate') → navigate_page → …` never trips the threshold. Multi-modality is irrelevant to this failure: the screenshot bytes ride along on observations the model never gets to consume because the action never lands.

## Why R5b's text-only run had the same outcome

R5b traces show the same hallucinated-tool / flat-action failure shape. R5b's gemini-react was already 0/60 step coverage; R6 just preserves that floor, with the screenshot bytes adding token cost but not behaviour change.

## Where multi-modality DID help (and where to keep it)

The gemma-react `journey-4-account-signup` lift (4/5 → 5/5) is real and caused by the screenshot-on-action wiring: that task sends the agent through a Figma sign-up flow whose step 5 is "click the Get-started CTA after the cookie banner dismisses", which the snapshot historically described accurately but in a way the small model couldn't ground without seeing where the button moved post-banner-dismiss. Probe traces show 7 tool calls vs R5b's 15 (incomplete) — fewer wasted turns, more efficient grounding. **The multi-modal wiring should stay.** The wave just shouldn't be the gating wave for distillation.

## Recommended next-most-likely failure axis

The gemini-react regression is **action-space / tool-schema adherence**, not vision or context handling. The next wave should target the gap between what gemini Flash 3's training data thinks browser tools look like and what our MCP server actually exposes. Concrete candidate fixes (in increasing scope):

1. **Schema-constrain `ACTION.args` per-tool.** Replace `Schema.Unknown` on `ACTION.args` with a discriminated union keyed off `toolName` (interact/observe/trace + the flat tools). The `responseSchema` then physically rejects `{action: "navigate"}` and `navigate_page` at decode time, forcing gemini's structured-output path back to the right shape on the same turn instead of burning a round-trip.
2. **Tool-name aliasing in the MCP bridge.** Map legacy names (`navigate_page`, `take_snapshot`, `performance_start_trace`) to the current `interact`/`observe`/`trace` calls. Cheap remediation; doesn't address shape errors but cuts the failure rate.
3. **Drop `interact` to flat tools.** Replace the `interact { action: { command: ... } }` wrapper with the legacy flat tools (`click(ref)`, `fill(ref, text)`, `navigate(url)`, …) for gemini-react specifically. This is the action-space-granularity hypothesis the wave plan parked. Ironically, gemma-react seems to handle the nested shape fine via the bridge's auto-wrap — gemini doesn't because gemini's training data prefers flat schemas and the auto-wrap only triggers when `"command"` is the args key.
4. **Multi-shot exemplars in the system prompt.** Show gemini one fully-formed `{_tag: "ACTION", toolName: "interact", args: {action: {command: "navigate", url: "..."}}}` envelope before turn 1. Exemplars are still general (no site heuristics) so this doesn't violate `feedback_avoid_prompt_overfitting.md`. Cheapest, but historically least effective for tool-schema problems.

Recommendation: start with (1) — physically constraining the args at the schema level is the same lesson R5b learned with `$ref` flattening (`feedback_no_test_only_injection_seams.md`). What the schema doesn't enforce, the model finds a way to violate.

## What did NOT contribute to the failure

- **The Ollama multipart wire shape works.** Probe 1 + the new `gemma-multimodal-smoke` test pin it. Gemma's lift on journey-4 is direct evidence the multi-modal feed is reaching the model.
- **The AI SDK multipart shape works.** Probe 2 + the extended `gemini-live-smoke` test round-trip a multipart envelope through `AGENT_TURN_RESPONSE_SCHEMA` in <2s.
- **Trajectory rolling handles multipart cleanly.** The image bytes drop on summarization, the verbatim window keeps the most recent N=10 turns intact. Existing trajectory tests stay green.
- **Token budget held.** Peak prompt for multi-modal turns: 24,964 tokens (gemma-react moderate-2). R4 abort is 120K. Plenty of headroom; not a budget failure.

## Process verdict

R6-T1 reports **INVESTIGATIVE**, not COMPLETE. Implementation shipped (commits `4586c649`..`99b568b2` on `gemma-harness-lora`). Smoke probes + unit tests stay green. The wave's headline goal — lift gemini-react above gemma-react's 0.465 floor — was not achieved, so distillation remains gated. User decides the next direction (likely R7: schema-constrain ACTION.args).
