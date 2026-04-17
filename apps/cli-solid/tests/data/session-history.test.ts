import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Option } from "effect";
import {
  saveSession,
  listSessions,
  updateSession,
  INDEX_FILE,
  SESSION_DIR,
} from "../../src/data/session-history";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-history-test-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const readIndexLines = (baseDir: string): string[] => {
  const indexPath = path.join(baseDir, SESSION_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return [];
  const content = fs.readFileSync(indexPath, "utf-8");
  if (content.length === 0) return [];
  return content.split("\n").filter((line) => line.length > 0);
};

describe("saveSession", () => {
  test("creates a file in the sessions directory", () => {
    saveSession({ instruction: "test something", status: "running", agentBackend: "ollama" }, tempDir);

    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));

    expect(files).toHaveLength(1);
    expect(files[0]).toEndWith(".json");
  });

  test("generates a unique id and timestamps", () => {
    const record = saveSession(
      { instruction: "run perf test", status: "running", agentBackend: "claude" },
      tempDir,
    );

    expect(record.id).toHaveLength(8);
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
    expect(record.createdAt).toBe(record.updatedAt);
    expect(record.instruction).toBe("run perf test");
    expect(record.status).toBe("running");
    expect(record.agentBackend).toBe("claude");
    expect(Option.isNone(record.reportPath)).toBe(true);
  });

  test("omits reportPath key on disk when None", () => {
    const record = saveSession(
      { instruction: "no report yet", status: "running", agentBackend: "claude" },
      tempDir,
    );

    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
    const targetFile = files.find((f) => f.endsWith(`-${record.id}.json`))!;
    const raw = JSON.parse(fs.readFileSync(path.join(sessionDir, targetFile), "utf-8")) as Record<
      string,
      unknown
    >;

    expect("reportPath" in raw).toBe(false);
  });
});

describe("listSessions", () => {
  test("returns sessions sorted newest first", () => {
    const first = saveSession(
      { instruction: "first", status: "completed", agentBackend: "ollama" },
      tempDir,
    );

    const second = saveSession(
      { instruction: "second", status: "running", agentBackend: "ollama" },
      tempDir,
    );

    const sessions = listSessions(tempDir);

    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe(second.id);
    expect(sessions[1].id).toBe(first.id);
  });

  test("returns empty array when no sessions exist", () => {
    const sessions = listSessions(tempDir);
    expect(sessions).toEqual([]);
  });

  test("decodes legacy session files without reportPath as Option.none", () => {
    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    const legacy = {
      id: "legacy01",
      instruction: "old session",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      status: "completed",
      agentBackend: "ollama",
    };
    fs.writeFileSync(
      path.join(sessionDir, "1700000000000-legacy01.json"),
      JSON.stringify(legacy),
    );

    const sessions = listSessions(tempDir);
    expect(sessions).toHaveLength(1);
    expect(Option.isNone(sessions[0].reportPath)).toBe(true);
  });

  test("decodes session files with reportPath as Option.some", () => {
    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    const withReport = {
      id: "hasrep01",
      instruction: "has report",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      status: "completed",
      agentBackend: "local",
      reportPath: "reports/2026-01-01T00-00-01Z-example.json",
    };
    fs.writeFileSync(
      path.join(sessionDir, "1700000000001-hasrep01.json"),
      JSON.stringify(withReport),
    );

    const sessions = listSessions(tempDir);
    expect(sessions).toHaveLength(1);
    expect(Option.getOrUndefined(sessions[0].reportPath)).toBe(
      "reports/2026-01-01T00-00-01Z-example.json",
    );
  });
});

describe("updateSession", () => {
  test("changes status and updatedAt", () => {
    const original = saveSession(
      { instruction: "test update", status: "running", agentBackend: "ollama" },
      tempDir,
    );

    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    const updated = updateSession(
      original.id,
      { status: "completed", updatedAt: futureTimestamp },
      tempDir,
    );

    expect(updated.status).toBe("completed");
    expect(updated.instruction).toBe("test update");
    expect(updated.updatedAt).toBe(futureTimestamp);
    expect(updated.updatedAt).not.toBe(original.updatedAt);
  });

  test("persists reportPath on update", () => {
    const original = saveSession(
      { instruction: "will have report", status: "running", agentBackend: "local" },
      tempDir,
    );

    const reportPath = "reports/2026-04-17T17-37-22Z-agent-perflab-io.json";
    const updated = updateSession(
      original.id,
      { status: "completed", reportPath: Option.some(reportPath) },
      tempDir,
    );

    expect(Option.getOrUndefined(updated.reportPath)).toBe(reportPath);

    const reloaded = listSessions(tempDir).find((s) => s.id === original.id)!;
    expect(Option.getOrUndefined(reloaded.reportPath)).toBe(reportPath);
  });

  test("throws when session not found", () => {
    expect(() => updateSession("nonexistent", { status: "failed" }, tempDir)).toThrow(
      "Session not found: nonexistent",
    );
  });

  test("throws descriptive error when session file is corrupt", () => {
    const record = saveSession(
      { instruction: "will corrupt", status: "running", agentBackend: "ollama" },
      tempDir,
    );

    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
    const targetFile = files.find((f) => f.endsWith(`-${record.id}.json`));
    fs.writeFileSync(path.join(sessionDir, targetFile!), "not valid json{{{");

    expect(() => updateSession(record.id, { status: "completed" }, tempDir)).toThrow(
      `Session file corrupt: ${record.id}`,
    );
  });
});

describe("index.jsonl append-only stream", () => {
  test("appends one line per saveSession", () => {
    saveSession({ instruction: "a", status: "running", agentBackend: "ollama" }, tempDir);
    saveSession({ instruction: "b", status: "running", agentBackend: "ollama" }, tempDir);

    const lines = readIndexLines(tempDir);
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0].instruction).toBe("a");
    expect(parsed[1].instruction).toBe("b");
    expect(parsed[0].status).toBe("running");
  });

  test("appends another line per updateSession (no rewrite)", () => {
    const record = saveSession(
      { instruction: "track me", status: "running", agentBackend: "ollama" },
      tempDir,
    );
    updateSession(record.id, { status: "completed" }, tempDir);
    updateSession(record.id, { reportPath: Option.some("reports/example.json") }, tempDir);

    const lines = readIndexLines(tempDir);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0].status).toBe("running");
    expect(parsed[1].status).toBe("completed");
    expect(parsed[2].reportPath).toBe("reports/example.json");
    expect(parsed.every((entry) => entry.id === record.id)).toBe(true);
  });

  test("omits reportPath field when None", () => {
    saveSession(
      { instruction: "no report", status: "running", agentBackend: "ollama" },
      tempDir,
    );

    const lines = readIndexLines(tempDir);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect("reportPath" in parsed).toBe(false);
  });

  test("every line is single-line valid JSON (grep-friendly)", () => {
    const record = saveSession(
      { instruction: "multi\nline\ninstruction", status: "running", agentBackend: "ollama" },
      tempDir,
    );
    updateSession(record.id, { status: "completed" }, tempDir);

    const indexPath = path.join(tempDir, ".perf-agent/sessions", INDEX_FILE);
    const raw = fs.readFileSync(indexPath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.length > 0);

    for (const line of lines) {
      expect(line.includes("\n")).toBe(false);
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe("pruning", () => {
  test("removes oldest sessions when count exceeds max", () => {
    const maxSessions = 3;

    for (let i = 0; i < 5; i++) {
      saveSession(
        { instruction: `session ${i}`, status: "completed", agentBackend: "ollama" },
        tempDir,
        maxSessions,
      );
    }

    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));

    expect(files).toHaveLength(maxSessions);

    const sessions = listSessions(tempDir);
    const instructions = sessions.map((s) => s.instruction);

    expect(instructions).toContain("session 4");
    expect(instructions).toContain("session 3");
    expect(instructions).toContain("session 2");
    expect(instructions).not.toContain("session 0");
    expect(instructions).not.toContain("session 1");
  });
});

describe("corrupt file handling", () => {
  test("skips corrupt JSON files in listSessions", () => {
    saveSession(
      { instruction: "valid session", status: "completed", agentBackend: "ollama" },
      tempDir,
    );

    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    fs.writeFileSync(path.join(sessionDir, "0000000000000-corrupt.json"), "not valid json{{{");

    const sessions = listSessions(tempDir);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].instruction).toBe("valid session");
  });
});
