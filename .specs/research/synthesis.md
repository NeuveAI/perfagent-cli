# Synthesis — Tool-Call Healing Research (Peer Review)

Peer review of three parallel research streams: `opencode-tool-healing.md`, `goose-tool-healing.md`, `papers-tool-healing.md`. All citations spot-checked against clones at `/Users/vinicius/code/.better-coding-agents/resources/{opencode,goose}`.

## 1. Executive summary

- **The field has a clear consensus, not a split.** Every surveyed source — two production harnesses and ten+ papers — tells the same story: prevent shape errors by flattening and by showing wire-shape examples; repair is a fallback, not a strategy.
- **OpenCode's repair hook (`experimental_repairToolCall`) is deliberately narrow.** It fixes tool-name casing only and reroutes everything else to an `invalid` sentinel ([`session/llm.ts:317-337`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/llm.ts)). No arg reshaping.
- **Goose's `coerce_tool_arguments` only walks top-level properties** ([`reply_parts.rs:99-120`](/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/agents/reply_parts.rs)); it cannot heal our `{ action: { command } }` shape even if ported verbatim.
- **Both harnesses assume flat tool schemas as the default.** OpenCode's built-ins (bash, edit, read, grep) are all `z.object({ ... })` with flat top-level params (opencode §2.1). Goose has no counter-pattern.
- **Academic evidence converges on flattening + examples.** NESTFUL (GPT-4o at 28% on nested-API chains, papers §2.NESTFUL) plus samchon's "10 variants × 3 levels = 1,000 paths" result make P2 the structurally-supported direction.
- **Constrained decoding (TOOLDEC 0→52% lift, papers §2.TOOLDEC) is the only class that *eliminates* the failure mode**, but it requires logit access. Ollama's OpenAI-format endpoint does not expose logits. This is a genuine dead-end for us today, not a hedge.
- **Our tentative P0+P1 recommendation holds, but the weighting should shift.** P1 has the highest evidence-to-cost ratio and should ship first; P0 is useful but borrows risk that the field warns about (Geng et al. 2025 on heuristic-repair coverage, papers §2.JSONSchemaBench). P2 is where the evidence-weighted ceiling is — do not park it indefinitely.

## 2. Unified taxonomy

| # | Strategy | Description | Who uses it | Works over Ollama OAI? | Cost for us |
|---|----------|-------------|-------------|-----------------------|-------------|
| **T1** | Flat-schema prevention | Declare tool params as flat `z.object({...})`; one tool per command instead of a macro + discriminated union. | OpenCode all built-ins (opencode §2.1, `bash.ts:52-60`); Goose MCP assumption (goose §4); NESTFUL, samchon, docat0209 (papers §2). | Yes (schema-agnostic). | **High** — P2; rewrites `interact`/`observe`/`trace` + SKILL.md + prompts. |
| **T2** | Wire-shape examples in tool descriptions | Put a literal example JSON in the description alongside the schema. | He 2024, Manduzio 2024, Sigdel & Baral 2026 (papers §2). Not used by OpenCode or Goose in-tree. | Yes — pure description text. | **Very low** — P1; three description edits. |
| **T3** | Tool-name casing repair | Lower-case tool name and retry if it matches. | OpenCode (`session/llm.ts:317-327`, verified). | Yes. | N/A — our failure is arg shape, not name. |
| **T4** | Invalid-sentinel reroute | Reroute any failed call to a `invalid` tool whose execution echoes the Zod error back as a tool-result. Model sees structured feedback for the next turn. | OpenCode (`tool/invalid.ts`, verified; `session/llm.ts:329-336`). | Yes — happens after model call. | **Low-medium** — would replace our `return "Error: ..."` with a structured tool-result; small payoff unless Gemma actually learns from it. Su et al. 2025 warns plain retry plateaus (papers §2). |
| **T5** | Top-level type coercion | Walk args, coerce string→number/int/bool where schema demands it. Top-level only. | Goose (`coerce_tool_arguments`, verified at `reply_parts.rs:99-120`). | Yes. | **Low** — small win; irrelevant to wrapper bug. |
| **T6** | Tolerant JSON parsing (control-char escape) | Re-try parse after escaping raw control chars inside string values. | Goose (`safely_parse_json`, verified at `providers/utils.rs:465-475`). | Yes. | **Low** — we already do `repairAndParseJson`. Parity is cheap. |
| **T7** | Per-provider schema sanitisation (before send) | Rewrite outgoing JSON Schema per provider quirks (e.g. enum-to-string for Gemini). | OpenCode `sanitizeGemini` (`provider/transform.ts:967-1065`); Goose `ensure_valid_json_schema` (`openai.rs:652-696`). | Yes. | **Low** — not directly applicable, but same architectural slot where P0's auto-wrap-for-gemma heuristic would live. |
| **T8** | Auto-wrap/unwrap args heuristic | Detect single-key wrapper pattern at bridge layer, lift/inject wrapper transparently. | **Nobody in the survey.** Closest analogues: samchon's lenient parse (soft-match class, papers §2.samchon); LangChain `OutputFixingParser`. | Yes. | **Low** — P0; ~15 LOC in `mcp-bridge.ts`. |
| **T9** | Interpreter-model shim (ToolShim) | Main model emits free text; a second LLM (default `mistral-nemo`) re-extracts structured tool calls via Ollama `format:` schema. | Goose (`toolshim.rs`, verified at lines 116-140 for the output schema). | Yes — requires 2 Ollama calls/turn. | **High** — doubles latency; solves non-tool-calling models, not shape errors. |
| **T10** | Emulated-tool text protocol | Dedicated text conventions (e.g. `$ cmd`) parsed into synthetic tool calls. | Goose `.gguf` path (`local_inference/inference_emulated_tools.rs`). | Yes — but abandons tool-calling API. | High + loss of function-call API. Not applicable. |
| **T11** | Grammar-constrained decoding | Mask tokens that violate the target grammar at decode time. | Outlines, XGrammar, TOOLDEC, LM-Format-Enforcer, llama.cpp GBNF (papers §2). | **No** — needs logit access. Ollama's OAI endpoint does not expose logits; its `format: json_schema` mode is structured-output-lite, not grammar-constrained tool-call decoding. | N/A today; future direction if we move off OAI shim. |
| **T12** | Structured reflection (trained) | Model is trained (SFT/DPO) to diagnose its own tool-call failures and emit a repaired call. | Su et al. 2025 *Tool-Reflection-Bench* (papers §2). Manduzio 2024 is the DPO variant. | Yes. | Out of scope — requires training. |
| **T13** | Doom-loop guard | Detect N identical consecutive failed calls; bail with a permission prompt. | OpenCode (`session/processor.ts:305-330`, verified `DOOM_LOOP_THRESHOLD = 3` at line 25). | Yes. | **Low** — our `MAX_TOOL_ROUNDS = 15` cap is coarser. Worth adopting a same-args-repeat detector. |

## 3. Cross-validation & disagreements

**Where all three sources agree:**
1. Flat schemas win (opencode §3d; goose §4; papers §3/§4). No voice dissents.
2. Plain error-in-loop is insufficient for small models (opencode §4.3 observes Gemma would hit the `invalid` sentinel but self-correction is "model-dependent"; goose §3f notes raw `ErrorData` feedback is the only retry signal and it plateaus; Su et al. 2025 demonstrates this experimentally, papers §2).
3. Constrained decoding is the structural fix, but gated by logit access (papers §3/§5).

**Apparent disagreements (resolved):**

- **"Don't heal, use flat schemas" (OpenCode) vs "heuristic repair is industry-standard" (Instructor/LangChain/samchon).** These are not contradictions — they are different cost-points. OpenCode *prevents* shape errors so repair isn't needed; Instructor/LangChain repair because they don't own the schema. We own the schema, so OpenCode's stance (prevent) is the better-supported long-term; samchon's (repair) is the better-supported short-term if we don't want to touch the schema yet. Papers §5 explicitly endorses this layering (P0 short-term, P2 long-term).

- **P1 (descriptions) sufficient vs insufficient.** Opencode researcher does not weigh in strongly on P1. Goose researcher implicitly pans prompt-only fixes (none exist in-tree). Papers researcher strongly endorses P1 (He 2024, Manduzio 2024, Sigdel & Baral 2026). Papers wins — the academic evidence is direct and recent; OpenCode/Goose absence is not evidence of inefficacy, just of "they didn't need to because their schemas were already flat."

- **Goose researcher implies `coerce_tool_arguments` could help**; opencode and papers are silent. Goose researcher correctly flags in §4 that it walks top-level only and "is not walked into" for nested wrappers — so for our specific bug it offers nothing. Agreement across sources once you read Goose carefully.

## 4. Fact-check (spot-checks)

**OpenCode report:**
- ✅ `experimental_repairToolCall` at `session/llm.ts:317-337` — **verified as cited**. Lower-case retry then reroute to `invalid`, exactly as described.
- ✅ `InvalidTool` at `tool/invalid.ts:5-20` — **verified as cited**. Message text `"The arguments provided to the tool are invalid: ${params.error}"` matches the report.
- ✅ `Tool.define` wrapper re-validation at `tool/tool.ts:83-96` — **verified as cited**. `formatValidationError` hook present, generic fallback message matches.
- ✅ `activeTools` excludes `invalid` at `session/llm.ts:342` — **verified**.
- ✅ MCP adapter at `mcp/index.ts:133-161` — **verified**. Forces `type: "object"` + `additionalProperties: false`, no arg reshaping.
- ✅ `DOOM_LOOP_THRESHOLD = 3` at `session/processor.ts:25` — **verified** (report cites `305-330` for the usage site, which is correct; the constant is declared at line 25).

**Goose report:**
- ✅ `coerce_tool_arguments` at `reply_parts.rs:99-120` — **verified as cited**. Top-level walk, type coercion from `String`.
- ✅ `safely_parse_json` at `providers/utils.rs:465-475` — **verified as cited**.
- ✅ ToolShim output schema at `toolshim.rs:116-140` — **verified** (matches `tool_structured_output_format_schema`).
- ⚠️ Report cites "`GOOSE_MAX_TURNS` (default `1000`, `agent.rs:65`)". **Cited slightly imprecisely:** constant is named `DEFAULT_MAX_TURNS` at `agent.rs:65`. `GOOSE_MAX_TURNS` is presumably the env-var alias. Substantively correct (value 1000, correct file/line), minor naming slip.

**Papers report:**
- ✅ `arxiv.org/abs/2603.13404` (Sigdel & Baral 2026) resolves to *"Schema First Tool APIs for LLM Agents: A Controlled Study of Tool Misuse, Recovery, and Budgeted Performance"* — **verified as cited**.
- ✅ `arxiv.org/abs/2509.18847` (Su et al. 2025) resolves — **verified existent**. Did not read full paper; claim about plain retry plateauing is consistent with title and researcher's paraphrase.
- ⚠️ TOOLDEC "0% to 52%" — researcher cites arXiv:2310.07075 accurately but I did not re-read the paper. Directionally consistent with other constrained-decoding literature; flagging as **unverified quantitatively** but citation is correctly formed.

**Net:** no factual errors material to the synthesis. One minor naming slip in Goose's `DEFAULT_MAX_TURNS` citation.

## 5. Re-ranking P0/P1/P2 against field practice

Original doc ranked P0 > P1 > P2 (P0+P1 now, park P2). Re-ranking:

| Option | Evidence weight | Ceiling | Short-term value | Revised rank |
|--------|----------------|---------|------------------|--------------|
| **P1 — wire-shape examples** | Strong (He, Manduzio, Sigdel). Zero-risk, zero-code. | Medium (helps every model, doesn't guarantee obedience). | High. | **#1 — ship first.** |
| **P2 — flatten** | Strongest (NESTFUL, samchon, docat0209, OpenCode convention, Goose assumption). | High (matches both harnesses' baseline). | Medium (cost: SKILL.md + prompts + reporter filters). | **#2 — next after P1 validates.** |
| **P0 — auto-wrap heuristic** | Weak-to-medium (no direct analogue in either harness; only samchon-class lenient-parse precedent). Geng et al. cautions heuristic repair has uneven coverage. | Low (Gemma-today unblock only; silently hides the real bug). | High (20 min). | **#3 — keep as safety net, not centerpiece.** |

**Newly surfaced option (P4-style) the field suggests:**

- **T4 — adopt OpenCode's `invalid`-sentinel pattern.** Cheap (tens of LOC), structurally clean, aligns with a production harness. Currently we return `"Error: validation error..."` as a raw string; switching to a structured tool-result named `invalid` (or annotating the existing tool-result as a recognizable error envelope) gives downstream filtering and trace-reading a cleaner hook. Independent of P0/P1/P2.

- **T13 — same-args doom-loop detector.** Our `MAX_TOOL_ROUNDS = 15` fails *slow*; OpenCode's 3-repeat detector fails fast with a better error message. ~10 LOC.

Grammar-constrained decoding (T11) is a genuine **P5** and correctly identified by papers researcher as out-of-scope today. Ollama's OAI endpoint is not a grammar-constrained surface; `format: json_schema` only applies to text completions, not tool-call arguments. The opencode §7 question 1 about AI SDK's validator is irrelevant to us — we don't use AI SDK in `local-agent`.

## 6. Gaps & open questions

1. **No benchmark on "single-key wrapper around discriminated union" in isolation.** NESTFUL is the closest (full nested-API chains), samchon is the closest industry result (recursive unions). No A/B of `{action: {command}}` vs `{command}` on identical semantics. Would be a small custom eval — valuable before committing to P2.
2. **Tool-count budget for small models.** Every source assumes flat = good, but 27 flat tools vs 3 macros is not benchmarked against Gemma-class models. BFCL hints at budget cliffs but doesn't isolate tool-count. Before rewriting SKILL.md we should at minimum measure tokens.
3. **Ollama grammar-constraint reality.** Papers researcher's §7.3 question stands: is there any path to GBNF-at-Ollama without bypassing the OAI endpoint? A 15-minute spike on Ollama docs / a test with `format: ...` for tool-call args specifically would tell us whether T11 is 0% or 20% accessible.
4. **Does Gemma 4 E4B actually correct on structured error feedback?** Both harnesses hand the model its error back and pray. Goose plateaus, OpenCode doom-loops. We have no Gemma-specific probe — it's possible Gemma 4 ignores any tool-error payload regardless of structure. Worth a deliberate test before investing in T4.
5. **`perf-agent` isn't AI-SDK-backed.** OpenCode relies heavily on AI SDK's `experimental_repairToolCall`; our local agent hand-rolls the OpenAI chat loop in `tool-loop.ts` + `mcp-bridge.ts`. Any OpenCode pattern we adopt has to be re-implemented, not imported.

## 7. Prescriptive recommendation

**Ship in this order, explicitly not the order in the analysis doc:**

1. **P1 first (today, 10 min).** Wire-shape examples in `interact.ts`, `observe.ts`, `trace.ts` descriptions. Three papers directly endorse it (He 2024, Manduzio 2024, Sigdel & Baral 2026, papers §2); zero code risk; helps every consumer, not just Gemma. This is the single highest evidence-to-cost lever we have and the tentative doc underweighted it by ranking P0 above it.
2. **P0 second (today, 20 min) — but as a belt-and-suspenders, not a centerpiece.** Land the auto-wrap heuristic in `mcp-bridge.ts` with the conservative shape-accepts-`command` sub-check, and **log every auto-wrap at Info level** so we can tell whether P1 alone was enough. If telemetry shows P0 firing often, that's the signal P1 didn't stick and we need P2.
3. **Add T4 + T13 opportunistically (this week, ~30 min).** Replace raw error strings with a structured `invalid` tool-result envelope (T4, mirrors OpenCode); add a 3-repeat same-args detector to fail fast (T13). Both tiny, both close real gaps in the current loop.
4. **Plan P2 now, execute when P0 telemetry confirms the bug is structural.** NESTFUL (GPT-4o at 28% on nested chains), samchon (recursive-union blow-up), and the fact that OpenCode *and* Goose both assume flat schemas as their default — these are not soft signals. P2 is where the evidence-weighted ceiling is. The tentative "park P2" stance is wrong; "defer P2 until signal" is right. The signal is: P0 auto-wraps fire on more than ~20% of Gemma tool-calls over a week of use.
5. **Do not pursue T9 (ToolShim) or T11 (grammar decoding) now.** T9 doubles latency for a problem we don't have (our model *can* tool-call, it just mis-shapes). T11 requires leaving the Ollama OAI surface; the ROI doesn't clear the integration cost while Gemma 4 is still the local target.

The field has a consensus. The tentative P0+P1 recommendation is directionally right but ranks the wrong item first and treats P2 as optional when the literature treats it as the destination. Re-rank to P1 > P0 > (T4, T13) > P2, and P2 stops being "someday" and starts being "when auto-wrap telemetry says so."

---

**Word count: ~2,350.**
