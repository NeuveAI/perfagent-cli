import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "vite-plus/test";
import { EvalTask, KeyNode } from "../src/task";
import { TeacherDataExporter, parseTraceFilename } from "../src/distill/teacher-data-exporter";
import { writeSamplesToJsonl, renderSamplesToJsonl } from "../src/distill/jsonl-writer";
import { ExportOptions } from "../src/distill/types";
import {
  containsSensitiveData,
  isTraceSuccessful,
  redactSensitiveKeys,
} from "../src/distill/filters";

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "teacher-data-"));

const writeNdjson = (filePath: string, events: ReadonlyArray<unknown>): void => {
  const body = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
};

const buildTask = (id: string, prompt: string): EvalTask =>
  new EvalTask({
    id,
    prompt,
    keyNodes: [new KeyNode({ urlPattern: "^https://example\\.com/?$", domAssertion: "h1" })],
    expectedFinalState: { urlPattern: "^https://example\\.com/?$", domAssertion: "Example" },
  });

const SAMPLE_SYSTEM_PROMPT = "You are a test agent.";
const SAMPLE_TEACHER = "claude-test";

const successfulTraceEvents: ReadonlyArray<unknown> = [
  { type: "agent_message", ts: 1, turn: 1, content: "I will navigate to example.com." },
  {
    type: "tool_call",
    ts: 2,
    turn: 1,
    id: "tc-000",
    name: "interact",
    args: JSON.stringify({ action: { command: "navigate", url: "https://example.com" } }),
  },
  {
    type: "tool_result",
    ts: 3,
    id: "tc-000",
    result: "Successfully navigated to https://example.com.",
    ok: true,
  },
  {
    type: "status_marker",
    ts: 4,
    marker: "STEP_DONE",
    payload: ["step-1", "Navigated"],
  },
  { type: "status_marker", ts: 5, marker: "RUN_COMPLETED", payload: ["passed", "done"] },
  { type: "stream_terminated", ts: 6, reason: "run_finished:passed", remainingSteps: 0 },
];

const abortedTraceEvents: ReadonlyArray<unknown> = [
  { type: "agent_message", ts: 1, turn: 1, content: "I tried." },
  { type: "status_marker", ts: 2, marker: "RUN_COMPLETED", payload: ["failed", "aborted"] },
  { type: "stream_terminated", ts: 3, reason: "run_finished:failed", remainingSteps: 1 },
];

const sensitiveTraceEvents: ReadonlyArray<unknown> = [
  {
    type: "tool_call",
    ts: 1,
    turn: 1,
    id: "tc-000",
    name: "interact",
    args: JSON.stringify({
      action: { command: "navigate", url: "https://example.com" },
      api_key: "SECRET-API-KEY-LEAK",
      token: "SECRET-TOKEN-LEAK",
    }),
  },
  {
    type: "tool_result",
    ts: 2,
    id: "tc-000",
    result: "Successfully navigated to https://example.com.",
    ok: true,
  },
  { type: "status_marker", ts: 3, marker: "RUN_COMPLETED", payload: ["passed", "done"] },
];

const runExportEffect = <E>(
  effect: Effect.Effect<unknown, E, TeacherDataExporter | import("effect/FileSystem").FileSystem>,
) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(TeacherDataExporter.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ) as Effect.Effect<unknown, E, never>,
  );

describe("parseTraceFilename", () => {
  it("splits runner and taskId on double underscore", () => {
    const result = parseTraceFilename("/abs/path/real__calibration-1.ndjson");
    assert.deepEqual(result, { runner: "real", taskId: "calibration-1" });
  });

  it("returns undefined for filenames without the double underscore", () => {
    assert.isUndefined(parseTraceFilename("singlepart.ndjson"));
  });
});

describe("filters", () => {
  it("isTraceSuccessful returns true only for RUN_COMPLETED passed", () => {
    assert.isTrue(
      isTraceSuccessful([
        { type: "status_marker", ts: 1, marker: "RUN_COMPLETED", payload: ["passed", "done"] },
      ] as never),
    );
    assert.isFalse(
      isTraceSuccessful([
        { type: "status_marker", ts: 1, marker: "RUN_COMPLETED", payload: ["failed", "x"] },
      ] as never),
    );
    assert.isFalse(isTraceSuccessful([]));
  });

  it("isTraceSuccessful rejects aborted traces even when followed by RUN_COMPLETED passed", () => {
    // Regression for Round 1 review C1. An ASSERTION_FAILED with
    // category="abort" contaminates the trace; any subsequent
    // RUN_COMPLETED payload[0]="passed" is a termination marker, not a
    // genuine success. Fine-tuning on it would teach failure-then-fake-
    // completion shapes.
    assert.isFalse(
      isTraceSuccessful([
        {
          type: "status_marker",
          ts: 1,
          marker: "ASSERTION_FAILED",
          payload: ["step-1", "Out of budget", "abort", "budget-violation"],
        },
        { type: "status_marker", ts: 2, marker: "RUN_COMPLETED", payload: ["passed", "done"] },
      ] as never),
    );
    assert.isFalse(
      isTraceSuccessful([
        { type: "status_marker", ts: 1, marker: "RUN_COMPLETED", payload: ["passed", "done"] },
        {
          type: "status_marker",
          ts: 2,
          marker: "ASSERTION_FAILED",
          payload: ["step-2", "Later abort", "abort", "budget-violation"],
        },
      ] as never),
    );
    // Non-abort categories (budget-violation without abort flag) must NOT
    // poison the trace — those are recoverable-step-level failures that
    // happen inside otherwise-successful runs.
    assert.isTrue(
      isTraceSuccessful([
        {
          type: "status_marker",
          ts: 1,
          marker: "ASSERTION_FAILED",
          payload: ["step-1", "Mild budget overshoot", "budget-violation", null],
        },
        { type: "status_marker", ts: 2, marker: "RUN_COMPLETED", payload: ["passed", "done"] },
      ] as never),
    );
  });

  it("containsSensitiveData finds api_key under tool_call args", () => {
    assert.isTrue(
      containsSensitiveData([
        {
          type: "tool_call",
          ts: 1,
          turn: 1,
          id: "x",
          name: "t",
          args: { api_key: "LEAK" },
        },
      ] as never),
    );
    assert.isFalse(
      containsSensitiveData([
        { type: "tool_call", ts: 1, turn: 1, id: "x", name: "t", args: { url: "u" } },
      ] as never),
    );
  });

  it("redactSensitiveKeys replaces matching values recursively", () => {
    const redacted = redactSensitiveKeys({
      url: "https://x",
      token: "LEAK",
      nested: { password: "LEAK", api_key: "LEAK", inner: { secret: "LEAK", ok: 1 } },
    });
    assert.strictEqual(redacted.url, "https://x");
    assert.strictEqual(redacted.token, "[REDACTED]");
    assert.strictEqual(redacted.nested.password, "[REDACTED]");
    assert.strictEqual(redacted.nested.api_key, "[REDACTED]");
    assert.strictEqual(redacted.nested.inner.secret, "[REDACTED]");
    assert.strictEqual(redacted.nested.inner.ok, 1);
  });
});

describe("TeacherDataExporter", () => {
  it("emits one per-trajectory sample from a successful trace", async () => {
    const tempDir = makeTempDir();
    const tracePath = path.join(tempDir, "real__example-task.ndjson");
    writeNdjson(tracePath, successfulTraceEvents);
    const task = buildTask("example-task", "Go to example.com");
    const effect = Effect.gen(function* () {
      const exporter = yield* TeacherDataExporter;
      return yield* exporter.export({
        tracePaths: [tracePath],
        tasks: [task],
        options: new ExportOptions({
          teacherModel: SAMPLE_TEACHER,
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
        }),
      });
    });
    const exit = await runExportEffect(effect);
    assert.strictEqual(exit._tag, "Success", JSON.stringify(exit));
    const result =
      exit._tag === "Success"
        ? (exit.value as {
            samples: ReadonlyArray<unknown>;
            summary: { samplesWritten: number; tracesAccepted: number };
          })
        : undefined;
    assert.strictEqual(result?.summary.samplesWritten, 1);
    assert.strictEqual(result?.summary.tracesAccepted, 1);
    assert.strictEqual(result?.samples.length, 1);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects aborted/failed traces", async () => {
    const tempDir = makeTempDir();
    const tracePath = path.join(tempDir, "real__aborted.ndjson");
    writeNdjson(tracePath, abortedTraceEvents);
    const task = buildTask("aborted", "Go away");
    const effect = Effect.gen(function* () {
      const exporter = yield* TeacherDataExporter;
      return yield* exporter.export({
        tracePaths: [tracePath],
        tasks: [task],
        options: new ExportOptions({
          teacherModel: SAMPLE_TEACHER,
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
        }),
      });
    });
    const exit = await runExportEffect(effect);
    assert.strictEqual(exit._tag, "Success");
    const result =
      exit._tag === "Success"
        ? (exit.value as { summary: { samplesWritten: number; tracesRejected: number } })
        : undefined;
    assert.strictEqual(result?.summary.samplesWritten, 0);
    assert.strictEqual(result?.summary.tracesRejected, 1);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("redacts sensitive keys in sample output", async () => {
    const tempDir = makeTempDir();
    const tracePath = path.join(tempDir, "real__sensitive.ndjson");
    writeNdjson(tracePath, sensitiveTraceEvents);
    const task = buildTask("sensitive", "Visit");
    const outputPath = path.join(tempDir, "out.jsonl");
    const effect = Effect.gen(function* () {
      const exporter = yield* TeacherDataExporter;
      const result = yield* exporter.export({
        tracePaths: [tracePath],
        tasks: [task],
        options: new ExportOptions({
          teacherModel: SAMPLE_TEACHER,
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
        }),
      });
      yield* writeSamplesToJsonl(outputPath, result.samples);
      return result;
    });
    const exit = await runExportEffect(effect);
    assert.strictEqual(exit._tag, "Success");
    const body = fs.readFileSync(outputPath, "utf8");
    assert.notInclude(body, "SECRET-API-KEY-LEAK");
    assert.notInclude(body, "SECRET-TOKEN-LEAK");
    assert.include(body, "[REDACTED]");
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("deduplicates samples with identical content hash", async () => {
    const tempDir = makeTempDir();
    const traceA = path.join(tempDir, "real__dup.ndjson");
    const traceB = path.join(tempDir, "real__dup2.ndjson");
    writeNdjson(traceA, successfulTraceEvents);
    writeNdjson(traceB, successfulTraceEvents);
    const task1 = buildTask("dup", "Go");
    const task2 = buildTask("dup2", "Go");
    const effect = Effect.gen(function* () {
      const exporter = yield* TeacherDataExporter;
      return yield* exporter.export({
        tracePaths: [traceA, traceB],
        tasks: [task1, task2],
        options: new ExportOptions({
          teacherModel: SAMPLE_TEACHER,
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
        }),
      });
    });
    const exit = await runExportEffect(effect);
    assert.strictEqual(exit._tag, "Success");
    const result =
      exit._tag === "Success"
        ? (exit.value as { summary: { samplesWritten: number; duplicatesSkipped: number } })
        : undefined;
    assert.strictEqual(result?.summary.samplesWritten, 1);
    assert.strictEqual(result?.summary.duplicatesSkipped, 1);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("surfaces structured error for malformed trace lines", async () => {
    const tempDir = makeTempDir();
    const tracePath = path.join(tempDir, "real__bad.ndjson");
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.writeFileSync(tracePath, "{this is not json}\n", "utf8");
    const task = buildTask("bad", "Visit");
    const effect = Effect.gen(function* () {
      const exporter = yield* TeacherDataExporter;
      return yield* exporter.export({
        tracePaths: [tracePath],
        tasks: [task],
        options: new ExportOptions({
          teacherModel: SAMPLE_TEACHER,
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
        }),
      });
    });
    const exit = await runExportEffect(effect);
    assert.strictEqual(exit._tag, "Failure");
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("per-turn granularity produces one sample per assistant turn", async () => {
    const tempDir = makeTempDir();
    const tracePath = path.join(tempDir, "real__multi-turn.ndjson");
    const multiTurnEvents: ReadonlyArray<unknown> = [
      { type: "agent_message", ts: 1, turn: 1, content: "First action." },
      {
        type: "tool_call",
        ts: 2,
        turn: 1,
        id: "tc-000",
        name: "interact",
        args: "{}",
      },
      { type: "tool_result", ts: 3, id: "tc-000", result: "ok", ok: true },
      { type: "agent_message", ts: 4, turn: 2, content: "Second action." },
      { type: "agent_message", ts: 5, turn: 3, content: "Third action." },
      { type: "status_marker", ts: 6, marker: "RUN_COMPLETED", payload: ["passed", "done"] },
    ];
    writeNdjson(tracePath, multiTurnEvents);
    const task = buildTask("multi-turn", "Do three things");
    const effect = Effect.gen(function* () {
      const exporter = yield* TeacherDataExporter;
      return yield* exporter.export({
        tracePaths: [tracePath],
        tasks: [task],
        options: new ExportOptions({
          granularity: "per-turn",
          teacherModel: SAMPLE_TEACHER,
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
        }),
      });
    });
    const exit = await runExportEffect(effect);
    assert.strictEqual(exit._tag, "Success");
    const result =
      exit._tag === "Success"
        ? (exit.value as {
            samples: ReadonlyArray<{ messages: ReadonlyArray<unknown> }>;
            summary: { samplesWritten: number };
          })
        : undefined;
    assert.strictEqual(result?.summary.samplesWritten, 3);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("serializes samples to valid JSONL via renderSamplesToJsonl", async () => {
    const tempDir = makeTempDir();
    const tracePath = path.join(tempDir, "real__roundtrip.ndjson");
    writeNdjson(tracePath, successfulTraceEvents);
    const task = buildTask("roundtrip", "Go");
    const effect = Effect.gen(function* () {
      const exporter = yield* TeacherDataExporter;
      const result = yield* exporter.export({
        tracePaths: [tracePath],
        tasks: [task],
        options: new ExportOptions({
          teacherModel: SAMPLE_TEACHER,
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
        }),
      });
      return yield* renderSamplesToJsonl(result.samples);
    });
    const exit = await runExportEffect(effect);
    assert.strictEqual(exit._tag, "Success");
    const body = exit._tag === "Success" ? (exit.value as string) : "";
    const lines = body.split("\n").filter((line) => line.length > 0);
    assert.strictEqual(lines.length, 1);
    const roundtripped = JSON.parse(lines[0]) as { messages: ReadonlyArray<{ role: string }> };
    assert.isTrue(roundtripped.messages.some((message) => message.role === "system"));
    assert.isTrue(roundtripped.messages.some((message) => message.role === "user"));
    assert.isTrue(roundtripped.messages.some((message) => message.role === "assistant"));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
