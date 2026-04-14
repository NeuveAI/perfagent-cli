export interface ParsedNetworkRequest {
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  resourceType?: "document" | "stylesheet" | "script" | "image" | "font" | "fetch" | "xhr" | "other";
  transferSizeKb?: number;
  durationMs?: number;
  failed?: boolean;
}

const NETWORK_REQUESTS_HEADING = "## Network requests";
const EMPTY_REQUESTS_SENTINEL = "No requests found.";
const SELECTED_SUFFIX = " [selected in the DevTools Network panel]";
const REQID_LINE_PREFIX = "reqid=";
const NET_ERR_PREFIX = "net::ERR_";
const PENDING_STATUS = "pending";
const HTTP_STATUS_FAILURE_THRESHOLD = 400;

const parseStatusToken = (
  statusToken: string,
): Pick<ParsedNetworkRequest, "status" | "statusText" | "failed"> => {
  if (statusToken === PENDING_STATUS) {
    return { status: undefined, statusText: PENDING_STATUS, failed: false };
  }

  if (statusToken.startsWith(NET_ERR_PREFIX)) {
    return { status: undefined, statusText: statusToken, failed: true };
  }

  const numericStatus = Number.parseInt(statusToken, 10);
  if (!Number.isFinite(numericStatus) || String(numericStatus) !== statusToken) {
    return { status: undefined, statusText: statusToken, failed: true };
  }

  return {
    status: numericStatus,
    statusText: undefined,
    failed: numericStatus >= HTTP_STATUS_FAILURE_THRESHOLD,
  };
};

const parseRequestLine = (rawLine: string): ParsedNetworkRequest | undefined => {
  const line = rawLine.endsWith(SELECTED_SUFFIX)
    ? rawLine.slice(0, rawLine.length - SELECTED_SUFFIX.length)
    : rawLine;

  const bracketStart = line.lastIndexOf("[");
  const bracketEnd = line.lastIndexOf("]");
  if (bracketStart < 0 || bracketEnd !== line.length - 1 || bracketEnd < bracketStart) {
    return undefined;
  }

  const statusToken = line.slice(bracketStart + 1, bracketEnd);
  const beforeBracket = line.slice(0, bracketStart).trimEnd();

  if (!beforeBracket.startsWith(REQID_LINE_PREFIX)) return undefined;

  const afterReqid = beforeBracket.slice(REQID_LINE_PREFIX.length);
  const firstSpace = afterReqid.indexOf(" ");
  if (firstSpace < 0) return undefined;

  const rest = afterReqid.slice(firstSpace + 1);
  const methodEnd = rest.indexOf(" ");
  if (methodEnd < 0) return undefined;

  const method = rest.slice(0, methodEnd);
  const url = rest.slice(methodEnd + 1).trim();
  if (method.length === 0 || url.length === 0) return undefined;

  const statusFields = parseStatusToken(statusToken);

  return { url, method, ...statusFields };
};

export const parseNetworkRequests = (toolResultText: string): ParsedNetworkRequest[] => {
  if (!toolResultText || !toolResultText.includes(NETWORK_REQUESTS_HEADING)) return [];
  if (toolResultText.includes(EMPTY_REQUESTS_SENTINEL)) return [];

  const lines = toolResultText.split(/\r?\n/);
  const requests: ParsedNetworkRequest[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith(REQID_LINE_PREFIX)) continue;
    const parsed = parseRequestLine(trimmed);
    if (parsed) requests.push(parsed);
  }

  return requests;
};
