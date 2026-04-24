# Wave 5 — Distillation pipeline (teacher-data exporter + fine-tune stub)

**Owner:** `distillation-eng`
**Task:** #10
**Status:** 5.A + 5.B feature-complete; real LoRA training deferred to provisioned-GPU infra per plan scope.

## What this wave ships

A complete distillation pipeline with three CLI surfaces:

1. **`pnpm --filter @neuve/evals distill:export`** — scan a directory of
   `evals/traces/*.ndjson` captured by the real runner, filter to successful
   trajectories, redact sensitive fields, and write a JSONL training file in
   Ollama's `/v1/chat/completions` message format.
2. **`pnpm --filter @neuve/evals distill:build-modelfile`** — emit an Ollama
   `Modelfile` that references `gemma4:e4b` as base, declares an `ADAPTER`
   directive for a future LoRA `.gguf`, pins generation parameters, and
   optionally injects the first sample as a few-shot `MESSAGE` block.
3. **`pnpm --filter @neuve/evals distill:smoke-finetune`** — end-to-end
   plumbing check: feeds one sample + base model into `ollama create`,
   confirms the resulting model answers a canned prompt, then removes it.
   No LoRA adapter; proves the Ollama-side wiring, not training itself.

Code lives under `packages/evals/src/distill/` with scripts at
`packages/evals/scripts/distill/`. Nothing outside `packages/evals/` was
modified.

## Training-sample format decision

**Shape:** OpenAI-style chat messages —
`{ role: "system" | "user" | "assistant" | "tool", content, toolCalls?, toolCallId? }[]`.

**Why:** Ollama's `/v1/chat/completions` ingest consumes that shape
verbatim (see `ollama serve` OpenAI-compat docs), and the existing
`@neuve/local-agent` builds identical
`ChatCompletionMessageParam` objects when calling Gemma. Shipping
anything else would introduce a shim between teacher capture and student
training, and shims rot.

**Granularity:** per-trajectory (one sample per successful trace) as the
default, per-turn (one sample per assistant turn) as an option via
`EVAL_DISTILL_GRANULARITY=per-turn`. Per-trajectory preserves sub-goal
continuity — the student sees the full plan → tool_call → tool_result →
plan loop, not just isolated single-turn imitation. Per-turn multiplies
sample count at the cost of dropping cross-turn context; worth trying
later once we have enough traces that sample count isn't the bottleneck.

**Rationale documented inline at**
`packages/evals/src/distill/types.ts:6-20`.

**Example (first sample from `data/distill/examples/sample-teacher-data.jsonl`):**

```
{
  "messages": [
    { "role": "system", "content": "You are a performance analysis agent …" },
    { "role": "user", "content": "Go to example.com and report the page title." },
    {
      "role": "assistant",
      "content": "I'll navigate to example.com and report the page title.\nSTEP_START [\"1\",\"Navigate to example.com\"]",
      "toolCalls": [
        { "id": "tc-000", "name": "mcp__browser__interact",
          "arguments": "{\"action\":{\"command\":\"navigate\",\"url\":\"https://example.com\"}}" }
      ]
    },
    { "role": "tool", "toolCallId": "tc-000",
      "content": "[{\"type\":\"text\",\"text\":\"Successfully navigated to https://example.com.\\n## Pages\\n1: https://example.com/ [selected]\"}]" },
    …
    { "role": "assistant", "content": "The page title is \"Example Domain\".\nRUN_COMPLETED [\"passed\",\"Reported the page title successfully.\"]" }
  ],
  "metadata": {
    "sourceTrace": "synthetic__trivial-1-example-homepage.ndjson",
    "taskId": "trivial-1-example-homepage",
    "runnerName": "synthetic",
    "teacherModel": "claude-sonnet-4-5",
    "turnCount": 3,
    "toolCallCount": 2,
    "contentHash": "<sha256>"
  }
}
```

Status markers (`STEP_START`, `STEP_DONE`, `RUN_COMPLETED`) are appended
to the `content` of the assistant turn that emitted them, preserving the
marker-protocol the Wave 2.B prompt teaches. Tool-call arguments stay as
JSON strings (mirrors the OpenAI tool-call shape on the wire), so the
student learns the exact on-the-wire format it will need to emit.

## Filter + redaction pipeline

**Filter — `isTraceSuccessful`** (`src/distill/filters.ts`): two-gate accept.
1. Reject any trace containing an `ASSERTION_FAILED` marker with
   `category === "abort"` — the abort contaminates the trajectory even if
   a later `RUN_COMPLETED passed` fires (recovery replay, fiber race).
   Round 1 review C1 caught an earlier version that accepted such traces.
2. Trace must end with a `RUN_COMPLETED` status marker whose payload
   starts with `"passed"`. Everything else — failed runs, grace-period
   timeouts, non-abort `ASSERTION_FAILED` that never recovered, traces
   with no run marker — is rejected.

Non-abort `ASSERTION_FAILED` categories (`budget-violation`,
`flake-retry`) are NOT disqualifying on their own — those are
step-level failures that can happen inside otherwise-successful runs.
Only `category === "abort"` poisons the trace.

**Redaction — `redactSensitiveKeys`** (`src/distill/filters.ts`):
deep-clone the tool-call args and tool-result payload, replacing the
value of any key matching `REDACTED_KEY_PATTERN` (the single source of
truth at `src/redaction.ts` — `api[_-]?key|token|password|secret|authorization`,
case-insensitive) with `"[REDACTED]"`. Round 1 review M1 caught an
earlier version that duplicated the regex across `filters.ts` and
`runners/trajectory-summary.ts`; the shared `src/redaction.ts` file is
now imported by both so future edits land in one place. Redaction runs
unconditionally; `containsSensitiveData` is a logging hint, not a gate.

Tool-call `args` arrive as JSON strings on the trace schema. The
exporter JSON-parses them before redacting so sensitive keys embedded
inside the serialized form get caught (`teacher-data-exporter.ts:179-209`).
Test coverage at `tests/teacher-data-exporter.test.ts` — the "redacts
sensitive keys in sample output" case reads the emitted JSONL and
asserts no leaked value strings remain.

**Deduplication:** per-sample sha256 of canonical
`(role, content, toolCall name+args, toolCallId)` tuples
(`teacher-data-exporter.ts:253-267`). Traces that converge on the same
user prompt + tool sequence emit one sample, not N. On the current
20-task set this will likely collapse re-runs of the same successful
trajectory into one sample — expect sample count to be
`successful_trace_count`, not `successful_run_count`.

## Ollama Modelfile format reference

Directives we emit, in the order they appear in the generated file:

| Directive | Purpose | Used via |
|-----------|---------|----------|
| `FROM` | Base model reference | Always |
| `ADAPTER` | Path to LoRA `.gguf` | When provided (omitted for smoke) |
| `PARAMETER` | Generation params (`temperature`, `num_ctx`) | Always |
| `TEMPLATE` | Chat template override | Optional, inherited from base |
| `SYSTEM` | System prompt baked into model | Always (`buildLocalAgentSystemPrompt`) |
| `MESSAGE` | Few-shot example chat turns | Optional, includes 1 sample by default |

`MESSAGE` role is strictly `system | user | assistant` — `tool` is NOT
a valid Modelfile role (Round 1 review C2). Tool-call context from
training samples is projected into the surrounding assistant turn as
`<tool_calls>...</tool_calls>` + `<tool_result id="...">...</tool_result>`
blocks (see `src/distill/modelfile-messages.ts`). Samples' `role: "system"`
messages are dropped during conversion — the `SYSTEM` directive already
owns the system prompt; duplicating it as `MESSAGE system` was O(N)
bloat and incorrect Modelfile shape (Round 1 review M4).

Multi-line arguments are wrapped in Python-style `"""..."""` heredocs
(`modelfile-builder.ts`). Header comments are prefixed with `# `.

**Reference:** Ollama's Modelfile docs live at
[ollama/ollama — docs/modelfile.md](https://github.com/ollama/ollama/blob/main/docs/modelfile.md).
We do **not** depend on a typed Ollama SDK — Ollama's create API
consumes the raw Modelfile text, and no SDK exports Modelfile
grammar types. A contract-test-style version pin is overkill for a
directive set this small, but we centralized directives in
`MODELFILE_DIRECTIVES` (`modelfile-builder.ts:22-30`) so a grammar
change hits one file, and tests assert the expected FROM/ADAPTER/
PARAMETER/SYSTEM ordering.

## Smoke fine-tune outcome

Ollama + `gemma4:e4b` were available locally at wave time.
`pnpm --filter @neuve/evals distill:smoke-finetune
EVAL_DISTILL_INPUT=data/distill/examples/sample-teacher-data.jsonl`
was run end-to-end and completed in ~7 s (Round 2):

1. `ollama list` probe succeeded; `gemma4:e4b` pulled.
2. Script read first sample from the JSONL; hashed messages; built a
   Modelfile with no `ADAPTER` directive (real LoRA adapters come from
   off-repo training).
3. `ollama create perfagent-smoke-finetune -f <tempdir>/Modelfile`
   succeeded (0.07 s).
4. HTTP POST to `http://localhost:11434/api/generate` with
   `"Reply with a single word: ok"` returned `"ok"`
   (`responseLength: 2`) within the 120 s timeout budget.
5. Script cleaned up the smoke model via `ollama rm` inside an
   `Effect.acquireRelease` finalizer — runs even on failure. Verified
   disappearance from `ollama list`.

**Round 1 → Round 2 delta:** Round 1 smoke reported `status: ok` with
an empty response. Root cause: the committed Modelfile contained two
`MESSAGE tool` directives (invalid per Ollama grammar — see C2) which
scrambled the chat template. Fixing C2 by dropping `tool` from the
accepted MESSAGE role set (and routing tool context into surrounding
assistant turns via `<tool_result>` blocks) produced a Modelfile the
chat template honors; the smoke now returns a real response.

The smoke additionally asserts `responseText.trim().length > 0` and
fails with `OllamaEmptyResponseError` otherwise — Round 1 review M3
caught that the prior script hid empty responses under a green status.

Implementation note: we call `/api/generate` directly, NOT `ollama run`.
`ollama run` blocks on a TTY and hangs indefinitely under a spawn-no-pipe
parent — switched to the Ollama HTTP API via `fetch` on the
`http://localhost:11434/api/generate` endpoint (`stream: false` for a
simple round-trip). The smoke script now uses `Schema.ErrorClass`
tagged errors (`OllamaUnavailableError`, `OllamaBaseModelMissingError`,
`SmokeSampleMissingError`, `OllamaCreateFailedError`,
`OllamaGenerateFailedError`, `OllamaEmptyResponseError`) instead of
raw `new Error(...)` — Round 1 review M2.

This confirms the Ollama side of the pipeline wires up. It does **not**
confirm that a real LoRA fine-tune improves Gemma on the harness
tasks — that requires (a) more successful traces and (b) a GPU to
actually run backprop.

## Handover for real training on provisioned GPU

At time of writing, the harness's `evals/traces/` directory contains
20 real-runner traces from Wave 4.5 capture — **none of which end in
`RUN_COMPLETED` status=passed**. The pre-Wave-5 harness simply does
not complete any of the 20 tasks successfully. The exporter's filter
correctly rejects all 20.

**Hand-authored synthetic traces are committed at**
`packages/evals/data/distill/examples/synthetic__*.ndjson` — two
minimal successful shapes over the `trivial-1` and `calibration-2`
tasks. These are clearly labelled as synthetic and exist so the
`sample-teacher-data.jsonl` + `Modelfile` artifacts are non-empty and
the pipeline can be demonstrated. They are NOT training data for the
real fine-tune.

**Before a training run is meaningful, the agent must land successful
traces.** The bottleneck is Wave 1 + 2 harness/prompt improvements,
not distillation infrastructure. Rough acceptance threshold: at
least 15 successful traces across ≥5 distinct tasks (to avoid
single-task overfitting) before a first LoRA pass is worth GPU time.

**Exact commands for the real run on a provisioned GPU:**

```bash
# 1. Capture teacher traces with Claude (frontier) on all 20 tasks.
EVAL_RUNNER=real EVAL_BACKEND=claude \
  pnpm --filter @neuve/evals eval:real
# → writes packages/evals/evals/traces/real__*.ndjson

# 2. Export to JSONL.
pnpm --filter @neuve/evals distill:export
# → packages/evals/data/distill/out/teacher-data.jsonl

# 3. Train the LoRA adapter on GPU (off-repo). Expected framework:
#    axolotl or unsloth — both ingest OpenAI chat JSONL natively.
#    Output: adapters/gemma4-perfagent.gguf (converted via llama.cpp's
#    convert-lora-to-ggml.py if the training framework emits PEFT safetensors).

# 4. Build the production Modelfile pointing at the trained adapter.
EVAL_DISTILL_ADAPTER=./adapters/gemma4-perfagent.gguf \
  pnpm --filter @neuve/evals distill:build-modelfile

# 5. Create the fine-tuned Ollama model.
ollama create gemma4-perfagent -f packages/evals/data/distill/out/Modelfile

# 6. Point @neuve/local-agent at it and re-run evals.
PERF_AGENT_LOCAL_MODEL=gemma4-perfagent \
  EVAL_RUNNER=real EVAL_BACKEND=gemma \
  pnpm --filter @neuve/evals eval:real
```

## Guardrails observed

- **No prompt overfitting:** samples carry the same
  `buildLocalAgentSystemPrompt()` as the runtime agent, unchanged. No
  site-specific DOM selectors or "when you see X click Y" heuristics
  injected. The student learns the generic protocol the production
  agent already follows.
- **Types over regex:** Ollama ships no Modelfile grammar types, so
  the builder validates inputs against a constant directive list
  (`MODELFILE_DIRECTIVES`) and throws `ModelfileBuilderError` on
  invalid shapes — no regex surface. Trace events go through the
  existing `TraceEventSchema` decode; we do not re-parse.
- **Effect rules:** `ServiceMap.Service` + `Layer.effect`, `Effect.fn`
  with spans, `Schema.ErrorClass` with explicit tags, no barrel
  files, no `null`, no `as` casts in core logic, no `mapError`, no
  `catchAll`, `Config.string`/`Config.schema` (no raw `process.env`).
- **No injection seams with divergent defaults:** the `TeacherDataExporter`
  layer yields `FileSystem` in `make`, closing over it at service
  construction. Tests provide the same `NodeServices.layer` the
  production scripts use — same code path at runtime.
- **Sensitive values never leak:** `REDACTED_KEY_PATTERN` lives in
  `src/redaction.ts` as the single source of truth; both
  `src/distill/filters.ts` and `src/runners/trajectory-summary.ts`
  import from there. Round 1 review M1 caught the earlier duplication
  and this round eliminated it.

## Files added

```
packages/evals/src/
  redaction.ts          — REDACTED_KEY_PATTERN single source of truth
                          (imported by distill/filters.ts + runners/trajectory-summary.ts)

packages/evals/src/distill/
  types.ts              — TrainingSample / ExportOptions / metadata schemas
  filters.ts            — isTraceSuccessful + redactSensitiveKeys
  teacher-data-exporter.ts  — Effect service
  jsonl-writer.ts       — writeSamplesToJsonl (FileSystem) + renderSamplesToJsonl (pure)
  modelfile-builder.ts  — buildModelfile (pure) + ModelfileBuilderError
  modelfile-messages.ts — convertTrainingMessagesToModelfileMessages
                          (drops role="system", inlines role="tool" into
                          preceding assistant turn, shared by build-modelfile
                          + smoke-finetune)
  task-registry.ts      — allEvalTasks lookup for taskId → EvalTask

packages/evals/scripts/distill/
  export-teacher-data.ts
  build-modelfile.ts
  smoke-finetune.ts

packages/evals/data/distill/examples/
  synthetic__trivial-1-example-homepage.ndjson    — hand-authored sample trace
  synthetic__calibration-2-single-nav-news.ndjson — hand-authored sample trace
  sample-teacher-data.jsonl                        — export output
  Modelfile                                        — build-modelfile output

packages/evals/tests/
  teacher-data-exporter.test.ts   — 11 tests (filters + C1 regression
                                     + exporter + JSONL)
  modelfile-builder.test.ts       — 11 tests (grammar + message conversion
                                     including C2 + M4 regressions)
```

## Undisclosed scope (Round 1 review M5)

The formatter (`vp fmt`) runs as part of `pnpm check` and normalizes
whole packages, not just touched files. Three pre-existing files in
`packages/evals/` that did NOT match the current formatter spec got
normalized during Round 1's check: `src/scorers/final-state.ts`,
`tests/mock-runner.test.ts`, `tests/scorers.test.ts`. Attempting to
manually revert them to the pre-drift HEAD shape fails `pnpm
format:check` — the HEAD shape is itself formatter-non-conforming.
Per Round 1 seed ("commit them in a separate
`chore(evals): revert pre-existing formatter drift` commit"), these
changes are carried as a separate commit outside the feature slice and
disclosed here. No logic changes — whitespace only, verifiable via
`git diff HEAD --ignore-all-space` on those three files.

## Verification

- `pnpm --filter @neuve/evals typecheck` — green.
- `pnpm --filter @neuve/evals test` — 111 passing (95 prior + 16 new).
- `pnpm --filter @neuve/evals distill:export EVAL_TRACE_DIR=data/distill/examples EVAL_DISTILL_OUTPUT=data/distill/examples/sample-teacher-data.jsonl` — accepts both synthetic traces, writes a 7.3KB JSONL.
- `pnpm --filter @neuve/evals distill:build-modelfile EVAL_DISTILL_INPUT=data/distill/examples/sample-teacher-data.jsonl EVAL_DISTILL_MODELFILE=data/distill/examples/Modelfile` — writes 5.4KB Modelfile.
- `pnpm --filter @neuve/evals distill:smoke-finetune EVAL_DISTILL_INPUT=data/distill/examples/sample-teacher-data.jsonl` — created + prompted + removed `perfagent-smoke-finetune`.
