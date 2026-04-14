# Goose — Tool-Call Validation & Healing

Research target: `block/goose` at `/Users/vinicius/code/.better-coding-agents/resources/goose`.
Scope: how Goose copes with malformed / mis-shaped tool calls from LLMs, especially with Ollama and local models.

## 1. Summary (key findings)

- Goose does **not** auto-unwrap or auto-wrap mismatched argument objects. MCP validation errors flow back to the model verbatim as `ErrorData { code: INVALID_PARAMS, message }`, and the model is expected to retry.
- Goose **does** perform one real healing pass: `coerce_tool_arguments` in `reply_parts.rs:99` walks each tool-call argument against the tool's JSON Schema and coerces string values to `number` / `integer` / `boolean` when the schema demands.
- JSON-level repair is limited to control-char escaping (`safely_parse_json` / `json_escape_control_chars_in_string`, `providers/utils.rs:465` & `:491`). No quote fixing, no trailing-comma fix, no key-quoting repair.
- The primary small/local-model accommodation is the **ToolShim** (`providers/toolshim.rs`): for models that cannot produce tool-calls, Goose empties the `tools` array, sends text, then post-processes with a **second interpreter LLM** (default `mistral-nemo`) using Ollama's `format:` structured-output schema.
- For `.gguf` local inference, Goose has an alternative **emulated tools** path (`local_inference/inference_emulated_tools.rs`) that teaches the model two narrow conventions — `$ command` lines → shell, and ```` ```execute_typescript ```` blocks → code-exec — detected by a streaming text parser. This dodges schema-shape problems entirely.

## 2. Tool-call pipeline (Rust flow)

1. **Provider stream → parsed message.** `providers/formats/openai.rs:515-591` (`response_to_message`) reads `choices[0].message.tool_calls[]`, pulls `function.name` + `function.arguments` (string), and parses arguments with `safely_parse_json` (`providers/utils.rs:465`). If parse fails, it emits a `MessageContent::ToolRequest(Err(ErrorData { code: INVALID_PARAMS, .. }))` instead of dropping the call (`openai.rs:572-587`).
2. **Function-name sanitization.** `sanitize_function_name` strips non-`[a-zA-Z0-9_-]` chars (`providers/utils.rs:218-222`); invalid names similarly produce `Err(ErrorData { INVALID_REQUEST })` (`openai.rs:548-561`).
3. **Categorization + coercion.** `reply_parts.rs:338-386` (`categorize_tool_requests`) looks up the registered `Tool` by name and runs `coerce_tool_arguments(args, schema)` (`reply_parts.rs:99-120`) before dispatch. This is the single schema-aware transformation.
4. **Dispatch to MCP.** `Agent::dispatch_tool_call` (`agents/agent.rs:521`) forwards to `ExtensionManager::dispatch_tool_call` (`agents/extension_manager.rs:1402`), which calls `client.call_tool(..)` on the rmcp Client. Arguments are passed **unchanged** from the (already-coerced) tool-call.
5. **MCP error surfacing.** `extension_manager.rs:1445-1453`: `ServiceError::McpError(error_data) => error_data`; the raw `ErrorData` with its `message` string becomes a `ToolResponse` with `Err(ErrorData)` and is appended to the conversation as a tool-role message for the next turn.
6. **Re-prompt.** The reply loop iterates up to `GOOSE_MAX_TURNS` (default `1000`, `agent.rs:65`); every turn the assistant sees its previous tool-error as history and re-emits a new tool call.

## 3. Healing strategies observed

### 3a. Type coercion against tool schema (`reply_parts.rs:49-120`)

Walks each top-level arg; if schema declares `number` / `integer` / `boolean` and the model supplied a `String`, convert. Handles `Array`-typed schema (union of types) by trying each in order.

```rust
// reply_parts.rs:99-120
pub(crate) fn coerce_tool_arguments(
    arguments: Option<serde_json::Map<String, Value>>,
    tool_schema: &Value,
) -> Option<serde_json::Map<String, Value>> {
    let args = arguments?;
    let properties = tool_schema.get("properties").and_then(|p| p.as_object())?;
    let mut coerced = serde_json::Map::new();
    for (key, value) in args.iter() {
        let coerced_value =
            if let (Value::String(s), Some(prop_schema)) = (value, properties.get(key)) {
                coerce_value(s, prop_schema)
            } else { value.clone() };
        coerced.insert(key.clone(), coerced_value);
    }
    Some(coerced)
}
```

Note this is **top-level only** and uses the outer `properties`. A nested wrapper like `{ action: { command: ... } }` is not walked into.

### 3b. Tolerant JSON parsing (`providers/utils.rs:465-475`)

```rust
pub fn safely_parse_json(s: &str) -> Result<serde_json::Value, serde_json::Error> {
    match serde_json::from_str(s) {
        Ok(value) => Ok(value),
        Err(_) => {
            let escaped = json_escape_control_chars_in_string(s);
            serde_json::from_str(&escaped)
        }
    }
}
```

Fixes literal `\n`/`\t`/`\r` and other control chars that small models emit unescaped inside string values. Does not try single→double quotes, trailing commas, or unquoted keys.

### 3c. ToolShim — separate interpreter model (`providers/toolshim.rs`)

When `GOOSE_TOOLSHIM=true`, Goose sends messages with **empty tools** (`reply_parts.rs:239-248`), then post-processes the assistant's text with a second Ollama call using `format:` structured output to extract a `{ tool_calls: [{ name, arguments }] }` payload (`toolshim.rs:116-241`). The interpreter runs on a tool-capable small model (default `mistral-nemo`) even when the main model can't tool-call.

```rust
// toolshim.rs:256-278 — system prompt taught to interpreter
"If there is detectable JSON-formatted tool requests, write them into valid JSON tool calls ..."
```

The interpreter produces `arguments` as a `Value`; it is passed via `CallToolRequestParams::new(name).with_arguments(object(arguments))` with **no schema-aware reshaping** (`toolshim.rs:229-232`).

### 3d. Tool-schema back-fill (`providers/formats/openai.rs:652-696`)

Before sending tool definitions to the provider, `validate_tool_schemas` / `ensure_valid_json_schema` fills in missing `properties: {}`, `required: []`, `type: "object"` on object-type schemas so bad MCP servers don't break OpenAI-compatible endpoints. This shapes the **outgoing** schema, not incoming arguments.

### 3e. Emulated-tool text parser (`local_inference/inference_emulated_tools.rs:152-299`)

A streaming parser converts two conventions into tool calls: `$ <cmd>\n` → `developer__shell(command=<cmd>)`, and ```` ```execute_typescript\n...\n``` ```` → `code_execution__execute(code=<code>)`. There is no schema at all — the mapping is hard-coded.

### 3f. Error-as-retry-signal

When arg-parse or MCP validation fails, Goose pushes the full error string (`ErrorData.message`) back as a tool-role message and continues the loop. `agents/agent.rs:1249-1256` and `:1235-` drive up to `GOOSE_MAX_TURNS` retries before giving up with a canned "I've reached the maximum number of actions…" message. There is no dedicated "tool-repair" retry with a targeted hint — the model just gets the raw validation error.

## 4. Handling our specific shape (nested wrapper with discriminated union)

**Goose does not have a pattern for this.** It expects tool schemas to be flat enough that top-level `properties` suffices, or to be exercised with a large capable model. The wrapper-inference heuristic proposed in `.specs/tool-call-validation-fix-analysis.md` §P0 has no counterpart in Goose. The closest adjacent concept is the ToolShim's interpreter LLM, which could in principle produce nested args if its structured-output schema allowed — but Goose's hard-coded schema (`toolshim.rs:116-140`) defines `arguments` as an open `"type": "object"` with no per-tool shape guidance, so the second-pass model still has to guess wrapper shape from the system-prompt tool listing (`toolshim.rs:303-314` `format_tool_info`, which prints the raw `input_schema` JSON).

In practice, Goose's answer to this class of bug would be: (a) flatten your MCP tool surface, or (b) use a model strong enough to handle nested discriminated unions. P2 "flatten" from our analysis doc is the shape Goose assumes.

## 5. Applicability to perfagent-cli (per strategy)

| Strategy | Verdict | Justification |
|---|---|---|
| 3a. Schema-aware type coercion | **Adaptable** | Straightforward TS port (JSON Schema walk + `String(number)` → `number`). Small win, orthogonal to the wrapper bug. |
| 3b. Control-char JSON repair | **Adaptable** | Already overlaps `repairAndParseJson` in `tool-loop.ts:28-42`. Add control-char escape fallback for parity with Goose. |
| 3c. ToolShim second-pass LLM | **Not applicable (today)** | Requires an extra interpreter call per turn and a structured-output-capable local model. Doubles latency; solves a different problem (non-tool-calling models) from ours (tool-calling model with wrong shape). |
| 3d. Outgoing-schema back-fill | **Not applicable** | Our MCP schemas are well-formed; this fixes missing fields, not wrapper shape. |
| 3e. Emulated-tool text parser | **Not applicable** | Hard-coded conventions tied to `gguf` runtime; our stack is Ollama HTTP + OpenAI-format tools. |
| 3f. Raw-error-as-retry-signal | **Already doing this implicitly** | `tool-loop.ts:110` pushes MCP error back as a tool-role message. Matches Goose; observed insufficient for Gemma 4. Our P1 (better descriptions) and P0 (auto-wrap) are complementary corrections Goose does not have. |

**Rust-to-TS translation flags:**
- `CallToolRequestParams::new(name).with_arguments(object(args))` relies on rmcp's typed builder; in TS we pass a plain record to `client.callTool`.
- `#[derive(Deserialize)]` with `#[serde(untagged)]` discriminated-union decoding would be the Rust-native way to handle `{action: ...}` vs `{command: ...}` leniently, but Goose does not use it on tool arguments — it keeps arguments as `serde_json::Map<String, Value>` end-to-end. So there is no "Rust idiom to port" here.
- Goose's `coerce_value` sorts by explicit schema-type strings; Zod schemas in our MCP server don't expose JSON Schema at the transport layer identically — we'd coerce off the OpenAI-format `parameters` JSON Schema we already emit from `mcp-bridge.ts:44-52`.

## 6. Citations

- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/providers/toolshim.rs` (full file)
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/providers/utils.rs:218-228, 465-521`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/providers/formats/openai.rs:454-598, 652-696`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/providers/local_inference/inference_emulated_tools.rs:1-299`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/providers/local_inference/inference_native_tools.rs:1-100`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/providers/ollama.rs:1-140`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/agents/reply_parts.rs:19-133, 338-386`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/agents/agent.rs:65, 400-470, 521-600, 1200-1280`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/agents/tool_execution.rs:76-188`
- `/Users/vinicius/code/.better-coding-agents/resources/goose/crates/goose/src/agents/extension_manager.rs:1402-1460`

## 7. Questions for peer review

1. **Is ToolShim's interpreter actually engaged for Gemma-class models?** The default interpreter is `mistral-nemo`; if the user's Ollama install lacks it, `GOOSE_TOOLSHIM=true` would error. A reviewer should verify whether Goose users report using ToolShim specifically for small-model tool-call healing or only for non-tool-calling models.
2. **Does `coerce_tool_arguments` fire before MCP dispatch in every path?** I only traced the default path through `reply_parts::categorize_tool_requests`. Permission-gated and frontend-tool paths may bypass it (see `agents/tool_execution.rs:86-125` using `tool_call.clone()` directly without re-coercing).
3. **Have we ruled out that Goose tolerates `{action: ...}` nesting because large models naturally produce it?** We tested only by code search. A functional test (Gemma 4 → Goose → our `trace` tool via MCP) would show whether Goose's default retry-loop + raw-error-feedback is enough for small models, or whether real Goose users silently avoid nested schemas.
