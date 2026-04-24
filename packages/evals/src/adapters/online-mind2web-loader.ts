import * as path from "node:path";
import { Config, Effect, Layer, Option, Schema, ServiceMap } from "effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/unstable/http/HttpClient";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { EvalTask } from "../task";
import {
  DATASET_VERSION,
  DEFAULT_MAX_KEY_NODES,
  HUGGINGFACE_DATASET_URL,
  Mind2WebDataset,
  Mind2WebSchemaError,
  buildManifest,
  filterByKeyNodeCount,
  mind2webToEvalTask,
  type DatasetManifest,
  type Mind2WebTask,
} from "./online-mind2web";

export class Mind2WebDownloadError extends Schema.ErrorClass<Mind2WebDownloadError>(
  "Mind2WebDownloadError",
)({
  _tag: Schema.tag("Mind2WebDownloadError"),
  url: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to download Online-Mind2Web dataset from ${this.url}: ${this.cause}. Set HUGGINGFACE_TOKEN (accept the gated dataset terms at https://huggingface.co/datasets/osunlp/Online-Mind2Web first) or populate the cache at the configured EVAL_MIND2WEB_DATA_DIR.`;
}

export class Mind2WebCacheError extends Schema.ErrorClass<Mind2WebCacheError>("Mind2WebCacheError")(
  {
    _tag: Schema.tag("Mind2WebCacheError"),
    filePath: Schema.String,
    cause: Schema.String,
  },
) {
  message = `Online-Mind2Web cache operation failed at ${this.filePath}: ${this.cause}`;
}

export const DEFAULT_DATA_DIR = "packages/evals/data/online-mind2web";
const RAW_FILE_NAME = "Online_Mind2Web.json";
const MANIFEST_FILE_NAME = "cached-tasks.json";

export interface LoadSubsetOptions {
  readonly maxKeyNodes?: number;
  readonly limit?: number;
  readonly dataDir?: string;
  readonly refresh?: boolean;
}

export interface LoadedSubset {
  readonly tasks: ReadonlyArray<EvalTask>;
  readonly rawTasks: ReadonlyArray<Mind2WebTask>;
  readonly manifest: DatasetManifest;
  readonly source: "cache" | "download";
}

const ManifestSchema = Schema.Struct({
  version: Schema.String,
  source: Schema.String,
  totalCount: Schema.Number,
  filteredCount: Schema.Number,
  maxKeyNodes: Schema.Number,
  entries: Schema.Array(
    Schema.Struct({
      taskId: Schema.String,
      referenceLength: Schema.Number,
      website: Schema.String,
    }),
  ),
});

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(ManifestSchema));
const decodeRawDataset = Schema.decodeEffect(Schema.fromJsonString(Mind2WebDataset));

/**
 * OnlineMind2WebLoader — hydrates the 300-task Online-Mind2Web benchmark into
 * our EvalTask fixture format.
 *
 * Disk shape (DEFAULT_DATA_DIR, relative to repo root):
 *   raw/Online_Mind2Web.json      # downloaded once, gitignored
 *   cached-tasks.json             # small manifest checked into git as cache-drift sentinel
 *
 * Download strategy:
 *   1. Read raw cache. If present, decode + filter + done (no network).
 *   2. If absent, HTTP GET Online_Mind2Web.json (auth via HUGGINGFACE_TOKEN).
 *   3. On success, persist raw + manifest side-by-side.
 *   4. On failure, surface Mind2WebDownloadError with remediation text
 *      (accept the gated-dataset terms, set the token, or populate cache).
 */
export class OnlineMind2WebLoader extends ServiceMap.Service<OnlineMind2WebLoader>()(
  "@evals/OnlineMind2WebLoader",
  {
    make: Effect.gen(function* () {
      const tokenOption = yield* Config.option(Config.string("HUGGINGFACE_TOKEN"));
      const fileSystem = yield* FileSystem.FileSystem;
      const httpClient = yield* HttpClient;

      const readCachedRaw = Effect.fn("OnlineMind2WebLoader.readCachedRaw")(function* (
        rawPath: string,
      ) {
        const exists = yield* fileSystem
          .exists(rawPath)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)));
        if (!exists) return Option.none<ReadonlyArray<Mind2WebTask>>();
        const contents = yield* fileSystem.readFileString(rawPath).pipe(
          Effect.catchTag("PlatformError", (platformError) =>
            new Mind2WebCacheError({
              filePath: rawPath,
              cause: platformError.message,
            }).asEffect(),
          ),
        );
        const parsed = yield* decodeRawDataset(contents).pipe(
          Effect.catchTag("SchemaError", (schemaError) =>
            new Mind2WebSchemaError({
              cause: `${rawPath}: ${schemaError.message}`,
            }).asEffect(),
          ),
        );
        return Option.some(parsed);
      });

      const downloadRawDataset = Effect.fn("OnlineMind2WebLoader.downloadRawDataset")(function* (
        url: string,
      ) {
        // HuggingFace's resolve endpoint serves JSON without requiring an
        // Accept header — pinning `accept: application/json` made it brittle
        // if the upstream content-type ever diverged. We read the body as
        // text either way and schema-decode via JSON-from-string.
        const headers: Record<string, string> = {};
        if (Option.isSome(tokenOption)) {
          headers["authorization"] = `Bearer ${tokenOption.value}`;
        }
        const response = yield* httpClient.get(url, { headers }).pipe(
          Effect.catchTag("HttpClientError", (httpError) =>
            new Mind2WebDownloadError({
              url,
              cause: httpError.message,
            }).asEffect(),
          ),
        );
        if (response.status < 200 || response.status >= 300) {
          const bodyPreview = yield* response.text.pipe(
            Effect.catchTag("HttpClientError", () => Effect.succeed("<unreadable>")),
          );
          return yield* new Mind2WebDownloadError({
            url,
            cause: `HTTP ${response.status}: ${bodyPreview.slice(0, 200)}`,
          }).asEffect();
        }
        const body = yield* response.text.pipe(
          Effect.catchTag("HttpClientError", (httpError) =>
            new Mind2WebDownloadError({
              url,
              cause: httpError.message,
            }).asEffect(),
          ),
        );
        const parsed = yield* decodeRawDataset(body).pipe(
          Effect.catchTag("SchemaError", (schemaError) =>
            new Mind2WebSchemaError({
              cause: `download: ${schemaError.message}`,
            }).asEffect(),
          ),
        );
        return { body, parsed } as const;
      });

      const writeRawCache = Effect.fn("OnlineMind2WebLoader.writeRawCache")(function* (
        rawPath: string,
        body: string,
      ) {
        yield* fileSystem.makeDirectory(path.dirname(rawPath), { recursive: true }).pipe(
          Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
          Effect.catchTag("PlatformError", (platformError) =>
            new Mind2WebCacheError({
              filePath: rawPath,
              cause: platformError.message,
            }).asEffect(),
          ),
        );
        yield* fileSystem.writeFileString(rawPath, body).pipe(
          Effect.catchTag("PlatformError", (platformError) =>
            new Mind2WebCacheError({
              filePath: rawPath,
              cause: platformError.message,
            }).asEffect(),
          ),
        );
      });

      const writeManifestFile = Effect.fn("OnlineMind2WebLoader.writeManifest")(function* (
        manifestPath: string,
        manifest: DatasetManifest,
      ) {
        yield* fileSystem.makeDirectory(path.dirname(manifestPath), { recursive: true }).pipe(
          Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
          Effect.catchTag("PlatformError", (platformError) =>
            new Mind2WebCacheError({
              filePath: manifestPath,
              cause: platformError.message,
            }).asEffect(),
          ),
        );
        const payload = `${JSON.stringify(manifest, null, 2)}\n`;
        yield* fileSystem.writeFileString(manifestPath, payload).pipe(
          Effect.catchTag("PlatformError", (platformError) =>
            new Mind2WebCacheError({
              filePath: manifestPath,
              cause: platformError.message,
            }).asEffect(),
          ),
        );
      });

      const readCachedManifest = Effect.fn("OnlineMind2WebLoader.readCachedManifest")(function* (
        manifestPath: string,
      ) {
        const exists = yield* fileSystem
          .exists(manifestPath)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)));
        if (!exists) return Option.none<DatasetManifest>();
        const contents = yield* fileSystem.readFileString(manifestPath).pipe(
          Effect.catchTag("PlatformError", (platformError) =>
            new Mind2WebCacheError({
              filePath: manifestPath,
              cause: platformError.message,
            }).asEffect(),
          ),
        );
        const manifest = yield* decodeManifest(contents).pipe(
          Effect.catchTag("SchemaError", (schemaError) =>
            new Mind2WebSchemaError({
              cause: `${manifestPath}: ${schemaError.message}`,
            }).asEffect(),
          ),
        );
        return Option.some<DatasetManifest>(manifest);
      });

      const resolvePaths = (dataDir: string) => ({
        rawPath: path.join(dataDir, "raw", RAW_FILE_NAME),
        manifestPath: path.join(dataDir, MANIFEST_FILE_NAME),
      });

      const loadSubset = Effect.fn("OnlineMind2WebLoader.loadSubset")(function* (
        options?: LoadSubsetOptions,
      ) {
        const maxKeyNodes = options?.maxKeyNodes ?? DEFAULT_MAX_KEY_NODES;
        const limit = options?.limit;
        const dataDir = options?.dataDir ?? DEFAULT_DATA_DIR;
        const refresh = options?.refresh ?? false;
        yield* Effect.annotateCurrentSpan({
          maxKeyNodes,
          limit: limit ?? "unlimited",
          dataDir,
          refresh,
        });

        const { rawPath, manifestPath } = resolvePaths(dataDir);
        let source: "cache" | "download" = "cache";
        let rawTasks: ReadonlyArray<Mind2WebTask>;

        if (refresh) {
          const downloaded = yield* downloadRawDataset(HUGGINGFACE_DATASET_URL);
          yield* writeRawCache(rawPath, downloaded.body);
          rawTasks = downloaded.parsed;
          source = "download";
        } else {
          const cached = yield* readCachedRaw(rawPath);
          if (Option.isSome(cached)) {
            rawTasks = cached.value;
          } else {
            const downloaded = yield* downloadRawDataset(HUGGINGFACE_DATASET_URL);
            yield* writeRawCache(rawPath, downloaded.body);
            rawTasks = downloaded.parsed;
            source = "download";
          }
        }

        const filtered = filterByKeyNodeCount(rawTasks, maxKeyNodes);
        const limited =
          limit !== undefined && filtered.length > limit ? filtered.slice(0, limit) : filtered;

        const manifest = buildManifest(
          rawTasks.length,
          limited,
          maxKeyNodes,
          HUGGINGFACE_DATASET_URL,
          DATASET_VERSION,
        );
        yield* writeManifestFile(manifestPath, manifest);

        const tasks = limited.map(mind2webToEvalTask);

        yield* Effect.logInfo("Online-Mind2Web subset loaded", {
          total: rawTasks.length,
          filtered: filtered.length,
          limited: limited.length,
          maxKeyNodes,
          source,
        });

        return {
          tasks,
          rawTasks: limited,
          manifest,
          source,
        } satisfies LoadedSubset;
      });

      return { loadSubset, readCachedManifest } as const;
    }),
  },
) {
  static layer = Layer.effect(this)(this.make).pipe(
    Layer.provide(NodeServices.layer),
    Layer.provide(NodeHttpClient.layerUndici),
  );

  /**
   * layerFromDeps — bare loader layer that does NOT provide HttpClient or
   * FileSystem. Callers supply them via `Layer.provide` so tests can inject
   * a fake HttpClient (built with `HttpClient.make`) while production flows
   * use `NodeServices.layer` + `NodeHttpClient.layerUndici` through the
   * default `static layer` above. Separating these avoids the
   * feedback_no_test_only_injection_seams trap: the production path and the
   * test path both flow through the same `make` — only the transport layer
   * changes.
   */
  static layerFromDeps = Layer.effect(this)(this.make);
}
