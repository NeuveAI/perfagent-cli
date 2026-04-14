# OpenCode — Tool-call validation & healing research

Research target: `sst/opencode` at `/Users/vinicius/code/.better-coding-agents/resources/opencode` (Effect-TS, Bun, Vercel AI SDK v5).
Goal: learn how OpenCode copes with malformed / mis-shaped tool calls and see what applies to our wrapped-`action` problem in `@perfagent/local-agent`.

## 1. Summary

- **The Vercel AI SDK does the heavy lifting.** OpenCode plugs its own logic into AI SDK's `experimental_repairToolCall` hook — it does **not** hand-roll a JSON repair pipeline like ours does (`repairAndParseJson`).
- **Repair is narrow and non-semantic.** It only fixes tool-name casing (e.g. `Bash` → `bash`). On anything else it reroutes the call to a sentinel tool named `invalid` that just echoes the error back to the model. No arg coercion, no schema-shape healing, no re-prompting.
- **Tool parameters are defined as Zod objects with flat top-level shapes.** Discriminated unions are avoided in the built-in toolset — every built-in tool is a `z.object({ ... })` whose properties are the parameters the model emits. This sidesteps the class of problem perf-agent-cli has with `{ action: { command, ... } }`.
- **Validation happens twice** — once inside the AI SDK (against the `jsonSchema(...)` on the `tool()` def) and once inside the Effect wrapper (`Tool.define` re-runs `parameters.parse(args)`). A hook called `formatValidationError` lets a tool pretty-print its Zod error back to the model, but none of the current built-ins use it.
- **Per-provider schema sanitisation exists**, but only for Gemini quirks (enum types, required filtering, `items` backfill). There is no per-model "rewrap args" adapter for small models.

## 2. Tool-call pipeline (walkthrough with citations)

All paths are under `packages/opencode/src/`.

1. **Tool definition.** Each built-in tool is declared with `Tool.define(id, Effect<{description, parameters: z.ZodType, execute}>)` at [`tool/tool.ts:117-130`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/tool.ts). Parameters are **always** a top-level `z.object`; see [`tool/bash.ts:52-60`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/bash.ts) — `{ command, timeout?, workdir? }`, flat.
2. **Registration.** [`tool/registry.ts:186-204`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/registry.ts) gathers builtins including the sentinel `InvalidTool`. The per-request `tools()` function at `registry.ts:276-317` filters by agent/model and forwards `formatValidationError` through to consumers.
3. **Schema → AI SDK `tool()`.** [`session/prompt.ts:396-438`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/prompt.ts) converts each Zod schema via `z.toJSONSchema`, pipes it through `ProviderTransform.schema(model, ...)`, wraps it with `jsonSchema(...)` and registers it as `tool({ description, inputSchema, execute })`.
4. **Provider-specific schema sanitisation.** [`provider/transform.ts:967-1065`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/provider/transform.ts) — only non-trivial branch is Gemini (enum-to-string, filtering `required`, patching empty `items`). No reshaping for Ollama / small models.
5. **Streaming call with repair hook.** [`session/llm.ts:311-337`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/llm.ts) invokes `streamText({ ..., experimental_repairToolCall, tools, activeTools, maxRetries: 0 })`. AI SDK runs JSON-Schema validation on the model's emitted args before calling `execute`; on failure it calls `experimental_repairToolCall`.
6. **Repair implementation.** Same file, lines 317-337: fix tool-name casing if it would match a real tool; otherwise rewrite the call to `{ toolName: "invalid", input: JSON.stringify({ tool, error }) }`. Note `activeTools` at line 342 deliberately excludes `invalid` from the manifest the model sees — it can only be reached via the repair path.
7. **Second-stage validation inside `Tool.define` wrapper.** [`tool/tool.ts:83-96`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/tool.ts) runs `toolInfo.parameters.parse(args)` again inside Effect, and if it throws either calls the tool's `formatValidationError(error)` or falls back to a generic "rewrite the input so it satisfies the expected schema" message.
8. **Tool-error surfacing.** [`session/processor.ts:338-341`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/processor.ts) catches the AI SDK's `tool-error` event and pipes the error string back as a `tool-result` for the next model turn via `failToolCall` at `processor.ts:198-215`.
9. **MCP adapter.** [`mcp/index.ts:133-161`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/mcp/index.ts) — `convertMcpTool` wraps each MCP tool in AI SDK's `dynamicTool(...)`. It forces `type: "object"` + `additionalProperties: false` on the schema but otherwise passes the MCP server's `inputSchema` through verbatim. **No wrapping, unwrapping, or arg massaging.** `session/prompt.ts:440-459` re-runs `ProviderTransform.schema` on MCP schemas too.

## 3. Healing strategies observed

### 3a. Tool-name case repair
Before giving up, `experimental_repairToolCall` lower-cases the tool name and retries. Cheap fix for models that capitalise tool names (`Bash`, `Read`).

```ts
// session/llm.ts:317-328
async experimental_repairToolCall(failed) {
  const lower = failed.toolCall.toolName.toLowerCase()
  if (lower !== failed.toolCall.toolName && tools[lower]) {
    l.info("repairing tool call", { tool: failed.toolCall.toolName, repaired: lower })
    return { ...failed.toolCall, toolName: lower }
  }
  ...
}
```

### 3b. Reroute to `invalid` sentinel
Any other failure (missing required prop, bad type, unknown tool) becomes a redirected call to a zero-op tool whose output reads `"The arguments provided to the tool are invalid: <error>"` — visible as a tool-result on the next turn.

```ts
// session/llm.ts:329-336
return {
  ...failed.toolCall,
  input: JSON.stringify({
    tool: failed.toolCall.toolName,
    error: failed.error.message,
  }),
  toolName: "invalid",
}
```

```ts
// tool/invalid.ts:5-20
export const InvalidTool = Tool.define("invalid", Effect.succeed({
  description: "Do not use",
  parameters: z.object({ tool: z.string(), error: z.string() }),
  execute: (params) =>
    Effect.succeed({
      title: "Invalid Tool",
      output: `The arguments provided to the tool are invalid: ${params.error}`,
      metadata: {},
    }),
}))
```

`invalid` is explicitly excluded from `activeTools` ([`session/llm.ts:342`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/llm.ts)) so the model never sees it in the manifest.

### 3c. Per-tool `formatValidationError` hook (latent)
The `Tool.Def` interface exposes an optional `formatValidationError(error: z.ZodError) => string` that the Effect wrapper calls when `parameters.parse(args)` fails. Intent: let a tool tailor its error message (e.g. collapse a huge Zod stack into one actionable line). In the current codebase **no built-in tool implements it** — it is plumbing that exists for plugin/custom tools.

```ts
// tool/tool.ts:85-96
yield* Effect.try({
  try: () => toolInfo.parameters.parse(args),
  catch: (error) => {
    if (error instanceof z.ZodError && toolInfo.formatValidationError) {
      return new Error(toolInfo.formatValidationError(error), { cause: error })
    }
    return new Error(
      `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
      { cause: error },
    )
  },
})
```

### 3d. Flat parameter schemas as prevention
OpenCode's built-ins systematically avoid nesting that a model could mis-guess. `bash.ts:52-60`, `edit.ts:37` (`z.object({ filePath, oldString, newString, ... })`), `read.ts`, `grep.ts` etc. — all flat objects. The cost of this is more tools, not deeper tools.

### 3e. Gemini-targeted schema rewriting
`sanitizeGemini` (`provider/transform.ts:1013-1062`) rewrites JSON Schema in place for Google models: integer enums → string enums, filter `required` to existing properties, backfill missing `items.type`, strip `properties`/`required` off non-object nodes. Narrow: only runs when provider === `google` or model id contains `gemini`.

### 3f. Doom-loop guard
Not a healing strategy per se, but worth flagging: `session/processor.ts:305-330` watches for the same `{toolName, input}` repeating `DOOM_LOOP_THRESHOLD` times and raises a permission prompt. That's the backstop for cases where the model ignores `invalid` feedback and keeps retrying — directly analogous to our 8-round failure loop.

## 4. Does OpenCode handle our specific problem?

**Short answer: no.** Three observations:

1. None of OpenCode's built-in tools use the `{ wrapper: { discriminated union } }` shape, so the repair code has never needed to learn this pattern.
2. `experimental_repairToolCall` only maps to a known `toolName`; it never rewrites `input` to re-shape arguments. If Gemma 4 emitted `{"command": "start"}` to an OpenCode tool expecting `{"action": {"command": "start"}}`, AI SDK would flag it invalid, OpenCode would swap to `invalid`, and the model would see `"The arguments provided to the tool are invalid: ...Zod error..."`. The next turn's success would depend purely on the model's own correction.
3. The MCP adapter (`mcp/index.ts:133-161`) forwards whatever the MCP server declares. There's no logic that notices a wrapping key and lifts payloads under it.

The closest analogue is strategy 3b — reroute to a sentinel that tells the model what went wrong. Gemma 4 E4B in our traces didn't self-correct even with the Zod error visible; the doom-loop guard would eventually stop us but not fix us.

## 5. Applicability to perf-agent-cli

Given our root-cause is wrapped `{ action: { command } }` schemas:

| Strategy | Fit | Why |
|---|---|---|
| **3a. Tool-name case repair** | *Not applicable.* Our failure is arg shape, not tool name. |
| **3b. Sentinel `invalid` tool + reroute** | *Adaptable.* Worth adopting regardless — right now our bridge returns `"Error: validation error..."` as a tool-result, which is effectively the same signal but unstructured. Switching to a named `invalid` tool yields cleaner traces and matches P0+P1 if P0+P1 still leaves residual failures. |
| **3c. Per-tool `formatValidationError`** | *Adaptable.* We control the MCP server (`packages/browser/src/mcp/tools/*.ts`); we could synthesise a friendly "You sent X, expected `{ action: X }`" from the Zod error at that layer, matching OpenCode's plumbing philosophy. Minor gain because most small models ignore verbose Zod output anyway. |
| **3d. Flat schemas** | *Direct fit — this is essentially P2 (flatten).* OpenCode's entire built-in toolset follows this rule because it's the only robust answer for diverse models. Validates the architectural direction of P2 in our spec. |
| **3e. Per-provider sanitisation** | *Adaptable.* Our `mcp-bridge.ts` could host a similar adapter keyed on the model identity (`gemma*` → auto-wrap), mirroring `sanitizeGemini`. This is very close to P0 in spirit. |
| **3f. Doom-loop guard** | *Direct fit.* We already cap at `MAX_TOOL_ROUNDS = 15` (tool-loop.ts:8), but a same-args-repeating detector would fail faster and surface a better message than "reached max rounds". |

**Bottom line for perf-agent-cli:** OpenCode's lesson is *prevent, don't repair*. Their `experimental_repairToolCall` is a last-ditch narrow fixup, and their main answer to shape mismatch is to never present a shape the model is likely to get wrong. This reinforces P2 (flatten) as the structurally correct answer while P0 (auto-wrap in bridge) is a reasonable local equivalent of 3e for the Gemma-today unblock.

## 6. Citations

- [`packages/opencode/src/tool/tool.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/tool.ts) — `Tool.define`, Effect wrapper, `formatValidationError` hook.
- [`packages/opencode/src/tool/invalid.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/invalid.ts) — sentinel tool for rerouted failures.
- [`packages/opencode/src/tool/registry.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/registry.ts) — tool assembly, `InvalidTool` baked into builtins, per-request filtering.
- [`packages/opencode/src/tool/bash.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/tool/bash.ts) — flat schema exemplar.
- [`packages/opencode/src/session/llm.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/llm.ts) — `streamText`, `experimental_repairToolCall`, `activeTools`, `resolveTools`.
- [`packages/opencode/src/session/prompt.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/prompt.ts) — per-tool AI-SDK wiring, MCP tool schema transform.
- [`packages/opencode/src/session/processor.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/session/processor.ts) — `tool-error` handling, `failToolCall`, doom-loop guard.
- [`packages/opencode/src/provider/transform.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/provider/transform.ts) — `schema` + `sanitizeGemini`.
- [`packages/opencode/src/mcp/index.ts`](/Users/vinicius/code/.better-coding-agents/resources/opencode/packages/opencode/src/mcp/index.ts) — MCP → AI SDK `dynamicTool` adapter.

## 7. Questions for peer review

1. **Is AI SDK's JSON-schema validator strict enough to reject Gemma's flat `{command}` when the schema says `{action: {...}}`, or does it silently pass through with `additionalProperties: false` and fail only at our Zod re-parse?** Worth double-checking by reading `ai` SDK's tool-call pipeline (outside this clone) — it influences whether OpenCode's `experimental_repairToolCall` would even fire for our shape mismatch.
2. **Does OpenCode have any plugin-level tool that does use discriminated unions?** I searched `tool/*.ts` and saw none; a plugin in the wild might have already had this problem and solved it locally. Scanning `packages/plugin` or `packages/sdk` could surface evidence.
3. **Is flipping `activeTools` to exclude `invalid` portable to every model?** If a provider ignores `activeTools` and leaks the full `tools` record to the model, the model might "helpfully" call `invalid` directly and derail the loop. Worth a probe with Ollama.
