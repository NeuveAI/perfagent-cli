import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Config, Effect, Schema } from "effect";
import { buildLocalAgentSystemPrompt } from "@neuve/shared/prompts";
import { buildModelfile, ModelfileBuilderError } from "../../src/distill/modelfile-builder";
import { convertTrainingMessagesToModelfileMessages } from "../../src/distill/modelfile-messages";
import { TrainingSample } from "../../src/distill/types";

/**
 * smoke-finetune — end-to-end smoke check for the distillation pipeline.
 *
 * What this does:
 *   1. Read the teacher-data JSONL file.
 *   2. Take the first sample as a one-shot example.
 *   3. Build a Modelfile referencing the base model (NO ADAPTER — real LoRA
 *      training requires a provisioned GPU; this stub creates a derivative
 *      Ollama model that only differs from the base by SYSTEM + MESSAGE
 *      examples, proving the `ollama create` path is wired up end-to-end).
 *   4. Run `ollama create <smoke-model>` against the temp Modelfile.
 *   5. Call Ollama's `/api/generate` HTTP endpoint with a canned prompt and
 *      assert that the response is non-empty.
 *   6. Clean up the temp model via `ollama rm` (inside `Effect.acquireRelease`
 *      — runs even on failure).
 *
 * What this does NOT do:
 *   - Run actual LoRA fine-tuning. That requires a GPU and a training
 *     framework (e.g. Unsloth, axolotl) that consumes the JSONL, produces
 *     a `.gguf` adapter, and then `ollama create` wires that adapter via
 *     the ADAPTER directive. That pipeline runs off-repo on provisioned
 *     infra; this script validates the Ollama-side plumbing only.
 *
 * Exit codes:
 *   0 — created + prompted + removed the smoke model; non-empty response.
 *   1 — Ollama unavailable, base model missing, create/generate failed,
 *       OR the model returned an empty response.
 */

const DEFAULT_BASE_MODEL = "gemma4:e4b";
const DEFAULT_INPUT = "packages/evals/data/distill/out/teacher-data.jsonl";
const DEFAULT_SMOKE_MODEL_NAME = "perfagent-smoke-finetune";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const SMOKE_GENERATE_TIMEOUT_MS = 120_000;

class OllamaUnavailableError extends Schema.ErrorClass<OllamaUnavailableError>(
  "OllamaUnavailableError",
)({
  _tag: Schema.tag("OllamaUnavailableError"),
  cause: Schema.String,
}) {
  message = `Ollama is not available (${this.cause}). Install from https://ollama.com and run \`ollama serve\`.`;
}

class OllamaBaseModelMissingError extends Schema.ErrorClass<OllamaBaseModelMissingError>(
  "OllamaBaseModelMissingError",
)({
  _tag: Schema.tag("OllamaBaseModelMissingError"),
  baseModel: Schema.String,
  listing: Schema.String,
}) {
  message = `Base model ${this.baseModel} is not pulled. Run \`ollama pull ${this.baseModel}\`. ollama list:\n${this.listing}`;
}

class SmokeSampleMissingError extends Schema.ErrorClass<SmokeSampleMissingError>(
  "SmokeSampleMissingError",
)({
  _tag: Schema.tag("SmokeSampleMissingError"),
  jsonlPath: Schema.String,
}) {
  message = `No samples available in ${this.jsonlPath}. Run \`pnpm --filter @neuve/evals distill:export\` first.`;
}

class OllamaCreateFailedError extends Schema.ErrorClass<OllamaCreateFailedError>(
  "OllamaCreateFailedError",
)({
  _tag: Schema.tag("OllamaCreateFailedError"),
  smokeModel: Schema.String,
  exitCode: Schema.Number,
  stderr: Schema.String,
}) {
  message = `\`ollama create ${this.smokeModel}\` exited with code ${this.exitCode}: ${this.stderr}`;
}

class OllamaGenerateFailedError extends Schema.ErrorClass<OllamaGenerateFailedError>(
  "OllamaGenerateFailedError",
)({
  _tag: Schema.tag("OllamaGenerateFailedError"),
  smokeModel: Schema.String,
  cause: Schema.String,
}) {
  message = `Ollama \`/api/generate\` failed for ${this.smokeModel}: ${this.cause}`;
}

class OllamaEmptyResponseError extends Schema.ErrorClass<OllamaEmptyResponseError>(
  "OllamaEmptyResponseError",
)({
  _tag: Schema.tag("OllamaEmptyResponseError"),
  smokeModel: Schema.String,
}) {
  message = `Smoke model ${this.smokeModel} returned an empty response. Likely causes: Modelfile integration bug, chat template mismatch, or base model failure to load. Re-verify the generated Modelfile and system prompt.`;
}

const baseModelConfig = Config.string("EVAL_DISTILL_BASE_MODEL").pipe(
  Config.withDefault(DEFAULT_BASE_MODEL),
);
const inputConfig = Config.string("EVAL_DISTILL_INPUT").pipe(Config.withDefault(DEFAULT_INPUT));
const smokeModelConfig = Config.string("EVAL_DISTILL_SMOKE_MODEL").pipe(
  Config.withDefault(DEFAULT_SMOKE_MODEL_NAME),
);
const ollamaUrlConfig = Config.string("PERF_AGENT_OLLAMA_URL").pipe(
  Config.withDefault(DEFAULT_OLLAMA_URL),
);

const OllamaGenerateResponse = Schema.Struct({
  response: Schema.String,
});
const decodeGenerateResponse = Schema.decodeUnknownSync(OllamaGenerateResponse);

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

const runCommand = (command: string, args: ReadonlyArray<string>): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (next: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(next);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => settle({ stdout, stderr, code: code ?? -1 }));
  });

const decodeSample = Schema.decodeUnknownSync(TrainingSample);
const JsonLine = Schema.fromJsonString(Schema.Unknown);
const decodeJsonLine = Schema.decodeUnknownSync(JsonLine);

const readFirstSample = (jsonlPath: string): TrainingSample | undefined => {
  if (!fs.existsSync(jsonlPath)) return undefined;
  const contents = fs.readFileSync(jsonlPath, "utf8");
  const firstLine = contents.split("\n").find((line) => line.length > 0);
  if (firstLine === undefined) return undefined;
  return decodeSample(decodeJsonLine(firstLine));
};

const acquireTempDir = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "perfagent-smoke-"))),
  (dir) =>
    Effect.sync(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }),
);

const program = Effect.gen(function* () {
  const baseModel = yield* baseModelConfig;
  const input = yield* inputConfig;
  const smokeModel = yield* smokeModelConfig;
  const ollamaUrl = yield* ollamaUrlConfig;

  yield* Effect.logInfo("Smoke fine-tune starting", { baseModel, input, smokeModel });

  const ollamaCheck = yield* Effect.tryPromise({
    try: () => runCommand("ollama", ["list"]),
    catch: (cause) =>
      new OllamaUnavailableError({
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (ollamaCheck.code !== 0) {
    return yield* new OllamaUnavailableError({
      cause: `\`ollama list\` exited with code ${ollamaCheck.code}: ${ollamaCheck.stderr}`,
    });
  }
  if (!ollamaCheck.stdout.includes(baseModel)) {
    return yield* new OllamaBaseModelMissingError({ baseModel, listing: ollamaCheck.stdout });
  }

  const sample = readFirstSample(input);
  if (sample === undefined) {
    return yield* new SmokeSampleMissingError({ jsonlPath: input });
  }
  yield* Effect.logInfo("Loaded sample", {
    taskId: sample.metadata.taskId,
    messageCount: sample.messages.length,
    hash: sample.metadata.contentHash.slice(0, 12),
  });

  const exampleMessages = convertTrainingMessagesToModelfileMessages(sample.messages).slice(0, 4);

  const modelfile = yield* Effect.try({
    try: () =>
      buildModelfile({
        baseModel,
        systemPrompt: buildLocalAgentSystemPrompt(),
        parameters: [{ name: "temperature", value: 0.1 }],
        exampleMessages,
        header:
          "Smoke-finetune Modelfile (no ADAPTER — real LoRA adapters are built off-repo on GPU). Disposable.",
      }),
    catch: (cause) =>
      cause instanceof ModelfileBuilderError
        ? cause
        : new ModelfileBuilderError({
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
  });

  const tempDir = yield* acquireTempDir;
  const modelfilePath = path.join(tempDir, "Modelfile");
  fs.writeFileSync(modelfilePath, modelfile, "utf8");
  yield* Effect.logInfo("Temp Modelfile written", { modelfilePath });

  yield* Effect.acquireRelease(
    Effect.gen(function* () {
      const createResult = yield* Effect.tryPromise({
        try: () => runCommand("ollama", ["create", smokeModel, "-f", modelfilePath]),
        catch: (cause) =>
          new OllamaCreateFailedError({
            smokeModel,
            exitCode: -1,
            stderr: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (createResult.code !== 0) {
        return yield* new OllamaCreateFailedError({
          smokeModel,
          exitCode: createResult.code,
          stderr: createResult.stderr,
        });
      }
      yield* Effect.logInfo("Smoke model created", { smokeModel });
      return smokeModel;
    }),
    (createdModel) =>
      Effect.tryPromise({
        try: () => runCommand("ollama", ["rm", createdModel]),
        catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
      }).pipe(
        Effect.tap(() => Effect.logInfo("Smoke model removed", { smokeModel: createdModel })),
        Effect.ignore,
      ),
  );

  const generateResponse = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: smokeModel,
          prompt: "Reply with a single word: ok",
          stream: false,
        }),
        signal: AbortSignal.timeout(SMOKE_GENERATE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      return decodeGenerateResponse(await response.json());
    },
    catch: (cause) =>
      new OllamaGenerateFailedError({
        smokeModel,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  });

  const responseText = generateResponse.response.trim();
  if (responseText.length === 0) {
    return yield* new OllamaEmptyResponseError({ smokeModel });
  }

  yield* Effect.logInfo("Smoke model responded", {
    responseLength: responseText.length,
    responsePreview: responseText.slice(0, 200),
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        smokeModel,
        responseLength: responseText.length,
        responsePreview: responseText.slice(0, 500),
        sourceSample: sample.metadata.sourceTrace,
      },
      null,
      2,
    ),
  );
});

try {
  await Effect.runPromise(Effect.scoped(program));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
