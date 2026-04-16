import { Cause } from "effect";

const FALLBACK_TRUNCATION_LIMIT = 500;

export interface ParsedError {
  readonly title: string;
  readonly message: string;
  readonly hint?: string;
}

interface TaggedError {
  readonly _tag: string;
  readonly message?: string;
  readonly cause?: unknown;
  readonly reason?: TaggedError;
}

const isTaggedError = (value: unknown): value is TaggedError =>
  typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string";

const truncate = (text: string): string =>
  text.length > FALLBACK_TRUNCATION_LIMIT ? `${text.slice(0, FALLBACK_TRUNCATION_LIMIT)}…` : text;

const parseTaggedError = (error: TaggedError): ParsedError => {
  switch (error._tag) {
    case "AcpSessionCreateError": {
      const causeText = `${String(error.cause)} ${String(error.message)}`;
      if (causeText.includes("Connection closed")) {
        return {
          title: "Session failed",
          message: "A previous browser session may be stale",
          hint: "Try killing any leftover chrome-devtools-mcp processes",
        };
      }
      return {
        title: "Session failed",
        message: error.message ?? "Creating session failed",
      };
    }
    case "DevToolsConnectionError":
      return {
        title: "Browser connection failed",
        message: error.message ?? "Failed to connect to browser DevTools",
        hint: "Is chrome-devtools-mcp installed? Run: npx chrome-devtools-mcp@0.21.0 --help",
      };
    case "DevToolsToolError":
      return {
        title: "Browser tool error",
        message: error.message ?? "A browser tool call failed",
      };
    case "ExecutionError": {
      if (error.reason && isTaggedError(error.reason)) {
        return parseTaggedError(error.reason);
      }
      return {
        title: "Execution failed",
        message: error.message ?? "An unknown execution error occurred",
      };
    }
    case "AcpProviderNotInstalledError":
      return {
        title: "Provider not installed",
        message: error.message ?? "The agent provider is not installed",
      };
    case "AcpProviderUnauthenticatedError":
      return {
        title: "Not authenticated",
        message: error.message ?? "The agent provider is not authenticated",
      };
    case "AcpProviderUsageLimitError":
      return {
        title: "Usage limit reached",
        message: error.message ?? "Usage limits exceeded",
      };
    case "AcpStreamError":
      return {
        title: "Agent stream error",
        message: error.message ?? "An error occurred during agent streaming",
        hint: "Check your network connection and try again",
      };
    default:
      return {
        title: "Unexpected error",
        message: truncate(String(error.message ?? error._tag)),
      };
  }
};

export const parseExecutionError = (cause: Cause.Cause<unknown>): ParsedError => {
  const firstFail = cause.reasons.find(Cause.isFailReason);

  if (firstFail !== undefined && isTaggedError(firstFail.error)) {
    return parseTaggedError(firstFail.error);
  }

  return {
    title: "Unexpected error",
    message: truncate(String(cause)),
  };
};
