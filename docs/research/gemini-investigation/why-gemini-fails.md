# Why gemini-3-flash-preview Fails Our Browsing Evals

**Date:** 2026-04-27
**Trigger:** R6-T1 partial-sweep gate failed — gemini-react remained at 0.000 mean step-coverage on calibration-1 / journey-4 / moderate-2 after multi-modal wiring shipped. Engineer's memo (`post-r6-investigation.md`) named "tool-schema adherence" as the failure axis. This report independently verifies and extends that diagnosis with codebase evidence + OSS-harness comparison + published Gemini behavior.
**Scope:** Browsing-only. Debugging-mode tasks are out of scope.

---

## TL;DR

The failure has **one root cause and one catalyst**, not the other way around.

- **Root cause: tool-surface divergence.** `gemini-3-flash-preview` correctly recalls the upstream `chrome-devtools-mcp` public API from training data — `navigate_page`, `take_snapshot`, `performance_start_trace` are all real, current, documented tool names in our installed v0.21.0. Our harness collapses the upstream 34 flat tools into 3 macro dispatchers (`interact` / `observe` / `trace`) plus 5 flat aliases. The MCP server returns "Unknown tool" for every name Gemini knows.
- **Catalyst: schema permissiveness.** `ACTION.args = Schema.Unknown` (`packages/shared/src/react-envelope.ts:35`) puts zero structural pressure on the args body. Gemini's structured-output path can emit any shape — flat-action (`{action: "navigate"}`), array-action (`{action: ["navigate", "url"]}`), or hallucinated tool name — and decoding succeeds. The bridge fails the call downstream, but the model has already burned the round.

These two interact. The dispatcher abstraction is upstream-incompatible AND the args slot is unconstrained, so the model's training prior overrides the in-prompt contract. **Multi-modality is not the failure axis** — gemma-react gained on the same 3-task probe (0.711 → 0.778) with screenshots. Token budget, multipart wire shape, trajectory rolling all check out (R6 smoke probes pass live).

The fix matrix has three tiers, increasing in scope. Tier 1 (schema-constrain `ACTION.args`) is the smallest ship; Tier 2 (tool-name aliasing in MCP bridge) extends it; Tier 3 (drop dispatchers, expose 34 native tools) is the radical option that the OSS field has converged on.

---

## 1 — The smoking gun

> The codebase-research agent initially reported `grep node_modules/chrome-devtools-mcp/ -r` returned no matches for the names. That agent was wrong — its grep scope missed the build artifacts. Lead verified directly:

```text
$ grep -E "name:|\"name\"" node_modules/chrome-devtools-mcp/build/src/tools/{pages,snapshot,performance}.js
pages.js:       name: 'list_pages',
pages.js:       name: 'select_page',
pages.js:       name: 'close_page',
pages.js:       name: 'new_page',
pages.js:       name: 'navigate_page',          ← what gemini emits
pages.js:       name: 'resize_page',
pages.js:       name: 'handle_dialog',
pages.js:       name: 'get_tab_id',
performance.js: name: 'performance_start_trace', ← what gemini emits
performance.js: name: 'performance_stop_trace',
performance.js: name: 'performance_analyze_insight',
snapshot.js:    name: 'take_snapshot',           ← what gemini emits
snapshot.js:    name: 'wait_for',
```

Installed version: `chrome-devtools-mcp@0.21.0`. The names Gemini "hallucinates" are not hallucinations; they are the canonical, current public API of the upstream package. Per the upstream tool-reference (https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md), v0.21 exposes **34 flat tools**. Our `packages/browser/src/mcp/server.ts` exposes **8 wrapper tools** instead.

What our MCP server exposes (per system prompt at `packages/browser/src/mcp/server.ts:18-53`):
- `interact` — dispatcher for click/fill/type/navigate/etc., with nested `{action: {command: ..., ...}}` shape
- `observe` — dispatcher for snapshot/screenshot, same nested shape
- `trace` — dispatcher for performance start/stop/analyze, same nested shape
- `click` / `fill` / `hover` / `select` / `wait_for` — 5 legacy flat aliases registered via `registerInteractionTools`

The trace evidence (`packages/evals/evals/traces/wave-r5-ab/gemini-react__calibration-1-single-nav-python-docs.ndjson` line 11) confirms what the server returns:

```text
RESULT: ERR Unknown tool: navigate_page.
        Available: interact, observe, trace, click, fill, hover, select, wait_for
```

Gemini's prior is correct; our prompt is the divergent surface.

---

## 2 — The two-axis failure mode (with trace forensics)

Three distinct failure shapes appear across the 20 gemini-react traces (engineer's memo §"Failure-axis evidence" enumerates them; this section grounds each in code references):

### 2.1 — Hallucinated tool names from the upstream catalog
```text
CALL: navigate_page {'url': 'https://docs.python.org/3/'}
RESULT: ERR Unknown tool: navigate_page. Available: interact, observe, trace, …
```
Gemini calls public chrome-devtools-mcp names (`navigate_page`, `take_snapshot`, `performance_start_trace`). Our server doesn't expose them. Hard fail.

### 2.2 — Flat-action shape on `interact`
When Gemini does pick `interact`, it ships:
```text
args: {action: "navigate", url: "..."}            ← flat: action-as-string
```
instead of the contract:
```text
args: {action: {command: "navigate", url: "..."}} ← nested: action-as-object
```
The MCP bridge auto-wrap at `packages/local-agent/src/mcp-bridge.ts:246-251` only fires when:

```ts
if (wrapperKey && !(wrapperKey in args) && "command" in args) {
  finalArgs = { [wrapperKey]: args };  // wrap {command:...} → {action:{command:...}}
}
```

The wrap requires `"command" in args`. Gemini's flat shape has `"action" in args` (with a string value), so the auto-wrap silently skips and the call goes to the real `interact` tool with the wrong shape. The Zod discriminated union at `packages/browser/src/mcp/tools/interact.ts:7-92` rejects it.

### 2.3 — The array-action hallucination
```text
args: {action: ["navigate", "https://docs.python.org/3/"]}
```
Neither contract nor any past version. Pure pattern-match from training distribution.

### Why all three pass the AgentTurn schema

`packages/shared/src/react-envelope.ts:32-36`:
```ts
export class Action extends Schema.TaggedClass<Action>()("ACTION", {
  stepId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,   // ← every shape above decodes successfully
}) {}
```

Gemini receives this as `responseSchema` via `AGENT_TURN_RESPONSE_SCHEMA` (`gemini-react-loop.ts:121`). `Schema.Unknown` translates to an empty object schema with no type pressure. Per Google's own structured-output docs ([firebase.google.com](https://firebase.google.com/docs/ai-logic/generate-structured-output)): *"If there's insufficient context in the associated input prompt, the model generates responses mainly based on the data it was trained on."* The structured-output constraints **physically cannot reject** the malformed args — there's nothing in the schema to reject against.

### Cadence
Across all three calibration tasks gemini-react burns rounds in this dance until the 15-round budget cap fires (`gemini-react-loop.ts` max-rounds path emits synthetic RunCompleted with `abort.reason = "max-rounds"`). The doom-loop detector keys on `(toolName, argsHash)` so the alternation `navigate_page → interact{action:"navigate"} → take_snapshot → interact{action:"snapshot"}` never trips the threshold. Multi-modality is **irrelevant to this failure** — the screenshot bytes ride observations the model never receives because the action never lands.

---

## 3 — Why gemma-react succeeds with the same schema

Gemma 4 E4B (`gemma4:e4b`, the production model) hits the same loose schema and the same loose prompt, yet scores 0.465 baseline / 0.778 on the multi-modal probe. Two reasons:

1. **Smaller training-data exposure to chrome-devtools-mcp public catalog.** Gemma is a Google open-weights release with a narrower corpus than Gemini Flash 3. Anecdotally (no published evidence), it appears to follow the in-context system prompt more obediently when the prompt names tools clearly. Gemma's traces show it picking `interact` directly with `{command: "navigate", url: "..."}` — which the bridge auto-wrap promotes to `{action: {command: "navigate", url: "..."}}` and the Zod discriminator accepts. (Trace evidence: `packages/evals/evals/traces/wave-r5-ab/gemma-react__calibration-1-single-nav-python-docs.ndjson` line 3.)
2. **Bridge auto-wrap covers gemma's emission shape.** Gemma lands on `"command" in args`, which is the exact precondition the auto-wrap checks. Gemini lands on `"action" in args` (string-valued), which is not. The wrap is one-sided.

This is fragile. Gemma succeeds by coincidence: its emission shape happens to match a one-sided recovery path. If Gemma ever drifts to flat-action emission (no published reason it would, but small-model behavior under longer trajectories is empirical), it would regress to gemini's failure mode.

---

## 4 — Where Gemini's prior comes from

Direct evidence of training-data exposure to the upstream catalog:

- **Public Chrome for Developers blog post** announces `chrome-devtools-mcp` and lists the tool surface ([developer.chrome.com](https://developer.chrome.com/blog/chrome-devtools-mcp)).
- **AddyOsmani's blog** documents the same names in tutorials ([addyosmani.com](https://addyosmani.com/blog/devtools-mcp/)).
- **Google ships first-class Gemini CLI integration**: `gemini mcp add chrome-devtools npx chrome-devtools-mcp@latest` ([chrome-devtools-mcp #709](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/709)). Google has both motive (first-party demo) and capability (training data ownership) to ensure Gemini's prior matches this catalog.
- **CHANGELOG stability**: tool names have been stable since at least v0.10 (Nov 2025) per the upstream CHANGELOG. There is no rename event in history that would have left "old" names in training data.

The names are not legacy. They are current. Gemini's prior is correct; the divergence is on our side.

---

## 5 — OSS browsing-harness comparison

Web research scanned 11 public ReAct browsing harnesses. Pattern: **every benchmark-leading harness uses a flat per-action surface**. The closest analog to our bug is `browser-use`:

- **`browser-use/browser-use`** — Python ReAct browsing agent with multi-provider support including Gemini via `ChatGoogle` ([docs.browser-use.com](https://docs.browser-use.com/supported-models)). Documented bug ([#104](https://github.com/browser-use/browser-use/issues/104)): Gemini emits `[{"navigate": "google.com"}]` instead of `[{"navigate": {"url": "google.com"}}]` when Pydantic field descriptions are missing. Fix: strict per-action schemas with descriptions on every field. **Identical failure mode to ours.**
- **WebVoyager** ([arXiv 2401.13919](https://arxiv.org/html/2401.13919v3)) — flat actions: `Click`, `Type`, `Scroll`, `Wait`, `GoBack`, `Google`, `ANSWER`. Free-form text parsing.
- **BrowserGym / AgentLab** ([arXiv 2412.05467](https://arxiv.org/abs/2412.05467)) — flat Python-callable actions: `click(bid)`, `fill(bid, value)`, `goto(url)`. Used by AgentLab as the reference standard. Gemini 2.5 Flash works as eval judge but no documented harness deployment.
- **AutoWebGLM** — flat actions on simplified DOM (Steel.dev leaderboard).
- **SeeAct** — choose-from-element-list (flat).
- **Anthropic Computer Use reference impl** — single composite `computer` tool with a **discriminated `action` enum** (closest to our nested shape, but uses an explicit enum, not `Schema.Unknown`). This is the only nested-action design that ships at scale, and it ships with strict schema typing.
- **OpenCode** (the local clone at `.repos/opencode/`) — coding agent, not browsing-relevant. OpenAI-style flat tool names, no discriminated unions, no Gemini-specific schema flattening. Provides no directly applicable patterns.

**Selection-pressure conclusion**: no published harness ships nested dispatcher actions with permissive args and tops a leaderboard. The field has converged on flat actions. We are an outlier.

---

## 6 — Multi-modality is *not* the failure axis (R6 evidence)

To rule out the screenshot wiring:

- **R6 multi-modal probes pass live**. `gemini-live-smoke` (extended in R6 commit `99b568b2`) sends a real multipart `[{type:"text"}, {type:"image"}]` envelope through `AGENT_TURN_RESPONSE_SCHEMA` and asserts `parseAgentTurn` succeeds in <2s. `gemma-multimodal-smoke` does the same against Ollama's native shape (`images: ["base64..."]` siblings to `content: string`).
- **Gemma-react gained on the partial-sweep**: 0.711 → 0.778 on calibration-1 / journey-4 / moderate-2 with screenshots wired in. Direct evidence the multi-modal feed reaches the model and is being used (journey-4 specifically went 4/5 → 5/5 keynodes — the post-cookie-banner CTA grounded better with vision).
- **Token budget held**. Peak prompt for multi-modal turns: 24,964 tokens (gemma-react moderate-2). R4 abort is 120K. Plenty of headroom.
- **Trajectory rolling handles multi-modal**. Image bytes drop on summarization; verbatim window keeps the most recent N=10 turns intact. Existing trajectory tests stay green.

If the failure axis were multi-modality, gemini-react would have moved (in either direction). It didn't — 0.000 → 0.000. The screenshot bytes are bytes the model never gets to consume because the actions never land.

---

## 7 — Ancillary Gemini-specific constraints surfaced by web research

Documented Gemini-side issues that don't currently bite us but affect future-fix design:

- **`responseSchema` + tool history was unsupported on Gemini 2.5** ([googleapis/python-genai #706](https://github.com/googleapis/python-genai/issues/706), [vercel/ai #11947](https://github.com/vercel/ai/issues/11947)). Only `gemini-3-pro-preview` and `gemini-3-flash-preview` support the combination. We're already on `gemini-3-flash-preview`. Don't downgrade.
- **Gemini silently ignores schema constraints it doesn't understand**. The Mastra MCP compatibility study ([mastra.ai blog](https://mastra.ai/blog/mcp-tool-compatibility-layer)) measured 15% → 3% error rate (5x reduction) by **normalizing schemas to provider-supported subsets**. Gemini-2.0-flash-lite-001 baseline 73.33% — among the worst tested. *Gemini ignoring is worse than failing.*
- **Schema property ordering is load-bearing for Gemini**. Per Vertex docs ([cloud.google.com](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output)): "If there are any descriptions, schemas, or examples in the prompt, they must present the same property ordering as is specified in the responseSchema." Unique to Gemini.
- **Gemini renames schema field names to synonyms** ([discuss.ai.google.dev](https://discuss.ai.google.dev/t/structured-output-ignoring-schema-field-names/110880)). This is the same dynamic as our `action`-vs-`action.command` divergence — the model substitutes from its prior when the schema is permissive.
- **`anyOf` is poorly supported; `oneOf` works** ([colinhacks/zod #5807](https://github.com/colinhacks/zod/issues/5807)). When we constrain `ACTION.args` we should use `oneOf` (discriminated union) not `anyOf`.
- **`additionalProperties` was rejected client-side until Nov 2025** ([googleapis/python-genai #1815](https://github.com/googleapis/python-genai/issues/1815)). Probably fine now, but verify.
- **`$defs` rejected in tool schemas** ([gemini-cli #13326](https://github.com/google-gemini/gemini-cli/issues/13326)). Already a known constraint — R5b's schema-flatten fix addressed it. Stays relevant for the next-wave schema work.
- **Multipart messages need a text-part companion** ([vercel/ai #3776](https://github.com/vercel/ai/issues/3776)). Image-only messages 400. Our R6 wiring already includes the text part by construction.

No primary source publishes WebArena / Mind2Web / WebVoyager / OSWorld scores for Gemini 3 Flash specifically as of 2026-04-27. The closest data point is **PA Bench's qualitative observation** that Gemini 3 Pro "frequently makes small execution errors, and often terminates immediately" ([vibrantlabs.com](https://vibrantlabs.com/blog/pa-bench)) — strong planning, weak execution. Consistent with what we see.

---

## 8 — The fix matrix

Three tiers, increasing in scope. Each is independently shippable; later tiers benefit from earlier ones being in place.

### Tier 1 — Schema-constrain `ACTION.args` per `toolName`

**The smallest, most targeted ship.** Replace `Schema.Unknown` with a discriminated union keyed on `toolName`:

```ts
// Before (packages/shared/src/react-envelope.ts:32-36)
export class Action extends Schema.TaggedClass<Action>()("ACTION", {
  stepId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,
}) {}

// After
export class Action extends Schema.TaggedClass<Action>()("ACTION", {
  stepId: Schema.String,
  args: Schema.Union(
    InteractActionSchema,   // { toolName: "interact", args: {action: {command, ...}} }
    ObserveActionSchema,
    TraceActionSchema,
    ClickActionSchema,      // legacy flat aliases stay
    FillActionSchema,
    // ...
  ),
}) {}
```

What this fixes: Gemini's structured-output path can no longer emit `{action: "navigate"}` because the schema rejects it at decode time. The model is forced back to the right shape on the same turn instead of burning a round-trip.

What this doesn't fix: Gemini may still emit hallucinated tool names (`navigate_page`). The schema rejects them at decode time, so the loop sees a SchemaError instead of an "Unknown tool" error — equivalent failure mode but caught earlier.

Caveat per the web research: use `oneOf` (discriminated union via `Schema.Union` of `Schema.TaggedClass`), not `anyOf`. Gemini handles `oneOf` correctly. Add Pydantic-style descriptions on every field — `browser-use #104` is direct precedent that Gemini falls back to flat shapes when descriptions are missing.

### Tier 2 — Tool-name aliasing in MCP bridge

**Map upstream names to dispatcher calls in the bridge, not in the prompt.**

In `packages/local-agent/src/mcp-bridge.ts`, before the auto-wrap, add an alias step:

```ts
const TOOL_ALIASES: Record<string, { tool: string; argsTransform: (args: unknown) => unknown }> = {
  navigate_page: { tool: "interact", argsTransform: (a) => ({ action: { command: "navigate", ...a } }) },
  take_snapshot: { tool: "observe",  argsTransform: (a) => ({ action: { command: "snapshot", ...a } }) },
  take_screenshot: { tool: "observe", argsTransform: (a) => ({ action: { command: "screenshot", ...a } }) },
  performance_start_trace: { tool: "trace", argsTransform: (a) => ({ action: { command: "start", ...a } }) },
  performance_stop_trace: { tool: "trace", argsTransform: (a) => ({ action: { command: "stop", ...a } }) },
  performance_analyze_insight: { tool: "trace", argsTransform: (a) => ({ action: { command: "analyze", ...a } }) },
  // ...the full 34-tool catalog
};
```

What this fixes: Gemini's correct training-prior tool names route to the right dispatcher without the model having to "learn" our local naming. Cuts the most common gemini failure shape (per traces: ~60% of failures are tool-name divergence).

What this doesn't fix: Tier 1 still required to constrain args shape at the schema level.

Combined with Tier 1: gemini's emissions get the strict discriminated args schema (Tier 1) AND the bridge accepts upstream names (Tier 2). Both axes covered.

### Tier 3 — Drop the dispatcher abstraction

**Stop fighting the prior. Expose the upstream 34 flat tools directly.**

Rewrite `packages/browser/src/mcp/server.ts` to proxy chrome-devtools-mcp's tool surface 1:1. The system prompt shrinks dramatically (no need to teach a dispatcher contract). Per the OSS comparison (§5), this is what every benchmark-leading harness does.

What this fixes: Tool-name divergence disappears entirely. Args-shape divergence narrows because each tool has a tightly-typed schema upstream.

What this risks: Gemma may regress. Gemma's 0.465 baseline is on the dispatcher contract; we don't know how it scores on flat tools. Could be better (smaller cognitive load per call, no nesting); could be worse (loses the categorical grouping our prompt teaches). Need a partial-sweep probe before committing.

This is also the largest ship: deletes the dispatcher tools, rewrites the system prompt, requires re-running R5b's full smoke probe + partial-sweep + full sweep to validate both gemma-react and gemini-react. ~3-5 days of work depending on prompt iteration.

### Recommendation

**Tier 1 + Tier 2 in sequence, gated on partial-sweep.** Tier 1 ships first (the engineer's recommendation in the memo) — it's the smallest change with the most direct evidence (browser-use #104 precedent + Mastra 5x error-rate study). Run a 3-task partial sweep. If gemini-react ≥ 0.5: proceed to Tier 2 + full sweep. If still 0.000 after Tier 1: Tier 2 next, gated again. Defer Tier 3 until we know whether Tier 1+2 are sufficient. The user has been clear that LoRA distillation is gated on lifting gemini-react above 0.465 — that's the headline gate we're optimizing for.

If Tier 1+2 don't lift gemini-react, **Tier 3 is the highest-evidence option** (selection pressure across the OSS field), but it's a bigger architectural commitment and we should run it as its own dedicated wave.

---

## 9 — Open questions

These don't block the next wave but should be tracked:

1. **Is Gemma's success on the dispatcher contract actually robust, or is it coincidence?** The bridge auto-wrap is one-sided (catches `"command" in args` but not `"action" in args`). If Gemma ever drifts to flat-action emission under longer trajectories, it regresses. Tier 1 protects against this regression.
2. **Does Gemini's failure mode shift when `responseSchema` is strict?** Theory says it should emit the right shape on turn 1; precedent (browser-use #104) confirms. But "Gemini silently ignores constraints it doesn't understand" (Mastra study) suggests verifying empirically per task before declaring victory.
3. **Is `gemini-3-flash-preview` even the right teacher for distillation?** Per the OSS field's selection pressure, frontier-baseline ReAct browsing increasingly relies on either (a) Gemini-fine-tuned products like Mariner or (b) Anthropic Computer Use's coordinate-based action surface. If Tier 1+2 only get gemini-react to ~0.4 and we need >0.465, **switching the teacher** (claude-sonnet-4-6 with computer-use? gpt-5? gpt-4o? Mariner if API access) becomes the live alternative. This is a research question, not a code question.
4. **Does our `interact` system-prompt section (`packages/browser/src/mcp/server.ts:18-53`) bury the dispatcher contract in too much text?** Web research surfaced that Gemini honors the *first* schema description in a prompt. If the upstream catalog leaked into Gemini's prior more strongly than our 35-line dispatcher prose, the prompt may be losing the prior-fight. Worth a controlled probe with a much shorter, more declarative dispatcher prompt.

---

## 10 — What this report does not claim

- **Not** that multi-modality was a wasted wave. The R6 wiring is a 0.067-point lift on gemma-react and a regression-guard for the wire shape (`gemini-live-smoke` + `gemma-multimodal-smoke` are now permanent CI). The wave reports as INVESTIGATIVE, not RETRACTED.
- **Not** that Gemini is fundamentally unsuited to ReAct browsing. PA Bench / Mariner / browser-use Gemini paths all show Gemini Flash 3 *can* do agentic browsing — when the tool surface matches its prior and the schemas are strict. Our harness is fightable, not unfittable.
- **Not** that flat tools are universally better than dispatchers. Anthropic Computer Use ships nested-action with discriminated enum and works well. The research-supported claim is narrower: nested with `Schema.Unknown` args is uniquely worst-case.

---

## Sources

### Codebase (file:line)
- `packages/shared/src/react-envelope.ts:32-36` — `Action` schema with `args: Schema.Unknown`.
- `packages/evals/src/runners/gemini-react-loop.ts:81-129` — `AGENT_TURN_RESPONSE_SCHEMA` construction; what Gemini receives as `responseSchema`.
- `packages/local-agent/src/tool-loop.ts:49-52` — `AGENT_TURN_FORMAT` for Ollama; identical permissiveness on `args`.
- `packages/browser/src/mcp/server.ts:18-53,98-101` — system prompt + tool registration. 8 tools total (3 dispatchers + 5 flat aliases).
- `packages/browser/src/mcp/tools/interact.ts:7-122` — Zod discriminated union on `command` (12+ variants). Tightly typed downstream of the AgentTurn schema, but unreachable when Gemini emits the wrong wrapper shape.
- `packages/local-agent/src/mcp-bridge.ts:62-73,246-251` — `detectWrapperKey` + auto-wrap condition. One-sided recovery: catches `"command" in args`, not `"action" in args` with string value.
- `packages/evals/evals/traces/wave-r5-ab/gemini-react__calibration-1-single-nav-python-docs.ndjson` — 12 lines, single-turn failure, hallucinated `navigate_page`.
- `packages/evals/evals/traces/wave-r5-ab/gemma-react__calibration-1-single-nav-python-docs.ndjson` — 31 lines, 2-turn success on the same task.
- `node_modules/chrome-devtools-mcp/build/src/tools/{pages,snapshot,performance}.js` — ground truth for the upstream API surface in v0.21.0.

### Engineer artifacts (this wave)
- `docs/research/multi-modal-react/post-r6-investigation.md` — engineer's memo with 4 ranked candidate fixes.
- `docs/handover/multi-modal-react/diary/r6-2026-04-27.md` — engineer's diary covering the 4 open probes.
- `docs/handover/harness-evals/baselines/wave-r5-ab.md` — R5b A:B baseline (0.000 / 0.465 / 0.346 across runners).

### chrome-devtools-mcp (upstream)
- https://github.com/ChromeDevTools/chrome-devtools-mcp — repo
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md — 34-tool catalog
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md — name-stability evidence
- https://developer.chrome.com/blog/chrome-devtools-mcp — Chrome for Developers blog announcement
- https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/709 — Google's first-party Gemini CLI integration (training-data-exposure evidence)

### Gemini structured-output / tool-call constraints
- https://firebase.google.com/docs/ai-logic/generate-structured-output — "training data fallback when context insufficient"
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output — schema property ordering
- https://github.com/googleapis/python-genai/issues/706 — `responseSchema` + tool history unsupported on 2.5
- https://github.com/vercel/ai/issues/11947 — `gemini-3-flash-preview` is minimum viable
- https://github.com/googleapis/google-cloud-java/issues/11782 — malformed JSON with `responseSchema` on Flash
- https://github.com/vercel/ai/issues/3776 — multipart needs text-part companion
- https://github.com/colinhacks/zod/issues/5807 — `oneOf` works, `anyOf` doesn't on Gemini
- https://github.com/google-gemini/gemini-cli/issues/13326 — `$defs` rejected (R5b's known constraint)
- https://discuss.ai.google.dev/t/structured-output-ignoring-schema-field-names/110880 — Gemini renames schema field names to synonyms
- https://discuss.ai.google.dev/t/gemini-2-5-flash-stuck-in-a-tool-call-loop-when-using-both-tools-and-structured-output/110777 — tool-call loop pathology

### OSS browsing harnesses
- https://github.com/browser-use/browser-use/issues/104 — Gemini flat-shape emission bug (closest analog to ours)
- https://github.com/browser-use/browser-use/issues/733 — custom actions broken on Gemini (silent failure mode)
- https://docs.browser-use.com/supported-models — browser-use's Gemini support matrix
- https://arxiv.org/html/2401.13919v3 — WebVoyager paper (flat actions)
- https://arxiv.org/abs/2412.05467 — BrowserGym (flat-by-convention)
- https://arxiv.org/html/2407.13032v1 — Agent-E (planner + flat-navigator split)
- https://leaderboard.steel.dev/ — AI Browser Agent leaderboard (Mariner 83.5% on WebVoyager)

### Industry-wide schema-strictness data
- https://mastra.ai/blog/mcp-tool-compatibility-layer — 15% → 3% error rate (5x reduction) via schema normalization. Gemini-2.0-flash-lite-001 73.33% baseline — worst tested.
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview — Anthropic `strict: true` for tools.
- https://openai.com/index/introducing-structured-outputs-in-the-api/ — OpenAI strict mode 85% → 100%.
- https://vibrantlabs.com/blog/pa-bench — Gemini 3 Pro qualitative ("strong planning, weak execution").
- https://arxiv.org/html/2504.01382v4 — "An Illusion of Progress?" (release recency does not predict browsing quality).
