import { Effect, Layer, ServiceMap } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DevToolsConnectionError, DevToolsToolError } from "./errors";

interface CallToolResult {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
  }>;
  readonly isError?: boolean;
}

export class DevToolsClient extends ServiceMap.Service<DevToolsClient>()(
  "@devtools/DevToolsClient",
  {
    make: Effect.gen(function* () {
      const transport = new StdioClientTransport({
        command: "npx",
        args: ["chrome-devtools-mcp@0.21.0", "--headless"],
      });

      const client = new Client({
        name: "neuve-devtools",
        version: "0.1.0",
      });

      yield* Effect.tryPromise({
        try: () => client.connect(transport),
        catch: (cause) =>
          new DevToolsConnectionError({
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      yield* Effect.logInfo("DevTools MCP client connected");

      const callTool = Effect.fn("DevToolsClient.callTool")(function* (
        toolName: string,
        args: Record<string, unknown> = {},
      ) {
        yield* Effect.annotateCurrentSpan({ tool: toolName });
        yield* Effect.logDebug("Calling DevTools tool", { tool: toolName, args });

        const result = yield* Effect.tryPromise({
          try: () => client.callTool({ name: toolName, arguments: args }),
          catch: (cause) =>
            new DevToolsToolError({
              tool: toolName,
              cause: cause instanceof Error ? cause.message : String(cause),
            }),
        });

        const typedResult = result as CallToolResult;
        if (typedResult.isError) {
          const errorText =
            typedResult.content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n") || "Unknown error";
          return yield* new DevToolsToolError({ tool: toolName, cause: errorText });
        }

        return typedResult;
      });

      const navigate = Effect.fn("DevToolsClient.navigate")(function* (
        url: string,
        options: { type?: string } = {},
      ) {
        return yield* callTool("navigate_page", { url, type: options.type ?? "url" });
      });

      const startTrace = Effect.fn("DevToolsClient.startTrace")(function* (
        options: { reload?: boolean; autoStop?: boolean; filePath?: string } = {},
      ) {
        return yield* callTool("performance_start_trace", options);
      });

      const stopTrace = Effect.fn("DevToolsClient.stopTrace")(function* (
        options: { filePath?: string } = {},
      ) {
        return yield* callTool("performance_stop_trace", options);
      });

      const analyzeInsight = Effect.fn("DevToolsClient.analyzeInsight")(function* (
        insightSetId: string,
        insightName: string,
      ) {
        return yield* callTool("performance_analyze_insight", { insightSetId, insightName });
      });

      const takeScreenshot = Effect.fn("DevToolsClient.takeScreenshot")(function* (
        options: { format?: string; quality?: number; filePath?: string } = {},
      ) {
        return yield* callTool("take_screenshot", options);
      });

      const takeSnapshot = Effect.fn("DevToolsClient.takeSnapshot")(function* (
        options: { verbose?: boolean; filePath?: string } = {},
      ) {
        return yield* callTool("take_snapshot", options);
      });

      const emulate = Effect.fn("DevToolsClient.emulate")(function* (
        options: Record<string, unknown>,
      ) {
        return yield* callTool("emulate", options);
      });

      const takeMemorySnapshot = Effect.fn("DevToolsClient.takeMemorySnapshot")(function* (
        filePath: string,
      ) {
        return yield* callTool("take_memory_snapshot", { filePath });
      });

      const lighthouseAudit = Effect.fn("DevToolsClient.lighthouseAudit")(function* (
        options: { mode?: string; device?: string; outputDirPath?: string } = {},
      ) {
        return yield* callTool("lighthouse_audit", options);
      });

      const evaluateScript = Effect.fn("DevToolsClient.evaluateScript")(function* (
        functionBody: string,
        args?: unknown[],
      ) {
        const params: Record<string, unknown> = { function: functionBody };
        if (args) {
          params.args = args;
        }
        return yield* callTool("evaluate_script", params);
      });

      const listNetworkRequests = Effect.fn("DevToolsClient.listNetworkRequests")(function* (
        options: { resourceType?: string } = {},
      ) {
        return yield* callTool("list_network_requests", options);
      });

      const listConsoleMessages = Effect.fn("DevToolsClient.listConsoleMessages")(function* (
        options: { type?: string } = {},
      ) {
        return yield* callTool("list_console_messages", options);
      });

      const closePage = Effect.fn("DevToolsClient.closePage")(function* (
        options: { pageId?: string } = {},
      ) {
        return yield* callTool("close_page", options);
      });

      const disconnect = Effect.fn("DevToolsClient.disconnect")(function* () {
        yield* Effect.tryPromise({
          try: () => client.close(),
          catch: (cause) =>
            new DevToolsConnectionError({
              cause: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        yield* Effect.logInfo("DevTools MCP client disconnected");
      });

      return {
        callTool,
        navigate,
        startTrace,
        stopTrace,
        analyzeInsight,
        takeScreenshot,
        takeSnapshot,
        emulate,
        takeMemorySnapshot,
        lighthouseAudit,
        evaluateScript,
        listNetworkRequests,
        listConsoleMessages,
        closePage,
      } as const;
    }),
  },
) {
  static layer = Layer.effect(this)(this.make);
}
