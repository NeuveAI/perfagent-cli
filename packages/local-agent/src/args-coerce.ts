import { log } from "./log.js";

export interface CoerceResult {
  readonly content: string;
  readonly rewrote: boolean;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// R9 Option 4 — pre-parse coercion for the strict AgentTurn parser
// (`packages/shared/src/react-envelope.ts parseAgentTurnFromString`). Three
// R9 prompt iterations (wave-r9-prompt-aligned, wave-r9-prompt-refined,
// wave-r9-prompt-v3) failed to eliminate `interact{command:"type", uid, text}`
// — gemma adopted `uid` from observe.snapshot correctly but kept reaching
// for `type` over `fill` despite progressively explicit disambiguation
// prose. Rule 1 rewrites the failing shape to canonical
// `interact{command:"fill", uid, value:text}` so the strict per-tool union
// accepts it and the run continues.
//
// Intra-dispatcher rewrite: stays inside the `interact` tool, just renames
// the command + field. Distinct from the MCP-bridge call-time auto-wrap
// (`packages/local-agent/src/mcp-bridge.ts callTool`) which wraps args
// under a wrapperKey at the MCP boundary — this runs at envelope-parse
// boundary inside the local-agent loop, BEFORE the strict parser sees the
// content. The bridge auto-wrap can't help here because the bailout
// happens at parse, before any MCP call.
//
// See `docs/handover/schema-invalid-reconciliation/diary/r9-2026-04-30.md`
// for the failure trace catalog and the prompt-iteration ladder that
// exhausted prompt-only options.
export const coerceAgentTurnArgs = (content: string): CoerceResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { content, rewrote: false };
  }
  if (!isObjectRecord(parsed)) return { content, rewrote: false };
  if (parsed["_tag"] !== "ACTION") return { content, rewrote: false };
  if (parsed["toolName"] !== "interact") return { content, rewrote: false };
  const args = parsed["args"];
  if (!isObjectRecord(args)) return { content, rewrote: false };

  // Rule 1: interact{command:"type", uid, text} → interact{command:"fill", uid, value:text}
  if (
    args["command"] === "type" &&
    typeof args["uid"] === "string" &&
    typeof args["text"] === "string"
  ) {
    const rewrittenArgs: Record<string, unknown> = {
      command: "fill",
      uid: args["uid"],
      value: args["text"],
    };
    if ("includeSnapshot" in args) {
      rewrittenArgs["includeSnapshot"] = args["includeSnapshot"];
    }
    const rewrittenEnvelope = { ...parsed, args: rewrittenArgs };
    log("coerceAgentTurnArgs: type+uid+text → fill+uid+value", {
      from: { command: "type", uid: args["uid"], text: args["text"] },
      to: rewrittenArgs,
    });
    return { content: JSON.stringify(rewrittenEnvelope), rewrote: true };
  }

  return { content, rewrote: false };
};
