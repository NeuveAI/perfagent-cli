import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { Effect, type ManagedRuntime } from "effect";
import { DevToolsClient } from "../devtools-client";
import { McpSession } from "./mcp-session";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

const extractTextContent = (result: {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
  }>;
}) => {
  const parts: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
  for (const item of result.content) {
    if (item.type === "text" && item.text) {
      parts.push({ type: "text" as const, text: item.text });
    }
    if (item.type === "image" && item.data && item.mimeType) {
      parts.push({ type: "image" as const, data: item.data, mimeType: item.mimeType });
    }
  }
  return { content: parts.length > 0 ? parts : [{ type: "text" as const, text: "OK" }] };
};

const buildPerfAgentGuide = (): string =>
  [
    "You are a performance analysis agent. You analyze web application performance using Chrome DevTools tools.",
    "",
    "You validate code changes by measuring their performance impact in a real browser. Your job is to find performance regressions, measure Core Web Vitals, audit accessibility, and profile runtime behavior.",
    "",
    "<execution_strategy>",
    "Use the perf-agent MCP tools for all browser interactions. Do NOT use other browser automation tools.",
    "",
    "Workflow:",
    "1. `navigate_page` to the target URL",
    "2. Use `take_snapshot` to understand page structure",
    "3. Use `performance_start_trace` and `performance_stop_trace` for performance profiling",
    "4. Use `performance_analyze_insight` to dig into specific performance insights",
    "5. Use `lighthouse_audit` for accessibility, SEO, and best practices",
    "6. Use `emulate` to test under constrained conditions (slow CPU, network throttling)",
    "7. Use `take_memory_snapshot` to analyze memory usage",
    "8. Use `list_network_requests` and `list_console_messages` to check for errors",
    "9. Use `close` when done",
    "</execution_strategy>",
    "",
    "<performance_tools>",
    "1. navigate_page: Navigate to a URL, or go back/forward/reload",
    "2. take_snapshot: Get accessibility tree with element UIDs (preferred for understanding page structure)",
    "3. take_screenshot: Capture page as PNG/JPEG/WebP image",
    "4. performance_start_trace: Start a performance trace (Core Web Vitals, LoAF, resource timing)",
    "5. performance_stop_trace: Stop the active trace and get results with insights",
    "6. performance_analyze_insight: Get detailed info on a specific performance insight from a trace",
    "7. emulate: Apply CPU/network throttling, viewport, geolocation, user agent emulation",
    "8. lighthouse_audit: Run Lighthouse for accessibility, SEO, best practices (not performance — use traces for that)",
    "9. take_memory_snapshot: Capture heap snapshot for memory analysis",
    "10. list_network_requests: List all network requests since last navigation",
    "11. list_console_messages: List console messages (errors, warnings, logs)",
    "12. evaluate_script: Execute JavaScript in the page context",
    "13. close: Close the DevTools session and browser",
    "</performance_tools>",
    "",
    "<best_practices>",
    "- Always start with `navigate_page` to ensure you are on the correct URL before tracing",
    "- Use `performance_start_trace` with reload=true for cold-load profiling",
    "- Use `performance_start_trace` with reload=false for interaction profiling",
    "- After a trace, use `performance_analyze_insight` to investigate specific insights",
    "- Use `emulate` with cpuThrottlingRate=4 to simulate mid-tier mobile devices",
    "- Use `emulate` with networkConditions='Slow 3G' to test under poor network conditions",
    "- Check `list_console_messages` for JavaScript errors that may indicate bugs",
    "- Use `take_memory_snapshot` before and after interactions to detect memory leaks",
    "</best_practices>",
  ].join("\n");

// HACK: tool annotations (readOnlyHint, destructiveHint) are required for parallel execution in the Claude Agent SDK
export const createBrowserMcpServer = <E>(
  runtime: ManagedRuntime.ManagedRuntime<McpSession | DevToolsClient, E>,
) => {
  const runMcp = <A>(effect: Effect.Effect<A, unknown, McpSession | DevToolsClient>) =>
    runtime.runPromise(effect);

  const server = new McpServer({
    name: "perf-agent",
    version: "0.0.1",
  });

  const navigatePageTool = server.registerTool(
    "navigate_page",
    {
      title: "Navigate Page",
      description:
        "Navigate to a URL, or go back, forward, or reload the page.",
      inputSchema: {
        url: z.string().optional().describe("Target URL (required for type=url)"),
        type: z
          .enum(["url", "back", "forward", "reload"])
          .optional()
          .describe("Navigation type (default: url)"),
        ignoreCache: z
          .boolean()
          .optional()
          .describe("Whether to ignore cache on reload"),
      },
    },
    ({ url, type, ignoreCache }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const session = yield* McpSession;
          const resolvedUrl = url ? session.resolveUrl(url) : undefined;
          const args: Record<string, unknown> = {};
          if (resolvedUrl) args.url = resolvedUrl;
          if (type) args.type = type;
          if (ignoreCache !== undefined) args.ignoreCache = ignoreCache;
          const result = yield* devtools.callTool("navigate_page", args);
          yield* Effect.logInfo("Page navigated", { url: resolvedUrl, type });
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.navigate_page")),
      ),
  );

  const takeSnapshotTool = server.registerTool(
    "take_snapshot",
    {
      title: "Take Snapshot",
      description:
        "Take a text snapshot of the page based on the accessibility tree. Lists page elements with unique identifiers (UIDs). Prefer snapshot over screenshot for understanding page structure.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        verbose: z
          .boolean()
          .optional()
          .describe("Include all available a11y tree information (default: false)"),
        filePath: z
          .string()
          .optional()
          .describe("Save snapshot to file instead of returning in response"),
      },
    },
    ({ verbose, filePath }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (verbose !== undefined) args.verbose = verbose;
          if (filePath) args.filePath = filePath;
          const result = yield* devtools.callTool("take_snapshot", args);
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.take_snapshot")),
      ),
  );

  const takeScreenshotTool = server.registerTool(
    "take_screenshot",
    {
      title: "Take Screenshot",
      description: "Take a screenshot of the page or element.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        format: z
          .enum(["png", "jpeg", "webp"])
          .optional()
          .describe("Image format (default: png)"),
        quality: z
          .number()
          .optional()
          .describe("Image quality 0-100 (for jpeg/webp)"),
        filePath: z
          .string()
          .optional()
          .describe("Save screenshot to file"),
      },
    },
    ({ format, quality, filePath }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (format) args.format = format;
          if (quality !== undefined) args.quality = quality;
          if (filePath) args.filePath = filePath;
          const result = yield* devtools.callTool("take_screenshot", args);
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.take_screenshot")),
      ),
  );

  const startTraceTool = server.registerTool(
    "performance_start_trace",
    {
      title: "Start Performance Trace",
      description:
        "Start a performance trace on the selected page. Use to find frontend performance issues, Core Web Vitals (LCP, INP, CLS), and improve page load speed. Navigate to the correct URL BEFORE starting the trace if reload or autoStop is true.",
      inputSchema: {
        reload: z
          .boolean()
          .optional()
          .describe("Reload the page after starting trace (default: true)"),
        autoStop: z
          .boolean()
          .optional()
          .describe("Automatically stop the trace after recording (default: true)"),
        filePath: z
          .string()
          .optional()
          .describe("Save raw trace data to file (e.g. trace.json.gz)"),
      },
    },
    ({ reload, autoStop, filePath }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (reload !== undefined) args.reload = reload;
          if (autoStop !== undefined) args.autoStop = autoStop;
          if (filePath) args.filePath = filePath;
          const result = yield* devtools.callTool("performance_start_trace", args);
          yield* Effect.logInfo("Performance trace started", { reload, autoStop });
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.performance_start_trace")),
      ),
  );

  const stopTraceTool = server.registerTool(
    "performance_stop_trace",
    {
      title: "Stop Performance Trace",
      description: "Stop the active performance trace recording.",
      inputSchema: {
        filePath: z
          .string()
          .optional()
          .describe("Save raw trace data to file (e.g. trace.json.gz)"),
      },
    },
    ({ filePath }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (filePath) args.filePath = filePath;
          const result = yield* devtools.callTool("performance_stop_trace", args);
          yield* Effect.logInfo("Performance trace stopped");
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.performance_stop_trace")),
      ),
  );

  const analyzeInsightTool = server.registerTool(
    "performance_analyze_insight",
    {
      title: "Analyze Performance Insight",
      description:
        "Get detailed information on a specific Performance Insight from a trace recording. Use the insight set IDs and insight names from trace results.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        insightSetId: z
          .string()
          .describe("The ID for the insight set from the trace results"),
        insightName: z
          .string()
          .describe('The name of the insight (e.g. "DocumentLatency", "LCPBreakdown")'),
      },
    },
    ({ insightSetId, insightName }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const result = yield* devtools.callTool("performance_analyze_insight", {
            insightSetId,
            insightName,
          });
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.performance_analyze_insight")),
      ),
  );

  const emulateTool = server.registerTool(
    "emulate",
    {
      title: "Emulate",
      description:
        "Emulate various conditions: CPU throttling, network throttling, viewport size, geolocation, user agent, and more.",
      inputSchema: {
        networkConditions: z
          .string()
          .optional()
          .describe("Network throttling preset (e.g. 'Slow 3G', 'Fast 3G', 'Offline')"),
        cpuThrottlingRate: z
          .number()
          .optional()
          .describe("CPU slowdown factor (1-20). 1 = no throttling"),
        viewport: z
          .string()
          .optional()
          .describe("Viewport dimensions as 'WIDTHxHEIGHT' (e.g. '375x812')"),
        userAgent: z
          .string()
          .optional()
          .describe("User agent string to emulate"),
        geolocation: z
          .string()
          .optional()
          .describe("Geolocation as 'LAT,LNG' (e.g. '37.7749,-122.4194')"),
      },
    },
    ({ networkConditions, cpuThrottlingRate, viewport, userAgent, geolocation }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (networkConditions) args.networkConditions = networkConditions;
          if (cpuThrottlingRate !== undefined) args.cpuThrottlingRate = cpuThrottlingRate;
          if (viewport) args.viewport = viewport;
          if (userAgent) args.userAgent = userAgent;
          if (geolocation) args.geolocation = geolocation;
          const result = yield* devtools.callTool("emulate", args);
          yield* Effect.logInfo("Emulation applied", args);
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.emulate")),
      ),
  );

  const lighthouseAuditTool = server.registerTool(
    "lighthouse_audit",
    {
      title: "Lighthouse Audit",
      description:
        "Run Lighthouse audit for accessibility, SEO, and best practices. For performance analysis, use performance_start_trace instead.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        mode: z
          .enum(["navigation", "snapshot"])
          .optional()
          .describe("'navigation' reloads & audits, 'snapshot' analyzes current state (default: navigation)"),
        device: z
          .enum(["desktop", "mobile"])
          .optional()
          .describe("Device to emulate (default: desktop)"),
        outputDirPath: z
          .string()
          .optional()
          .describe("Directory for report output"),
      },
    },
    ({ mode, device, outputDirPath }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (mode) args.mode = mode;
          if (device) args.device = device;
          if (outputDirPath) args.outputDirPath = outputDirPath;
          const result = yield* devtools.callTool("lighthouse_audit", args);
          yield* Effect.logInfo("Lighthouse audit completed", { mode, device });
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.lighthouse_audit")),
      ),
  );

  const takeMemorySnapshotTool = server.registerTool(
    "take_memory_snapshot",
    {
      title: "Take Memory Snapshot",
      description:
        "Capture a heap snapshot of the page. Use to analyze memory distribution and debug memory leaks.",
      inputSchema: {
        filePath: z
          .string()
          .describe("Path to save the .heapsnapshot file"),
      },
    },
    ({ filePath }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const result = yield* devtools.callTool("take_memory_snapshot", { filePath });
          yield* Effect.logInfo("Memory snapshot captured", { filePath });
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.take_memory_snapshot")),
      ),
  );

  const listNetworkRequestsTool = server.registerTool(
    "list_network_requests",
    {
      title: "List Network Requests",
      description: "List all network requests for the current page since the last navigation.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        resourceType: z
          .string()
          .optional()
          .describe("Filter by resource type (e.g. 'fetch', 'xhr', 'script', 'document')"),
      },
    },
    ({ resourceType }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (resourceType) args.resourceType = resourceType;
          const result = yield* devtools.callTool("list_network_requests", args);
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.list_network_requests")),
      ),
  );

  const listConsoleMessagesTool = server.registerTool(
    "list_console_messages",
    {
      title: "List Console Messages",
      description: "List console messages (errors, warnings, logs) from the page.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: z
          .string()
          .optional()
          .describe("Filter by message type (e.g. 'error', 'warn', 'log')"),
      },
    },
    ({ type }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const args: Record<string, unknown> = {};
          if (type) args.type = type;
          const result = yield* devtools.callTool("list_console_messages", args);
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.list_console_messages")),
      ),
  );

  const evaluateScriptTool = server.registerTool(
    "evaluate_script",
    {
      title: "Evaluate Script",
      description:
        "Evaluate a JavaScript function in the page context. Returns the result as JSON. The function must be JSON-serializable.",
      inputSchema: {
        function: z
          .string()
          .describe(
            'JavaScript function to execute (e.g. \'() => document.title\' or \'(el) => el.innerText\')',
          ),
        args: z
          .array(z.string())
          .optional()
          .describe("CSS selectors for element arguments to pass to the function"),
      },
    },
    ({ function: functionBody, args }) =>
      runMcp(
        Effect.gen(function* () {
          const devtools = yield* DevToolsClient;
          const toolArgs: Record<string, unknown> = { function: functionBody };
          if (args) toolArgs.args = args;
          const result = yield* devtools.callTool("evaluate_script", toolArgs);
          return extractTextContent(result);
        }).pipe(Effect.withSpan("mcp.tool.evaluate_script")),
      ),
  );

  const closeTool = server.registerTool(
    "close",
    {
      title: "Close",
      description: "Close the DevTools session and browser.",
      annotations: { destructiveHint: true },
      inputSchema: {},
    },
    () =>
      runMcp(
        Effect.gen(function* () {
          const session = yield* McpSession;
          yield* session.close();
          yield* Effect.logInfo("DevTools session closed");
          return textResult("DevTools session closed.");
        }).pipe(Effect.withSpan("mcp.tool.close")),
      ),
  );

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

  const tools = {
    navigate_page: navigatePageTool,
    take_snapshot: takeSnapshotTool,
    take_screenshot: takeScreenshotTool,
    performance_start_trace: startTraceTool,
    performance_stop_trace: stopTraceTool,
    performance_analyze_insight: analyzeInsightTool,
    emulate: emulateTool,
    lighthouse_audit: lighthouseAuditTool,
    take_memory_snapshot: takeMemorySnapshotTool,
    list_network_requests: listNetworkRequestsTool,
    list_console_messages: listConsoleMessagesTool,
    evaluate_script: evaluateScriptTool,
    close: closeTool,
  };

  return { server, tools };
};

export type BrowserToolMap = ReturnType<typeof createBrowserMcpServer>["tools"];

export const startBrowserMcpServer = async <E>(
  runtime: ManagedRuntime.ManagedRuntime<McpSession | DevToolsClient, E>,
) => {
  const { server } = createBrowserMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
