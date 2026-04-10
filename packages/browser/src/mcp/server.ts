import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect, type ManagedRuntime } from "effect";
import { DevToolsClient } from "../devtools-client";
import { McpSession } from "./mcp-session";

const buildPerfAgentGuide = (): string =>
  [
    "You are a performance analysis agent. You analyze web application performance using Chrome DevTools.",
    "",
    "You validate code changes by measuring their performance impact in a real browser. Your job is to find performance regressions, measure Core Web Vitals, audit accessibility, and profile runtime behavior.",
    "",
    "<execution_strategy>",
    "All chrome-devtools tools are exposed through the perf-agent MCP server. Use them directly.",
    "",
    "Interaction workflow (snapshot-first, like a real user):",
    "1. `navigate_page` to the target URL",
    "2. `take_snapshot` to get the accessibility tree with element UIDs",
    "3. Use UIDs with input tools: `click`, `fill`, `type_text`, `press_key`, `hover`, `drag`",
    "4. These input tools use real CDP input events — they trigger INP, focus, and real event handlers",
    "",
    "Performance workflow:",
    "1. `navigate_page` to the target URL",
    "2. `performance_start_trace` with `reload=true` for cold-load profiling",
    "3. `performance_stop_trace` to get CWV metrics and insight IDs",
    "4. `performance_analyze_insight` to drill into LCPBreakdown, RenderBlocking, DocumentLatency, etc.",
    "5. For interaction profiling: start trace without reload, perform real interactions, stop trace",
    "6. Use `emulate` with cpuThrottlingRate=4 and networkConditions='Slow 3G' to test constrained conditions",
    "7. Use `take_memory_snapshot` for heap analysis",
    "</execution_strategy>",
    "",
    "<best_practices>",
    "- ALWAYS prefer input tools (click, type_text, fill) over evaluate_script for interactions",
    "- Synthetic JS events do NOT trigger INP — only real CDP input events do",
    "- Use `take_snapshot` first to find element UIDs, then pass them to input tools",
    "- For INP measurement: start a manual trace, perform real clicks/typing, stop the trace",
    "- Use `emulate` BEFORE starting traces to measure performance under realistic conditions",
    "- Check `list_console_messages` for JavaScript errors that may indicate bugs",
    "- Run Lighthouse for accessibility/SEO/best-practices — NOT for performance (use traces instead)",
    "</best_practices>",
    "",
    "<core_web_vitals>",
    "LCP < 2500ms (good), FCP < 1800ms, CLS < 0.1, INP < 200ms, TTFB < 800ms",
    "</core_web_vitals>",
  ].join("\n");

// HACK: the MCP SDK's low-level request handlers return unknown content types that tools can pass through as-is.
// We proxy chrome-devtools-mcp transparently — it already conforms to the MCP content format.
interface ProxyCallResult {
  readonly content: ReadonlyArray<unknown>;
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
}

export const createBrowserMcpServer = <E>(
  runtime: ManagedRuntime.ManagedRuntime<McpSession | DevToolsClient, E>,
) => {
  const server = new McpServer({
    name: "perf-agent",
    version: "0.1.0",
  });

  server.server.registerCapabilities({ tools: { listChanged: false } });

  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await runtime.runPromise(
      Effect.gen(function* () {
        const devtools = yield* DevToolsClient;
        return yield* devtools.listTools();
      }),
    );
    return { tools };
  });

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args: Record<string, unknown> = rawArgs ?? {};

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const devtools = yield* DevToolsClient;
        const session = yield* McpSession;

        // Intercept URL-based tools to apply base URL resolution
        const resolvedArgs = { ...args };
        if (
          (name === "navigate_page" || name === "new_page") &&
          typeof args.url === "string"
        ) {
          resolvedArgs.url = session.resolveUrl(args.url);
        }

        const callResult = yield* devtools.callTool(name, resolvedArgs);
        yield* Effect.logDebug("Proxied DevTools tool call", { tool: name });
        return callResult;
      }).pipe(Effect.withSpan(`mcp.tool.${name}`)),
    );

    const proxyResult = result as ProxyCallResult;
    return {
      content: proxyResult.content as Array<{ type: "text"; text: string }>,
      ...(proxyResult.isError !== undefined && { isError: proxyResult.isError }),
      ...(proxyResult.structuredContent !== undefined && {
        structuredContent: proxyResult.structuredContent as Record<string, unknown>,
      }),
    };
  });

  server.registerPrompt(
    "run",
    {
      description:
        "Analyze web performance in a real browser. Use after generating or modifying code to profile performance, audit accessibility, and find regressions.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildPerfAgentGuide(),
          },
        },
      ],
    }),
  );

  return { server };
};

export const startBrowserMcpServer = async <E>(
  runtime: ManagedRuntime.ManagedRuntime<McpSession | DevToolsClient, E>,
) => {
  const { server } = createBrowserMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
