import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AnalysisStep,
  ChangesFor,
  ConsoleCapture,
  ConsoleEntry,
  NetworkCapture,
  NetworkRequest,
  PerfMetricSnapshot,
  PerfReport,
  PlanId,
  StepId,
  TraceInsightRef,
} from "@neuve/shared/models";
import { ReportStorage } from "../src/report-storage";
import { GitRepoRoot } from "../src/git/git";
import { PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME } from "../src/constants";

const makeReport = (overrides: Partial<ConstructorParameters<typeof PerfReport>[0]> = {}): PerfReport => {
  const now = DateTime.makeUnsafe("2026-04-14T10:20:30Z");
  const snapshot = new PerfMetricSnapshot({
    url: "https://example.com/dashboard",
    lcpMs: Option.some(1200),
    fcpMs: Option.some(800),
    clsScore: Option.some(0.05),
    inpMs: Option.none(),
    ttfbMs: Option.some(150),
    totalTransferSizeKb: Option.some(340.5),
    traceInsights: [
      new TraceInsightRef({ insightSetId: "NAVIGATION_0", insightName: "LCPBreakdown" }),
    ],
    collectedAt: now,
  });

  const consoleCapture = new ConsoleCapture({
    url: "https://example.com/dashboard",
    entries: [
      new ConsoleEntry({
        level: "error",
        text: "boom",
        source: Option.none(),
        url: Option.none(),
      }),
    ],
    collectedAt: now,
  });

  const networkCapture = new NetworkCapture({
    url: "https://example.com/dashboard",
    requests: [
      new NetworkRequest({
        url: "https://example.com/api",
        method: "GET",
        status: Option.some(200),
        statusText: Option.none(),
        resourceType: Option.some("xhr"),
        transferSizeKb: Option.some(10),
        durationMs: Option.some(50),
        failed: false,
      }),
    ],
    collectedAt: now,
  });

  return new PerfReport({
    id: PlanId.makeUnsafe("plan-storage-01"),
    changesFor: ChangesFor.makeUnsafe({ _tag: "WorkingTree" }),
    currentBranch: "main",
    diffPreview: "",
    fileStats: [],
    instruction: "check perf",
    baseUrl: Option.none(),
    isHeadless: false,
    cookieBrowserKeys: [],
    targetUrls: ["https://example.com/dashboard"],
    perfBudget: Option.none(),
    title: "Dashboard perf",
    rationale: "Validate CWV on dashboard",
    steps: [
      new AnalysisStep({
        id: StepId.makeUnsafe("step-01"),
        title: "Trace dashboard",
        instruction: "trace it",
        expectedOutcome: "lcp captured",
        routeHint: Option.none(),
        status: "passed",
        summary: Option.some("ok"),
        startedAt: Option.none(),
        endedAt: Option.none(),
      }),
    ],
    events: [],
    summary: "Captured 1 trace",
    screenshotPaths: [],
    pullRequest: Option.none(),
    metrics: [snapshot],
    regressions: [],
    consoleCaptures: [consoleCapture],
    networkCaptures: [networkCapture],
    insightDetails: [],
    ...overrides,
  });
};

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "report-storage-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const runSave = (report: PerfReport) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* ReportStorage;
      return yield* storage.save(report);
    }).pipe(
      Effect.provide(ReportStorage.layer),
      Effect.provide(Layer.succeed(GitRepoRoot, tempDir)),
      Effect.provide(NodeServices.layer),
    ),
  );

describe("ReportStorage", () => {
  it("persists the report as JSON (parseable) and Markdown (readable)", async () => {
    const report = makeReport();
    const persistedOption = await runSave(report);

    expect(Option.isSome(persistedOption)).toBe(true);
    const persisted = Option.getOrThrow(persistedOption);

    expect(persisted.jsonPath.endsWith(".json")).toBe(true);
    expect(persisted.markdownPath.endsWith(".md")).toBe(true);

    const reportsDir = path.join(tempDir, PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME);
    expect(fs.existsSync(reportsDir)).toBe(true);

    const jsonContents = fs.readFileSync(persisted.jsonPath, "utf-8");
    const parsed = JSON.parse(jsonContents) as Record<string, unknown>;
    expect(parsed["title"]).toBe(report.title);
    expect(parsed["status"]).toBe(undefined); // status is a getter, not persisted
    expect(Array.isArray(parsed["metrics"])).toBe(true);
    const metricsArr = parsed["metrics"] as ReadonlyArray<Record<string, unknown>>;
    expect(metricsArr[0]?.["url"]).toBe("https://example.com/dashboard");
    expect(metricsArr[0]?.["lcpMs"]).toBe(1200);

    const markdownContents = fs.readFileSync(persisted.markdownPath, "utf-8");
    expect(markdownContents).toContain("# ");
    expect(markdownContents).toContain("Dashboard perf");
    expect(markdownContents).toContain("## Metrics");

    const latestJsonContents = fs.readFileSync(persisted.latestJsonPath, "utf-8");
    expect(latestJsonContents).toBe(jsonContents);
    const latestMarkdownContents = fs.readFileSync(persisted.latestMarkdownPath, "utf-8");
    expect(latestMarkdownContents).toBe(markdownContents);

    const topLevelKeys = Object.keys(parsed).sort();
    expect(topLevelKeys).toContain("title");
    expect(topLevelKeys).toContain("metrics");
    expect(topLevelKeys).toContain("consoleCaptures");
    expect(topLevelKeys).toContain("networkCaptures");
    expect(topLevelKeys).toContain("insightDetails");
    expect(topLevelKeys).toContain("regressions");
    expect(topLevelKeys).toContain("screenshotPaths");
    expect(topLevelKeys).toContain("summary");
    expect(topLevelKeys).toContain("events");
    expect(topLevelKeys).toContain("steps");
  });

  it("derives a slug from the first metric URL and includes an ISO-safe timestamp", async () => {
    const report = makeReport();
    const persistedOption = await runSave(report);
    const persisted = Option.getOrThrow(persistedOption);
    expect(persisted.slug).toContain("example-com-dashboard");
    expect(path.basename(persisted.jsonPath)).not.toContain(":");
    expect(path.basename(persisted.jsonPath)).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/);
  });

  it("skips persistence when the report has no metrics, console, or network data", async () => {
    const report = makeReport({ metrics: [], consoleCaptures: [], networkCaptures: [] });
    const persistedOption = await runSave(report);
    expect(Option.isNone(persistedOption)).toBe(true);

    const reportsDir = path.join(tempDir, PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME);
    const exists = fs.existsSync(reportsDir);
    if (exists) {
      const entries = fs.readdirSync(reportsDir);
      expect(entries.filter((entry) => entry.endsWith(".json") || entry.endsWith(".md"))).toEqual(
        [],
      );
    }
  });
});
