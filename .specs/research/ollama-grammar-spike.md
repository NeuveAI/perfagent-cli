# Ollama Grammar-Constrained Tool-Call Args — 15-Minute Spike

**Date:** 2026-04-14
**Question:** Can we constrain the *shape* of `tool_calls.function.arguments` via
any Ollama API today (so Gemma 4 E4B cannot drop the `action` wrapper key)?

## Verdict

**CONFIRMED DEAD** — Grammar-constrained tool-call argument shape enforcement is
not accessible via any Ollama API today. The Ollama maintainer who owns the
relevant PRs has explicitly declined to add it. Lock T11 as out-of-scope.

A narrow caveat: the argument schema is still passed to the model *as prompt
context*, and `additionalProperties: false` / `required` are honored as schema
text only — not enforced at decode time on `tool_calls.function.arguments`.

## Evidence

### 1. `format` constrains `message.content`, not `tool_calls`

The `/api/chat` doc lists `format` alongside `options`, `stream`, `keep_alive`
as controlling the returned response:

> "`format`: the format to return a response in. Format can be `json` or a JSON
> schema. The model will generate a response that matches the schema."
> — https://github.com/ollama/ollama/blob/main/docs/api.md

The tools section is separate and makes no mention of `format` affecting
tool-call args. In practice, passing `format` together with `tools` *breaks tool
calling* (the model stops emitting `tool_calls` at all):

> ollama-python #546 — "With `format=AddTwoNumbersOutput.model_json_schema()`,
> `response.message.tool_calls` remains empty … Team member ParthSareen:
> **'We're probably not going to support structured generation around tool
> calling for now. It's best to use a model better at tool calling.'**
> Status: CLOSED as COMPLETED, Sept 18 2025."
> — https://github.com/ollama/ollama-python/issues/546

That is the definitive on-record maintainer position.

### 2. The OpenAI-compat endpoint adds no escape hatch

`docs/openai.md` does not render as a standalone page on main (404 on direct
fetch), but the broader evidence is unambiguous:

- `strict: true` on function tools is an **OpenAI-only** feature; Ollama's OAI
  shim accepts the parameter silently but does not enforce it at the decode
  layer. Ollama's tool-parameters field is "a very limited subset of JSON
  Schema" per issue #6377 (closed 2025-10-07 as completed once
  `ToolFunctionParameters` was exported — but "completed" only means the Go
  struct was exposed, not that decode-time enforcement exists).
  — https://github.com/ollama/ollama/issues/6377
- `response_format: { type: "json_schema" }` routes through the same
  `format`-field machinery as `/api/chat` — same content-only scope, same
  conflict with `tools`.
- Known bug: `llama3.2:3b outputs tool calls as JSON in content instead of
  using tool_calls field` — https://github.com/ollama/ollama/issues/13519 —
  confirms the two surfaces are distinct and that structured-output machinery
  does not wrap `tool_calls.function.arguments`.

### 3. Ollama does not expose llama.cpp's GBNF through any public parameter

- **PR #7513** ("grammar: surgically wrenching gbnf from system messages") —
  proposed extracting GBNF from ```gbnf code blocks in the system prompt.
  **Closed unmerged** Dec 5 2024 by ParthSareen: *"Going to close this out as
  we're supporting structured outputs through #7900."*
  — https://github.com/ollama/ollama/pull/7513
- **Issue #5917** ("Integrate LM Format Enforcer") — **Closed completed** Dec 5
  2024 by ParthSareen: *"Closing this out for now with our structured outputs
  PR — already digging into some constrained decoding work — will check this
  out and keep in mind!"* No follow-through since.
  — https://github.com/ollama/ollama/issues/5917
- **Issue #6002** ("JSON Schema conformity using Llama.cpp Grammar generation
  for Tool Calling") — **Reopened** Dec 9 2024 by ParthSareen: *"Seems like I
  misinterpreted on my first run through of this. Reopening the issue for now.
  Going to think a bit about how we can support this, what does extensibility
  look like, and if it makes sense for the stage of the project we're in."*
  **No maintainer activity in the 16 months since.**
  — https://github.com/ollama/ollama/issues/6002

So: structured outputs (PR #7900) apply GBNF to message content; the request
to extend the same mechanism to tool_calls has been open-and-dormant since
Dec 2024 and explicitly declined in ollama-python #546.

### 4. There is no GBNF/`raw` back door

`raw: true` exists on `/api/generate` only (disables the chat template); it
does not gain a `grammar` field. GBNF is a llama.cpp-level parameter that
Ollama does not forward through any public API. The only way to reach it is
to leave Ollama entirely (run llama.cpp-server or vLLM directly).

### 5. LM-Format-Enforcer has no Ollama shim

LMFE supports llama.cpp, vLLM, HuggingFace transformers. No Ollama backend
exists, and the integration request is the same #5917 that was closed without
implementation. — https://github.com/noamgat/lm-format-enforcer

## What changes for our plan

**Nothing.** The synthesis doc's §2 T11 row and §5 "P5" classification are
correct. The only update is we can drop the "unknown — worth a spike" hedge
in §6 question 3 and lock in:

- P0 (auto-wrap heuristic) stays.
- P1 (wire-shape examples) stays as top-rank.
- P2 (flatten) stays as the evidence-weighted ceiling.
- T11 is out-of-scope **until we move off Ollama's OAI endpoint entirely**
  (llama.cpp-server or vLLM would unlock XGrammar / LMFE / native GBNF).

The ollama-python #546 thread is a small positive signal for P2: the
maintainer's *own* recommendation when `format` doesn't mix with tools is
"use a model better at tool calling" — i.e. the path forward runs through
schema shape, not decode constraints.

## Tangential finding worth recording

`additionalProperties: false` + `required: ["action"]` are accepted by Ollama's
tool-parameters field and passed to the model as *prompt text*, but they are
not enforced at the sampling layer (issue #6377, #10164 on enum-string
coercion). Tightening our `interact`/`observe`/`trace` input schemas with these
constraints is zero-cost and may help Gemma *soft*-respect the shape — but it
is not a grammar constraint and cannot substitute for P0/P1/P2.

If we want to cheaply test whether Gemma responds to stricter schema text,
the minimal probe is: add `additionalProperties: false` and an explicit
`required: ["action"]` to the current `interact` inputSchema, keep the
discriminated union, run 20 turns, count wrapper-drop events vs baseline.
This is a schema-text experiment, not a decode-constraint one — name it
accordingly so we don't confuse ourselves later.

## Recommended next step

None on grammar. Proceed with the synthesis doc's rank: ship P1, land P0 as
belt-and-suspenders, plan P2. Revisit T11 only if we ever swap Ollama for
llama.cpp-server or vLLM as the local inference backend.

## Surprises

1. Structured outputs in Ollama *do* use GBNF under the hood (confirmed on
   HN by an Ollama-knowledgeable respondent: *"tightly integrated into the
   token sampling infrastructure"* of llama.cpp —
   https://news.ycombinator.com/item?id=44871641). The grammar machinery is
   literally one API-surface decision away. The maintainer just hasn't pulled
   that lever for tool-call arguments and has publicly said they won't soon.
2. Issue #6002 is technically *open*, not closed. Reopened Dec 2024. Dormant
   since. Worth a `watch` but not worth betting a roadmap on.
