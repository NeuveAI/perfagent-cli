import { Effect, Layer, type ServiceMap } from "effect";
import { DevToolsClient, type CallToolResult } from "../../src/devtools-client";
import { DevToolsToolError } from "../../src/errors";

type DevToolsClientShape = ServiceMap.Service.Shape<typeof DevToolsClient>;

interface FakeCall {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

export interface FakeDevTools {
  readonly calls: ReadonlyArray<FakeCall>;
  readonly layer: Layer.Layer<DevToolsClient>;
}

interface FakeOptions {
  readonly responses?: Partial<Record<string, CallToolResult>>;
  readonly failures?: Partial<Record<string, string>>;
}

const textResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
});

export const makeFakeDevTools = (options: FakeOptions = {}): FakeDevTools => {
  const calls: FakeCall[] = [];
  const { responses = {}, failures = {} } = options;

  const callTool = (tool: string, args: Record<string, unknown> = {}) =>
    Effect.gen(function* () {
      calls.push({ tool, args });
      const failure = failures[tool];
      if (failure !== undefined) {
        return yield* new DevToolsToolError({ tool, cause: failure });
      }
      const response = responses[tool];
      if (response !== undefined) return response;
      return textResult(`fake-response:${tool}`);
    });

  const fn =
    (tool: string) =>
    (args: Record<string, unknown> = {}) =>
      callTool(tool, args);

  const fake = {
    callTool: (tool: string, args: Record<string, unknown> = {}) => callTool(tool, args),
    listTools: () => Effect.succeed([]),
    navigate: fn("navigate_page"),
    startTrace: fn("performance_start_trace"),
    stopTrace: fn("performance_stop_trace"),
    analyzeInsight: fn("performance_analyze_insight"),
    takeScreenshot: fn("take_screenshot"),
    takeSnapshot: fn("take_snapshot"),
    emulate: fn("emulate"),
    takeMemorySnapshot: fn("take_memory_snapshot"),
    lighthouseAudit: fn("lighthouse_audit"),
    evaluateScript: (functionBody: string, args?: unknown[]) =>
      callTool("evaluate_script", { function: functionBody, args: args ?? [] }),
    listNetworkRequests: fn("list_network_requests"),
    listConsoleMessages: fn("list_console_messages"),
    closePage: fn("close_page"),
  } satisfies DevToolsClientShape;

  return { calls, layer: Layer.succeed(DevToolsClient, fake) };
};

export const snapshotResponse = (text: string): CallToolResult => textResult(text);
export const networkResponse = (text: string): CallToolResult => textResult(text);
