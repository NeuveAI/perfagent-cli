import type { Page } from "playwright";
import { REF_PREFIX, SNAPSHOT_TIMEOUT_MS } from "./constants";
import type { RefEntry, RefMap, SnapshotOptions, SnapshotResult } from "./types";
import { parseAriaLine } from "./utils/parse-aria-line";
import { resolveLocator } from "./utils/resolve-locator";

export const snapshot = async (
  page: Page,
  options: SnapshotOptions = {},
): Promise<SnapshotResult> => {
  const timeout = options.timeout ?? SNAPSHOT_TIMEOUT_MS;
  const rawTree = await page.locator("body").ariaSnapshot({ timeout });
  const lines = rawTree.split("\n");

  const refs: RefMap = {};
  const roleNameGroups = new Map<string, RefEntry[]>();
  let refCount = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const parsed = parseAriaLine(lines[lineIndex]);
    if (!parsed) continue;

    refCount++;
    const ref = `${REF_PREFIX}${refCount}`;
    const entry: RefEntry = { role: parsed.role, name: parsed.name };
    refs[ref] = entry;

    const key = `${parsed.role}|${parsed.name}`;
    const group = roleNameGroups.get(key);
    if (group) {
      group.push(entry);
    } else {
      roleNameGroups.set(key, [entry]);
    }

    lines[lineIndex] = `${lines[lineIndex]} [ref=${ref}]`;
  }

  for (const group of roleNameGroups.values()) {
    if (group.length > 1) {
      group.forEach((entry, nthIndex) => {
        entry.nth = nthIndex;
      });
    }
  }

  const locator = (ref: string) => {
    const entry = refs[ref];
    if (!entry) {
      const available = Object.keys(refs);
      const detail =
        available.length === 0
          ? "no refs available (page may be empty)"
          : `available refs: ${available.join(", ")}`;
      throw new Error(`Unknown ref "${ref}" (${detail})`);
    }
    return resolveLocator(page, entry);
  };

  return { tree: lines.join("\n"), refs, locator };
};
