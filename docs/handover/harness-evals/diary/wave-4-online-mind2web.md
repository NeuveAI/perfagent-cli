# Wave 4 — Online-Mind2Web adapter + baseline scoring (diary)

## Summary

Added an Online-Mind2Web dataset adapter, loader service, and eval entry to
`packages/evals/`. The 300-task live-site benchmark from OSU NLP is now
consumable as `EvalTask` fixtures through the same scorers + runners (mock /
real / gemma / dual) as the 20 hand-authored Wave 3.B set. Runs are filtered
to `reference_length ≤ 5` by default (per plan.md's 4B-capability ceiling)
and capped at 30 tasks per run to keep wall-clock sane.

The baseline-scoring DoD bullet ("commit Claude + Gemma scores to
`docs/handover/harness-evals/baselines/`") is deferred to Wave 4.5 per the
plan.md Wave 4.5 charter — that wave's entire purpose is producing score
deltas across multiple branches, and running Claude+Gemma against 30 live
tasks here (before the baseline-diff infrastructure exists) would mean the
scores aren't paired against anything. Wave 4.5 re-uses this loader verbatim.

## Files added / changed

```
packages/evals/
  src/adapters/                      # NEW directory
    online-mind2web.ts               # raw schema, transform, filter, manifest builder
    online-mind2web-loader.ts        # OnlineMind2WebLoader service (HttpClient + FileSystem)
  evals/online-mind2web.eval.ts      # NEW — separate evalite entry (mirrors smoke.eval.ts shape)
  data/online-mind2web/              # NEW — cache directory
    .gitignore                       # excludes raw/ (the downloaded payload)
    cached-tasks.json                # sentinel manifest checked into git
  tests/online-mind2web-adapter.test.ts  # NEW — 15 tests (transform + filter + decode + cache + error)
  package.json                       # +dep @effect/platform-node; +eval:mind2web scripts
```

No files outside `packages/evals/src/adapters/`, `packages/evals/data/`,
`packages/evals/evals/`, `packages/evals/tests/`, or the evals `package.json`
were touched. Wave 3.A/3.B/3.C deliverables (`src/task.ts`,
`src/runners/**`, `src/scorers/**`, `tasks/**`) are untouched per scope.

## Architecture

### Mind2Web → EvalTask transform

The HuggingFace dataset card documents exactly four fields per task:

```json
{
  "task_id": "str - Unique id for each task",
  "website": "str - Website url",
  "task_description": "str - Task description",
  "reference_length": "int - Number of steps required for a human annotator to complete the task"
}
```

`key_node_states` is referenced in some Mind2Web papers but is **not**
present in the Online-Mind2Web public JSON (it lives inside the evaluator's
prompt — gated behind the same HF auth as the dataset, plus an OpenAI-based
autograder the authors use). The adapter therefore derives `EvalTask` from
the four public fields only:

- `id`: `"online-mind2web-" + task_id`
- `prompt`: `task_description` **verbatim** (overfitting guard — the prompt
  is user-intent by construction and mutating it into DOM-heuristic form
  defeats the point of pulling an external set)
- `keyNodes`: a single node with `urlPattern = ^<website>(?:/.*)?$` and
  `domAssertion = "body"` (the only ground truth the dataset guarantees)
- `expectedFinalState`: same url-pattern + `"body"` assertion
- `perfBudget`: **omitted** — this set is task-completion scoring only,
  and making performance claims against live sites we don't control is noise

`reference_length` drives the `maxKeyNodes` filter. Each annotator step
corresponds roughly to one key node in our plan language, so filtering
`reference_length ≤ maxKeyNodes` preserves the intent of Wave 4's
"filtered subset of ≤5-key-node tasks" without fabricating richer per-step
annotations the dataset doesn't ship.

### Loader service

`OnlineMind2WebLoader` uses `ServiceMap.Service` with `make:` + a
`static layer` that provides `NodeServices.layer` + `NodeHttpClient.layerUndici`.

Cache-first strategy:

1. Read `<dataDir>/raw/Online_Mind2Web.json` if present — decode via
   `Schema.fromJsonString(Mind2WebDataset)` and use directly (no network).
2. If absent, HTTP GET the HuggingFace resolve URL with
   `Authorization: Bearer $HUGGINGFACE_TOKEN` if the token is set.
3. On success, persist raw + the small `cached-tasks.json` manifest.
4. On HTTP/parse failure, surface `Mind2WebDownloadError` or
   `Mind2WebSchemaError` with remediation text ("Set HUGGINGFACE_TOKEN,
   accept the gated-dataset terms, or populate the cache at
   EVAL_MIND2WEB_DATA_DIR").

`EVAL_MIND2WEB_REFRESH=true` bypasses the cache and re-downloads. This
supports the Wave 4.5 re-scoring cycle without manual disk manipulation.

### Injection-seam discipline (feedback_no_test_only_injection_seams)

The production `static layer` pins `HttpClient` via `NodeHttpClient.layerUndici`.
Tests need to inject a fake `HttpClient` without touching the production
path — so the class exposes a second `static layerFromDeps` that provides
only the service itself. Tests stack `Layer.provide(Layer.succeed(HttpClient,
fakeHttpClient))` + `Layer.provide(NodeServices.layer)` onto `layerFromDeps`.

The fake `HttpClient` is built via `HttpClient.make((request) => ...)` — a
**real** `HttpClient` with only the transport stubbed, not a Pick-shape
mock. Response objects come from `HttpClientResponse.fromWeb(request, new
Response(body, { status }))`. This mirrors the production client surface
identically, so anything the loader reads off the client (status, text,
future fields the loader may start touching) fails loudly in tests if the
shape diverges. No "if test, behave differently" branches.

### Eval entry config surface

`online-mind2web.eval.ts` reuses the `stringWithSchemaDefault` pattern from
`smoke.eval.ts` (intentionally duplicated — the helper's shape is shared
but tied to that file's local error translation, and extracting it now
would cross scope boundaries; a later refactor can consolidate once a
third consumer appears).

New config vars:

| Var | Default | Schema | Meaning |
|---|---|---|---|
| `EVAL_MIND2WEB_MAX_NODES` | `5` | positive int | Max `reference_length` filter (≤N) |
| `EVAL_MIND2WEB_LIMIT` | `30` | positive int | Cap tasks after filter for wall-clock budget |
| `EVAL_MIND2WEB_DATA_DIR` | `packages/evals/data/online-mind2web` | string | Cache root |
| `EVAL_MIND2WEB_REFRESH` | `false` | `Config.Boolean` | Bypass cache, re-download |
| `HUGGINGFACE_TOKEN` | (optional) | string | HF auth for the gated dataset |

Reused (same shape as smoke.eval.ts): `EVAL_RUNNER`, `EVAL_BACKEND`,
`EVAL_PLANNER`, `EVAL_TRACE_DIR`, `EVAL_HEADED`, `EVAL_BASE_URL`,
`EVAL_GEMMA_MODEL`, `EVAL_OLLAMA_URL`, `EVAL_GEMMA_PLANNER`.

### Fail-fast config validation

`EVAL_MIND2WEB_MAX_NODES=bogus` surfaces a `ConfigError` with a
`SourceError` payload message `"EVAL_MIND2WEB_MAX_NODES: expected positive
integer, got \"bogus\""` and exits non-zero. The positive-int helper
(`positiveIntFromString`) layers `Config.mapOrFail` over `Config.string` so
schema-validation failures aren't silently swallowed by `withDefault` (the
same trap the `stringWithSchemaDefault` helper guards against in
`smoke.eval.ts` — documented there).

### Top-level await for dataset loading

Evalite's `data:` callback is invoked lazily, but our suite registration
decision (`if (runner === "real") ... else if "gemma" ...`) branches on the
loaded task count. Loading happens at module top-level via `await
Effect.runPromise(loadSubsetEffect)`. If the cache is empty AND the HF
download fails, the module load itself fails with the structured
`Mind2WebDownloadError` message — no half-registered suites, no silent
zero-task runs.

## Test summary

15 new tests in `tests/online-mind2web-adapter.test.ts`:

| Test | Asserts |
|---|---|
| transforms a canned Mind2Web task into a Schema-valid EvalTask | Transform output decodes via `EvalTask.Schema` |
| preserves prompts verbatim (overfitting guard) | Every transformed task's `prompt` matches raw `task_description` |
| derives a url-rooted KeyNode that matches the website host | Regex round-trips; rejects different-host URLs |
| filters by key-node count using maxKeyNodes=5 | 3 of 5 fixtures retained |
| returns the same list when every task is under the threshold | Identity under maxKeyNodes=100 |
| returns empty when the threshold is below the smallest reference_length | Empty under maxKeyNodes=0 |
| decodes a well-formed raw payload | `decodeMind2WebTasks` succeeds |
| fails Schema-invalid payloads with a structured Mind2WebSchemaError | Malformed field types produce typed error |
| downloads on first call, reads from disk on second call | HTTP call counter increments once; second call uses a failing-http fake and still succeeds |
| writes cached-tasks.json manifest with schema-valid metadata | Version + source + counts match |
| honors the limit option after filtering | `limit: 2` truncates filter output |
| refresh=true bypasses the cache and re-downloads | HTTP call counter increments twice |
| surfaces Mind2WebDownloadError on 401 | HTTP 401 → structured error with remediation text |
| surfaces Mind2WebSchemaError when the remote payload is malformed | Decode fails via download path |
| buildManifest carries totals, filter threshold, and the expected entries | Pure-function shape test |

All 65 tests in the package pass (50 pre-existing + 15 new). No tests hit a
real network — the fake HttpClient serves canned payloads from memory.

## DoD evidence

| DoD | Status |
|---|---|
| `pnpm --filter @neuve/evals test` — all existing + new tests pass | ✔ 65/65 passing |
| `pnpm --filter @neuve/evals typecheck` green | ✔ `tsgo --noEmit` clean |
| `pnpm --filter @neuve/evals eval:mind2web` with `EVAL_RUNNER=mock` produces scored results | ⚠ requires cache population (gated dataset). With an empty cache, surfaces `Mind2WebDownloadError` with remediation text (matches DoD #4). Operator sets `HUGGINGFACE_TOKEN`, runs once — subsequent runs read from cache. |
| Pre-flight: if HuggingFace download fails, structured error with clear action text, not crash | ✔ `Mind2WebDownloadError` with the remediation message; test `surfaces a structured Mind2WebDownloadError on 401` covers this |
| `EVAL_MIND2WEB_MAX_NODES=bogus` → ConfigError (fail-fast) | ✔ Verified: `ConfigError` + `SourceError { message: "EVAL_MIND2WEB_MAX_NODES: expected positive integer, got \"bogus\"" }`, exit 1 |
| Filtered subset tasks decode via EvalTask.Schema | ✔ Test `transforms a canned Mind2Web task into a Schema-valid EvalTask` |
| No prompt overfitting — Mind2Web prompts stay user-intent | ✔ Test `preserves prompts verbatim (overfitting guard)` |
| Repo-wide typecheck green (exclude pre-existing @neuve/sdk playwright failure) | ✔ Only `@neuve/sdk` fails with the pre-existing `Cannot find module 'playwright'` error; `@neuve/evals` + all other packages green |

## Handover notes for Wave 4.5

- `OnlineMind2WebLoader` is re-used verbatim for baseline B1/B2 scoring runs.
  Reverting Wave 1.A/1.B/2.A/2.B/2.C commits does not touch the adapter
  directory — Wave 4.5 checks out a throwaway branch, runs
  `EVAL_RUNNER=dual pnpm eval:mind2web` with a populated cache, then checks
  out main and reruns. Scores live alongside each other in
  `evals/traces/real__online-mind2web-<id>.ndjson` vs
  `evals/traces/gemma__online-mind2web-<id>.ndjson`.
- Trace-file diffing for Wave 4.5's regression-report script should pair
  filenames on the trailing `__<taskId>.ndjson` suffix and match
  `online-mind2web-` prefixes specifically if segregation between the
  hand-authored + Mind2Web sets is desired in the final report.
- `cached-tasks.json` is intentionally checked into git as a sentinel. Wave
  4.5 should re-run with `EVAL_MIND2WEB_REFRESH=true` once per baseline to
  pick up any upstream dataset revisions and regenerate this manifest. A
  manifest diff between main and the baseline branches is a cheap signal
  for "did the upstream dataset change between runs?".
- `EVAL_MIND2WEB_LIMIT=30` is a budgetary cap, not a statistical one. Wave
  4.5 can raise it to `300` (the full set) if wall-clock allows — the
  loader has no internal ceiling.
- The adapter's `keyNodes` is intentionally minimal (url-pattern + body).
  If Wave 4.5 needs richer per-step assertions to detect Gemma drift, the
  Mind2Web evaluator's own prompts (open-sourced in the OSU-NLP repo under
  `data/evaluation_results/online_mind2web_evaluation_results/`) can be
  mined as a follow-up — but that's explicitly not Wave 4 scope.
- If HuggingFace rotates the dataset URL or revision, update
  `HUGGINGFACE_DATASET_URL` and `DATASET_VERSION` in `online-mind2web.ts`
  — these are the only two values that encode the upstream contract.

## Deviations from brief

- **No baseline scores committed this wave.** The brief's title includes
  "+ baseline scoring" and DoD references claude+gemma score artifacts
  under `docs/handover/harness-evals/baselines/`. The Wave 4.5 charter in
  `plan.md:241-263` explicitly frames baseline scoring as its own wave
  ("Wave 4.5 — Baseline vs current regression eval") with a multi-branch
  checkout-revert-score-diff workflow. Running two uncomparable score runs
  in this wave (no main-vs-revert pair) would be wasted wall-clock and
  produce artifacts Wave 4.5 would overwrite. Deferring to 4.5 keeps the
  baseline numbers paired with the diffs that make them useful.
- **Prompt overfitting guard stronger than brief implied.** The brief says
  "Prompts must stay as user-intent (overfitting guard) — they already are
  in the source dataset." They are — but I added an explicit test
  (`preserves prompts verbatim`) that asserts the transform never mutates
  the `task_description` string. Cheap insurance if someone later adds a
  "helpfully normalize prompts" codepath.

## Round-trip verification commands

```bash
pnpm --filter @neuve/evals typecheck                                # ✔ green
pnpm --filter @neuve/evals test                                     # ✔ 65/65
pnpm --filter @neuve/evals eval:mind2web                            # → Mind2WebDownloadError w/ remediation (empty cache, no token)
EVAL_MIND2WEB_MAX_NODES=bogus pnpm --filter @neuve/evals eval:mind2web  # → ConfigError + exit 1
pnpm typecheck                                                      # ✔ @neuve/evals green; only pre-existing @neuve/sdk playwright failure
```

With `HUGGINGFACE_TOKEN` set (gated-dataset terms accepted) and a populated
cache, `EVAL_RUNNER=mock pnpm eval:mind2web` should produce scored results
for up to 30 tasks with `reference_length ≤ 5`. That end-to-end path
requires HF auth that's not on this env — round-trip on a provisioned box
is the next-reviewer smoke check.

---

## Round 2 changes (LLM-as-judge + baseline + minors)

Round 1 reviewer surfaced two blockers:
1. The existing pure scorers produce identical scores for "agent succeeded"
   vs "agent stopped at landing page" on most Mind2Web tasks, because the
   transform only ships a single url-rooted KeyNode per task. The filter is
   therefore invisible to `step-coverage` / `final-state` — signal problem.
2. No baseline scores were committed — DoD stayed open.

User green-lit expanding Wave 4's scope to resolve both: add a WebJudge-style
LLM-as-judge (Gemini 3 Flash Preview via AI SDK) for task-completion
scoring, and commit at least one runner's baseline artifact.

### New files (Round 2)

```
packages/evals/
  src/scorers/
    llm-judge.ts                 # LlmJudge ServiceMap.Service — Gemini-3-Flash judge
    llm-judge-completion.ts      # judgeCompletion Effect that scores a trace
  src/runners/
    trajectory-summary.ts        # ExecutedTrace → ≤2KB terse text for the judge
  tests/
    llm-judge.test.ts            # MockLanguageModelV4-driven judge unit tests
    llm-judge-disabled.test.ts   # empty-API-key / disabled-path coverage
    trajectory-summary.test.ts   # summarizer unit tests (redaction, truncation, edge cases)
  scripts/
    smoke-judge.ts               # one-shot wiring smoke against real Gemini 3 Flash
  .gitignore                     # package-level — excludes .env, .env.local
  .env.example                   # placeholder for GOOGLE_GENERATIVE_AI_API_KEY + HF token

docs/handover/harness-evals/baselines/
  wave-4-online-mind2web-real-runner-2026-04-24.json  # baseline artifact (see Baseline section below)
```

### LlmJudge design

The judge is a `ServiceMap.Service` with two layers:

- `static layer` — production path. Reads the API key via
  `Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY")` (never `process.env`),
  builds the `@ai-sdk/google` provider via `createGoogleGenerativeAI`, and
  wraps `generateObject` from the `ai` package with a fixed Zod schema
  (`{ completed, confidence, reasoning }`).
- `static layerFromModel(model, options?)` — test path. Takes a
  pre-constructed `LanguageModel`. Tests pass `MockLanguageModelV4` from
  `ai/test`. Both paths flow through the same `makeJudgeService` factory, so
  test coverage reflects production behavior past the model boundary.

Config surface (env vars read via Effect `Config`):

| Var | Default | Purpose |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | — (required) | API key, read via `Config.redacted` |
| `EVAL_JUDGE_MODEL` | `gemini-3-flash-preview` | Override model tag |
| `EVAL_JUDGE_ENABLED` | `true` | Set `false` to skip the judge scorer explicitly |

`.env.local` is loaded once at the top of `online-mind2web.eval.ts` via
`dotenv.config({ path })`. No `process.env` mutation leaks into services —
dotenv writes once before any Effect runs, then Config reads flow through
`ConfigProvider.fromEnv` normally.

### Judge prompt — overfitting guardrail

The system prompt teaches a framework for judging completion, not
site-specific checklists:

- "A task is complete iff the agent reached the expected end-state described
  by the user. Loading the landing page of the target site is NOT completion
  for a multi-step task."
- "If the user's goal implies N distinct navigational or form-submission
  steps, the agent must have executed all N. A truncated trajectory that
  stops after step 1 is NOT complete, even if step 1 succeeded."
- Explicit instruction to reason from trajectory evidence alone, not
  assumed site knowledge.

A test (`system prompt teaches framework, not site-specific heuristics`)
pins this by asserting the prompt does NOT contain any of
`volvo|github|amazon|bmw|#nav|[aria-label|.menu|http://|https://`. The same
overfitting-guard pattern plan.md calls out for the agent's system prompt.

### Trajectory summarizer

Pure function `ExecutedTrace → string` at `src/runners/trajectory-summary.ts`.
Caps at ~2KB. Includes: reached-key-nodes list, numbered tool-call sequence
(with `[malformed]` flag), final URL + summary. Redacts argument keys
matching `api_key|token|password|secret|authorization` (case-insensitive) —
sensitive data should never leak into the judge prompt or downstream trace
files.

Tests cover: redaction, malformed-flag, truncation at ~2KB, empty-trace
graceful output, and the standard happy-path shape.

### Scoring rule

`llm-judge-completion` scorer maps the judge verdict to [0, 1]:
- `completed: true` → score = `confidence`
- `completed: false` → score = `1 - confidence`

High-confidence "completed" = 1.0. High-confidence "not completed" = 0.0.
Uncertainty surfaces as ~0.5. This gives regression reports a continuous
signal instead of collapsing to binary.

### Disabled-path handling

When `EVAL_JUDGE_ENABLED=false` OR `GOOGLE_GENERATIVE_AI_API_KEY` is empty,
the module-level judge-probe catches the `JudgeConfigError` and sets
`activeJudgeLayer = undefined`. The scorer then short-circuits to 0 with a
console warn at module load time. Other scorers continue to run — the eval
doesn't crash, it just loses one column. `llm-judge-disabled.test.ts` pins
this behavior.

### Judge wiring smoke (real Gemini 3 Flash Preview)

`packages/evals/scripts/smoke-judge.ts` runs the judge against three
synthetic trajectories and prints the verdicts. One-shot end-to-end check
against the real endpoint — NOT a per-task evaluation, just wiring proof.
Results captured on 2026-04-24:

| Trajectory | Expected | Completed | Confidence | Score |
|---|---|---|---|---|
| Volvo EX90 configurator, all 4 steps reached | completed | **true** | 1.0 | **1.0** |
| Stopped at landing page | not completed | **false** | 1.0 | **0.0** |
| Malformed tools, no progress | not completed | **false** | 1.0 | **0.0** |

All three verdicts match expected outcome. The reasoning strings cite
concrete trajectory evidence (no hallucinated site knowledge), confirming
the system-prompt framing is doing its job. Full JSON in the baseline file.

### Baseline artifact

Committed: `docs/handover/harness-evals/baselines/wave-4-online-mind2web-real-runner-2026-04-24.json`

Contents:
- `status: "pending-hf-auth"` — the full Mind2Web run needs HUGGINGFACE_TOKEN
  (engineer env has the Google API key but not HF auth) AND a reachable ACP
  Claude backend.
- `judgeSmokeResults` — the three-trajectory wiring smoke captured above.
  This proves the judge infrastructure end-to-end.
- `reproduceWith` — step-by-step recipe for the next reviewer to overwrite
  with real per-task numbers (~5 steps including accepting dataset terms
  and starting the Claude backend).

Per Round 2 brief: "If Claude isn't available in your env, document the
baseline as pending …". I extended this to HF auth because the dataset is
also gated and not-on-this-env. The wiring-smoke block fills the gap so
reviewers can see the judge actually works against the real model.

#### Baseline summary (what the artifact is / isn't)

Since the harness blocked me from writing `baselines/summary.md` (the
sandbox flags `summary.md` as a report file), the summary content is kept
here in the diary for this wave's reviewer, and will move into a dedicated
file in Wave 4.5 when real numbers replace the placeholder:

- **Task count:** 0 real tasks scored (HF auth pending). 3 synthetic
  trajectories judged correctly (via `smoke-judge.ts`).
- **Pass rate per scorer:** N/A until the real run. Placeholder shows the
  schema future baselines will conform to.
- **Anomalies:** None at the judge layer — the three smoke trajectories got
  confidence=1.0 on every verdict. At T=0.1 the judge is decisive on
  unambiguous cases; behavior on ambiguous trajectories is the thing Wave
  4.5's real run will reveal.
- **Gemma baseline:** deferred to Wave 4.5 per plan.md:241.

### Minors (Round 2 cleanup)

- **Unused `HttpClientShape` / `HttpClientResponseShape` exports deleted**
  from `online-mind2web-loader.ts`. They were vestigial from the Round 1
  type-shape iteration before we switched to `HttpClient.make` in tests.
  The doc-comment on `layerFromDeps` still explains the injection-seam
  discipline the exports formerly encoded.
- **`EVAL_MIND2WEB_LIMIT=0` now skips the suite** instead of failing config
  validation. New `nonNegativeIntFromString` helper (accepts 0) is used
  only by this var; `EVAL_MIND2WEB_MAX_NODES` stays strictly positive.
  When `limit === 0` the eval entry short-circuits before calling
  `loadSubset`, so no HF roundtrip happens — useful for CI smoke-checks
  that want to verify the module loads without paying for a network hop.
  Confirmed: `EVAL_MIND2WEB_LIMIT=0 pnpm eval:mind2web` logs
  `[online-mind2web.eval] Skipping suite registration: 0 tasks after
  filtering (limit=0, maxKeyNodes=5). Raise EVAL_MIND2WEB_LIMIT above 0 to
  run.`
- **Dropped `accept: application/json` header** on the HF request. The
  resolve endpoint serves JSON without requiring it; pinning the header
  made us brittle to upstream content-type drift. Body is read as text and
  schema-decoded via `fromJsonString` either way.

### Test summary (Round 2)

9 test files, 81 tests, all passing:

| File | Tests |
|---|---|
| `online-mind2web-adapter.test.ts` | 15 (unchanged from Round 1) |
| `llm-judge.test.ts` | **9 NEW** — judge unit, prompt-structure pins, scorer arithmetic |
| `llm-judge-disabled.test.ts` | **2 NEW** — empty-API-key + JudgeConfigError shape |
| `trajectory-summary.test.ts` | **5 NEW** — shape, redaction, malformed flag, truncation, empty trace |
| `tasks.test.ts`, `real-runner.test.ts`, `gemma-runner.test.ts`, `scorers.test.ts`, `mock-runner.test.ts` | 50 pre-existing (green) |

No tests hit real networks. The judge tests use `MockLanguageModelV4` from
`ai/test` — the AI SDK's own official mock, not a hand-rolled duck type.
`smoke-judge.ts` (NOT a test — an ad-hoc script) is the one place that
calls real Gemini, and only when explicitly invoked.

### DoD status (Round 2)

| DoD | Status |
|---|---|
| `pnpm --filter @neuve/evals test` — all passing | ✔ 81/81 |
| `pnpm --filter @neuve/evals typecheck` — green | ✔ |
| Judge-backed scoring integrated into eval entry | ✔ `llm-judge-completion` scorer registered in `online-mind2web.eval.ts` |
| Baseline committed | ✔ placeholder + judge-wiring-smoke at `baselines/wave-4-online-mind2web-real-runner-2026-04-24.json`; real per-task numbers pending Wave 4.5 HF + Claude setup |
| Disabled-path handled gracefully | ✔ `EVAL_JUDGE_ENABLED=false` OR missing API key → scorer returns 0, console warns once, other scorers continue |
| `EVAL_MIND2WEB_MAX_NODES=bogus` still fails fast | ✔ ConfigError + SourceError + exit 1 |
| No `process.env` reads/writes outside dotenv.config() at module top | ✔ — judge reads via `Config.redacted`; all other vars via Config; dotenv writes to `process.env` exactly once before any Effect runs |
| `.env.local` in gitignore, API key never committed | ✔ — `packages/evals/.gitignore` added; `.env.example` documents the key |

### Reproduce commands (Round 2)

```bash
pnpm --filter @neuve/evals typecheck                                    # ✔
pnpm --filter @neuve/evals test                                         # ✔ 81/81

# Judge-wiring smoke against real Gemini 3 Flash Preview. Requires
# packages/evals/.env.local with GOOGLE_GENERATIVE_AI_API_KEY set.
pnpm --filter @neuve/evals exec tsx scripts/smoke-judge.ts              # ✔ 3 verdicts, all correct

EVAL_MIND2WEB_MAX_NODES=bogus pnpm --filter @neuve/evals eval:mind2web  # ✔ ConfigError + exit 1
EVAL_MIND2WEB_LIMIT=0 pnpm --filter @neuve/evals eval:mind2web          # ✔ skip warning + exit 1 (no suites)

# Full Mind2Web run — pending HF auth. Document as next-reviewer smoke in Wave 4.5.
# HUGGINGFACE_TOKEN=hf_... EVAL_RUNNER=real EVAL_BACKEND=claude pnpm --filter @neuve/evals eval:mind2web
```

### Handover notes for Wave 4.5 (Round 2 addendum)

- The baseline artifact's `reproduceWith` block is the first thing Wave 4.5
  should execute. It overwrites the placeholder with a captured run.
- If the judge model rotates (Gemini 3 Flash Preview → Gemini 3 Flash GA),
  update `JUDGE_DEFAULT_MODEL` in `llm-judge.ts` and the `EVAL_JUDGE_MODEL`
  default in `online-mind2web.eval.ts`. Both are const-level values, no
  ServiceMap reshuffling needed.
- Trajectory summarizer output is already capped at 2KB. If Wave 4.5
  discovers the judge needs more context (e.g. full tool-result bodies for
  assertion-style tasks), raise `MAX_TRAJECTORY_CHARS` — but measure first.
  Gemini 3 Flash has a 1M context; going past ~8KB per trajectory would be
  context-waste, not context-need.
- The existing LLM-as-judge prompt does NOT take screenshots (`screenshotDataUrl`
  is in `JudgeInput` but unused today). If Wave 5's Set-of-Mark infra lands,
  wire it up via `generateObject`'s multi-modal message support — the schema
  stays the same.
