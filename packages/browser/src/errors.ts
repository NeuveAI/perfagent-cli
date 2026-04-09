import { Schema } from "effect";

export class DevToolsConnectionError extends Schema.ErrorClass<DevToolsConnectionError>(
  "DevToolsConnectionError",
)({
  _tag: Schema.tag("DevToolsConnectionError"),
  cause: Schema.String,
}) {
  message = `Failed to connect to chrome-devtools-mcp: ${this.cause}`;
}

export class DevToolsToolError extends Schema.ErrorClass<DevToolsToolError>("DevToolsToolError")({
  _tag: Schema.tag("DevToolsToolError"),
  tool: Schema.String,
  cause: Schema.String,
}) {
  message = `DevTools tool "${this.tool}" failed: ${this.cause}`;
}

export class TraceNotFoundError extends Schema.ErrorClass<TraceNotFoundError>("TraceNotFoundError")({
  _tag: Schema.tag("TraceNotFoundError"),
}) {
  message = "No active performance trace. Start a trace with performance_start_trace first.";
}

export class McpServerStartError extends Schema.ErrorClass<McpServerStartError>(
  "McpServerStartError",
)({
  _tag: Schema.tag("McpServerStartError"),
  cause: Schema.String,
}) {
  message = `Failed to start MCP server: ${this.cause}`;
}

export class NavigationError extends Schema.ErrorClass<NavigationError>("NavigationError")({
  _tag: Schema.tag("NavigationError"),
  url: Schema.String,
  cause: Schema.String,
}) {
  message = `Navigation to "${this.url}" failed: ${this.cause}`;
}
