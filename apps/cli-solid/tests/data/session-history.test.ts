import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { saveSession, listSessions, updateSession } from "../../src/data/session-history";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-history-test-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("saveSession", () => {
  test("creates a file in the sessions directory", () => {
    saveSession({ instruction: "test something", status: "running", agentBackend: "ollama" }, tempDir);

    const sessionDir = path.join(tempDir, ".perf-agent/sessions");
    const files = fs.readdirSync(sessionDir);

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
    const files = fs.readdirSync(sessionDir);
    const targetFile = files.find((f) => f.endsWith(`-${record.id}.json`));
    fs.writeFileSync(path.join(sessionDir, targetFile!), "not valid json{{{");

    expect(() => updateSession(record.id, { status: "completed" }, tempDir)).toThrow(
      `Session file corrupt: ${record.id}`,
    );
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
    const files = fs.readdirSync(sessionDir);

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
