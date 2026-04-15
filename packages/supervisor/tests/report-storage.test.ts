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
import {
  PERF_AGENT_STATE_DIR,
  REPORT_DIRECTORY_NAME,
  REPORT_LATEST_JSON_NAME,
} from "../src/constants";

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

const runList = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* ReportStorage;
      return yield* storage.list();
    }).pipe(
      Effect.provide(ReportStorage.layer),
      Effect.provide(Layer.succeed(GitRepoRoot, tempDir)),
      Effect.provide(NodeServices.layer),
    ),
  );

const runLoad = (absolutePath: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* ReportStorage;
      return yield* storage.load(absolutePath);
    }).pipe(
      Effect.provide(ReportStorage.layer),
      Effect.provide(Layer.succeed(GitRepoRoot, tempDir)),
      Effect.provide(NodeServices.layer),
    ),
  );

const runLoadExit = (absolutePath: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const storage = yield* ReportStorage;
      return yield* storage.load(absolutePath);
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

  it("list returns an empty array when the reports directory is missing", async () => {
    const manifests = await runList();
    expect(manifests).toEqual([]);
  });

  it("list returns manifests sorted desc by collectedAt, skipping latest.json and malformed files", async () => {
    const reportA = makeReport({
      id: PlanId.makeUnsafe("plan-a"),
      title: "Report A",
      targetUrls: ["https://a.example.com/path"],
    });
    const reportB = makeReport({
      id: PlanId.makeUnsafe("plan-b"),
      title: "Report B",
      targetUrls: ["https://b.example.com/path"],
      currentBranch: "feature/b",
    });

    const persistedA = Option.getOrThrow(await runSave(reportA));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const persistedB = Option.getOrThrow(await runSave(reportB));

    const reportsDir = path.join(tempDir, PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME);
    fs.writeFileSync(path.join(reportsDir, "malformed.json"), "{not valid json", "utf-8");
    expect(fs.existsSync(path.join(reportsDir, REPORT_LATEST_JSON_NAME))).toBe(true);

    const manifests = await runList();

    const filenames = manifests.map((manifest) => manifest.filename);
    expect(filenames).not.toContain(REPORT_LATEST_JSON_NAME);
    expect(filenames).not.toContain("malformed.json");

    expect(manifests).toHaveLength(2);
    expect(manifests[0]!.filename).toBe(path.basename(persistedB.jsonPath));
    expect(manifests[1]!.filename).toBe(path.basename(persistedA.jsonPath));
    expect(manifests[0]!.collectedAt.getTime()).toBeGreaterThanOrEqual(
      manifests[1]!.collectedAt.getTime(),
    );

    expect(manifests[0]!.url).toBe("https://b.example.com/path");
    expect(manifests[0]!.branch).toBe("feature/b");
    expect(manifests[0]!.id).toBe("plan-b");
    expect(manifests[0]!.title).toBe("Report B");
    expect(manifests[0]!.status).toBe("passed");
  });

  it("load round-trips a freshly-written report through save and load", async () => {
    const report = makeReport();
    const persisted = Option.getOrThrow(await runSave(report));

    const loaded = await runLoad(persisted.jsonPath);
    expect(loaded.id).toBe(report.id);
    expect(loaded.title).toBe(report.title);
    expect(loaded.currentBranch).toBe(report.currentBranch);
    expect(loaded.targetUrls).toEqual(report.targetUrls);
    expect(loaded.metrics).toHaveLength(report.metrics.length);
    expect(Option.isNone(loaded.pullRequest)).toBe(true);
    expect(loaded.status).toBe(report.status);
  });

  it("load decodes a legacy payload containing pullRequest Option marker", async () => {
    const report = makeReport();
    const persisted = Option.getOrThrow(await runSave(report));

    const raw = JSON.parse(fs.readFileSync(persisted.jsonPath, "utf-8")) as Record<string, unknown>;
    const legacy = { ...raw, pullRequest: { _id: "Option", _tag: "None" } };
    fs.writeFileSync(persisted.jsonPath, `${JSON.stringify(legacy, undefined, 2)}\n`, "utf-8");

    const loaded = await runLoad(persisted.jsonPath);
    expect(loaded.id).toBe(report.id);
    expect(Option.isNone(loaded.pullRequest)).toBe(true);
  });

  it("load decodes a real legacy fixture captured from .perf-agent/reports/", async () => {
    const reportsDir = path.join(tempDir, PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME);
    fs.mkdirSync(reportsDir, { recursive: true });
    const fixturePath = path.join(
      __dirname,
      "fixtures",
      "legacy-report-task61.json",
    );
    const targetPath = path.join(reportsDir, "legacy-report.json");
    fs.copyFileSync(fixturePath, targetPath);

    const loaded = await runLoad(targetPath);
    expect(loaded.id.length).toBeGreaterThan(0);
    expect(loaded.title.length).toBeGreaterThan(0);
    // The fixture has baseUrl wrapped as {_id:"Option",_tag:"Some",value:"..."}
    expect(Option.isSome(loaded.baseUrl)).toBe(true);
  });

  it("list returns manifests for a real legacy fixture", async () => {
    const reportsDir = path.join(tempDir, PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME);
    fs.mkdirSync(reportsDir, { recursive: true });
    const fixturePath = path.join(
      __dirname,
      "fixtures",
      "legacy-report-task61.json",
    );
    fs.copyFileSync(fixturePath, path.join(reportsDir, "legacy-report.json"));

    const manifests = await runList();
    expect(manifests).toHaveLength(1);
    expect(manifests[0]!.filename).toBe("legacy-report.json");
    expect(manifests[0]!.id.length).toBeGreaterThan(0);
  });

  it("load round-trips a report whose baseUrl is Some and pullRequest is None", async () => {
    const report = makeReport({ baseUrl: Option.some("https://agent.perflab.io") });
    const persisted = Option.getOrThrow(await runSave(report));

    const loaded = await runLoad(persisted.jsonPath);
    expect(Option.isNone(loaded.pullRequest)).toBe(true);
    expect(Option.isSome(loaded.baseUrl)).toBe(true);
    expect(Option.getOrThrow(loaded.baseUrl)).toBe("https://agent.perflab.io");
  });

  it("load propagates ReportLoadError for truncated JSON", async () => {
    const reportsDir = path.join(tempDir, PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME);
    fs.mkdirSync(reportsDir, { recursive: true });
    const filePath = path.join(reportsDir, "broken.json");
    fs.writeFileSync(filePath, '{"title": "boom"', "utf-8");

    const exit = await runLoadExit(filePath);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const pretty = JSON.stringify(exit.cause);
      expect(pretty).toContain("ReportLoadError");
      expect(pretty).toContain("broken.json");
    }
  });

  it("load propagates ReportLoadError for schema-mismatched JSON", async () => {
    const reportsDir = path.join(tempDir, PERF_AGENT_STATE_DIR, REPORT_DIRECTORY_NAME);
    fs.mkdirSync(reportsDir, { recursive: true });
    const filePath = path.join(reportsDir, "wrong-shape.json");
    fs.writeFileSync(filePath, JSON.stringify({ not: "a report" }), "utf-8");

    const exit = await runLoadExit(filePath);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const pretty = JSON.stringify(exit.cause);
      expect(pretty).toContain("ReportLoadError");
      expect(pretty).toContain("wrong-shape.json");
    }
  });
});
