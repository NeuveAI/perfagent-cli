import { z } from "zod/v4";
import { Effect, type ManagedRuntime } from "effect";
import { DevToolsClient } from "../../devtools-client";
import { McpSession } from "../mcp-session";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TraceAction = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("start"),
    reload: z.boolean().optional().default(true),
    autoStop: z.boolean().optional().default(true),
    filePath: z.string().optional(),
  }),
  z.object({
    command: z.literal("stop"),
    filePath: z.string().optional(),
  }),
  z.object({
    command: z.literal("analyze"),
    insightSetId: z.string(),
    insightName: z.string(),
  }),
  z.object({
    command: z.literal("memory"),
    filePath: z.string(),
  }),
  z.object({
    command: z.literal("lighthouse"),
    mode: z.enum(["navigation", "snapshot"]).optional(),
    device: z.enum(["desktop", "mobile"]).optional(),
    outputDirPath: z.string().optional(),
  }),
  z.object({
    command: z.literal("emulate"),
    cpuThrottling: z.number().min(1).max(20).optional(),
    network: z
      .enum(["Offline", "Slow 3G", "Fast 3G", "Slow 4G", "4G"])
      .optional(),
    viewport: z.string().optional(),
    colorScheme: z.enum(["dark", "light", "auto"]).optional(),
    geolocation: z.string().optional(),
    userAgent: z.string().optional(),
  }),
]);

type TraceAction = z.infer<typeof TraceAction>;

interface CallToolResultLike {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
  }>;
  readonly isError?: boolean;
}

const rewriteStartAck = (result: CallToolResultLike): CallToolResultLike => {
  const rewrittenContent = result.content.map((item) => {
    if (item.type !== "text" || item.text === undefined) return item;
    if (!item.text.includes("performance_stop_trace")) return item;
    return {
      ...item,
      text: item.text.replaceAll(
        "performance_stop_trace",
        'trace with command="stop"',
      ),
    };
  });
  return { ...result, content: rewrittenContent };
};

export const registerTraceTool = <E>(
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<McpSession | DevToolsClient, E>,
) => {
  server.registerTool(
    "trace",
    {
      title: "Trace",
      description: [
        'Call shape: { "action": { "command": "<name>", ...args } }',
        "",
        "Cold-load profiling is one-shot: call `start` with `reload: true, autoStop: true` to record -> auto-stop -> return CWV + insights in a single response.",
        "Manual profiling (INP / interactions): call `start` with `reload: false, autoStop: false`, then perform user actions via `interact`, then call `stop`.",
        "",
        "Examples:",
        '  { "action": { "command": "start", "reload": true, "autoStop": true } }   # cold-load, one-shot',
        '  { "action": { "command": "stop" } }                                       # manual profiling only',
        '  { "action": { "command": "analyze", "insightSetId": "NAVIGATION_0", "insightName": "LCPBreakdown" } }',
        '  { "action": { "command": "emulate", "cpuThrottling": 4, "network": "Slow 3G" } }',
        "",
        "Commands: start, stop, analyze, memory, lighthouse, emulate.",
        "",
        "Performance profiling and analysis.",
        "",
        "Workflow: `emulate` (optional throttling) -> `start` (begins trace; for cold-load pass reload=true, autoStop=true) ->",
        "`analyze` (drill into specific insights like LCPBreakdown, RenderBlocking, DocumentLatency).",
        "",
        "For interaction profiling: start with reload=false, autoStop=false, perform real interactions via `interact`,",
        "then call `stop` to capture INP and other interaction metrics.",
        "Use `memory` for heap snapshots to detect memory leaks.",
        "Use `lighthouse` for accessibility, SEO, and best-practices audits (NOT for performance — use traces).",
      ].join("\n"),
      inputSchema: { action: TraceAction },
    },
    async ({ action }) => {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;

          switch (action.command) {
            case "start": {
              const startResult = yield* devtools.callTool(
                "performance_start_trace",
                {
                  reload: action.reload,
                  autoStop: action.autoStop,
                  ...(action.filePath !== undefined && {
                    filePath: action.filePath,
                  }),
                },
              );
              return rewriteStartAck(startResult);
            }
            case "stop":
              return yield* devtools.callTool("performance_stop_trace", {
                ...(action.filePath !== undefined && {
                  filePath: action.filePath,
                }),
              });
            case "analyze":
              return yield* devtools.callTool(
                "performance_analyze_insight",
                {
                  insightSetId: action.insightSetId,
                  insightName: action.insightName,
                },
              );
            case "memory":
              return yield* devtools.callTool("take_memory_snapshot", {
                filePath: action.filePath,
              });
            case "lighthouse":
              return yield* devtools.callTool("lighthouse_audit", {
                ...(action.mode !== undefined && { mode: action.mode }),
                ...(action.device !== undefined && {
                  device: action.device,
                }),
                ...(action.outputDirPath !== undefined && {
                  outputDirPath: action.outputDirPath,
                }),
              });
            case "emulate":
              return yield* devtools.callTool("emulate", {
                ...(action.cpuThrottling !== undefined && {
                  cpuThrottlingRate: action.cpuThrottling,
                }),
                ...(action.network !== undefined && {
                  networkConditions: action.network,
                }),
                ...(action.viewport !== undefined && {
                  viewport: action.viewport,
                }),
                ...(action.colorScheme !== undefined && {
                  colorScheme: action.colorScheme,
                }),
                ...(action.geolocation !== undefined && {
                  geolocation: action.geolocation,
                }),
                ...(action.userAgent !== undefined && {
                  userAgent: action.userAgent,
                }),
              });
          }
        }).pipe(
          Effect.tap(() =>
            Effect.logDebug("trace dispatch complete", {
              command: action.command,
            }),
          ),
          Effect.withSpan(`trace.${action.command}`),
        ),
      );

      return result as {
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      };
    },
  );
};
