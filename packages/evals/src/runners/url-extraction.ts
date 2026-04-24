import { Option, Schema } from "effect";

// chrome-devtools-mcp version this extractor was validated against.
// The text-scan fallback patterns below mirror template literals from:
//   node_modules/chrome-devtools-mcp/build/src/tools/pages.js:179 (navigate)
//   node_modules/chrome-devtools-mcp/build/src/McpResponse.js:437   (page list)
//   node_modules/chrome-devtools-mcp/build/src/McpResponse.js:507   (trace URL)
//   node_modules/chrome-devtools-mcp/build/src/formatters/SnapshotFormatter.js:52,76  (snapshot url="")
// chrome-devtools-mcp exports neither typed data structures nor the
// magic-string constants, so a version pin + contract test is the best
// tripwire we have against silent drift when the dep upgrades.
export const CHROME_DEVTOOLS_MCP_EXPECTED_VERSION = "0.21.0";

const UnknownJsonShape = Schema.fromJsonString(Schema.Unknown);
const decodeJsonOption = Schema.decodeUnknownOption(UnknownJsonShape);

// MCP wire schema. Upstream type:
//   @modelcontextprotocol/sdk/types.js — TextContentSchema (line 1002),
//   CallToolResultSchema (line 1276), structuredContent field (line 1289).
// We define local Effect schemas rather than depend on @modelcontextprotocol/sdk
// at runtime — evals is a downstream consumer of ACP's rawOutput, not of
// MCP directly. Decode failures feed the text fallback so we never crash
// a real run on a novel shape.
const TextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

const PageEntry = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  url: Schema.String,
  selected: Schema.optional(Schema.Boolean),
});

const SnapshotNode = Schema.Struct({
  url: Schema.optional(Schema.String),
});

const StructuredContent = Schema.Struct({
  pages: Schema.optional(Schema.Array(PageEntry)),
  snapshot: Schema.optional(SnapshotNode),
});

const CallToolResultShape = Schema.Struct({
  content: Schema.optional(Schema.Array(Schema.Unknown)),
  structuredContent: Schema.optional(StructuredContent),
});

const InputShape = Schema.Struct({
  url: Schema.optional(Schema.String),
  action: Schema.optional(Schema.Struct({ url: Schema.optional(Schema.String) })),
});

const decodeTextContent = Schema.decodeUnknownOption(TextContent);
const decodeCallToolResult = Schema.decodeUnknownOption(CallToolResultShape);
const decodeContentArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeInputShape = Schema.decodeUnknownOption(InputShape);

// Pre-Wave-2.A tool-input extractor: the old consolidated tools (and
// any provider that still calls navigate_page directly) pass the URL in
// the tool args. Byte-equivalent to the pre-F5 helper but now typed via
// schema decode so future drift fails decode rather than silently
// returning undefined.
export const extractUrlFromToolInput = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const parsedOption = decodeJsonOption(input);
  if (Option.isNone(parsedOption)) return undefined;
  const decoded = decodeInputShape(parsedOption.value);
  if (Option.isNone(decoded)) return undefined;
  return decoded.value.url ?? decoded.value.action?.url;
};

const extractUrlFromTextLine = (text: string): string | undefined => {
  // Mirrors `Successfully navigated to ${url}.` (pages.js:179).
  const navigated =
    /Successfully navigated (?:to|back to|forward to) (https?:\/\/\S+?)[.\s]*(?:\n|$)/.exec(text);
  if (navigated !== null) return navigated[1];
  // Mirrors `${pageId}: ${page.url()} [selected]` (McpResponse.js:437).
  const pagesSelected = /^\d+:\s*(https?:\/\/\S+)\s*\[selected\]/m.exec(text);
  if (pagesSelected !== null) return pagesSelected[1];
  // Mirrors `URL: ${summary.url}` in trace / lighthouse summaries (McpResponse.js:507).
  const traceUrl = /^URL:\s*(https?:\/\/\S+)\s*$/m.exec(text);
  if (traceUrl !== null) return traceUrl[1];
  // Mirrors SnapshotFormatter root-frame node output.
  // SnapshotFormatter.js:52 emits `uid=${id}` and id format is `${frameIndex}_0` for the root.
  const rootWebArea = /uid=\d+_0\s+RootWebArea\b[^\n]*\burl="(https?:\/\/[^"]+)"/.exec(text);
  if (rootWebArea !== null) return rootWebArea[1];
  return undefined;
};

const urlFromStructuredContent = (
  structured: Schema.Schema.Type<typeof StructuredContent>,
): string | undefined => {
  if (structured.pages !== undefined && structured.pages.length > 0) {
    const selected = structured.pages.find((page) => page.selected === true);
    if (selected !== undefined) return selected.url;
    return structured.pages[0].url;
  }
  if (structured.snapshot?.url !== undefined) return structured.snapshot.url;
  return undefined;
};

const urlFromContentArray = (content: ReadonlyArray<unknown>): string | undefined => {
  for (const entry of content) {
    const textOption = decodeTextContent(entry);
    if (Option.isNone(textOption)) continue;
    const url = extractUrlFromTextLine(textOption.value.text);
    if (url !== undefined) return url;
  }
  return undefined;
};

// ToolResult.result arrives as a JSON-stringified payload on the schema
// (shared/src/models.ts:710 serializeToolResult). We decode the string
// to JSON, then try three paths in order:
//
//   1. Full CallToolResult wrapper — `{ content: [...], structuredContent: {...} }`.
//      Used when a provider forwards the complete MCP envelope.
//   2. Bare content array — `[{type:"text", text:"..."}]`. What Claude ACP
//      currently forwards via rawOutput in real traces.
//   3. Raw string / fallback — if JSON decode fails.
//
// Structured-content URLs (pages[].url, snapshot.url) win over text-scan.
// Structured data is stable JSON with explicit fields; the text-scan
// fallback is the only surface today but is version-pinned via the
// CHROME_DEVTOOLS_MCP_EXPECTED_VERSION contract test.
export const extractUrlFromToolResult = (result: unknown): string | undefined => {
  if (typeof result !== "string" || result.length === 0) return undefined;
  const parsedOption = decodeJsonOption(result);
  if (Option.isNone(parsedOption)) {
    return extractUrlFromTextLine(result);
  }

  const envelopeOption = decodeCallToolResult(parsedOption.value);
  if (Option.isSome(envelopeOption)) {
    const envelope = envelopeOption.value;
    if (envelope.structuredContent !== undefined) {
      const structuredUrl = urlFromStructuredContent(envelope.structuredContent);
      if (structuredUrl !== undefined) return structuredUrl;
    }
    if (envelope.content !== undefined) {
      const textUrl = urlFromContentArray(envelope.content);
      if (textUrl !== undefined) return textUrl;
    }
    return undefined;
  }

  const contentArrayOption = decodeContentArray(parsedOption.value);
  if (Option.isSome(contentArrayOption)) {
    return urlFromContentArray(contentArrayOption.value);
  }

  if (typeof parsedOption.value === "string") {
    return extractUrlFromTextLine(parsedOption.value);
  }
  return undefined;
};
