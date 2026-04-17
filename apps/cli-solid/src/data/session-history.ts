import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Option } from "effect";

const SESSION_DIR = ".perf-agent/sessions";
const INDEX_FILE = "index.jsonl";
const MAX_SESSIONS = 100;

interface SessionRecord {
  readonly id: string;
  readonly instruction: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly agentBackend: string;
  readonly reportPath: Option.Option<string>;
  readonly error?: string;
}

interface SerializedSessionRecord {
  readonly id: string;
  readonly instruction: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: SessionRecord["status"];
  readonly agentBackend: string;
  readonly reportPath?: string;
  readonly error?: string;
}

let lastTimestamp = 0;

const monotonicTimestamp = () => {
  const now = Date.now();
  lastTimestamp = now <= lastTimestamp ? lastTimestamp + 1 : now;
  return lastTimestamp;
};

const getSessionDir = (baseDir: string) => path.join(baseDir, SESSION_DIR);
const getIndexPath = (sessionDir: string) => path.join(sessionDir, INDEX_FILE);

const toSerialized = (record: SessionRecord): SerializedSessionRecord => ({
  id: record.id,
  instruction: record.instruction,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  status: record.status,
  agentBackend: record.agentBackend,
  ...(Option.isSome(record.reportPath) && { reportPath: record.reportPath.value }),
  ...(record.error !== undefined && { error: record.error }),
});

const fromSerialized = (raw: SerializedSessionRecord): SessionRecord => ({
  id: raw.id,
  instruction: raw.instruction,
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
  status: raw.status,
  agentBackend: raw.agentBackend,
  reportPath: raw.reportPath === undefined ? Option.none() : Option.some(raw.reportPath),
  error: raw.error,
});

const writeRecordFile = (sessionDir: string, filename: string, record: SessionRecord) => {
  const serialized = toSerialized(record);
  fs.writeFileSync(path.join(sessionDir, filename), JSON.stringify(serialized, undefined, 2));
};

const appendToIndex = (sessionDir: string, record: SessionRecord) => {
  const line = `${JSON.stringify(toSerialized(record))}\n`;
  fs.appendFileSync(getIndexPath(sessionDir), line);
};

const pruneOldSessions = (sessionDir: string, maxSessions: number) => {
  if (!fs.existsSync(sessionDir)) return;

  const files = fs
    .readdirSync(sessionDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const excess = files.length - maxSessions;
  if (excess <= 0) return;

  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(sessionDir, files[i]));
  }
};

interface SaveSessionInput {
  readonly instruction: string;
  readonly status: SessionRecord["status"];
  readonly agentBackend: string;
}

const saveSession = (
  session: SaveSessionInput,
  baseDir = process.cwd(),
  maxSessions = MAX_SESSIONS,
): SessionRecord => {
  const sessionDir = getSessionDir(baseDir);
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const record: SessionRecord = {
    ...session,
    id,
    createdAt: now,
    updatedAt: now,
    reportPath: Option.none(),
  };

  fs.mkdirSync(sessionDir, { recursive: true });
  const filename = `${monotonicTimestamp()}-${id}.json`;
  writeRecordFile(sessionDir, filename, record);
  appendToIndex(sessionDir, record);
  pruneOldSessions(sessionDir, maxSessions);

  return record;
};

const listSessions = (baseDir = process.cwd()): readonly SessionRecord[] => {
  const sessionDir = getSessionDir(baseDir);

  if (!fs.existsSync(sessionDir)) return [];

  const files = fs
    .readdirSync(sessionDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const records: SessionRecord[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(sessionDir, file), "utf-8");
      const parsed = JSON.parse(content) as SerializedSessionRecord;
      records.push(fromSerialized(parsed));
    } catch {}
  }

  return records;
};

interface UpdateSessionInput {
  readonly status?: SessionRecord["status"];
  readonly error?: string;
  readonly updatedAt?: string;
  readonly reportPath?: Option.Option<string>;
}

const updateSession = (
  id: string,
  updates: UpdateSessionInput,
  baseDir = process.cwd(),
): SessionRecord => {
  const sessionDir = getSessionDir(baseDir);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session not found: ${id}`);
  }

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
  const targetFile = files.find((f) => f.endsWith(`-${id}.json`));

  if (!targetFile) {
    throw new Error(`Session not found: ${id}`);
  }

  const filePath = path.join(sessionDir, targetFile);
  let existing: SessionRecord;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SerializedSessionRecord;
    existing = fromSerialized(parsed);
  } catch {
    throw new Error(`Session file corrupt: ${id}`);
  }

  const updated: SessionRecord = {
    ...existing,
    status: updates.status ?? existing.status,
    error: updates.error ?? existing.error,
    reportPath: updates.reportPath ?? existing.reportPath,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  writeRecordFile(sessionDir, targetFile, updated);
  appendToIndex(sessionDir, updated);

  return updated;
};

export { saveSession, listSessions, updateSession, MAX_SESSIONS, SESSION_DIR, INDEX_FILE };
export type { SessionRecord };
