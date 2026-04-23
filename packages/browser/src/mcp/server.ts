import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type ManagedRuntime } from "effect";
import { DevToolsClient } from "../devtools-client";
import { NetworkIdleSampler, RefResolver, SnapshotTaker, WaitForEngine } from "../tools/types";
import { McpSession } from "./mcp-session";
import { registerInteractTool } from "./tools/interact";
import { registerInteractionTools } from "./tools/interactions";
import { registerObserveTool } from "./tools/observe";
import { registerTraceTool } from "./tools/trace";

const buildPerfAgentGuide = (): string =>
  [
    "You are a performance analysis agent. You analyze web application performance using Chrome DevTools.",
    "",
    "You validate code changes by measuring their performance impact in a real browser. Your job is to find performance regressions, measure Core Web Vitals, audit accessibility, and profile runtime behavior.",
    "",
    "You have 3 tools: `interact`, `observe`, and `trace`. Each accepts an `action` object with a `command` field that determines the operation.",
    "",
    "<tools>",
    "## interact — mutate page state via real CDP input",
    "Real browser input events that trigger INP, focus, and event handlers (unlike evaluate_script).",
    "- navigate: go to URL, back, forward, reload",
    "- click: click element by UID (supports double-click)",
    "- type: type text into focused element",
    "- fill: fill input by UID with value",
    "- press_key: press a keyboard key",
    "- hover: hover over element by UID",
    "- drag: drag from one element to another",
    "- fill_form: fill multiple form fields at once",
    "- upload_file: upload file to input by UID",
    "- handle_dialog: accept/dismiss browser dialogs",
    "- wait_for: wait for text to appear on page",
    "- resize: resize the viewport",
    "- new_tab: open URL in new tab",
    "- switch_tab / close_tab: manage tabs by pageId",
    "",
    "## observe — read page state (no side effects)",
    "- snapshot: accessibility tree with element UIDs (primary way to discover elements)",
    "- screenshot: visual capture (png/jpeg/webp, element or full page)",
    "- console: list or get console messages",
    "- network: list or get network requests",
    "- pages: list open pages",
    "- evaluate: run JS function (prefer interact for user actions)",
    "",
    "## trace — performance profiling and analysis",
    "- start: begin performance trace (reload=true for cold-load)",
    "- stop: end trace, returns CWV summary + insight IDs",
    "- analyze: drill into a specific insight (LCPBreakdown, RenderBlocking, etc.)",
    "- memory: heap snapshot for leak detection",
    "- lighthouse: a11y/SEO/best-practices audit (NOT for performance)",
    "- emulate: CPU throttling, network conditions, viewport, color scheme",
    "</tools>",
    "",
    "<execution_strategy>",
    "Interaction workflow (snapshot-first, like a real user):",
    "1. `interact navigate` to the target URL",
    "2. `observe snapshot` to get the accessibility tree with element UIDs",
    "3. Use UIDs with interact commands: `interact click`, `interact fill`, `interact type`, etc.",
    "4. These use real CDP input events — they trigger INP, focus, and real event handlers",
    "",
    "Performance workflow:",
    "1. `interact navigate` to the target URL",
    "2. `trace start` with reload=true for cold-load profiling",
    "3. `trace stop` to get CWV metrics and insight IDs",
    "4. `trace analyze` to drill into LCPBreakdown, RenderBlocking, DocumentLatency, etc.",
    "5. For interaction profiling: `trace start` with reload=false, perform real interactions, `trace stop`",
    "6. Use `trace emulate` with cpuThrottling=4 and network='Slow 3G' to test constrained conditions",
    "7. Use `trace memory` for heap analysis",
    "</execution_strategy>",
    "",
    "<best_practices>",
    "- ALWAYS prefer interact tools (click, type, fill) over observe evaluate for interactions",
    "- Synthetic JS events do NOT trigger INP — only real CDP input events do",
    "- Use `observe snapshot` first to find element UIDs, then pass them to interact commands",
    "- For INP measurement: trace start (reload=false), perform real clicks/typing, trace stop",
    "- Use `trace emulate` BEFORE starting traces to measure performance under realistic conditions",
    "- Check `observe console` for JavaScript errors that may indicate bugs",
    "- Run `trace lighthouse` for accessibility/SEO/best-practices — NOT for performance (use traces instead)",
    "</best_practices>",
    "",
    "<core_web_vitals>",
    "LCP < 2500ms (good), FCP < 1800ms, CLS < 0.1, INP < 200ms, TTFB < 800ms",
    "</core_web_vitals>",
  ].join("\n");

export const createBrowserMcpServer = <E>(
  runtime: ManagedRuntime.ManagedRuntime<
    McpSession | DevToolsClient | RefResolver | NetworkIdleSampler | SnapshotTaker | WaitForEngine,
    E
  >,
) => {
  const server = new McpServer({
    name: "perf-agent",
    version: "0.1.0",
  });

  registerInteractTool(server, runtime);
  registerObserveTool(server, runtime);
  registerTraceTool(server, runtime);
  registerInteractionTools(server, runtime);

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
  runtime: ManagedRuntime.ManagedRuntime<
    McpSession | DevToolsClient | RefResolver | NetworkIdleSampler | SnapshotTaker | WaitForEngine,
    E
  >,
) => {
  const { server } = createBrowserMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
