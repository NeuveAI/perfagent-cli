/**
 * Parse a URL and return `host + path` (stripping the trailing `/` when the
 * path is empty). Returns `undefined` when the input is nullish, or the raw
 * input string when parsing fails.
 */
export const formatHostPath = (rawUrl: string | undefined): string | undefined => {
  if (!rawUrl) return undefined;
  if (!URL.canParse(rawUrl)) return rawUrl;
  const parsed = new URL(rawUrl);
  const pathSegment = parsed.pathname.length > 1 ? parsed.pathname : "";
  return `${parsed.host}${pathSegment}`;
};
