import { Option, Predicate, Schema } from "effect";

const UnknownJsonShape = Schema.fromJsonString(Schema.Unknown);
const decodeJsonOption = Schema.decodeUnknownOption(UnknownJsonShape);

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

export const extractUrlFromToolInput = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const parsedOption = decodeJsonOption(input);
  if (Option.isNone(parsedOption)) return undefined;
  const parsed = parsedOption.value;
  if (!Predicate.isObject(parsed)) return undefined;
  const topUrl = readString(parsed, "url");
  if (topUrl !== undefined) return topUrl;
  const action = parsed["action"];
  if (!Predicate.isObject(action)) return undefined;
  return readString(action, "url");
};

const collectTextFromMcpContent = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const entry of value) {
    if (!Predicate.isObject(entry)) continue;
    const text = readString(entry, "text");
    if (text !== undefined) parts.push(text);
  }
  return parts.length === 0 ? undefined : parts.join("\n");
};

const NAVIGATED_PATTERN = /Successfully navigated to (https?:\/\/\S+?)[.\s]*(?:\n|$)/;
const TRACE_URL_PATTERN = /^URL:\s*(https?:\/\/\S+)\s*$/m;
const PAGES_SELECTED_PATTERN = /^\d+:\s*(https?:\/\/\S+)\s*\[selected\]/m;
const ROOT_WEB_AREA_PATTERN = /uid=\d+_0\s+RootWebArea\b[^\n]*\burl="(https?:\/\/[^"]+)"/;

export const extractUrlFromResultText = (text: string): string | undefined => {
  const navigated = NAVIGATED_PATTERN.exec(text);
  if (navigated !== null) return navigated[1];
  const pagesSelected = PAGES_SELECTED_PATTERN.exec(text);
  if (pagesSelected !== null) return pagesSelected[1];
  const traceUrl = TRACE_URL_PATTERN.exec(text);
  if (traceUrl !== null) return traceUrl[1];
  const rootWebArea = ROOT_WEB_AREA_PATTERN.exec(text);
  if (rootWebArea !== null) return rootWebArea[1];
  return undefined;
};

export const extractUrlFromToolResult = (result: unknown): string | undefined => {
  if (typeof result !== "string" || result.length === 0) return undefined;
  const parsedOption = decodeJsonOption(result);
  const contentText = Option.isSome(parsedOption)
    ? collectTextFromMcpContent(parsedOption.value)
    : undefined;
  const searchSpace = contentText ?? result;
  return extractUrlFromResultText(searchSpace);
};
