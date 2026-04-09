import { Schema } from "effect";

export class McpSessionNotOpenError extends Schema.ErrorClass<McpSessionNotOpenError>(
  "McpSessionNotOpenError",
)({
  _tag: Schema.tag("McpSessionNotOpenError"),
}) {
  message = "No DevTools session open. The chrome-devtools-mcp process may not be running.";
}
