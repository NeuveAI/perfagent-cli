import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import { Effect, Option, Stream } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Executor, ChangesFor, type ExecuteOptions } from "@neuve/supervisor";
import { ExecutedPerfPlan, type ExecutionEvent } from "@neuve/shared/models";
import { layerSdk } from "@neuve/sdk/effect";
import type { AgentBackend } from "@neuve/agent";

const VALID_AGENTS = new Set([
  "claude",
  "codex",
  "copilot",
  "gemini",
  "cursor",
  "opencode",
  "droid",
  "pi",
  "local",
]);

interface CaptureArgs {
  readonly prompt: string;
  readonly outputPath: string;
  readonly agent: AgentBackend;
  readonly baseUrl: string | undefined;
  readonly isHeadless: boolean;
  readonly fromReport: string | undefined;
}

const STATUS_PREFIXES = [
  "STEP_START",
  "STEP_DONE",
  "ASSERTION_FAILED",
  "STEP_SKIPPED",
  "RUN_COMPLETED",
] as const;
type StatusPrefix = (typeof STATUS_PREFIXES)[number];

const parseArg = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) return undefined;
  return next;
};

const printUsage = (): void => {
  process.stderr.write(
    [
      "Usage: pnpm tsx scripts/capture-harness-trace.ts <prompt> [options]",
      "",
      "Drives Executor via @neuve/sdk and writes every agent update to an ndjson trace file",
      "under evals/traces/<timestamp>-<slug>.ndjson. Use --output to override the path.",
      "",
      "Options:",
      "  --agent <backend>        agent backend (claude|codex|copilot|gemini|cursor|opencode|droid|pi|local). default: claude",
      "  --base-url <url>         base url forwarded to the executor",
      "  --headed                 run browser headed (default headless)",
      "  --output <path>          override the default trace output path",
      "  --from-report <json>     skip live execution; convert an existing .perf-agent/reports/<file>.json instead",
      "",
      "Environment:",
      "  PERF_AGENT_TRACE_CAPTURE  default output path (overridden by --output)",
      "",
    ].join("\n"),
  );
};

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const parseArgs = (argv: readonly string[]): CaptureArgs | undefined => {
  const positional = argv.filter((arg, index) => {
    if (arg.startsWith("-")) return false;
    const previous = argv[index - 1];
    if (previous === "--agent") return false;
    if (previous === "--base-url") return false;
    if (previous === "--output") return false;
    if (previous === "--from-report") return false;
    return true;
  });
  const prompt = positional[0];
  if (prompt === undefined || prompt.length === 0) {
    return undefined;
  }

  const agentRaw = parseArg(argv, "--agent") ?? "claude";
  if (!VALID_AGENTS.has(agentRaw)) {
    process.stderr.write(`Unknown agent backend: ${agentRaw}\n`);
    return undefined;
  }
  const agent = agentRaw as AgentBackend;
  const baseUrl = parseArg(argv, "--base-url");
  const isHeadless = !argv.includes("--headed");

  const envOutput = process.env.PERF_AGENT_TRACE_CAPTURE;
  const cliOutput = parseArg(argv, "--output");
  const defaultTracesDir = path.resolve(process.cwd(), "evals", "traces");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOutput = path.join(
    defaultTracesDir,
    `${timestamp}-${slugify(prompt)}.ndjson`,
  );
  const outputPath = cliOutput ?? envOutput ?? defaultOutput;

  const fromReport = parseArg(argv, "--from-report");

  return { prompt, outputPath, agent, baseUrl, isHeadless, fromReport };
};

interface TraceWriter {
  readonly write: (event: Record<string, unknown>) => void;
  readonly close: () => void;
}

const createWriter = (outputPath: string): TraceWriter => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const stream = fs.createWriteStream(outputPath, { flags: "w", encoding: "utf8" });
  return {
    write: (event) => {
      stream.write(`${JSON.stringify(event)}\n`);
    },
    close: () => {
      stream.end();
    },
  };
};

interface StreamState {
  previousEvents: readonly ExecutionEvent[];
  turn: number;
  nextToolId: number;
  pendingToolIds: string[];
  stepsStarted: number;
  stepsTerminal: number;
}

const findMarker = (line: string): StatusPrefix | undefined => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  for (const prefix of STATUS_PREFIXES) {
    if (trimmed.startsWith(`${prefix}|`) || trimmed === prefix) return prefix;
  }
  return undefined;
};

const emitEvent = (
  writer: TraceWriter,
  state: StreamState,
  event: ExecutionEvent,
  ts: number,
): void => {
  switch (event._tag) {
    case "RunStarted":
      return;
    case "AgentThinking":
    case "AgentText": {
      state.turn += 1;
      const textLines = event.text.split("\n");
      for (const line of textLines) {
        const marker = findMarker(line);
        if (!marker) continue;
        const payload = line.split("|").slice(1);
        writer.write({ ts, type: "status_marker", marker, payload });
        if (marker === "STEP_START") state.stepsStarted += 1;
        if (marker === "STEP_DONE" || marker === "ASSERTION_FAILED" || marker === "STEP_SKIPPED") {
          state.stepsTerminal += 1;
        }
      }
      writer.write({ ts, type: "agent_message", content: event.text, turn: state.turn });
      return;
    }
    case "ToolCall": {
      const id = `tc-${String(state.nextToolId++).padStart(3, "0")}`;
      state.pendingToolIds.push(id);
      let args: unknown = event.input;
      try {
        args = JSON.parse(event.input);
      } catch {
        // keep as string
      }
      writer.write({ ts, type: "tool_call", name: event.toolName, args, turn: state.turn, id });
      return;
    }
    case "ToolResult": {
      const id = state.pendingToolIds.shift() ?? `tc-${String(state.nextToolId++).padStart(3, "0")}`;
      writer.write({ ts, type: "tool_result", id, result: event.result, ok: !event.isError });
      return;
    }
    case "RunFinished": {
      writer.write({
        ts,
        type: "status_marker",
        marker: "RUN_COMPLETED",
        payload: [event.status, event.summary],
      });
      return;
    }
    default:
      return;
  }
};

const runFromReport = (args: CaptureArgs): void => {
  if (args.fromReport === undefined) throw new Error("fromReport path is required");
  const reportPath = path.resolve(process.cwd(), args.fromReport);
  const raw = fs.readFileSync(reportPath, "utf8");
  const report = JSON.parse(raw) as { events?: readonly ExecutionEvent[] };
  const events = report.events ?? [];

  const writer = createWriter(args.outputPath);
  const state: StreamState = {
    previousEvents: [],
    turn: 0,
    nextToolId: 0,
    pendingToolIds: [],
    stepsStarted: 0,
    stepsTerminal: 0,
  };

  const baseTs = Date.now() - events.length * 250;
  let index = 0;
  let finishedStatus: string | undefined;
  for (const event of events) {
    const ts = baseTs + index * 250;
    emitEvent(writer, state, event, ts);
    if (event._tag === "RunFinished") finishedStatus = event.status;
    index += 1;
  }

  const remaining = Math.max(0, state.stepsStarted - state.stepsTerminal);
  writer.write({
    ts: baseTs + index * 250,
    type: "stream_terminated",
    reason: finishedStatus ? `run_finished:${finishedStatus}` : "stream_exhausted",
    remainingSteps: remaining,
  });
  writer.close();
  process.stderr.write(`Converted ${events.length} events from ${reportPath} to ${args.outputPath}\n`);
};

const runLive = (args: CaptureArgs): Promise<void> => {
  const writer = createWriter(args.outputPath);

  const changesFor: ChangesFor = ChangesFor.WorkingTree();
  const executeOptions: ExecuteOptions = {
    changesFor,
    instruction: args.prompt,
    isHeadless: args.isHeadless,
    cookieBrowserKeys: [],
    baseUrl: args.baseUrl,
  };

  const state: StreamState = {
    previousEvents: [],
    turn: 0,
    nextToolId: 0,
    pendingToolIds: [],
    stepsStarted: 0,
    stepsTerminal: 0,
  };

  const program = Effect.gen(function* () {
    const executor = yield* Executor;

    let finishedStatus: string | undefined;
    yield* executor.execute(executeOptions).pipe(
      Stream.tap((executed: ExecutedPerfPlan) =>
        Effect.sync(() => {
          const ts = Date.now();
          const previousLength = state.previousEvents.length;
          const newEvents = executed.events.slice(previousLength);
          for (const event of newEvents) {
            emitEvent(writer, state, event, ts);
            if (event._tag === "RunFinished") finishedStatus = event.status;
          }
          state.previousEvents = executed.events;
        }),
      ),
      Stream.runDrain,
    );

    const remaining = Math.max(0, state.stepsStarted - state.stepsTerminal);
    writer.write({
      ts: Date.now(),
      type: "stream_terminated",
      reason: finishedStatus ? `run_finished:${finishedStatus}` : "stream_exhausted",
      remainingSteps: remaining,
    });
  });

  const runtime = program.pipe(
    Effect.provide(layerSdk(args.agent, process.cwd())),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
  );

  return Effect.runPromise(runtime as Effect.Effect<void, unknown, never>)
    .catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      writer.write({
        ts: Date.now(),
        type: "stream_terminated",
        reason: `error:${reason}`,
        remainingSteps: Math.max(0, state.stepsStarted - state.stepsTerminal),
      });
      throw error;
    })
    .finally(() => {
      writer.close();
    });
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args === undefined) {
    printUsage();
    process.exit(2);
    return;
  }

  if (args.fromReport !== undefined) {
    runFromReport(args);
    process.stderr.write(`Wrote ndjson trace to ${args.outputPath}\n`);
    return;
  }

  process.stderr.write(
    `Capturing harness trace to ${args.outputPath}\n  agent=${args.agent} headless=${args.isHeadless} baseUrl=${args.baseUrl ?? "(none)"}\n`,
  );

  try {
    await runLive(args);
  } catch (error) {
    process.stderr.write(
      `Capture failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
    return;
  }

  process.stderr.write(`Wrote ndjson trace to ${args.outputPath}\n`);
};

void main();
