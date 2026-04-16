import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const SESSION_DIR = ".perf-agent/sessions";
const MAX_SESSIONS = 100;

interface SessionRecord {
  readonly id: string;
  readonly instruction: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly agentBackend: string;
  readonly error?: string;
}

let lastTimestamp = 0;

const monotonicTimestamp = () => {
  const now = Date.now();
  lastTimestamp = now <= lastTimestamp ? lastTimestamp + 1 : now;
  return lastTimestamp;
};

const getSessionDir = (baseDir: string) => path.join(baseDir, SESSION_DIR);

const pruneOldSessions = (sessionDir: string, maxSessions: number) => {
  if (!fs.existsSync(sessionDir)) return;

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json")).sort();

  const excess = files.length - maxSessions;
  if (excess <= 0) return;

  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(sessionDir, files[i]));
  }
};

const saveSession = (
  session: Omit<SessionRecord, "id" | "createdAt" | "updatedAt">,
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
  };

  fs.mkdirSync(sessionDir, { recursive: true });
  const filename = `${monotonicTimestamp()}-${id}.json`;
  fs.writeFileSync(path.join(sessionDir, filename), JSON.stringify(record, undefined, 2));
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
      records.push(JSON.parse(content) as SessionRecord);
    } catch {}
  }

  return records;
};

const updateSession = (
  id: string,
  updates: Partial<Pick<SessionRecord, "status" | "error" | "updatedAt">>,
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
    existing = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionRecord;
  } catch {
    throw new Error(`Session file corrupt: ${id}`);
  }
  const updated: SessionRecord = {
    ...existing,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(updated, undefined, 2));

  return updated;
};

export { saveSession, listSessions, updateSession, MAX_SESSIONS, SESSION_DIR };
export type { SessionRecord };
