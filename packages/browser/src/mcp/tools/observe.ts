import { z } from "zod/v4";
import { Effect, type ManagedRuntime } from "effect";
import { DevToolsClient } from "../../devtools-client";
import { McpSession } from "../mcp-session";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ConsoleMessageType = z.enum([
  "log",
  "debug",
  "info",
  "error",
  "warn",
  "dir",
  "dirxml",
  "table",
  "trace",
  "clear",
  "startGroup",
  "startGroupCollapsed",
  "endGroup",
  "assert",
  "profile",
  "profileEnd",
  "count",
  "timeEnd",
  "verbose",
  "issue",
]);

const NetworkResourceType = z.enum([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "xhr",
  "fetch",
  "prefetch",
  "eventsource",
  "websocket",
  "manifest",
  "signedexchange",
  "ping",
  "cspviolationreport",
  "preflight",
  "fedcm",
  "other",
]);

const ObserveAction = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("snapshot"),
    verbose: z.boolean().optional(),
    filePath: z.string().optional(),
  }),
  z.object({
    command: z.literal("screenshot"),
    format: z.enum(["png", "jpeg", "webp"]).optional(),
    quality: z.number().min(0).max(100).optional(),
    uid: z.string().optional(),
    fullPage: z.boolean().optional(),
    filePath: z.string().optional(),
  }),
  z.object({
    command: z.literal("console"),
    msgid: z.number().optional(),
    types: z.array(ConsoleMessageType).optional(),
    pageSize: z.number().int().positive().optional(),
    pageIdx: z.number().int().min(0).optional(),
    includePreservedMessages: z.boolean().optional(),
  }),
  z.object({
    command: z.literal("network"),
    reqid: z.number().optional(),
    resourceTypes: z.array(NetworkResourceType).optional(),
    pageSize: z.number().int().positive().optional(),
    pageIdx: z.number().int().min(0).optional(),
    includePreservedRequests: z.boolean().optional(),
    requestFilePath: z.string().optional(),
    responseFilePath: z.string().optional(),
  }),
  z.object({
    command: z.literal("pages"),
  }),
  z.object({
    command: z.literal("evaluate"),
    function: z.string(),
    args: z.array(z.string()).optional(),
  }),
]);

type ObserveAction = z.infer<typeof ObserveAction>;

export const registerObserveTool = <E>(
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<McpSession | DevToolsClient, E>,
) => {
  server.registerTool(
    "observe",
    {
      title: "Observe",
      description: [
        "Read page state without side effects.",
        "",
        "Commands: snapshot, screenshot, console, network, pages, evaluate.",
        "",
        "Use `snapshot` to get the accessibility tree with element UIDs — this is the primary way",
        "to discover elements before interacting with them via the `interact` tool.",
        "Use `screenshot` for visual inspection. Use `console` and `network` to inspect logs and requests.",
        "Use `evaluate` only when no other tool covers your need — prefer real interactions via `interact`.",
      ].join("\n"),
      inputSchema: { action: ObserveAction },
    },
    async ({ action }) => {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;

          switch (action.command) {
            case "snapshot":
              return yield* devtools.callTool("take_snapshot", {
                ...(action.verbose !== undefined && {
                  verbose: action.verbose,
                }),
                ...(action.filePath !== undefined && {
                  filePath: action.filePath,
                }),
              });
            case "screenshot":
              return yield* devtools.callTool("take_screenshot", {
                ...(action.format !== undefined && {
                  format: action.format,
                }),
                ...(action.quality !== undefined && {
                  quality: action.quality,
                }),
                ...(action.uid !== undefined && { uid: action.uid }),
                ...(action.fullPage !== undefined && {
                  fullPage: action.fullPage,
                }),
                ...(action.filePath !== undefined && {
                  filePath: action.filePath,
                }),
              });
            case "console":
              if (action.msgid !== undefined) {
                return yield* devtools.callTool("get_console_message", {
                  msgid: action.msgid,
                });
              }
              return yield* devtools.callTool("list_console_messages", {
                ...(action.types !== undefined && { types: action.types }),
                ...(action.pageSize !== undefined && {
                  pageSize: action.pageSize,
                }),
                ...(action.pageIdx !== undefined && {
                  pageIdx: action.pageIdx,
                }),
                ...(action.includePreservedMessages !== undefined && {
                  includePreservedMessages: action.includePreservedMessages,
                }),
              });
            case "network":
              if (action.reqid !== undefined) {
                return yield* devtools.callTool("get_network_request", {
                  reqid: action.reqid,
                  ...(action.requestFilePath !== undefined && {
                    requestFilePath: action.requestFilePath,
                  }),
                  ...(action.responseFilePath !== undefined && {
                    responseFilePath: action.responseFilePath,
                  }),
                });
              }
              return yield* devtools.callTool("list_network_requests", {
                ...(action.resourceTypes !== undefined && {
                  resourceTypes: action.resourceTypes,
                }),
                ...(action.pageSize !== undefined && {
                  pageSize: action.pageSize,
                }),
                ...(action.pageIdx !== undefined && {
                  pageIdx: action.pageIdx,
                }),
                ...(action.includePreservedRequests !== undefined && {
                  includePreservedRequests: action.includePreservedRequests,
                }),
              });
            case "pages":
              return yield* devtools.callTool("list_pages", {});
            case "evaluate":
              return yield* devtools.callTool("evaluate_script", {
                function: action.function,
                ...(action.args !== undefined && { args: action.args }),
              });
          }
        }).pipe(
          Effect.tap(() =>
            Effect.logDebug("observe dispatch complete", {
              command: action.command,
            }),
          ),
          Effect.withSpan(`observe.${action.command}`),
        ),
      );

      return result as {
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      };
    },
  );
};
