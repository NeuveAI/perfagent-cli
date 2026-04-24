import { Effect, Schema } from "effect";
import { EvalTask, KeyNode } from "../task";

export class Mind2WebSchemaError extends Schema.ErrorClass<Mind2WebSchemaError>(
  "Mind2WebSchemaError",
)({
  _tag: Schema.tag("Mind2WebSchemaError"),
  cause: Schema.String,
}) {
  message = `Online-Mind2Web dataset failed schema validation: ${this.cause}`;
}

/**
 * Mind2WebTask — raw schema as documented on the HuggingFace dataset card
 * (https://huggingface.co/datasets/osunlp/Online-Mind2Web). The live benchmark
 * exposes exactly these four fields. `key_node_states` is mentioned in some
 * papers but is NOT present in Online-Mind2Web's public JSON (they live in
 * the evaluator's prompts, not the dataset payload) — so the adapter derives
 * a single url-scoped KeyNode per task and relies on `reference_length` as
 * the step-count proxy for the ≤5-key-node filter.
 */
export const Mind2WebTask = Schema.Struct({
  task_id: Schema.String,
  website: Schema.String,
  task_description: Schema.String,
  reference_length: Schema.Number,
});
export type Mind2WebTask = typeof Mind2WebTask.Type;

export const Mind2WebDataset = Schema.Array(Mind2WebTask);
export type Mind2WebDataset = typeof Mind2WebDataset.Type;

const decodeDataset = Schema.decodeUnknownEffect(Mind2WebDataset);

export const decodeMind2WebJson = (raw: string) =>
  Schema.decodeEffect(Schema.fromJsonString(Mind2WebDataset))(raw).pipe(
    Effect.catchTag("SchemaError", (schemaError) =>
      new Mind2WebSchemaError({ cause: schemaError.message }).asEffect(),
    ),
  );

export const decodeMind2WebTasks = (parsed: unknown) =>
  decodeDataset(parsed).pipe(
    Effect.catchTag("SchemaError", (schemaError) =>
      new Mind2WebSchemaError({ cause: schemaError.message }).asEffect(),
    ),
  );

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const urlPatternFromWebsite = (website: string): string => {
  const trimmed = website.trim().replace(/\/+$/, "");
  return `^${escapeRegex(trimmed)}(?:/.*)?$`;
};

const ONLINE_MIND2WEB_PREFIX = "online-mind2web-";

export const prefixedTaskId = (mind2webTaskId: string): string =>
  `${ONLINE_MIND2WEB_PREFIX}${mind2webTaskId}`;

/**
 * mind2webToEvalTask — pure transform from one raw Mind2Web task to our
 * EvalTask shape. Prompt stays verbatim (overfitting guard per plan.md — the
 * prompt is user-intent by construction, so mutating it into DOM-heuristic
 * form would defeat the point of pulling an external set).
 *
 * The dataset exposes no per-step DOM annotations, so `keyNodes` is a single
 * url-rooted node pointing at the target website (the only ground truth the
 * dataset guarantees). `reference_length` is carried into `perfCapture` slot
 * metadata indirectly — downstream runners rely on the prompt + the scorers'
 * reached-key-node logic, not on DOM selectors that don't exist.
 *
 * `perfBudget` is intentionally omitted: this set is task-completion scoring
 * only, and making performance claims against live sites we don't control
 * would be noise.
 */
export const mind2webToEvalTask = (task: Mind2WebTask): EvalTask => {
  const urlPattern = urlPatternFromWebsite(task.website);
  return new EvalTask({
    id: prefixedTaskId(task.task_id),
    prompt: task.task_description,
    keyNodes: [
      new KeyNode({
        urlPattern,
        domAssertion: "body",
      }),
    ],
    expectedFinalState: {
      urlPattern,
      domAssertion: "body",
    },
  });
};

/**
 * referenceLengthOf — exposes `reference_length` as the filter key for the
 * ≤maxKeyNodes constraint. The raw dataset's "steps" proxy is the only
 * per-task difficulty signal published, and Wave 4's plan.md filter targets
 * "≤5 key nodes" as a 4B-capability ceiling. Anything else would be guessing.
 */
export const referenceLengthOf = (task: Mind2WebTask): number => task.reference_length;

export const DEFAULT_MAX_KEY_NODES = 5;

export const filterByKeyNodeCount = (
  tasks: ReadonlyArray<Mind2WebTask>,
  maxKeyNodes: number,
): ReadonlyArray<Mind2WebTask> => tasks.filter((task) => referenceLengthOf(task) <= maxKeyNodes);

export interface ManifestEntry {
  readonly taskId: string;
  readonly referenceLength: number;
  readonly website: string;
}

export interface DatasetManifest {
  readonly version: string;
  readonly source: string;
  readonly totalCount: number;
  readonly filteredCount: number;
  readonly maxKeyNodes: number;
  readonly entries: ReadonlyArray<ManifestEntry>;
}

export const buildManifest = (
  totalCount: number,
  filteredTasks: ReadonlyArray<Mind2WebTask>,
  maxKeyNodes: number,
  source: string,
  version: string,
): DatasetManifest => ({
  version,
  source,
  totalCount,
  filteredCount: filteredTasks.length,
  maxKeyNodes,
  entries: filteredTasks.map((task) => ({
    taskId: task.task_id,
    referenceLength: task.reference_length,
    website: task.website,
  })),
});

export const HUGGINGFACE_DATASET_URL =
  "https://huggingface.co/datasets/osunlp/Online-Mind2Web/resolve/main/Online_Mind2Web.json";

export const DATASET_VERSION = "osunlp/Online-Mind2Web@main";
