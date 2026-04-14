# Tool Call Validation Failure — Deep Dive & Fix Options

## Observed symptom

Running `perf-agent tui -a local -u https://agent.perflab.io` with the prompt *"verify the performance of agent.perflab.io from main page to chat page and enter a basic chat query. Lets evaluate the core web-vitals and see what insights we have"* produces:

```
✗✓ Perf Agent
  ✓ Passed   Agent ran tools but didn't capture a performance trace.

Summary
  Agent ran 8 tools but did not capture a performance trace.
  Results may be in console/network output.
```

No CWV panel. No `c`/`n`/`i` hints. No insight drill-ins.

`.perf-agent/local-agent.log` tail:

```
[...2026-04-14T17:59:37.852Z] ollama responded
  finishReason: "stop"
  contentPreview: "The performance analysis could not be completed due to persistent
                   input validation errors across all core tools (`interact`, `trace`,
                   `observe`). The environment repeatedly rejected the tool calls, re"
```

The agent made 8 tool-call attempts across 8 rounds. Every single one failed validation at the MCP boundary. Zero tool calls actually reached Chrome DevTools.

## Root cause

The three perf-agent macro tools — `interact`, `observe`, `trace` — all wrap their discriminated-union command payload in an outer `action` key:

| File                                            | Line | Schema                                  |
|-------------------------------------------------|------|-----------------------------------------|
| `packages/browser/src/mcp/tools/interact.ts`    | 116  | `inputSchema: { action: InteractAction }` |
| `packages/browser/src/mcp/tools/observe.ts`     | 114  | `inputSchema: { action: ObserveAction }`  |
| `packages/browser/src/mcp/tools/trace.ts`       |  ~66 | `inputSchema: { action: TraceAction }`    |

So the MCP server expects:

```json
{ "action": { "command": "start", "reload": true } }
```

But Gemma 4 E4B (and most small tool-calling models) see the OpenAI-format tool signature and emit the discriminated union variant directly:

```json
{ "command": "start", "reload": true }
```

Zod validation at the MCP boundary rejects every one of these (missing required property `action`). The local agent receives 8 consecutive `"Error: validation error..."` tool results as assistant-visible feedback and eventually gives up.

## Current flow (broken)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  User: "verify the performance of agent.perflab.io..."                       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  LOCAL AGENT (packages/local-agent/src/tool-loop.ts)                         │
│  Sees 3 tools via OpenAI function-calling format from mcp-bridge:            │
│                                                                              │
│    interact: { action: { discriminated-union of 15 commands } }              │
│    observe:  { action: { discriminated-union of 6 commands } }               │
│    trace:    { action: { discriminated-union of 6 commands } }               │
│                                                                              │
│  Gemma 4 E4B emits:                                                          │
│    tool_call.function.name      = "trace"                                    │
│    tool_call.function.arguments = '{"command":"start","reload":true}'        │
│                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^         │
│                                     ❌ FLAT — missing "action" wrapper       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  MCP BRIDGE (packages/local-agent/src/mcp-bridge.ts:57-77)                   │
│  callTool("trace", { command: "start", reload: true })                       │
│         │                                                                    │
│         │ forwards args unchanged to MCP client                              │
│         ▼                                                                    │
│  client.callTool({ name: "trace", arguments: { command, reload } })          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │  stdio (JSON-RPC)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PERF-AGENT MCP SERVER (packages/browser/src/mcp/tools/trace.ts)             │
│  inputSchema: { action: TraceAction }                                        │
│                                                                              │
│  Zod validation against the "action" property:                               │
│    ❌ "action" is required, not provided                                     │
│    ❌ extra properties "command", "reload" not allowed                       │
│                                                                              │
│  Returns: { content: [{ type:"text", text:"validation error..." }],          │
│             isError: true }                                                  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  MCP BRIDGE returns to agent:  "Error: validation error..."                  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  TOOL LOOP pushes to messages[]:                                             │
│    { role: "tool", content: "Error: validation error..." }                   │
│                                                                              │
│  Gemma 4 tries again (different command, still no wrapper) — same error.    │
│  After 8 rounds, model emits:                                                │
│    "The performance analysis could not be completed due to persistent        │
│     input validation errors..."                                              │
└──────────────────────────────────────────────────────────────────────────────┘

RESULT: PerfReport.metrics = []
        TUI: "Agent ran 8 tools but did not capture a performance trace."
```

---

## P0 — Auto-wrap in local-agent bridge (QUICK FIX)

**Scope:** `packages/local-agent/src/mcp-bridge.ts` only (~15 lines)
**Blast radius:** zero — only affects the local agent path.
**Risk:** very low — idempotent (already-wrapped args pass through unchanged).

### Proposed flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  LOCAL AGENT                                                                 │
│  Gemma 4 emits:  '{"command":"start","reload":true}'   (same as before)      │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  MCP BRIDGE — NEW: wrapArgsIfNeeded()                                        │
│                                                                              │
│  1. On listTools(), build wrapperKeyByTool Map from inputSchema:             │
│                                                                              │
│       for (const tool of tools) {                                            │
│         const shape = tool.inputSchema?.properties ?? {};                    │
│         const keys = Object.keys(shape);                                     │
│         // heuristic: single-property schema whose value accepts `command` → │
│         //   the outer key is a wrapper                                      │
│         if (keys.length === 1 && shape[keys[0]].oneOf?.some(                 │
│              v => v.properties?.command)) {                                  │
│           wrapperKeyByTool.set(tool.name, keys[0]);                          │
│         }                                                                    │
│       }                                                                      │
│                                                                              │
│     → Map { "interact" → "action", "observe" → "action", "trace" → "action" }│
│                                                                              │
│  2. On callTool(name, args):                                                 │
│                                                                              │
│       const wrapper = wrapperKeyByTool.get(name);                            │
│       if (wrapper && !(wrapper in args) && "command" in args) {              │
│         args = { [wrapper]: args };  // ← auto-wrap                          │
│         log("auto-wrapped tool args", { tool: name, wrapper });              │
│       }                                                                      │
│                                                                              │
│     → { action: { command: "start", reload: true } }  ✓                      │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PERF-AGENT MCP SERVER                                                       │
│  Zod validation:  ✓ matches { action: { command: "start", ... } }            │
│  Handler dispatches to devtools.callTool("performance_start_trace", ...)     │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  CHROME DEVTOOLS MCP returns the CWV-bearing text                            │
│  Agent sees real data, continues the session, calls trace stop / analyze /   │
│  observe console / observe network in subsequent rounds.                     │
└──────────────────────────────────────────────────────────────────────────────┘

RESULT: PerfReport.metrics populated
        TUI: CWV panel + c/n/i hints appear
```

### Pros / cons
- ✅ Unblocks today's Gemma 4 run without changing any MCP server contract.
- ✅ Invisible to Claude / Codex / other agents (they go through their own ACP adapters, not this bridge).
- ✅ Idempotent — if the model ever sends wrapped args, passes through unchanged.
- ⚠️ Silent "magic" — behavior differs from what the tool schema literally says. We log every auto-wrap so it's observable.
- ⚠️ Heuristic-based — if a future tool has a legit non-wrapper single property called `action`, false positive. Mitigate by also checking the inner shape accepts `command`.

---

## P1 — Explicit wrapper shape in tool descriptions (COMPLEMENTARY)

**Scope:** description string in three files — `packages/browser/src/mcp/tools/interact.ts:107-115`, `observe.ts:104-112`, `trace.ts:55-69`. **No code changes, pure docs.**
**Blast radius:** all MCP consumers (Claude, Codex, Gemma, Cursor, …) — helps small models, no effect on large ones that already handle the schema.
**Risk:** effectively zero.

### Current description (`trace` tool)

```
Performance profiling and analysis.

Commands: start, stop, analyze, memory, lighthouse, emulate.

Workflow: `emulate` (optional throttling) -> `start` (begins trace, reload=true for cold-load) ->
`stop` (returns CWV summary + insight IDs) -> `analyze` (drill into specific insights like
LCPBreakdown, RenderBlocking, DocumentLatency).
...
```

The agent sees this + a JSON Schema for parameters. Small models often can't reliably translate the JSON Schema's `{"action": {"oneOf": [...]}}` into the right wire shape.

### Proposed description (`trace` tool)

```
Performance profiling and analysis.

Call shape:
  { "action": { "command": "<one of: start, stop, analyze, memory, lighthouse, emulate>", ... } }

Examples:
  { "action": { "command": "start", "reload": true } }
  { "action": { "command": "stop" } }
  { "action": { "command": "analyze", "insightSetId": "NAVIGATION_0", "insightName": "LCPBreakdown" } }
  { "action": { "command": "emulate", "cpuThrottling": 4, "network": "Slow 3G" } }

Workflow: emulate (optional throttling) -> start (reload=true for cold-load) ->
stop (returns CWV summary + insight IDs) -> analyze (drill into insights).
...
```

### How this flows

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  MCP SERVER                                                                  │
│  Tool description now has a literal example of the wire shape.               │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ listTools() sends description to bridge
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  OLLAMA RECEIVES                                                             │
│    tools[1].function.description = "...{ 'action': { 'command': 'start', ...}│
│    tools[1].function.parameters  = { ... same JSON Schema as before ... }    │
│                                                                              │
│  Gemma 4 reads description before emitting args. The wrapper example nudges  │
│  it to produce the correct shape directly — no auto-wrap needed.             │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Pros / cons
- ✅ Helps every small/medium model, not just Gemma 4.
- ✅ Zero code risk.
- ✅ Composes with P0 — if descriptions work, auto-wrap becomes a silent no-op (good layered defense).
- ⚠️ Doesn't guarantee the model obeys — some models still hallucinate past docs. Hence layering with P0.

---

## P2 — Flatten to individual tools (ARCHITECTURAL)

**Scope:** rewrite `packages/browser/src/mcp/*` to expose ~27 narrow tools instead of 3 macros. Update the skill's `SKILL.md` to teach the new names. Update prompts in `packages/shared/src/prompts.ts` that reference the 3 macro names.
**Blast radius:** every MCP consumer — Claude, Codex, Gemma, all of them see the new surface.
**Risk:** medium — bigger surface area for the agent to hold in context, and every downstream prompt/skill referring to `interact` / `observe` / `trace` needs updating.

### Current architecture — 3 macro tools

```
PERF-AGENT MCP SERVER
├── interact    (15 commands)
│    └── action: navigate | click | type | fill | press_key | hover | drag |
│                fill_form | upload_file | handle_dialog | wait_for | resize |
│                new_tab | switch_tab | close_tab
├── observe     (6 commands)
│    └── action: snapshot | screenshot | console | network | pages | evaluate
└── trace       (6 commands)
     └── action: start | stop | analyze | memory | lighthouse | emulate
                                           │
                                           ▼
                                  DevTools MCP (raw 29 tools)
```

### Proposed — flat tool surface

```
PERF-AGENT MCP SERVER (27 tools, each thin passthrough to DevTools MCP)
│
├── Interaction ( "performs an action on the page" )
│    ├── navigate_page        ── { url, timeout?, ... }
│    ├── click                ── { uid, double? }
│    ├── type_text            ── { text, submitKey? }
│    ├── fill_input           ── { uid, value }
│    ├── press_key            ── { key }
│    ├── hover                ── { uid }
│    ├── drag                 ── { fromUid, toUid }
│    ├── fill_form            ── { elements }
│    ├── upload_file          ── { uid, filePath }
│    ├── handle_dialog        ── { accept, promptText? }
│    ├── wait_for_text        ── { text, timeout? }
│    ├── resize_page          ── { width, height }
│    ├── new_page             ── { url, background? }
│    ├── select_page          ── { pageId }
│    └── close_page           ── { pageId }
│
├── Observation ( "reads page state" )
│    ├── take_snapshot        ── {}
│    ├── take_screenshot      ── { format?, fullPage? }
│    ├── list_console_messages ── { level? }
│    ├── list_network_requests ── { resourceTypes? }
│    ├── list_pages           ── {}
│    └── evaluate_script      ── { function, args? }
│
└── Profiling ( "measures performance" )
     ├── performance_start_trace     ── { reload?, autoStop? }
     ├── performance_stop_trace      ── {}
     ├── performance_analyze_insight ── { insightSetId, insightName }
     ├── take_memory_snapshot        ── {}
     ├── lighthouse_audit            ── { categories? }
     └── emulate_conditions          ── { cpuThrottling?, network? }
                                  │
                                  ▼
                         DevTools MCP (raw passthrough)
```

### How this flow changes

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  LOCAL AGENT                                                                 │
│  Sees 27 tools, each with flat inputSchema (no "action" wrapper).            │
│                                                                              │
│  Gemma 4 emits:                                                              │
│    tool_call.function.name      = "performance_start_trace"                  │
│    tool_call.function.arguments = '{"reload":true,"autoStop":true}'          │
│                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^            │
│                                     ✓ FLAT MATCHES SCHEMA                    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │  no wrapper, no shim needed
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PERF-AGENT MCP SERVER (thin layer over DevTools MCP)                        │
│  Handler:                                                                    │
│    devtools.callTool("performance_start_trace", { reload, autoStop })        │
└──────────────────────────────────────────────────────────────────────────────┘

Subsequent work:
 - SKILL.md rewrite — 27 tool names instead of 3 macros with sub-commands.
 - Prompts rewrite — packages/shared/src/prompts.ts references to interact/observe/trace
   become references to specific tool names.
 - Reporter filter adjust — sentinel still works, but tool-name pre-filter becomes
   `toolName === "performance_start_trace" || toolName === "performance_stop_trace"`.
 - Console/network capture filter adjust — match `list_console_messages` and
   `list_network_requests` directly.
```

### Pros / cons
- ✅ Schema matches reality — no wrappers, no shims, no heuristics.
- ✅ Small models and large models behave identically.
- ✅ Each tool description is focused and short (1–2 sentences) — easier for any model to grok than a 15-branch discriminated union.
- ⚠️ **27 tool names in context** instead of 3 — for context-constrained models, this means more tokens consumed by the tool manifest. Mitigation: most tool schemas are tiny (≤ 5 properties), so the manifest stays under 4KB.
- ⚠️ Loses the "3 macro tools" mental model the SKILL.md teaches. Skill files need rewriting — one more round of integration work.
- ⚠️ Harder to add new per-tool behavior (e.g. pre/post hooks, shared setup) once the grouping is gone. Currently the macro handlers can share code; flattening means 27 parallel handlers.

---

## Decision matrix

| Dimension                         | P0 (auto-wrap)  | P1 (descriptions) | P2 (flatten)    |
|-----------------------------------|-----------------|-------------------|-----------------|
| Unblocks Gemma 4 today            | ✅ Yes          | ⚠️ Probably       | ✅ Yes          |
| Helps other small models          | ❌ Only local   | ✅ Yes            | ✅ Yes          |
| Code-change scope                 | 1 file, ~15 LOC | 3 files, docs only | Many files, ~1–2 days |
| Impact on large models            | None            | None              | None (maybe +slight token cost) |
| Systemic elegance                 | Hack            | Docs band-aid     | Clean           |
| Skill / prompt rewrite needed     | No              | No                | **Yes**         |
| Reversibility                     | Delete 15 LOC   | Revert description | Hard revert    |

---

## Recommendation (current — pending research)

**Do P0 + P1 now, park P2.**

- P0 takes 20 minutes end-to-end and unblocks the live run today.
- P1 takes 10 minutes and helps every future model — tiny change, pure upside.
- P2 is the "right" answer architecturally, but the cost is non-trivial (skill + prompts + every macro reference in the codebase + reporter filters + capture filters). Defer until we see how hosted agents (Claude, Codex) actually behave with the wrapper. If they're fine, the 3-macro design is still the cleaner mental model — we just need the schema to not require unwrapping by the caller.

If P0+P1 doesn't make Gemma 4 reliable enough within a couple of tries, that's the signal to pull P2 in.

**This recommendation is tentative. Parallel research on how other SOTA harnesses handle tool-call healing is in flight — findings will update this doc.**

---

## Related research (in progress)

See `.specs/research/` for findings from:
- OpenCode harness (tool-call pipeline + healing patterns)
- Goose harness (tool-call validation + recovery)
- Academic papers on tool-call repair / schema-guided decoding / function-calling reliability

Peer-reviewed synthesis at `.specs/research/synthesis.md` will land when all streams complete.
