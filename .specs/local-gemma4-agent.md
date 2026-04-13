# Add "fully local" mode: Gemma 4 E4B via Ollama as ACP agent

## Context

The perf-agent CLI currently delegates all LLM work to cloud-based coding agent CLIs (Claude Code, Codex, Gemini CLI, etc.) via the Agent Client Protocol (ACP). We want a **fully local mode** where inference runs on-device using **Gemma 4 E4B Q8** (~7.5 GB) via **Ollama**, giving developers a zero-cost, offline-capable performance analysis workflow.

**Why:** Cloud agents require API keys, network access, and incur per-token costs. A local mode makes perf-agent accessible to anyone with a Mac (24 GB+ RAM) and removes the dependency on external services.

**Model choice:** Gemma 4 E4B Q8 — 4.5B active params, 128K context, native tool calling, ~57 tok/s on M4 Pro. Leaves ~16 GB free for Chrome + MCP server. Q8 preserves tool calling quality (lower quants degrade structured JSON output).

**Architecture:** A lightweight custom ACP agent (~250 lines TypeScript) that wraps Ollama's OpenAI-compatible API. It speaks ACP over stdio (so the existing `AcpClient` works unchanged), connects to the browser MCP server for tool discovery, and handles the tool-call loop internally.

---

## Architecture overview

```
perf-agent CLI (AcpClient)
  │ spawns via stdio
  ▼
local-agent process (new package: @neuve/local-agent)
  │ ACP protocol (JSON-RPC over ndJSON)
  │
  ├── AgentSideConnection (@agentclientprotocol/sdk)
  │     handles: initialize, newSession, prompt, cancel
  │
  ├── MCP Client (@modelcontextprotocol/sdk)
  │     connects to browser MCP server from mcpServers[]
  │     lists tools → converts to OpenAI function-calling format
  │
  └── Ollama Client (openai npm package)
        POST http://localhost:11434/v1/chat/completions
        model: gemma4:e4b
        tools: [...mcp tools as OpenAI functions]
        stream: false (non-streaming for tool call reliability)
```

---

## Files to create/modify

### New package: `packages/local-agent/`

| File | Purpose |
|------|---------|
| `packages/local-agent/package.json` | Package config, deps: `@agentclientprotocol/sdk`, `@modelcontextprotocol/sdk`, `openai` |
| `packages/local-agent/tsconfig.json` | TypeScript config |
| `packages/local-agent/src/agent.ts` | Main: ACP Agent class wrapping Ollama + MCP |
| `packages/local-agent/src/mcp-bridge.ts` | Connect to MCP servers, list tools, convert to OpenAI format, execute tool calls |
| `packages/local-agent/src/ollama-client.ts` | Typed wrapper around OpenAI SDK pointed at Ollama |
| `packages/local-agent/src/tool-loop.ts` | The prompt→tool_calls→tool_results→continue loop with guards |
| `packages/local-agent/src/main.ts` | Entry point: wire stdio → ndJsonStream → AgentSideConnection |

### Existing files to modify

| File | Change |
|------|--------|
| `packages/shared/src/models.ts` | Add `"local"` to `AgentProvider` literal union (line ~246) |
| `packages/agent/src/agent.ts` | Add `layerLocal` to `layerFor` lookup table |
| `packages/agent/src/acp-client.ts` | Add `AcpAdapter.layerLocal` — checks Ollama is running, resolves local-agent binary |
| `packages/agent/src/detect-agents.ts` | Add local agent detection (check `ollama` binary + model availability) |
| `packages/shared/src/infer-agent.ts` | Add `PERF_AGENT_LOCAL` env var inference |
| `apps/cli/src/index.tsx` | Add `"local"` to `-a` flag choices |

---

## Implementation

### Phase 1: New package skeleton

Create `packages/local-agent/` with package.json:
```json
{
  "name": "@neuve/local-agent",
  "private": true,
  "type": "module",
  "bin": { "neuve-local-agent": "./dist/main.js" },
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.17.0",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "openai": "^4.0.0"
  }
}
```

### Phase 2: Entry point (`main.ts`)

Wire stdio to ACP — exactly matching the SDK example pattern:
```ts
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { LocalAgent } from "./agent.js";

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
new acp.AgentSideConnection((conn) => new LocalAgent(conn), stream);
```

### Phase 3: MCP Bridge (`mcp-bridge.ts`)

Connects to MCP servers passed in `newSession`, lists their tools, and provides:
- `listTools()` → OpenAI function-calling format tools array
- `callTool(name, args)` → execute via MCP client, return result

Uses `@modelcontextprotocol/sdk` Client + StdioClientTransport (same pattern as DevToolsClient).

Tool schema conversion: MCP tool `inputSchema` (JSON Schema) → OpenAI `function.parameters` (identical format, direct passthrough).

### Phase 4: Ollama Client (`ollama-client.ts`)

Thin wrapper using the `openai` npm package:
```ts
const client = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
});
```

Key settings:
- `stream: false` — non-streaming for tool call reliability
- `temperature: 0.1` — low temp for structured output quality
- Model default: `gemma4:e4b` (configurable via `PERF_AGENT_LOCAL_MODEL` env var)

### Phase 5: Tool Loop (`tool-loop.ts`)

The core agent loop:

```
1. Build messages: [system, ...history, user]
2. Call Ollama with tools
3. If response has tool_calls:
   a. Emit ACP tool_call update (status: "in_progress")
   b. Execute each tool via MCP bridge
   c. Emit ACP tool_call_update (status: "completed", content: result)
   d. Append assistant + tool messages to history
   e. GOTO 2 (up to MAX_TOOL_ROUNDS=15)
4. If response is text:
   a. Emit ACP agent_message_chunk
   b. Return
```

Guards:
- `MAX_TOOL_ROUNDS = 15` — prevent infinite loops
- JSON repair layer for malformed tool arguments (try parse → regex repair → retry)
- Check `message.tool_calls` array directly (not `finish_reason`, which is unreliable)
- `num_ctx: 32768` minimum context window

### Phase 6: ACP Agent class (`agent.ts`)

Implements the 5 required ACP Agent methods:

| Method | Implementation |
|--------|---------------|
| `initialize` | Return `{ protocolVersion: 1, agentCapabilities: {} }` |
| `newSession` | Generate session ID, connect MCP bridge to `params.mcpServers`, extract `_meta.systemPrompt` |
| `authenticate` | Return `{}` (no auth for local) |
| `prompt` | Extract text from `params.prompt`, run tool loop, stream updates via `connection.sessionUpdate()`, return `{ stopReason: "end_turn" }` |
| `cancel` | Abort in-flight Ollama request via AbortController |

System prompt handling: Use `_meta.systemPrompt` if present (Claude-style). The AcpClient also prepends it to the user prompt for non-Claude providers (line 843-846 of acp-client.ts), so the local agent gets it either way.

### Phase 7: Wire into existing codebase

**`AcpAdapter.layerLocal`** in `acp-client.ts`:
```ts
static layerLocal = Layer.succeed(this, AcpAdapter.of({
  provider: "local",
  bin: process.execPath,
  args: [resolvedLocalAgentBinPath],
  env: {},
}));
```

Pre-flight checks:
1. Verify `ollama` is in PATH
2. Verify Ollama is running (`curl http://localhost:11434/api/version`)
3. Verify model is available (`ollama list | grep gemma4`)
4. If model missing, suggest `ollama pull gemma4:e4b`

**`Agent.layerLocal`** in `agent.ts` — add to the `layerFor` dispatch table.

**`AgentProvider`** in `models.ts` — add `"local"` to the union.

---

## Reference code

| Resource | Path | Use for |
|----------|------|---------|
| ACP SDK source | `~/code/.better-coding-agents/resources/acp-typescript-sdk/src/` | Agent interface, AgentSideConnection, ndJsonStream |
| ACP example agent | `~/code/.better-coding-agents/resources/acp-typescript-sdk/src/examples/agent.ts` | Full ACP agent pattern (224 lines) |
| Chrome DevTools MCP source | `~/code/.better-coding-agents/resources/chrome-devtools-mcp/` | MCP tool schemas for validation |
| Existing AcpAdapter layers | `packages/agent/src/acp-client.ts:252-546` | Pattern for pre-flight checks, binary resolution |
| Existing DevToolsClient | `packages/browser/src/devtools-client.ts` | MCP client pattern (StdioClientTransport, callTool) |
| ACP client consumption | `packages/agent/src/acp-client.ts:548-953` | What the client expects from the agent |

---

## Verification

1. **Build:** `pnpm typecheck && pnpm build`
2. **Unit test:** Test tool loop with a mock Ollama response (no real model needed)
3. **Integration test — Ollama health:**
   ```bash
   ollama pull gemma4:e4b
   ollama serve
   curl http://localhost:11434/v1/chat/completions -d '{"model":"gemma4:e4b","messages":[{"role":"user","content":"hi"}]}'
   ```
4. **Integration test — ACP agent standalone:**
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | node packages/local-agent/dist/main.js
   ```
5. **End-to-end:** `perf-agent -a local "Analyze the loading performance of https://agent.perflab.io"`
6. **Tool calling:** Verify the agent can navigate, take snapshots, start/stop traces via the 3 macro tools

---

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Ollama `tool_choice` not supported | Check `message.tool_calls` directly, not `finish_reason`. Re-prompt if model ignores tools. |
| Malformed JSON arguments at Q8 | JSON repair layer: strict parse → regex fix quotes/escapes → retry once |
| Context window silently truncated | Set `num_ctx: 32768` in Ollama request. Monitor token usage. |
| Model forgets tools after many turns | Re-inject tool reminder in system prompt. Cap conversation at MAX_TOOL_ROUNDS. |
| Ollama not running | Clear error: "Ollama is not running. Start it with `ollama serve`." |
| Model not pulled | Clear error: "Model gemma4:e4b not found. Run `ollama pull gemma4:e4b`." |
