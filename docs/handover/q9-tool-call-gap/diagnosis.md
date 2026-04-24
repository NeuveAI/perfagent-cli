# Q9 Tool-Call Gap — Diagnosis

Date: 2026-04-24
Author: team-lead (disambiguation spike, post frontier-planner removal)

## TL;DR

The 2026-04-24 baseline's deterministic `25% score floor / turnCount=1 / toolCallCount=0 / peakPromptTokens=4096` across 60 trajectories is **NOT** a Gemma 4 capability floor and **NOT** a parser gap in Ollama.

**It is a schema transformation bug in `@neuve/local-agent/mcp-bridge.ts`.** The MCP bridge hands chrome-devtools-mcp's raw input schemas — which use JSON-Schema `oneOf` discriminated unions for the compound tools (`interact`, `observe`, `trace`) — directly to Ollama's OpenAI `tools` parameter. Gemma 4's tool-call template cannot template `oneOf` variants, so even though the model reasons about the tool correctly and produces valid JSON arguments, the output lands in `message.content` instead of `message.tool_calls`. `tool_loop.ts` then sees an empty `tool_calls` array, terminates with the "model returned empty response" fallback, the run ends at turn 1, and the scorer gives a 25% floor.

The earlier framing "pipeline parser gap — Ollama drops Gemma 4 tokens" (memory `project_pipeline_gap_finding.md`) was wrong. Ollama parses Gemma 4's `<|tool_call>…<tool_call|>` tokens correctly; the tokens are never produced by the model when the schema contains `oneOf`.

## Probe results

### Probe A — Ollama endpoint comparison

- **Goal**: prove whether `/v1/chat/completions` (OpenAI-compat) drops Gemma 4's tool-call tokens where `/api/chat` (native) doesn't.
- **Setup**: single `click(selector)` tool, minimal prompt, same body to both endpoints.
- **Result**: BOTH endpoints returned valid `message.tool_calls`.

```
/v1/chat/completions: {"name":"click","arguments":"{\"selector\":\"#submit-btn\"}"} (OpenAI format — arguments stringified)
/api/chat:            {"name":"click","arguments":{"selector":"#submit-btn"}}        (Ollama native — arguments object)
```

→ Ollama's Gemma 4 parser works. Endpoint is NOT the bug.

Files: `probes/probe-a-body.json`, `probes/probe-a-v1-response.json`, `probes/probe-a-native-response.json`.

### Probe B — Production request replay

- **Goal**: reproduce the exact production request that Gemma sees in eval runs (local system prompt + 8 real browser-mcp tools + calibration-3 user message) and observe the response.
- **Setup**:
  - System prompt: `buildLocalAgentSystemPrompt()` from `packages/shared/src/prompts.ts` (30 lines, documents `interact/observe/trace`).
  - Tools: 8 tools from `browser-mcp.js` via the MCP bridge (3 compound: `interact`, `observe`, `trace`; 5 flat: `click`, `fill`, `hover`, `select`, `wait_for`).
  - User: `"Start by navigating to the MDN Web Docs page for JavaScript."` (calibration-3).
- **Result**:

```
tool_calls count: 0
content: {
  "action": {
    "command": "navigate",
    "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript"
  }
}
reasoning: "The user wants to navigate to the MDN Web Docs page for JavaScript. I must use the `interact` tool with the command 'navigate' to achieve this."
finish_reason: stop
```

Gemma KNEW it had tools, KNEW which one to call, and PRODUCED the right argument JSON — but emitted it as content, not a structured tool call. This matches the baseline trajectory signature (`content` carries an "I don't have browsing capability" or a JSON-as-text response, `tool_calls` is empty).

Files: `probes/probe-b-production-replay.mjs`, `probes/probe-b-request-body.json`, `probes/probe-b-response.json`.

### Probe C — Flattened `interact` schema

- **Goal**: isolate whether `oneOf` is the cause by replacing `interact`'s `oneOf`-based schema with a flat `{command, url, uid, text, …}` object and re-running the same request.
- **Setup**: same prompt + user, single tool (`interact` flattened), no `oneOf`.
- **Result**:

```
tool_calls count: 1
  → interact({"command":"navigate","direction":"url","url":"https://developer.mozilla.org/en-US/docs/Web/JavaScript"})
content.length: 0
finish_reason: tool_calls
```

Gemma emitted a proper structured tool call when handed a flat schema. → **`oneOf` is the bug.**

Files: `probes/probe-c-flattened-schema.mjs`, `probes/probe-c-request-body.json`, `probes/probe-c-response.json`.

## Where the schemas enter our stack

- `@modelcontextprotocol/sdk` `client.listTools()` returns each tool with `inputSchema` as-is from the MCP server.
- `packages/local-agent/src/mcp-bridge.ts:96-103` assigns `inputSchema` directly to OpenAI's `function.parameters` field — no transformation.
- `packages/local-agent/src/ollama-client.ts:33` forwards the tools unchanged to `/v1/chat/completions`.

The offending schemas live inside `chrome-devtools-mcp`. The three compound tools define a top-level `action` property whose type is `oneOf: [ {const: "navigate", …}, {const: "click", …}, … ]` — the classic discriminated-union pattern. The bridge's `detectWrapperKey` logic already knows this pattern exists (it auto-wraps args at call time), but does not rewrite the schema before it goes to Ollama.

## Fix scope

Transform `oneOf`-based compound schemas in the MCP bridge before handing them to OpenAI. Two viable shapes:

### Option A (recommended) — Flatten into one object per compound tool

For each compound tool, collapse its `oneOf` variants into a single object schema:
- `command` becomes `enum: [...all variants' const values]` (required)
- All per-variant properties are hoisted to the top level as optional
- Per-variant required fields are relaxed to optional at the schema level; the MCP server enforces them at call time
- Descriptions updated to document which fields go with which command

Pros: 8 tools stay 8 tools. The bridge's existing `detectWrapperKey` auto-wrap logic already handles re-constructing the nested `{action: {...}}` shape at call time. Minimal touch to the surrounding code.

Cons: Gemma sees a flat bag of fields and may occasionally include a field from the wrong variant. Probe C shows it also hallucinated a harmless `direction: "url"` default; that's tolerable (MCP server ignores unknown fields).

Touches: `packages/local-agent/src/mcp-bridge.ts` only — ~40 lines of schema transformation in a new `flattenOneOf(schema)` helper called inline at line 101. Write a unit test covering `interact/observe/trace` flattening outputs.

### Option B — Split each compound tool into N flat tools

Expose `interact_navigate`, `interact_click`, `interact_fill`, etc. as separate OpenAI tools. At call time, the bridge routes back to the underlying compound MCP tool.

Pros: zero `oneOf`; absolute clarity per tool.

Cons: tool count explodes (roughly 8 → 20+). System prompt + tool catalog become longer, pushing against Gemma's 4096-token context headroom (per the baseline finding that we were already near the prompt-token cap). Also requires rewriting `buildLocalAgentSystemPrompt` to reference the exploded names.

## Secondary cleanup (falls out with the fix)

1. Delete `repairAndParseJson` regex helper from `packages/local-agent/src/tool-loop.ts:58-72` — it was a workaround for malformed JSON in `message.content` when this bug hit. With tool_calls emitted correctly, arguments come in as proper JSON strings via the OpenAI SDK.
2. Bump `DEFAULT_NUM_CTX: 32768` → `131072` in `packages/local-agent/src/ollama-client.ts:7`. Gemma 4 supports 131072; we're artificially capping at 25% of the real window. Orthogonal to Q9 but in the same file.
3. Update `project_pipeline_gap_finding.md` memory — the finding is wrong; replace with this diagnosis.

## Re-baseline expectation

After the Option A fix lands, re-run the 3-run 20-task baseline. Expected outcome:
- Most (all?) calibration tasks should produce at least one tool call — `toolCallCount > 0` instead of the current uniform 0.
- `turnCount` should reflect actual task flow (multiple turns), not the 1-turn floor.
- Scores should rise above 25% — by how much is the real Gemma 4 capability signal. That number drives the ReAct migration scope decision (deep rewrite vs. just prompt + surface fixes).

## Verification commands for the fix

```bash
# After the bridge flatten lands:
node docs/handover/q9-tool-call-gap/probes/probe-b-production-replay.mjs
# Expected: tool_calls count >= 1, finish_reason=tool_calls

# End-to-end calibration-3 smoke:
(cd packages/evals && pnpm evalite evals/smoke.eval.ts) # or wave-4-5-subset
# Expected: calibration-3 trajectory contains at least one tool_call event

# Unit:
pnpm --filter @neuve/local-agent test # including new flattenOneOf tests
```

## Artifacts

- `probes/probe-a-body.json` — Probe A request body
- `probes/probe-a-v1-response.json`, `probes/probe-a-native-response.json` — Probe A responses
- `probes/list-tools.mjs` — helper that spawns browser-mcp and dumps OpenAI-format tools
- `probes/browser-mcp-tools.json` — 8 production tool schemas
- `probes/probe-b-production-replay.mjs` — production replay probe
- `probes/probe-b-request-body.json`, `probes/probe-b-response.json` — Probe B I/O
- `probes/probe-c-flattened-schema.mjs` — flattened-schema probe
- `probes/probe-c-request-body.json`, `probes/probe-c-response.json` — Probe C I/O
