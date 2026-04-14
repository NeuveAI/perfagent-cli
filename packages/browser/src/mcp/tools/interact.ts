import { z } from "zod/v4";
import { Effect, type ManagedRuntime } from "effect";
import { DevToolsClient } from "../../devtools-client";
import { McpSession } from "../mcp-session";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const InteractAction = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("navigate"),
    url: z.string().optional(),
    direction: z
      .enum(["url", "back", "forward", "reload"])
      .optional()
      .default("url"),
    ignoreCache: z.boolean().optional(),
    handleBeforeUnload: z.enum(["accept", "decline"]).optional(),
    initScript: z.string().optional(),
    timeout: z.number().int().optional(),
  }),
  z.object({
    command: z.literal("click"),
    uid: z.string(),
    double: z.boolean().optional(),
    includeSnapshot: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("type"),
    text: z.string(),
    submitKey: z.string().optional(),
  }),
  z.object({
    command: z.literal("fill"),
    uid: z.string(),
    value: z.string(),
    includeSnapshot: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("press_key"),
    key: z.string(),
    includeSnapshot: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("hover"),
    uid: z.string(),
    includeSnapshot: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("drag"),
    fromUid: z.string(),
    toUid: z.string(),
    includeSnapshot: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("fill_form"),
    elements: z.array(z.object({ uid: z.string(), value: z.string() })),
    includeSnapshot: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("upload_file"),
    uid: z.string(),
    filePath: z.string(),
    includeSnapshot: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("handle_dialog"),
    accept: z.boolean(),
    promptText: z.string().optional(),
  }),
  z.object({
    command: z.literal("wait_for"),
    text: z.array(z.string()).min(1),
    timeout: z.number().int().optional(),
  }),
  z.object({
    command: z.literal("resize"),
    width: z.number(),
    height: z.number(),
  }),
  z.object({
    command: z.literal("new_tab"),
    url: z.string(),
    background: z.boolean().optional(),
    isolatedContext: z.string().optional(),
    timeout: z.number().int().optional(),
  }),
  z.object({
    command: z.literal("switch_tab"),
    pageId: z.number(),
    bringToFront: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("close_tab"),
    pageId: z.number(),
  }),
]);

type InteractAction = z.infer<typeof InteractAction>;

export const registerInteractTool = <E>(
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<McpSession | DevToolsClient, E>,
) => {
  server.registerTool(
    "interact",
    {
      title: "Interact",
      description: [
        'Call shape: { "action": { "command": "<name>", ...args } }',
        "",
        "Examples:",
        '  { "action": { "command": "navigate", "url": "https://example.com" } }',
        '  { "action": { "command": "click", "uid": "abc123" } }',
        '  { "action": { "command": "fill", "uid": "abc123", "value": "hello" } }',
        '  { "action": { "command": "wait_for", "text": ["ready"], "timeout": 5000 } }',
        "",
        "Commands: navigate, click, type, fill, press_key, hover, drag, fill_form,",
        "upload_file, handle_dialog, wait_for, resize, new_tab, switch_tab, close_tab.",
        "",
        "Perform user-like interactions on the page using real CDP input events.",
        "These trigger real browser behavior (INP, focus, event handlers) — unlike evaluate_script which uses synthetic JS events.",
        "",
        "Use `observe snapshot` first to discover element UIDs, then pass them to click, fill, hover, etc.",
      ].join("\n"),
      inputSchema: { action: InteractAction },
    },
    async ({ action }) => {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const session = yield* McpSession;

          switch (action.command) {
            case "navigate":
              return yield* devtools.callTool("navigate_page", {
                url: action.url
                  ? session.resolveUrl(action.url)
                  : undefined,
                type: action.direction,
                ...(action.ignoreCache !== undefined && {
                  ignoreCache: action.ignoreCache,
                }),
                ...(action.handleBeforeUnload !== undefined && {
                  handleBeforeUnload: action.handleBeforeUnload,
                }),
                ...(action.initScript !== undefined && {
                  initScript: action.initScript,
                }),
                ...(action.timeout !== undefined && {
                  timeout: action.timeout,
                }),
              });
            case "click":
              return yield* devtools.callTool("click", {
                uid: action.uid,
                ...(action.double !== undefined && {
                  dblClick: action.double,
                }),
                ...(action.includeSnapshot !== undefined && {
                  includeSnapshot: action.includeSnapshot,
                }),
              });
            case "type":
              return yield* devtools.callTool("type_text", {
                text: action.text,
                ...(action.submitKey !== undefined && {
                  submitKey: action.submitKey,
                }),
              });
            case "fill":
              return yield* devtools.callTool("fill", {
                uid: action.uid,
                value: action.value,
                ...(action.includeSnapshot !== undefined && {
                  includeSnapshot: action.includeSnapshot,
                }),
              });
            case "press_key":
              return yield* devtools.callTool("press_key", {
                key: action.key,
                ...(action.includeSnapshot !== undefined && {
                  includeSnapshot: action.includeSnapshot,
                }),
              });
            case "hover":
              return yield* devtools.callTool("hover", {
                uid: action.uid,
                ...(action.includeSnapshot !== undefined && {
                  includeSnapshot: action.includeSnapshot,
                }),
              });
            case "drag":
              return yield* devtools.callTool("drag", {
                from_uid: action.fromUid,
                to_uid: action.toUid,
                ...(action.includeSnapshot !== undefined && {
                  includeSnapshot: action.includeSnapshot,
                }),
              });
            case "fill_form":
              return yield* devtools.callTool("fill_form", {
                elements: action.elements,
                ...(action.includeSnapshot !== undefined && {
                  includeSnapshot: action.includeSnapshot,
                }),
              });
            case "upload_file":
              return yield* devtools.callTool("upload_file", {
                uid: action.uid,
                filePath: action.filePath,
                ...(action.includeSnapshot !== undefined && {
                  includeSnapshot: action.includeSnapshot,
                }),
              });
            case "handle_dialog":
              return yield* devtools.callTool("handle_dialog", {
                action: action.accept ? "accept" : "dismiss",
                ...(action.promptText !== undefined && {
                  promptText: action.promptText,
                }),
              });
            case "wait_for":
              return yield* devtools.callTool("wait_for", {
                text: action.text,
                ...(action.timeout !== undefined && {
                  timeout: action.timeout,
                }),
              });
            case "resize":
              return yield* devtools.callTool("resize_page", {
                width: action.width,
                height: action.height,
              });
            case "new_tab":
              return yield* devtools.callTool("new_page", {
                url: session.resolveUrl(action.url),
                ...(action.background !== undefined && {
                  background: action.background,
                }),
                ...(action.isolatedContext !== undefined && {
                  isolatedContext: action.isolatedContext,
                }),
                ...(action.timeout !== undefined && {
                  timeout: action.timeout,
                }),
              });
            case "switch_tab":
              return yield* devtools.callTool("select_page", {
                pageId: action.pageId,
                ...(action.bringToFront !== undefined && {
                  bringToFront: action.bringToFront,
                }),
              });
            case "close_tab":
              return yield* devtools.callTool("close_page", {
                pageId: action.pageId,
              });
          }
        }).pipe(
          Effect.tap(() =>
            Effect.logDebug("interact dispatch complete", {
              command: action.command,
            }),
          ),
          Effect.withSpan(`interact.${action.command}`),
        ),
      );

      return result as {
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      };
    },
  );
};
