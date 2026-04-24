import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, assert, describe, it } from "vite-plus/test";
import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HttpClientMod from "effect/unstable/http/HttpClient";
import { HttpClientResponse } from "effect/unstable/http";
import {
  DATASET_VERSION,
  filterByKeyNodeCount,
  HUGGINGFACE_DATASET_URL,
  Mind2WebSchemaError,
  buildManifest,
  decodeMind2WebTasks,
  mind2webToEvalTask,
  prefixedTaskId,
  type Mind2WebTask,
} from "../src/adapters/online-mind2web";
import {
  Mind2WebDownloadError,
  OnlineMind2WebLoader,
} from "../src/adapters/online-mind2web-loader";
import { EvalTask } from "../src/task";

const sampleMind2WebTasks: ReadonlyArray<Mind2WebTask> = [
  {
    task_id: "task-alpha",
    website: "https://example.com",
    task_description: "Go to example.com and confirm the home page rendered.",
    reference_length: 1,
  },
  {
    task_id: "task-beta",
    website: "https://news.ycombinator.com",
    task_description: "Navigate to the front page and open the first story.",
    reference_length: 3,
  },
  {
    task_id: "task-gamma",
    website: "https://shop.example.com",
    task_description: "Search for a product and add it to the cart.",
    reference_length: 5,
  },
  {
    task_id: "task-delta",
    website: "https://wiki.example.com",
    task_description: "Browse three consecutive articles through internal links.",
    reference_length: 7,
  },
  {
    task_id: "task-epsilon",
    website: "https://portal.example.com",
    task_description: "Log in, set a preference, verify the confirmation banner.",
    reference_length: 10,
  },
];

const serializeDataset = (dataset: ReadonlyArray<Mind2WebTask>): string => JSON.stringify(dataset);

const tempDirs: string[] = [];

const makeTempDataDir = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mind2web-adapter-test-"));
  tempDirs.push(tempDir);
  return tempDir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

interface FakeHttpClientOptions {
  readonly body: string;
  readonly status?: number;
  readonly callCounter?: { count: number };
}

/**
 * Builds a real HttpClient using `HttpClient.make` so tests exercise the
 * production client wiring end-to-end — only the transport is stubbed. This
 * avoids the feedback_no_test_only_injection_seams trap (no "if test,
 * behave differently" divergence in the loader).
 */
const makeFakeHttpClient = (options: FakeHttpClientOptions): HttpClientMod.HttpClient => {
  const status = options.status ?? 200;
  const counter = options.callCounter;
  return HttpClientMod.make((request) => {
    if (counter) counter.count += 1;
    const webResponse = new Response(options.body, { status });
    return Effect.succeed(HttpClientResponse.fromWeb(request, webResponse));
  });
};

const makeFailingHttpClient = (callCounter?: { count: number }): HttpClientMod.HttpClient =>
  HttpClientMod.make((request) => {
    if (callCounter) callCounter.count += 1;
    const webResponse = new Response("Access to dataset osunlp/Online-Mind2Web is restricted.", {
      status: 401,
    });
    return Effect.succeed(HttpClientResponse.fromWeb(request, webResponse));
  });

const buildLoaderLayer = (fakeHttpClient: HttpClientMod.HttpClient) =>
  OnlineMind2WebLoader.layerFromDeps.pipe(
    Layer.provide(Layer.succeed(HttpClientMod.HttpClient, fakeHttpClient)),
    Layer.provide(NodeServices.layer),
  );

describe("Online-Mind2Web adapter transform", () => {
  it("transforms a canned Mind2Web task into a Schema-valid EvalTask", () => {
    const [raw] = sampleMind2WebTasks;
    const transformed = mind2webToEvalTask(raw);
    assert.strictEqual(transformed.id, prefixedTaskId(raw.task_id));
    assert.strictEqual(transformed.prompt, raw.task_description);
    assert.isAbove(transformed.keyNodes.length, 0);
    assert.isUndefined(transformed.perfBudget);
    // Decoding through EvalTask.Schema proves we match the locked fixture shape
    const encoded = EvalTask.make({
      id: transformed.id,
      prompt: transformed.prompt,
      keyNodes: transformed.keyNodes,
      expectedFinalState: transformed.expectedFinalState,
    });
    assert.strictEqual(encoded.id, transformed.id);
  });

  it("preserves prompts verbatim (overfitting guard)", () => {
    for (const raw of sampleMind2WebTasks) {
      const transformed = mind2webToEvalTask(raw);
      assert.strictEqual(transformed.prompt, raw.task_description);
    }
  });

  it("derives a url-rooted KeyNode that matches the website host", () => {
    const raw: Mind2WebTask = {
      task_id: "url-regex",
      website: "https://www.example.com/app",
      task_description: "Example task",
      reference_length: 2,
    };
    const transformed = mind2webToEvalTask(raw);
    const pattern = new RegExp(transformed.keyNodes[0].urlPattern);
    assert.isTrue(pattern.test("https://www.example.com/app"));
    assert.isTrue(pattern.test("https://www.example.com/app/details"));
    assert.isFalse(pattern.test("https://evil.example.com/app"));
  });
});

describe("Online-Mind2Web filter", () => {
  it("filters by key-node count (reference_length) using maxKeyNodes=5", () => {
    const filtered = filterByKeyNodeCount(sampleMind2WebTasks, 5);
    assert.strictEqual(filtered.length, 3);
    assert.deepStrictEqual(
      filtered.map((task) => task.task_id),
      ["task-alpha", "task-beta", "task-gamma"],
    );
  });

  it("returns the same list when every task is under the threshold", () => {
    const filtered = filterByKeyNodeCount(sampleMind2WebTasks, 100);
    assert.strictEqual(filtered.length, sampleMind2WebTasks.length);
  });

  it("returns empty when the threshold is below the smallest reference_length", () => {
    const filtered = filterByKeyNodeCount(sampleMind2WebTasks, 0);
    assert.strictEqual(filtered.length, 0);
  });
});

describe("Online-Mind2Web decoder", () => {
  it("decodes a well-formed raw payload", async () => {
    const decoded = await Effect.runPromise(decodeMind2WebTasks(sampleMind2WebTasks));
    assert.strictEqual(decoded.length, sampleMind2WebTasks.length);
  });

  it("fails Schema-invalid payloads with a structured Mind2WebSchemaError", async () => {
    const malformed: ReadonlyArray<unknown> = [
      { task_id: 42, website: "not-a-string", task_description: null, reference_length: "seven" },
    ];
    const exit = await Effect.runPromise(decodeMind2WebTasks(malformed).pipe(Effect.flip));
    assert.isTrue(exit instanceof Mind2WebSchemaError);
    assert.include(exit.message, "Online-Mind2Web");
  });
});

describe("Online-Mind2Web loader cache behavior", () => {
  it("downloads on first call, reads from disk on second call", async () => {
    const dataDir = makeTempDataDir();
    const counter = { count: 0 };
    const httpFake = makeFakeHttpClient({
      body: serializeDataset(sampleMind2WebTasks),
      callCounter: counter,
    });

    const loadOnce = Effect.gen(function* () {
      const loader = yield* OnlineMind2WebLoader;
      return yield* loader.loadSubset({ maxKeyNodes: 5, dataDir });
    });

    const first = await Effect.runPromise(
      loadOnce.pipe(Effect.provide(buildLoaderLayer(httpFake))),
    );
    assert.strictEqual(first.source, "download");
    assert.strictEqual(first.tasks.length, 3);
    assert.strictEqual(counter.count, 1);

    // Second call re-uses the on-disk cache — we even switch to a failing
    // client to prove no network traffic is attempted.
    const failingHttpFake = makeFailingHttpClient();
    const second = await Effect.runPromise(
      loadOnce.pipe(Effect.provide(buildLoaderLayer(failingHttpFake))),
    );
    assert.strictEqual(second.source, "cache");
    assert.strictEqual(second.tasks.length, 3);
    assert.deepStrictEqual(
      second.tasks.map((task) => task.id),
      first.tasks.map((task) => task.id),
    );
  });

  it("writes cached-tasks.json manifest with schema-valid metadata", async () => {
    const dataDir = makeTempDataDir();
    const httpFake = makeFakeHttpClient({ body: serializeDataset(sampleMind2WebTasks) });
    const program = Effect.gen(function* () {
      const loader = yield* OnlineMind2WebLoader;
      return yield* loader.loadSubset({ maxKeyNodes: 5, dataDir });
    });
    await Effect.runPromise(program.pipe(Effect.provide(buildLoaderLayer(httpFake))));

    const manifestPath = path.join(dataDir, "cached-tasks.json");
    assert.isTrue(fs.existsSync(manifestPath));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.strictEqual(manifest.version, DATASET_VERSION);
    assert.strictEqual(manifest.source, HUGGINGFACE_DATASET_URL);
    assert.strictEqual(manifest.totalCount, sampleMind2WebTasks.length);
    assert.strictEqual(manifest.filteredCount, 3);
    assert.strictEqual(manifest.maxKeyNodes, 5);
    assert.strictEqual(manifest.entries.length, 3);
  });

  it("honors the limit option after filtering", async () => {
    const dataDir = makeTempDataDir();
    const httpFake = makeFakeHttpClient({ body: serializeDataset(sampleMind2WebTasks) });
    const program = Effect.gen(function* () {
      const loader = yield* OnlineMind2WebLoader;
      return yield* loader.loadSubset({ maxKeyNodes: 5, limit: 2, dataDir });
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(buildLoaderLayer(httpFake))),
    );
    assert.strictEqual(result.tasks.length, 2);
    assert.strictEqual(result.manifest.filteredCount, 2);
  });

  it("refresh=true bypasses the cache and re-downloads", async () => {
    const dataDir = makeTempDataDir();
    const counter = { count: 0 };
    const httpFake = makeFakeHttpClient({
      body: serializeDataset(sampleMind2WebTasks),
      callCounter: counter,
    });

    const loadOnce = Effect.gen(function* () {
      const loader = yield* OnlineMind2WebLoader;
      return yield* loader.loadSubset({ maxKeyNodes: 5, dataDir });
    });
    const loadRefresh = Effect.gen(function* () {
      const loader = yield* OnlineMind2WebLoader;
      return yield* loader.loadSubset({ maxKeyNodes: 5, dataDir, refresh: true });
    });

    await Effect.runPromise(loadOnce.pipe(Effect.provide(buildLoaderLayer(httpFake))));
    await Effect.runPromise(loadRefresh.pipe(Effect.provide(buildLoaderLayer(httpFake))));
    assert.strictEqual(counter.count, 2);
  });
});

describe("Online-Mind2Web loader error surfaces", () => {
  it("surfaces a structured Mind2WebDownloadError on 401 (gated dataset not accepted)", async () => {
    const dataDir = makeTempDataDir();
    const failingHttpFake = makeFailingHttpClient();
    const program = Effect.gen(function* () {
      const loader = yield* OnlineMind2WebLoader;
      return yield* loader.loadSubset({ maxKeyNodes: 5, dataDir });
    });
    const exit = await Effect.runPromise(
      program.pipe(Effect.provide(buildLoaderLayer(failingHttpFake))).pipe(Effect.flip),
    );
    assert.isTrue(exit instanceof Mind2WebDownloadError);
    assert.include(exit.message, "HTTP 401");
    assert.include(exit.message, "HUGGINGFACE_TOKEN");
  });

  it("surfaces Mind2WebSchemaError when the remote payload is malformed", async () => {
    const dataDir = makeTempDataDir();
    const brokenPayload = JSON.stringify([{ not_a_real_field: 1 }]);
    const httpFake = makeFakeHttpClient({ body: brokenPayload });
    const program = Effect.gen(function* () {
      const loader = yield* OnlineMind2WebLoader;
      return yield* loader.loadSubset({ maxKeyNodes: 5, dataDir });
    });
    const exit = await Effect.runPromise(
      program.pipe(Effect.provide(buildLoaderLayer(httpFake))).pipe(Effect.flip),
    );
    assert.isTrue(exit instanceof Mind2WebSchemaError);
  });
});

describe("Online-Mind2Web manifest builder", () => {
  it("buildManifest carries totals, filter threshold, and the expected entries", () => {
    const filtered = filterByKeyNodeCount(sampleMind2WebTasks, 3);
    const manifest = buildManifest(
      sampleMind2WebTasks.length,
      filtered,
      3,
      HUGGINGFACE_DATASET_URL,
      DATASET_VERSION,
    );
    assert.strictEqual(manifest.totalCount, sampleMind2WebTasks.length);
    assert.strictEqual(manifest.filteredCount, filtered.length);
    assert.strictEqual(manifest.maxKeyNodes, 3);
    assert.deepStrictEqual(
      manifest.entries.map((entry) => entry.taskId),
      filtered.map((task) => task.task_id),
    );
  });
});
