import { z } from "zod/v4";
import { Cause, Effect, Exit, Predicate, Schema, type ManagedRuntime } from "effect";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DevToolsClient } from "../../devtools-client";
import { click } from "../../tools/click";
import { fill as fillTool } from "../../tools/fill";
import { hover } from "../../tools/hover";
import { select } from "../../tools/select";
import { waitFor } from "../../tools/wait-for";
import {
  NetworkIdleSampler,
  RefResolver,
  SnapshotTaker,
  ToolRef,
  WaitForEngine,
  type ToolResult,
  type WaitForState,
  type WaitForTarget,
} from "../../tools/types";
import { McpSession } from "../mcp-session";

type ToolsRuntime = ManagedRuntime.ManagedRuntime<
  McpSession | DevToolsClient | RefResolver | NetworkIdleSampler | SnapshotTaker | WaitForEngine,
  unknown
>;

interface McpToolResponse {
  readonly content: Array<{ type: "text"; text: string }>;
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

const successResponse = (result: ToolResult): McpToolResponse => ({
  content: [{ type: "text", text: result.snapshot.text }],
});

const errorResponse = (message: string): McpToolResponse => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const describeCause = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  if (squashed instanceof Error) return squashed.message;
  if (Predicate.isObject(squashed) && "message" in squashed) {
    const message: unknown = squashed.message;
    if (typeof message === "string") return message;
  }
  return String(squashed);
};

const runToMcp = async <A extends ToolResult, E>(
  runtime: ToolsRuntime,
  effect: Effect.Effect<
    A,
    E,
    McpSession | DevToolsClient | RefResolver | NetworkIdleSampler | SnapshotTaker | WaitForEngine
  >,
): Promise<McpToolResponse> => {
  const exit = await runtime.runPromiseExit(effect);
  return Exit.match(exit, {
    onSuccess: (value) => successResponse(value),
    onFailure: (cause) => errorResponse(describeCause(cause)),
  });
};

const decodeRef = Schema.decodeSync(ToolRef);

const ClickInput = z.object({
  ref: z.string().min(1),
  button: z.enum(["left", "right", "middle"]).optional(),
  clickCount: z.number().int().min(1).optional(),
});

const FillInput = z.object({
  ref: z.string().min(1),
  text: z.string(),
  clearFirst: z.boolean().optional(),
});

const HoverInput = z.object({
  ref: z.string().min(1),
});

const SelectInput = z.object({
  ref: z.string().min(1),
  option: z.union([z.string(), z.number()]),
});

const WAIT_FOR_STATES = ["visible", "hidden", "attached", "detached"] as const;

const WaitForInput = z.object({
  ref: z.string().optional(),
  selector: z.string().optional(),
  aria: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  state: z.enum(WAIT_FOR_STATES).optional(),
});

const resolveWaitForTarget = (input: z.infer<typeof WaitForInput>): WaitForTarget | undefined => {
  if (input.ref) return { kind: "ref", ref: decodeRef(input.ref) };
  if (input.selector) return { kind: "selector", selector: input.selector };
  if (input.aria) return { kind: "aria", aria: input.aria };
  return undefined;
};

export const registerInteractionTools = (server: McpServer, runtime: ToolsRuntime) => {
  server.registerTool(
    "click",
    {
      title: "Click",
      description: [
        "Click an element by its ref. The ref is an opaque string from the last snapshot",
        "(numbered from the Set-of-Mark overlay, or a chrome-devtools-mcp uid).",
        "",
        'Example: { "ref": "3" }',
        "",
        "After the click, waits for the network to go idle and returns a fresh snapshot",
        "so the next turn observes the post-click state.",
      ].join("\n"),
      inputSchema: ClickInput.shape,
    },
    async (input) => {
      const parsed = ClickInput.parse(input);
      return runToMcp(
        runtime,
        click(decodeRef(parsed.ref), {
          ...(parsed.button !== undefined && { button: parsed.button }),
          ...(parsed.clickCount !== undefined && { clickCount: parsed.clickCount }),
        }),
      );
    },
  );

  server.registerTool(
    "fill",
    {
      title: "Fill",
      description: [
        "Fill an input element by its ref with the given text.",
        "",
        'Example: { "ref": "7", "text": "hello", "clearFirst": true }',
        "",
        "clearFirst empties the field before writing. Returns a post-action snapshot.",
      ].join("\n"),
      inputSchema: FillInput.shape,
    },
    async (input) => {
      const parsed = FillInput.parse(input);
      return runToMcp(
        runtime,
        fillTool(decodeRef(parsed.ref), parsed.text, {
          ...(parsed.clearFirst !== undefined && { clearFirst: parsed.clearFirst }),
        }),
      );
    },
  );

  server.registerTool(
    "hover",
    {
      title: "Hover",
      description: [
        "Hover over an element by its ref. Triggers CSS hover states and menu reveals.",
        "",
        'Example: { "ref": "3" }',
      ].join("\n"),
      inputSchema: HoverInput.shape,
    },
    async (input) => {
      const parsed = HoverInput.parse(input);
      return runToMcp(runtime, hover(decodeRef(parsed.ref)));
    },
  );

  server.registerTool(
    "select",
    {
      title: "Select",
      description: [
        "Select an option from a <select> element by its ref. The option can be a value",
        "string or an index.",
        "",
        'Example: { "ref": "12", "option": "red" }',
      ].join("\n"),
      inputSchema: SelectInput.shape,
    },
    async (input) => {
      const parsed = SelectInput.parse(input);
      return runToMcp(runtime, select(decodeRef(parsed.ref), parsed.option));
    },
  );

  server.registerTool(
    "wait_for",
    {
      title: "Wait For",
      description: [
        "Wait for a target element or text to reach a given state.",
        "Provide exactly one of: ref, selector, aria.",
        "",
        'Example: { "selector": "button.submit", "state": "visible", "timeout": 5000 }',
        "",
        "state defaults to visible, timeout defaults to 5000ms.",
      ].join("\n"),
      inputSchema: WaitForInput.shape,
    },
    async (input) => {
      const parsed = WaitForInput.parse(input);
      const target = resolveWaitForTarget(parsed);
      if (!target) {
        return errorResponse("wait_for requires exactly one of: ref, selector, aria");
      }
      const state: WaitForState = parsed.state ?? "visible";
      return runToMcp(
        runtime,
        waitFor(target, {
          state,
          ...(parsed.timeout !== undefined && { timeout: parsed.timeout }),
        }),
      );
    },
  );
};
