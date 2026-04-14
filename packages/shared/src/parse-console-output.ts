export interface ParsedConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  source?: string;
  url?: string;
}

const CONSOLE_MESSAGES_HEADING = "## Console messages";
const EMPTY_MARKER = "<no console messages found>";
const ENTRY_PATTERN = /^msgid=(\d+)\s+\[([^\]]+)\]\s(.*?)(?:\s\((\d+)\s+args\))?$/;
const STACK_LINE_PREFIX = "    at ";
const KNOWN_LEVELS = new Set(["log", "info", "warn", "error", "debug"]);

const normalizeLevel = (raw: string): ParsedConsoleEntry["level"] => {
  const lowered = raw.toLowerCase();
  if (KNOWN_LEVELS.has(lowered)) return lowered as ParsedConsoleEntry["level"];
  if (lowered === "verbose" || lowered === "trace") return "debug";
  return "log";
};

const extractUrlFromStackLine = (stackLine: string): string | undefined => {
  const trimmed = stackLine.slice(STACK_LINE_PREFIX.length);
  const urlMatch = trimmed.match(/(https?:\/\/\S+|file:\/\/\S+|pptr:\S+)/);
  if (!urlMatch) return undefined;
  const candidate = urlMatch[1].replace(/[)\s]+$/, "");
  return candidate.length > 0 ? candidate : undefined;
};

interface EntryAccumulator {
  entry: ParsedConsoleEntry;
  stackLinesSeen: number;
}

export const parseConsoleOutput = (toolResultText: string): ParsedConsoleEntry[] => {
  if (!toolResultText || !toolResultText.includes(CONSOLE_MESSAGES_HEADING)) return [];
  if (toolResultText.includes(EMPTY_MARKER)) return [];

  const headingIndex = toolResultText.indexOf(CONSOLE_MESSAGES_HEADING);
  const afterHeading = toolResultText.slice(headingIndex + CONSOLE_MESSAGES_HEADING.length);
  const lines = afterHeading.split(/\r?\n/);

  const entries: ParsedConsoleEntry[] = [];
  let current: EntryAccumulator | undefined;

  for (const line of lines) {
    if (line.startsWith("## ") && !line.startsWith(CONSOLE_MESSAGES_HEADING)) break;

    const entryMatch = line.match(ENTRY_PATTERN);
    if (entryMatch) {
      const level = normalizeLevel(entryMatch[2]);
      const text = entryMatch[3];
      current = {
        entry: { level, text },
        stackLinesSeen: 0,
      };
      entries.push(current.entry);
      continue;
    }

    if (current && line.startsWith(STACK_LINE_PREFIX)) {
      if (current.stackLinesSeen === 0) {
        const url = extractUrlFromStackLine(line);
        if (url) current.entry.url = url;
      }
      current.stackLinesSeen += 1;
    }
  }

  return entries;
};
