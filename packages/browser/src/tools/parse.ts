import type { CallToolResult } from "../devtools-client";

export const extractText = (result: CallToolResult): string =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");

const NETWORK_PENDING_LINE = /^reqid=\d+\s+\S+\s+\S+\s+\[pending\]/gm;

export const countPendingNetworkRequests = (text: string): number => {
  const matches = text.match(NETWORK_PENDING_LINE);
  return matches ? matches.length : 0;
};

export const snapshotContainsUid = (text: string, uid: string): boolean => {
  const escaped = uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\buid=${escaped}\\b`);
  return pattern.test(text);
};

export interface ParsedSnapshotNode {
  readonly uid: string;
  readonly role: string | undefined;
  readonly name: string | undefined;
  readonly value: string | undefined;
  readonly indent: number;
}

const UID_LINE = /^(\s*)uid=(\S+)(?:\s+([^"\s][^\s]*))?(?:\s+"((?:[^"\\]|\\.)*)")?(.*)$/;

const extractValueAttr = (rest: string): string | undefined => {
  const match = rest.match(/\bvalue="((?:[^"\\]|\\.)*)"/);
  return match ? match[1] : undefined;
};

const parseSnapshotNodes = (text: string): ParsedSnapshotNode[] => {
  const out: ParsedSnapshotNode[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(UID_LINE);
    if (!match) continue;
    const [, indent, uid, role, name, rest] = match;
    out.push({
      uid: uid ?? "",
      role: role === "ignored" ? undefined : role,
      name,
      value: extractValueAttr(rest ?? ""),
      indent: indent ? indent.length : 0,
    });
  }
  return out;
};

/**
 * For a combobox/<select> at `selectUid`, return the immediate `option` children
 * in document order. "Immediate" = next nodes after the parent whose indent
 * exceeds the parent's, until the indent returns to the parent level or shallower.
 * Nested option groups (optgroup / listbox) would show up as deeper indents but
 * still appear in DFS order; we keep only direct option children of the select.
 */
export const findOptionsForSelect = (
  text: string,
  selectUid: string,
): ReadonlyArray<ParsedSnapshotNode> => {
  const nodes = parseSnapshotNodes(text);
  const selectIdx = nodes.findIndex((node) => node.uid === selectUid);
  if (selectIdx === -1) return [];
  const selectIndent = nodes[selectIdx]?.indent;
  if (selectIndent === undefined) return [];
  const options: ParsedSnapshotNode[] = [];
  for (let index = selectIdx + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) break;
    if (node.indent <= selectIndent) break;
    if (node.role === "option") options.push(node);
  }
  return options;
};
